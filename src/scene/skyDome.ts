import * as THREE from 'three'

/**
 * 程序化天穹与远山。
 *
 * 参考项目（rork-medieval-3d-chess）整套背景不含任何贴图文件：天空是渐变
 * ShaderMaterial 球，远山是正弦位移的开口圆柱。这么做有三个好处，而且都不是
 * 「把贴图出得更大」能替代的：
 *
 * 1. **任何分辨率都锐利**。equirect 照片是定分辨率的，用户开 4K 全屏就又糊了。
 * 2. **换主题只改颜色**。不必为每套配色重出一张全景图。
 * 3. **零字节**。原来那张 1408×704 全景里，相机只看得到 11.6%，其余全是白载。
 *
 * 关键约束：本项目的相机**永远不看水平线以上**（桌面视锥是水平线下
 * 26.7°–68.7°），而地面圆盘又挡到 32.5°，所以真正可见的只有 `h ∈ [0.246,
 * 0.297]` 这一条——**赤道以下**的窄带。因此辉光带必须按这个角度摆，
 * 而不是按「地平线在 h=0.5」的直觉摆。
 */
export interface SkyPalette {
  /** 天顶色（当前机位看不到，换构图或战术俯视时才露出）。 */
  zenith: number
  /** 辉光带上方的过渡色。 */
  horizon: number
  /** 辉光带下方的深渊色。 */
  abyss: number
  /** 辉光带本身。 */
  glow: number
  /** 星点整体亮度。 */
  starIntensity: number
}

export const DEFAULT_SKY_PALETTE: SkyPalette = {
  zenith: 0x0d1a38,
  horizon: 0x35719f,
  abyss: 0x080e1c,
  glow: 0x9ad8ff,
  starIntensity: 1.05,
}

/**
 * 辉光带中心。取自实测可见区间 `[0.246, 0.297]` 的中点——把最亮的一条
 * 正对着玩家唯一能看到的那道缝。
 */
const GLOW_CENTER = 0.271
/** 辉光带半宽。取 0.075 是为了在用户环绕、换视口时仍留有余量。 */
const GLOW_WIDTH = 0.105

export const SKY_DOME_RADIUS = 110

/**
 * 远山环。半径与山顶高度由「必须落进那 5.8° 可见缝」反推：
 *   山顶 y ∈ (camY − tan(遮挡角)·(r − camZ),  camY − tan(视锥顶)·(r − camZ))
 * 桌面机位下 r=24 → (−10.7, −6.1)，r=34 → (−17.1, −11.2)。
 * 取中值并让锯齿幅度跨满整条缝，于是从平台边缘望出去是一道深谷里的峰林。
 */
const RIDGE_LAYERS = [
  // 近层：山顶取在窗口偏上，锯齿幅度让峰尖几乎顶到视锥顶，
  // 于是「峰林咬进辉光带」而不是一条平灰带。近处更暗，符合逆光剪影。
  { radius: 24, topY: -8.0, jag: 1.8, depth: 26, top: 0x0c1322, base: 0x04070e },
  // 远层：略亮一档做空气透视，从近峰的缺口里透出来。
  { radius: 34, topY: -14.5, jag: 2.5, depth: 30, top: 0x16223a, base: 0x0a1120 },
] as const

export function createSkyDome(
  palette: SkyPalette = DEFAULT_SKY_PALETTE,
): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    // 穹顶是背景板，不该被场内的雾再压一层。
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(palette.zenith) },
      horizon: { value: new THREE.Color(palette.horizon) },
      abyss: { value: new THREE.Color(palette.abyss) },
      glow: { value: new THREE.Color(palette.glow) },
      stars: { value: createStarfieldTexture() },
      starIntensity: { value: palette.starIntensity },
      glowCenter: { value: GLOW_CENTER },
      glowWidth: { value: GLOW_WIDTH },
    },
    vertexShader: /* glsl */ `
varying vec3 vLocalPosition;
varying vec2 vSkyUv;
void main() {
  vLocalPosition = position;
  vSkyUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 abyss;
uniform vec3 glow;
uniform sampler2D stars;
uniform float starIntensity;
uniform float glowCenter;
uniform float glowWidth;
varying vec3 vLocalPosition;
varying vec2 vSkyUv;

void main() {
  float h = normalize(vLocalPosition).y * 0.5 + 0.5;

  // 辉光带把天穹分成上下两段，各自独立插值，
  // 这样带子的位置可以随意挪而不会把整条渐变拉歪。
  vec3 color = h > glowCenter
    ? mix(horizon, zenith, pow(clamp((h - glowCenter) / (1.0 - glowCenter), 0.0, 1.0), 0.8))
    : mix(abyss, horizon, pow(clamp(h / glowCenter, 0.0, 1.0), 1.7));

  // 指数 3 会把带子收成一条线，实测两侧 30px 外就掉回 (5,16,41)；
  // 1.9 让它铺满整条可见缝。强度 0.62 是实测钉住的上限：
  // 试过 1.15，y=110..230 有 120px 高的区域蓝通道撞死在 255，
  // 一条削顶的死白带既丢层次又跟棋盘抢注意力。
  float band = pow(max(0.0, 1.0 - abs(h - glowCenter) / glowWidth), 1.9);
  color += glow * band * 0.62;

  // 星点只在辉光线以上渐次浮现，读作「雾气之上才见星」。
  float starMask = smoothstep(glowCenter - 0.05, glowCenter + 0.10, h);
  color += texture2D(stars, vSkyUv).rgb * starIntensity * starMask;

  gl_FragColor = vec4(color, 1.0);
}`,
  })
  material.name = 'arena-sky-gradient'

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_DOME_RADIUS, 48, 32),
    material,
  )
  dome.name = 'arena-sky-dome'
  dome.renderOrder = -10
  dome.frustumCulled = false
  return dome
}

/**
 * 远山环：开口圆柱，顶边按三个正弦叠加位移成峰林。
 *
 * 首尾用同一个 index 取峰高，保证圆环接缝闭合；两层不同半径与顶点色，
 * 自然出空气透视。
 */
export function createRidgeRings(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'arena-ridges'

  for (const layer of RIDGE_LAYERS) {
    const segments = 96
    const geometry = new THREE.CylinderGeometry(
      layer.radius,
      layer.radius,
      layer.depth,
      segments,
      1,
      true,
    )
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    const colors = new Float32Array(position.count * 3)
    const topColor = new THREE.Color(layer.top)
    const baseColor = new THREE.Color(layer.base)
    const half = layer.depth / 2

    const peaks: number[] = []
    for (let index = 0; index <= segments; index += 1) {
      const t = (index / segments) * Math.PI * 2
      peaks.push(
        (Math.sin(t * 3.1) * 0.5 +
          Math.sin(t * 7.7 + 1.2) * 0.32 +
          Math.sin(t * 13.3 + 2.6) * 0.18) *
          layer.jag,
      )
    }

    for (let index = 0; index < position.count; index += 1) {
      const y = position.getY(index)
      const isTop = y > 0
      const angle = Math.atan2(position.getZ(index), position.getX(index))
      const peakIndex =
        Math.round(((angle + Math.PI) / (Math.PI * 2)) * segments) % segments
      if (isTop) position.setY(index, half + peaks[peakIndex]!)
      const shade = isTop ? topColor : baseColor
      colors[index * 3] = shade.r
      colors[index * 3 + 1] = shade.g
      colors[index * 3 + 2] = shade.b
    }
    position.needsUpdate = true
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    )
    mesh.name = `arena-ridge-${layer.radius}`
    // topY 是山顶应处的世界高度；几何体顶边在局部 +half。
    mesh.position.y = layer.topY - half
    mesh.renderOrder = -9
    mesh.frustumCulled = false
    group.add(mesh)
  }

  return group
}

/**
 * 星空与星座连线。
 *
 * 用 canvas 现画而不是外部贴图：星点是纯几何图形，程序化生成没有任何质量
 * 损失，还省掉一次网络请求。2:1 是 equirect 贴球的硬要求。
 */
export function createStarfieldTexture(): THREE.CanvasTexture {
  const width = 2048
  const height = 1024
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建星空纹理')

  context.fillStyle = '#000000'
  context.fillRect(0, 0, width, height)

  const random = mulberry32(0x5eab17)

  // 散星：越靠天顶越密，避免辉光带附近糊成一片。
  for (let index = 0; index < 1400; index += 1) {
    const x = random() * width
    // 平方分布把星点往上半球推。
    const bias = random() ** 1.6
    const y = height * (0.5 - bias * 0.5)
    const radius = 0.45 + random() ** 3 * 1.7
    const brightness = 0.28 + random() ** 2 * 0.72
    drawStar(context, x, y, radius, brightness, random)
  }

  // 星座：先在上半球取一组锚点，连线后在顶点补亮星。
  for (let figure = 0; figure < 7; figure += 1) {
    const centerX = random() * width
    const centerY = height * (0.06 + random() * 0.3)
    const nodes = 4 + Math.floor(random() * 4)
    const points: Array<[number, number]> = []
    for (let node = 0; node < nodes; node += 1) {
      points.push([
        centerX + (random() - 0.5) * 260,
        centerY + (random() - 0.5) * 170,
      ])
    }
    context.strokeStyle = 'rgba(150, 205, 255, 0.34)'
    context.lineWidth = 1.1
    context.beginPath()
    context.moveTo(points[0]![0], points[0]![1])
    for (let node = 1; node < points.length; node += 1) {
      context.lineTo(points[node]![0], points[node]![1])
    }
    context.stroke()
    for (const [x, y] of points) {
      drawStar(context, x, y, 1.5 + random() * 1.2, 1, random)
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.name = 'arena-starfield'
  texture.colorSpace = THREE.SRGBColorSpace
  // u 方向要环绕，否则贴球时接缝处会被钳出一条竖纹。
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

function drawStar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  brightness: number,
  random: () => number,
): void {
  // 略微偏冷或偏暖，避免一片纯白显得呆板。
  const warm = random() < 0.18
  const tint = warm ? [255, 226, 190] : [206, 232, 255]
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius * 3.2)
  gradient.addColorStop(
    0,
    `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${brightness})`,
  )
  gradient.addColorStop(
    0.35,
    `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${brightness * 0.35})`,
  )
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  context.fillStyle = gradient
  context.beginPath()
  context.arc(x, y, radius * 3.2, 0, Math.PI * 2)
  context.fill()
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
