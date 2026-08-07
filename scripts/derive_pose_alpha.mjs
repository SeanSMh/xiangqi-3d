/**
 * 从攻击姿态 JPG 派生 Alpha 蒙版。
 *
 * 姿态图是平滑的深蓝灰渐变底，角色不触边。用全局亮度阈值会连黑甲和黑靴一起
 * 抠掉，所以改用**从四边向内的区域生长**：每一步只跟相邻像素比颜色（自然跟随
 * 渐变），同时约束与种子色的总距离，防止从软边缘漏进角色内部。
 *
 * 用法（需要 dev server 已在 http://localhost:5173 运行）：
 *   PLAYWRIGHT_BROWSERS_PATH=... node scripts/derive_pose_alpha.mjs [--write]
 *
 * 不带 --write 只做测量与体检，不落盘。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// 本项目不把 playwright 作为依赖（只有这一个离线工具用得上）。
// 常规环境装了就能直接跑；用外部运行时时用 PLAYWRIGHT_MODULE 指到它的入口。
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')

const ORIGIN = process.env.POSE_ORIGIN ?? 'http://localhost:5173'
// playwright 装在工作区运行时里而非本项目，因此脚本可能不在项目根执行。
const OUT_DIR = process.env.POSE_OUT ?? resolve(process.cwd(), 'public/assets/poses')
const WRITE = process.argv.includes('--write')

const SIDES = ['red', 'black']
const KINDS = ['king', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'pawn']
/** `front`（默认）= *_attack.jpg；`back` = *_attack_back.jpg */
const POSE_VIEW = process.argv.includes('--back') ? 'back' : 'front'
const POSE_SUFFIX = POSE_VIEW === 'back' ? 'attack_back' : 'attack'

/**
 * 判据是**边缘屏障**而不是颜色阈值。
 *
 * 实测：背景约 `(30,32,34)`、Sobel 为 0；黑靴 `(13,11,14)`、Sobel 为 2 ——
 * 黑靴比背景还暗，色距仅约 34，靠颜色无论如何都分不开。但背景自身的 Sobel
 * 分位只有 `p99=7.1 / max=14`，而角色轮廓边缘远高于此。因此让填充「顺着平滑
 * 的背景走、撞到边缘就停」：角色内部再暗也进不去，因为它被轮廓包住了。
 */
const STEP_TOLERANCE = Number(process.env.POSE_STEP ?? 12)
const EDGE_LIMIT = Number(process.env.POSE_EDGE ?? 18)
/** 最后一道保险，仅防止极端情况下走遍全图；正常不会触发。 */
const GLOBAL_TOLERANCE = Number(process.env.POSE_GLOBAL ?? 150)
/** 边缘羽化半径（像素）。 */
const FEATHER = Number(process.env.POSE_FEATHER ?? 1.5)

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })

const results = await page.evaluate(
  async ({ urls, stepTolerance, globalTolerance, feather, edgeLimit }) => {
    function derive(data, width, height, edgeLimit) {
      const total = width * height
      const isBackground = new Uint8Array(total)
      const visited = new Uint8Array(total)

      // Sobel 幅值：背景平滑（实测 p99≈7），角色轮廓远高于此，用它当屏障。
      const luma = new Float32Array(total)
      for (let i = 0; i < total; i += 1) {
        luma[i] =
          data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114
      }
      const edge = new Float32Array(total)
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const i = y * width + x
          const gx =
            -luma[i - width - 1] - 2 * luma[i - 1] - luma[i + width - 1] +
            luma[i - width + 1] + 2 * luma[i + 1] + luma[i + width + 1]
          const gy =
            -luma[i - width - 1] - 2 * luma[i - width] - luma[i - width + 1] +
            luma[i + width - 1] + 2 * luma[i + width] + luma[i + width + 1]
          edge[i] = Math.hypot(gx, gy)
        }
      }
      // 种子背景色取四角均值：渐变在角落最接近纯背景。
      let seedR = 0
      let seedG = 0
      let seedB = 0
      const corners = [
        0,
        width - 1,
        (height - 1) * width,
        height * width - 1,
      ]
      for (const index of corners) {
        seedR += data[index * 4]
        seedG += data[index * 4 + 1]
        seedB += data[index * 4 + 2]
      }
      seedR /= 4
      seedG /= 4
      seedB /= 4

      const queue = new Int32Array(total)
      let head = 0
      let tail = 0
      const push = (index) => {
        if (visited[index]) return
        const r = data[index * 4]
        const g = data[index * 4 + 1]
        const b = data[index * 4 + 2]
        const globalDistance = Math.hypot(r - seedR, g - seedG, b - seedB)
        if (globalDistance > globalTolerance) return
        visited[index] = 1
        isBackground[index] = 1
        queue[tail++] = index
      }
      for (let x = 0; x < width; x += 1) {
        push(x)
        push((height - 1) * width + x)
      }
      for (let y = 0; y < height; y += 1) {
        push(y * width)
        push(y * width + width - 1)
      }

      while (head < tail) {
        const index = queue[head++]
        const x = index % width
        const y = (index / width) | 0
        const r = data[index * 4]
        const g = data[index * 4 + 1]
        const b = data[index * 4 + 2]
        const neighbours = [
          x > 0 ? index - 1 : -1,
          x < width - 1 ? index + 1 : -1,
          y > 0 ? index - width : -1,
          y < height - 1 ? index + width : -1,
        ]
        for (const next of neighbours) {
          if (next < 0 || visited[next]) continue
          const nr = data[next * 4]
          const ng = data[next * 4 + 1]
          const nb = data[next * 4 + 2]
          // 撞到轮廓边缘就停：角色内部再暗也进不去，因为它被轮廓包住了。
          if (edge[next] >= edgeLimit) continue
          // 每一步只跟“来处”比，因此能顺着渐变一路走完整片背景。
          if (Math.hypot(nr - r, ng - g, nb - b) > stepTolerance) continue
          if (
            Math.hypot(nr - seedR, ng - seedG, nb - seedB) > globalTolerance
          ) {
            continue
          }
          visited[next] = 1
          isBackground[next] = 1
          queue[tail++] = next
        }
      }

      // 二值 → 羽化。box blur 两次近似高斯，够用且快。
      const alpha = new Float32Array(total)
      for (let i = 0; i < total; i += 1) alpha[i] = isBackground[i] ? 0 : 1
      const radius = Math.max(1, Math.round(feather))
      const blurred = new Float32Array(total)
      for (let pass = 0; pass < 2; pass += 1) {
        const source = pass === 0 ? alpha : blurred
        const target = pass === 0 ? blurred : alpha
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            let sum = 0
            let count = 0
            for (let d = -radius; d <= radius; d += 1) {
              const sx = pass === 0 ? x + d : x
              const sy = pass === 0 ? y : y + d
              if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue
              sum += source[sy * width + sx]
              count += 1
            }
            target[y * width + x] = sum / count
          }
        }
      }

      return { alpha, isBackground }
    }

    const out = {}
    for (const [name, url] of Object.entries(urls)) {
      const img = new Image()
      img.src = url
      await img.decode()
      const width = img.naturalWidth
      const height = img.naturalHeight
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const image = ctx.getImageData(0, 0, width, height)
      const { alpha } = derive(image.data, width, height, edgeLimit)

      // 写回：RGB 保留原色（便于目检），A 用派生结果。
      let left = width
      let right = -1
      let top = height
      let bottom = -1
      let covered = 0
      // 脚部锚点：只看可见区最下方 18%，避开伸出去的兵器。
      for (let i = 0; i < alpha.length; i += 1) {
        const a = alpha[i]
        image.data[i * 4 + 3] = Math.round(Math.min(1, a) * 255)
        if (a <= 0.5) continue
        covered += 1
        const x = i % width
        const y = (i / width) | 0
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
      const footBandTop = bottom - Math.round((bottom - top + 1) * 0.18)
      let footLeft = width
      let footRight = -1
      for (let y = footBandTop; y <= bottom; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (alpha[y * width + x] <= 0.5) continue
          if (x < footLeft) footLeft = x
          if (x > footRight) footRight = x
        }
      }

      ctx.putImageData(image, 0, 0)
      out[name] = {
        width,
        height,
        bounds: { left, top, right, bottom },
        footCenterX: (footLeft + footRight + 1) / 2,
        coveragePct: +((covered / (width * height)) * 100).toFixed(2),
        dataUrl: canvas.toDataURL('image/png'),
      }
    }
    return out
  },
  {
    urls: Object.fromEntries(
      SIDES.flatMap((side) =>
        KINDS.map((kind) => [
          `${side}_${kind}`,
          `${ORIGIN}/assets/poses/${side}_${kind}_${POSE_SUFFIX}.jpg`,
        ]),
      ),
    ),
    stepTolerance: STEP_TOLERANCE,
    edgeLimit: EDGE_LIMIT,
    globalTolerance: GLOBAL_TOLERANCE,
    feather: FEATHER,
  },
)

if (WRITE) mkdirSync(OUT_DIR, { recursive: true })
const report = {}
for (const [name, entry] of Object.entries(results)) {
  const { dataUrl, ...stats } = entry
  report[name] = stats
  if (!WRITE) continue
  const file = resolve(OUT_DIR, `sil_${name}_${POSE_SUFFIX}_alpha.png`)
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
}

console.log(JSON.stringify(report, null, 1))
console.log(
  WRITE
    ? `已写入 ${OUT_DIR}（view=${POSE_VIEW}）`
    : `（体检模式 view=${POSE_VIEW}，未写盘；加 --write 落盘；背向加 --back）`,
)
await browser.close()
