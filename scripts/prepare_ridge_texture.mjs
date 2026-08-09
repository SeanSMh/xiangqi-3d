#!/usr/bin/env node
/**
 * 把外部交付的远山原图处理成可直接贴到圆柱上的纹理。
 *
 * 外部只负责出图（洋红底或透明底的山脉横幅），闭缝与裁剪由这里做——
 * 见 `resources/art/production/backgrounds/ridge_layers/README.md` 第八节「方案 A」。
 *
 * 三步：
 *
 * 0. **去洋红溢色**。抠图会在脊线上留一圈约 1px 的不透明像素，它们混了背景的
 *    洋红。实测很好分：清洁山体 `r−g` 中位 −32/−22、p99 不超过 +4，
 *    而边缘像素 `r−g` 中位 +58/+67 且 100% 为正，取阈值 10 即可。
 *    修法是从下方取干净像素顶替（山体向下延伸，下面一定是内部），
 *    实在找不到就把 r 夹到 g——洋红的特征就是抬高 r。
 *
 * 1. **闭合横向接缝**。纹理要绕圆柱一圈，首末列必须接得上。
 *    直接对 RGBA 交叉淡化是不行的：alpha 是二值的，淡化后再过 alphaTest
 *    只会把突变从接缝挪到淡化区中点，山形照样断。
 *    所以先取出逐列脊线高度，在**高度域**插值得到过渡脊线，
 *    再按各自脊线做**竖直对齐**后采样、在颜色域淡化——山体轮廓与纹理一起对上。
 *
 * 2. **竖直裁剪**。等比映射下整图会撑出很高的圆柱（04 原图撑到 81.7 世界单位），
 *    而可见带只有 5.4——九成纹素永远看不到。按峰顶行前后裁掉即可，
 *    裁剪不改变纹素密度，只是不再为看不见的部分占显存。
 *
 * 用法：
 *   node scripts/prepare_ridge_texture.mjs <src.png> <dst.png> \
 *     [--blend=0.06] [--above=40] [--below=360]
 *   --blend  淡化区占原宽的比例；输出宽度会相应变窄
 *   --above  峰顶之上保留的行数（透明区，给不同视口留余量）
 *   --below  峰顶之下保留的行数
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
  // 统一升到 RGBA，后面只用处理一种排布
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels
    if (channels === 4) {
      out.copy(rgba, i * 4, s, s + 4)
    } else if (channels === 3) {
      rgba[i * 4] = out[s]
      rgba[i * 4 + 1] = out[s + 1]
      rgba[i * 4 + 2] = out[s + 2]
      rgba[i * 4 + 3] = 255
    } else {
      throw new Error('灰度图请先转成 RGB/RGBA')
    }
  }
  return { width, height, data: rgba }
}

function encodePng(width, height, data) {
  const stride = width * 4
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
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 逐列脊线：第一个不透明像素所在行；整列透明则记为 height。 */
function ridgeRows({ width, height, data }) {
  const rows = new Int32Array(width)
  for (let x = 0; x < width; x += 1) {
    let row = height
    for (let y = 0; y < height; y += 1) {
      if (data[(y * width + x) * 4 + 3] > 127) {
        row = y
        break
      }
    }
    rows[x] = row
  }
  return rows
}

/**
 * 去洋红溢色。必须在闭缝之前做——闭缝会做颜色淡化，
 * 先闭缝会把污染色抹进邻近像素。
 */
function despill(image, threshold = 10, maxSearch = 8) {
  const { width, height, data } = image
  let fixed = 0
  const spilled = (at) => data[at + 3] > 127 && data[at] - data[at + 1] > threshold
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4
      if (!spilled(at)) continue
      fixed += 1
      let source = -1
      for (let step = 1; step <= maxSearch && y + step < height; step += 1) {
        const below = ((y + step) * width + x) * 4
        if (data[below + 3] > 127 && !spilled(below)) {
          source = below
          break
        }
      }
      if (source >= 0) {
        data[at] = data[source]
        data[at + 1] = data[source + 1]
        data[at + 2] = data[source + 2]
      } else {
        data[at] = Math.min(data[at], data[at + 1])
      }
    }
  }
  return fixed
}

function closeSeam(image, blendFraction) {
  const { width, height, data } = image
  const blend = Math.max(1, Math.round(width * blendFraction))
  const outWidth = width - blend
  const ridge = ridgeRows(image)
  const out = Buffer.alloc(outWidth * height * 4)

  const sample = (x, y, target, at) => {
    if (y < 0) {
      target.fill(0, at, at + 4)
      return
    }
    const clamped = Math.min(height - 1, y)
    const s = (clamped * width + x) * 4
    data.copy(target, at, s, s + 4)
  }
  const head = Buffer.alloc(4)
  const tail = Buffer.alloc(4)

  for (let x = 0; x < outWidth; x += 1) {
    if (x >= blend) {
      for (let y = 0; y < height; y += 1) {
        const s = (y * width + x) * 4
        data.copy(out, (y * outWidth + x) * 4, s, s + 4)
      }
      continue
    }
    const t = x / blend
    const xTail = x + outWidth
    const rHead = ridge[x]
    const rTail = ridge[xTail]
    const rOut = Math.round(rTail * (1 - t) + rHead * t)
    for (let y = 0; y < height; y += 1) {
      sample(x, y - rOut + rHead, head, 0)
      sample(xTail, y - rOut + rTail, tail, 0)
      const at = (y * outWidth + x) * 4
      for (let c = 0; c < 3; c += 1) {
        out[at + c] = Math.round(tail[c] * (1 - t) + head[c] * t)
      }
      // alpha 保持二值：对齐后两边本就一致，插值只会在边界留下毛边
      const alpha = tail[3] * (1 - t) + head[3] * t
      out[at + 3] = alpha > 127 ? 255 : 0
    }
  }
  return { width: outWidth, height, data: out, blend }
}

function cropAroundPeak(image, above, below) {
  const { width, height, data } = image
  const ridge = ridgeRows(image)
  let peak = height
  for (const row of ridge) if (row < peak) peak = row
  const top = Math.max(0, peak - above)
  const bottom = Math.min(height, peak + below)
  const outHeight = bottom - top
  const out = Buffer.alloc(width * outHeight * 4)
  data.copy(out, 0, top * width * 4, bottom * width * 4)
  return { width, height: outHeight, data: out, peak, top, bottom }
}

const [src, dst, ...flags] = process.argv.slice(2)
if (!src || !dst) {
  console.error(
    '用法: node scripts/prepare_ridge_texture.mjs <src.png> <dst.png> [--blend=0.06] [--above=40] [--below=360]',
  )
  process.exit(1)
}
const flag = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`))
  return hit ? Number(hit.split('=')[1]) : fallback
}

const source = decodePng(readFileSync(src))
const despilled = despill(source)
const sealed = closeSeam(source, flag('blend', 0.06))
const cropped = cropAroundPeak(sealed, flag('above', 40), flag('below', 360))
writeFileSync(dst, encodePng(cropped.width, cropped.height, cropped.data))

const after = ridgeRows(cropped)
console.log(
  `${src} ${source.width}×${source.height}\n` +
    `  去溢色 修正 ${despilled} 像素\n` +
    `  闭缝 淡化 ${sealed.blend}px → 宽 ${sealed.width}\n` +
    `  裁剪 峰顶行 ${cropped.peak} → 保留 [${cropped.top}, ${cropped.bottom}) 共 ${cropped.height} 行\n` +
    `  输出 ${dst} ${cropped.width}×${cropped.height}\n` +
    `  校验 首末列脊线差 ${Math.abs(after[0] - after[after.length - 1])} 行`,
)
