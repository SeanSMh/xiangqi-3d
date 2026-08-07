import * as THREE from 'three'
import type { Side } from '../types/xiangqi'

/** 环绕光点绕身一周的秒数（越小转越快）。 */
const ORBIT_SPEED = 0.62
/** 上下往复的速度。 */
const BOB_SPEED = 0.78
/** 环绕半径基准（格）。 */
const ORBIT_RADIUS = 0.3

/** 流星的完整周期：坠落 + 间歇。 */
const COMET_PERIOD_S = 4.2
/** 周期里真正在坠落的比例，其余时间是间歇。要短促才像流星，不像飘落。 */
const COMET_FALL_RATIO = 0.17
/** 流星拖尾的点数（含头）。 */
const COMET_TRAIL_POINTS = 8

/**
 * 点尺寸。注意这**不是**世界单位——最终像素尺寸是
 * `size × uScale / -mvz`，桌面视角下 `uScale=360`、`-mvz≈12`，即约 `size × 30` 像素。
 * 之前按世界单位的直觉取 0.065，算出来只有 2 像素，肉眼根本看不见。
 */
const MOTE_SIZE = 0.38
const COMET_HEAD_SIZE = 0.62
const COMET_TAIL_SIZE = 0.14

/**
 * 每枚棋子身上的灵气：一圈**上下环绕**的小光点，外加一颗周期性**从头顶坠到脚下、
 * 像流星一样烧尽**的大光点。
 *
 * 全场共用**一个** `THREE.Points`：32 枚棋子若各自一个粒子系统就是 32 次
 * draw call；合并后只有 1 次。用自定义 ShaderMaterial 而非 `PointsMaterial`，
 * 是因为流星的头和拖尾必须逐点控制大小，而 `PointsMaterial` 的 size 是全局的。
 *
 * 运动完全由模拟时钟与逐棋子固定相位决定，不读 wall clock、不用随机数——
 * 因此悔棋、回放与手动时钟画面一致。
 */
export class CharacterAura {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private positions = new Float32Array(0)
  private colors = new Float32Array(0)
  private sizes = new Float32Array(0)
  private capacity = 0
  private motesPerPiece = 10
  private writeIndex = 0
  private sourceIndex = 0
  private cometsFalling = 0

  constructor() {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1))
    geometry.setDrawRange(0, 0)

    this.points = new THREE.Points(geometry, createAuraMaterial())
    this.points.name = 'character-aura'
    this.points.renderOrder = 8
    this.points.frustumCulled = false
  }

  /** 视口高度变化时同步点尺寸的透视衰减基准。 */
  setViewportHeight(heightCss: number): void {
    this.points.material.uniforms.uScale.value = Math.max(1, heightCss) * 0.5
  }

  setMotesPerPiece(count: number): void {
    this.motesPerPiece = Math.max(0, Math.min(24, Math.round(count)))
  }

  getMotesPerPiece(): number {
    return this.motesPerPiece
  }

  getActiveCount(): number {
    return this.points.geometry.drawRange.count
  }

  /** 本帧有多少枚棋子的流星正在坠落；供自动化验收定位到有流星的帧。 */
  getCometsFalling(): number {
    return this.cometsFalling
  }

  /** 每枚棋子占用的点数：环绕光点 + 流星头尾。 */
  private get pointsPerPiece(): number {
    return this.motesPerPiece === 0
      ? 0
      : this.motesPerPiece + COMET_TRAIL_POINTS
  }

  /** 开始一轮写入。调用方随后对每枚存活棋子调用 `addSource`，最后 `commit`。 */
  begin(pieceCount: number): void {
    this.writeIndex = 0
    this.sourceIndex = 0
    this.cometsFalling = 0
    const needed = pieceCount * this.pointsPerPiece
    if (needed <= this.capacity) return
    // 只增不减，避免每次吃子都重建 buffer。
    this.capacity = Math.max(needed, 128)
    this.positions = new Float32Array(this.capacity * 3)
    this.colors = new Float32Array(this.capacity * 3)
    this.sizes = new Float32Array(this.capacity)
    const geometry = this.points.geometry
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1))
  }

  /**
   * 写入一枚棋子的灵气。`phase` 由棋子 id 派生，保证同一局面下每枚棋子的
   * 光点排布与流星时机完全可复现，且各棋子的流星互相错开、不会齐刷刷一起掉。
   */
  addSource(
    origin: THREE.Vector3,
    side: Side,
    visibleHeight: number,
    phase: number,
    timeMs: number,
  ): void {
    if (this.motesPerPiece === 0) return
    const color = MOTE_COLORS[side]
    const seconds = timeMs / 1000
    const index = this.sourceIndex++
    const spread = (Math.PI * 2) / this.motesPerPiece

    // ---- 环绕光点：水平绕身 + 垂直往复，半径在头顶与脚下收窄成球形包络。
    for (let mote = 0; mote < this.motesPerPiece; mote += 1) {
      const seed = phase + mote * 0.9 + index * 0.618
      const angle = phase + seconds * ORBIT_SPEED + mote * spread
      // 每颗点的上下往复相位错开，任意时刻都散布在整个身高上。
      const heightT = 0.5 + 0.42 * Math.sin(seconds * BOB_SPEED + seed)
      // 越靠近头顶/脚下半径越小，于是轨迹读起来是绕着身体转，而不是套了个圆筒。
      const radius = ORBIT_RADIUS * (0.5 + 0.5 * Math.sin(Math.PI * heightT))
      // 靠近正前方时略微增亮，强化绕到身后又转回来的感觉。
      const facing = 0.72 + 0.28 * Math.sin(angle)
      this.write(
        origin.x + Math.cos(angle) * radius,
        origin.y + 0.08 + heightT * visibleHeight,
        origin.z + Math.sin(angle) * radius,
        color,
        facing,
        MOTE_SIZE,
      )
    }

    // ---- 流星：周期性从头顶坠到脚下，一路变暗烧尽。
    const cometPhase = fract(seconds / COMET_PERIOD_S + phase * 0.159)
    if (cometPhase >= COMET_FALL_RATIO) {
      // 间歇期：占位点写在原点且亮度为 0，保持每枚棋子点数固定，
      // 这样 drawRange 不必随流星状态跳变。
      for (let i = 0; i < COMET_TRAIL_POINTS; i += 1) {
        this.write(origin.x, origin.y, origin.z, color, 0, 0.001)
      }
      return
    }

    this.cometsFalling += 1
    const fall = cometPhase / COMET_FALL_RATIO
    const topY = origin.y + visibleHeight * 1.18
    // 一路坠到底座，而不是半途消失。
    const dropHeight = visibleHeight * 1.16
    const cometAngle = phase * 2.7 + index
    const cometRadius = ORBIT_RADIUS * 0.42
    for (let i = 0; i < COMET_TRAIL_POINTS; i += 1) {
      // 拖尾是同一条轨迹上稍早的位置，因此自然贴合下坠方向。
      // 间距必须让整条尾巴明显长于头部直径，否则会被头完全盖住、看不出拖尾。
      const trailT = fall - i * 0.045
      if (trailT < 0) {
        this.write(origin.x, origin.y, origin.z, color, 0, 0.001)
        continue
      }
      // 只做轻微加速。二次缓动会让它在顶上悬停大半程，根本走不完全程。
      const eased = trailT ** 1.25
      const taper = (1 - i / COMET_TRAIL_POINTS) ** 1.6
      // 出现时瞬间亮起，贴近脚下时才烧尽——这样「从上到下消失」才成立。
      const burn =
        Math.min(1, trailT / 0.1) * Math.min(1, (1 - trailT) / 0.26)
      this.write(
        origin.x + Math.cos(cometAngle) * cometRadius,
        topY - eased * dropHeight,
        origin.z + Math.sin(cometAngle) * cometRadius,
        color,
        burn * taper * 2.1,
        // 头大尾细。
        COMET_TAIL_SIZE + (COMET_HEAD_SIZE - COMET_TAIL_SIZE) * taper,
      )
    }
  }

  commit(): void {
    const geometry = this.points.geometry
    geometry.setDrawRange(0, this.writeIndex)
    geometry.getAttribute('position').needsUpdate = true
    geometry.getAttribute('aColor').needsUpdate = true
    geometry.getAttribute('aSize').needsUpdate = true
    geometry.boundingSphere = null
  }

  clear(): void {
    this.writeIndex = 0
    this.points.geometry.setDrawRange(0, 0)
  }

  private write(
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    brightness: number,
    size: number,
  ): void {
    const slot = this.writeIndex
    if (slot >= this.capacity) return
    this.writeIndex += 1
    const offset = slot * 3
    this.positions[offset] = x
    this.positions[offset + 1] = y
    this.positions[offset + 2] = z
    this.colors[offset] = color.r * brightness
    this.colors[offset + 1] = color.g * brightness
    this.colors[offset + 2] = color.b * brightness
    this.sizes[slot] = size
  }
}

const MOTE_COLORS: Record<Side, THREE.Color> = {
  red: new THREE.Color(0xffcf6a),
  black: new THREE.Color(0x8fd0ff),
}

/**
 * 逐点尺寸 + 逐点亮度。`PointsMaterial` 的 size 是全局的，撑不起「流星头大尾细」。
 */
function createAuraMaterial(): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: createMoteTexture() },
      // 透视衰减基准，与 three 内建 PointsMaterial 的算法保持一致。
      uScale: { value: 360 },
    },
    vertexShader: /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (uScale / max(0.001, -mvPosition.z));
  gl_Position = projectionMatrix * mvPosition;
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D map;
varying vec3 vColor;
void main() {
  vec4 sampled = texture2D(map, gl_PointCoord);
  // 亮度已经乘进颜色里；加色混合下亮度为 0 即完全不可见。
  // 加色混合是 SrcAlpha × One；alpha 写 1、颜色预乘，贡献才是 vColor·a
  // 而不是被平方成 vColor·a²（那会让光点暗一大截）。
  gl_FragColor = vec4(vColor * sampled.a, 1.0);
}`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  })
  material.name = 'character-aura-points'
  return material
}

/** 径向渐变光点。程序化生成比外部贴图更锐利，也不占加载。 */
function createMoteTexture(): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建光点纹理')
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  )
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.66)')
  gradient.addColorStop(0.65, 'rgba(255,255,255,0.14)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.name = 'character-aura-mote'
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function fract(value: number): number {
  return value - Math.floor(value)
}

/** 由棋子 id 派生的稳定相位，保证同一局面下光点排布与流星时机可复现。 */
export function auraPhaseFromId(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (((hash >>> 0) % 10007) / 10007) * Math.PI * 2
}
