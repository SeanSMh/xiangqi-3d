#!/usr/bin/env node
/**
 * 把外部交付的洋红底站立态背视原画，处理成运行时用的「彩色图 + 蒙版」两件套。
 *
 * 前置：源图是 JPEG，先用 sips 转 PNG（本脚本只读 PNG）：
 *   sips -s format png <src.jpg> --out <src.png>
 *
 * 三步：
 *
 * 1. **抠洋红**。判据是 `(min(r,b) − g) / max(r,b)`，两处都不能省：
 *    - 用 `min(r,b)` 而不是远山那套的 `r − g`——红甲本身 r ≫ g，
 *      后者会把整副甲胄当背景抠掉；
 *    - 要**除以亮度**——模型给洋红背景也画了阴影，夹缝里的洋红被压暗到
 *      绝对差值只有 120–144，用绝对阈值会漏掉一大片（第一版漏了 17 万像素）。
 *    比值下纯洋红 1.00、压暗洋红 0.80、红甲 0.00、甲胄紫调 ≤0.20，
 *    实测是干净的双峰，阈值 0.35 两侧都有大片空档。
 *
 * 2. **腐蚀 1–2px**。源图是 JPEG，边缘有压缩振铃，那一圈像素混了洋红。
 *    与其去分类哪些被污染（红甲和洋红都是高 r，判据不好写），
 *    不如直接把边界啃掉两像素——1024 图上看不出来，却能整圈清干净。
 *
 * 3. **向外渗色**。透明区若留着洋红，双线性过滤会在轮廓上拉出粉边。
 *    把最近的不透明颜色向外铺几像素即可。
 *
 * 用法：
 *   node scripts/prepare_back_view.mjs <src.png> <color-out.png> <alpha-out.png>
 *     [--key=185] [--erode=2] [--bleed=6]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = -1
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ -1) >>> 0
}

function decodePng(buffer) {
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const body = buffer.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8) throw new Error(`只支持 8 位深，实际 ${body[8]}`)
      colorType = body[9]
    } else if (type === 'IDAT') idat.push(Buffer.from(body))
    pos += 12 + length
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`不支持的 colorType ${colorType}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset]
    offset += 1
    const line = raw.subarray(offset, offset + stride)
    offset += stride
    const row = out.subarray(y * stride, (y + 1) * stride)
    const prior = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? row[x - channels] : 0
      const b = prior ? prior[x] : 0
      const c = prior && x >= channels ? prior[x - channels] : 0
      let value = line[x]
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      row[x] = value & 0xff
    }
  }
  const rgb = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels
    rgb[i * 3] = out[s]
    rgb[i * 3 + 1] = channels >= 3 ? out[s + 1] : out[s]
    rgb[i * 3 + 2] = channels >= 3 ? out[s + 2] : out[s]
  }
  return { width, height, data: rgb }
}

function encodePng(width, height, data, channels) {
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(body.length, 0)
    head.write(type, 4, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
    return Buffer.concat([head, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = channels === 4 ? 6 : channels === 3 ? 2 : 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const [src, colorOut, alphaOut, ...flags] = process.argv.slice(2)
if (!src || !colorOut || !alphaOut) {
  console.error(
    '用法: node scripts/prepare_back_view.mjs <src.png> <color.png> <alpha.png> [--key=185] [--erode=2] [--bleed=6]',
  )
  process.exit(1)
}
const flag = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`))
  return hit ? Number(hit.split('=')[1]) : fallback
}
const KEY = flag('key', 0.35)
const ERODE = flag('erode', 2)
const BLEED = flag('bleed', 6)

const { width, height, data } = decodePng(readFileSync(src))
const count = width * height

// 1. 抠洋红。判据是**对亮度归一化的比值**，不是绝对差值——
// 模型给洋红背景也画了阴影，夹缝里的洋红被压暗成 (150,20,140) 这类，
// 绝对差值只有 120–144，会低于任何安全阈值而被当成角色留下来
// （第一版就这样漏了 172523 个像素）。比值则不受明暗影响：
// 纯洋红 1.00、压暗的洋红 0.80、红甲 0.00、甲胄紫调 ≤0.20。
// 实测直方图是干净的双峰，0.35 两侧都有大片空档。
const magentaRatio = (i) => {
  const r = data[i * 3]
  const g = data[i * 3 + 1]
  const b = data[i * 3 + 2]
  return (Math.min(r, b) - g) / Math.max(1, Math.max(r, b))
}
let solid = new Uint8Array(count)
for (let i = 0; i < count; i += 1) {
  solid[i] = magentaRatio(i) < KEY ? 1 : 0
}
const keyed = solid.reduce((a, v) => a + v, 0)

// 2. 腐蚀，啃掉 JPEG 振铃污染的那一圈
for (let pass = 0; pass < ERODE; pass += 1) {
  const next = new Uint8Array(solid)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (!solid[i]) continue
      const edge =
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        !solid[i - 1] ||
        !solid[i + 1] ||
        !solid[i - width] ||
        !solid[i + width]
      if (edge) next[i] = 0
    }
  }
  solid = next
}
const eroded = solid.reduce((a, v) => a + v, 0)

// 2.5 去残留洋红。手臂与躯干之间那种窄缝里，JPEG 把洋红混淡到 120–152，
// 低于抠图阈值 185 于是被当成角色留了下来（红王一张就有 351 个）。
// 不能靠降阈值解决——角色区 p99 已经到 117，再压就要啃甲胄了。
// 改成只修颜色不动蒙版：就近取一个干净的不透明像素顶替。
const color = Buffer.from(data)
const magentaness = (i) =>
  (Math.min(color[i * 3], color[i * 3 + 2]) - color[i * 3 + 1]) /
  Math.max(1, Math.max(color[i * 3], color[i * 3 + 2]))
// 阈值不能简单往下压：甲胄暗部本身带紫调，洋红度同样落在 45–100。
// 真正能分开两者的是**到透明区的距离**——污染像素必定紧贴背景，
// 而甲胄的紫调在内部。于是先算一张「离背景多远」的距离场。
const SPILL = 0.18
const NEAR = 12
const distance = new Int16Array(count).fill(NEAR + 1)
for (let i = 0; i < count; i += 1) if (!solid[i]) distance[i] = 0
for (let pass = 1; pass <= NEAR; pass += 1) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (distance[i] <= pass - 1) continue
      const near =
        (x > 0 && distance[i - 1] === pass - 1) ||
        (x < width - 1 && distance[i + 1] === pass - 1) ||
        (y > 0 && distance[i - width] === pass - 1) ||
        (y < height - 1 && distance[i + width] === pass - 1)
      if (near) distance[i] = pass
    }
  }
}
let despilled = 0
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const i = y * width + x
    if (!solid[i] || magentaness(i) <= SPILL) continue
    if (distance[i] > NEAR) continue
    despilled += 1
    let source = -1
    for (let radius = 1; radius <= 10 && source < 0; radius += 1) {
      for (const [dx, dy] of [
        [0, radius],
        [0, -radius],
        [radius, 0],
        [-radius, 0],
      ]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const j = ny * width + nx
        if (solid[j] && magentaness(j) <= SPILL && distance[j] > 2) {
          source = j
          break
        }
      }
    }
    if (source >= 0) {
      color[i * 3] = color[source * 3]
      color[i * 3 + 1] = color[source * 3 + 1]
      color[i * 3 + 2] = color[source * 3 + 2]
    } else {
      // 邻域全脏时直接压掉红蓝，洋红的特征就是 r 与 b 同时高于 g
      color[i * 3] = Math.min(color[i * 3], color[i * 3 + 1] + SPILL)
      color[i * 3 + 2] = Math.min(color[i * 3 + 2], color[i * 3 + 1] + SPILL)
    }
  }
}

let frontier = new Uint8Array(solid)
for (let pass = 0; pass < BLEED; pass += 1) {
  const grown = new Uint8Array(frontier)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (frontier[i]) continue
      let sr = 0
      let sg = 0
      let sb = 0
      let n = 0
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const j = ny * width + nx
        if (!frontier[j]) continue
        sr += color[j * 3]
        sg += color[j * 3 + 1]
        sb += color[j * 3 + 2]
        n += 1
      }
      if (!n) continue
      color[i * 3] = Math.round(sr / n)
      color[i * 3 + 1] = Math.round(sg / n)
      color[i * 3 + 2] = Math.round(sb / n)
      grown[i] = 1
    }
  }
  frontier = grown
}
// 仍未被渗到的远处背景填成暗色，别留洋红
for (let i = 0; i < count; i += 1) {
  if (frontier[i]) continue
  color[i * 3] = 8
  color[i * 3 + 1] = 10
  color[i * 3 + 2] = 16
}

// 蒙版必须写成 RGBA：角色着色器采的是 `texture2D(roleAlphaMask, uv).a`，
// 而灰度 PNG 上传后 alpha 恒为 1，整张卡会变成不透明矩形（踩过一次）。
const alpha = Buffer.alloc(count * 4)
for (let i = 0; i < count; i += 1) {
  const v = solid[i] ? 255 : 0
  alpha[i * 4] = v
  alpha[i * 4 + 1] = v
  alpha[i * 4 + 2] = v
  alpha[i * 4 + 3] = v
}

writeFileSync(colorOut, encodePng(width, height, color, 3))
writeFileSync(alphaOut, encodePng(width, height, alpha, 4))
console.log(
  `${src} ${width}×${height}  抠出 ${keyed} px → 腐蚀 ${ERODE} 层后 ${eroded} px ` +
    `去溢色 ${despilled} px ` +
    `(${((eroded / count) * 100).toFixed(1)}% 画面)`,
)
