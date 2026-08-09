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
  /** 星云冷色（团块主体）。 */
  nebulaCool: number
  /** 星云暖色（丝缕高光）。 */
  nebulaWarm: number
  /** 星云整体强度。 */
  nebulaIntensity: number
}

export const DEFAULT_SKY_PALETTE: SkyPalette = {
  zenith: 0x0d1a38,
  horizon: 0x35719f,
  abyss: 0x080e1c,
  glow: 0x9ad8ff,
  starIntensity: 1.05,
  nebulaCool: 0x1d5f8c,
  nebulaWarm: 0x6b4a9e,
  nebulaIntensity: 1.45,
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
 * 远山环。轮廓来自 `public/assets/arena/ridge_0*_alpha.png`——
 * 四张横向无缝的二值遮罩，用作 `alphaMap` 把平顶圆柱切出山形。
 *
 * 每个数字的来源（改之前先读，它们看着像审美选择，其实是几何反解的）：
 *
 * - **tileWidth / repeat**：贴图只有 768–2304 宽，靠 `repeat.x` 补到 360°。
 *   次数取 5/4/3/2 是因为两两互质——单层各自重复，四层叠加后要绕满一整圈
 *   才复现一次，视野（约 120°）内看不出重复。
 * - **height**：由等比映射定死，`2πR · 256 / (tileWidth × repeat)`。
 *   不等比会把山拉扁或抻细。
 * - **topY**：先二分反解「峰顶要落在屏幕第几行」，再加上贴图里峰顶到图顶的
 *   18%（实测四张都恰好是第 46 行 / 256）。目标行由近及远 48/38/26/12。
 *
 * 实测圆盘遮挡线在所有层都是屏幕第 105 行，而脊线摆幅有 119–132px，
 * 所以谷底本就会被平台吃掉，只剩峰尖露出——这是预期的，不是 bug。
 */
const RIDGE_LAYERS = [
  {
    radius: 20,
    map: '/assets/arena/ridge_01_near_alpha.png',
    repeat: 5,
    height: 8.38,
    topY: -4.35,
    baseShade: 0.34,
  },
  {
    radius: 28,
    map: '/assets/arena/ridge_02_mid_alpha.png',
    repeat: 4,
    height: 11.0,
    topY: -7.89,
    baseShade: 0.4,
  },
  {
    radius: 38,
    map: '/assets/arena/ridge_03_far_alpha.png',
    repeat: 3,
    height: 13.26,
    topY: -12.27,
    baseShade: 0.52,
  },
  {
    radius: 52,
    map: '/assets/arena/ridge_04_horizon_alpha.png',
    repeat: 2,
    height: 18.15,
    topY: -17.83,
    baseShade: 0.66,
  },
] as const

/**
 * 层间雾带。半径取相邻两层之间，横向透明度用谐波扰动——
 * 圆柱本身是旋转对称的，不给方位角变化的话转起来看不出任何动静。
 * 三条带各转各的速率，远的慢，于是层与层之间出视差。
 */
const MIST_BANDS = [
  // `y` 是雾带**底边**，顶边 = y + height。
  //
  // 顶边必须压在**身后那层山的峰顶之下**。换成贴图山形后我漏了这一步：
  // 三条雾带的顶边（−7.4 / −11.0 / −16.2）全都高过身后山峰
  // （−9.87 / −14.65 / −21.09），于是雾不是填在谷里而是直接糊在天上，
  // 把辉光带洗成一片灰蓝。
  { radius: 24, y: -15.2, height: 5.0, opacity: 0.5, rate: 0.0000062 },
  { radius: 33, y: -21.0, height: 6.0, opacity: 0.42, rate: 0.0000046 },
  { radius: 45, y: -28.5, height: 7.0, opacity: 0.34, rate: 0.0000032 },
] as const

const MIST_COLOR = 0x86b4dc

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
      nebulaCool: { value: new THREE.Color(palette.nebulaCool) },
      nebulaWarm: { value: new THREE.Color(palette.nebulaWarm) },
      nebulaIntensity: { value: palette.nebulaIntensity },
      // 由 ArenaEnvironment.update 用 presentationTimeMs 推进，而不是墙上时钟。
      // 手动时钟下 advanceTime(n) 必须得到逐字节相同的帧，否则 Playwright
      // 截图差分这套测量方法就废了。
      time: { value: 0 },
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
uniform vec3 nebulaCool;
uniform vec3 nebulaWarm;
uniform float nebulaIntensity;
uniform float time;
varying vec3 vLocalPosition;
varying vec2 vSkyUv;

// 在方向向量上采样而不是在 uv 上：equirect uv 两极会挤成一点、接缝处会断，
// 而方向向量天然连续，星云不会在正后方裂开一条缝。
float hash13(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float valueNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave += 1) {
    value += amplitude * valueNoise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec3 dir = normalize(vLocalPosition);
  float h = dir.y * 0.5 + 0.5;
  float t = time;

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

  // 星云。纯渐变实测「同一行相邻像素亮度差只有 0.44」——没有任何表面细节，
  // 读作一块纯色。两层 fbm 叠加补上团块与丝缕：低频给大团，高频做域扭曲
  // （用低频结果去偏移高频采样点）拉出被风吹散的纤维感。
  //
  // h < 0.20（水平线下 37°）永远被地面圆盘挡死，直接跳过——
  // 这块占屏幕大半，不早退的话每帧要白算 64 次 hash。
  float nebulaMask =
    smoothstep(0.20, 0.32, h) * (1.0 - smoothstep(0.62, 0.95, h));
  if (nebulaMask > 0.002) {
    // 频率不能凭手感填。dir 是单位向量，可见方位角只有约 120°（2.09 rad），
    // 所以 fbm(dir * f) 在整个可见宽度上只有 2.09·f 个噪声格。
    // 起初填 2.6 → 不到 3 个格横跨全屏，那是渐变不是纹理，实测毫无变化。
    // 6.5 给约 14 个格做团块，15.0 给约 31 个格做丝缕。
    // 让采样点在三维噪声场里**穿行**而不是平移二维图案：
    // 平移只会整体滑动，穿行才会让云团自己生灭翻卷。
    // 两层速率不同，于是近处丝缕比远处团块跑得快，出视差。
    vec3 bulkFlow = vec3(t * 0.0000042, 0.0, t * 0.0000090);
    vec3 wispFlow = vec3(t * 0.0000115, t * 0.0000031, t * 0.0000205);
    float bulk = fbm(dir * 6.5 + bulkFlow);
    float wisp = fbm(dir * 15.0 + vec3(bulk * 2.2) + wispFlow);
    // 下限压到 0.22：取 0.30 时差分图中部出现一整片硬切到 0 的「平坦沙漠」，
    // 那正是视线中心，反而比没有星云更显得平。
    float density = smoothstep(0.22, 0.72, bulk * 0.62 + wisp * 0.48);
    vec3 tint = mix(nebulaCool, nebulaWarm, smoothstep(0.28, 0.72, bulk));
    // 辉光核心处让路。星云在暗区最好看，而撞死在 255 的恰恰只有最亮那一条：
    // 系数 0.45 时削顶 3.72%，0.75 压回基线水平，暗区结构一点没少。
    color += tint * density * nebulaIntensity * nebulaMask * (1.0 - band * 0.75);
  }

  // 星点。原先阈值把可见带里的星压到只剩 26% 亮度，等于白画；
  // 现在让整条可见缝都到 0.75 以上。
  float starMask = smoothstep(glowCenter - 0.10, glowCenter + 0.02, h);
  //
  // 周日旋转：只偏移星图的 u，**不转穹顶**。转穹顶会把辉光带一起带走，
  // 而那条带子是按可见缝的角度钉死的，一转就跑出画面。
  // 速率 8e-8 u/ms ≈ 3.5 小时一整圈：一局五分钟约漂 92px，注意到才发现在动。
  vec2 starUv = vec2(vSkyUv.x + t * 0.00000008, vSkyUv.y);
  // 闪烁用高频时空噪声整体调制，而不是逐星记录相位——星点烘在贴图里，
  // 着色器拿不到单颗身份，但噪声尺度足够细时视觉上就是各闪各的。
  float twinkle = 0.62 + 0.62 * valueNoise(dir * 52.0 + vec3(t * 0.0000021));
  color += texture2D(stars, starUv).rgb * starIntensity * starMask * twinkle;

  // 流星。只在可见缝上方一点点出生，斜穿而下没入山脊，
  // 生命周期与方位都由 idx 派生，所以在手动时钟下完全可复现。
  if (h > 0.20 && h < 0.42) {
    // 周期与命中率是按「屏幕上能看到几颗」反推的，不是手感。
    // 原先 7400ms + 命中率 45%，前 11 个周期只有 3 颗放行，其中 1 颗全程在
    // 视锥外、1 颗有 2.7s 躲在 SPOILS 面板后——平均 40 秒才有一颗干净可见的。
    float cycle = t / 5200.0;
    float idx = floor(cycle);
    float u = fract(cycle);
    // 只有约 45% 的周期真的放一颗，避免节拍器般的规律感。
    if (hash11(idx * 1.37 + 3.1) > 0.18) {
      float azimuth = atan(dir.z, dir.x);
      // 相机朝 +z，可见方位角在 PI/2 附近，把出生点偏进这个范围。
      // ±63° 的散布有近一半落在视锥外，收到 ±40°。
      float startAz = 1.5708 + (hash11(idx) - 0.5) * 1.4;
      float startH = 0.308 + hash11(idx + 11.3) * 0.022;
      float sweep = (hash11(idx + 5.9) - 0.5) * 1.6;
      float meteorAz = startAz + sweep * u;
      // 画面中央的纯天空只有约 70px 高（h 0.246–0.297），
      // 落差 0.105 太短，还没划开就没入圆盘；0.135 能走满两侧较宽的天空。
      float meteorH = startH - u * 0.135;
      // 方位角要按圆环归一化，否则 ±PI 接缝处会闪一下。
      float dAz = atan(sin(azimuth - meteorAz), cos(azimuth - meteorAz));
      vec2 offset = vec2(dAz * 0.62, (h - meteorH) * 5.4);
      vec2 heading = normalize(vec2(sweep * 0.62, -0.105 * 5.4));
      float along = dot(offset, heading);
      float across = length(offset - heading * along);
      // 850 的 1/e 半径换到屏幕约 34px，整团 85px 宽，读作光斑不是流星。
      // 6000 收到约 13px；头小了就把亮度补回来，保持「一点极亮」的观感。
      float head = exp(-dot(offset, offset) * 6000.0);
      // 尾巴只长在身后（along < 0），头前面要干净利落。
      float tail = exp(-across * 130.0) * exp(min(along, 0.0) * 10.0)
        * (1.0 - step(0.015, along));
      // 原先 u=0.81 就衰到 0.17，人还在画面里就先熄了。
      float life = smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.66, 1.0, u));
      color += vec3(0.78, 0.90, 1.0) * (head * 3.4 + tail * 0.9) * life;
    }
  }

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
 * 远山与雾带。山是正弦位移顶边的开口圆柱，雾是层间的半透明圆柱。
 *
 * 山脊改为 `depthWrite: true`：雾带是 transparent，three.js 把它放进
 * 独立的后置队列，renderOrder 排不到山脊前面去，只能靠深度测试挡。
 * 山本来就是不透明的，写深度也是它该有的行为。
 */
export interface RidgeField {
  readonly root: THREE.Group
  update(timeMs: number): void
  dispose(): void
}

/**
 * 远山与雾带。
 *
 * 遮罩是二值的，所以用 `alphaTest` 硬切而不是 `transparent`：这样山脊留在
 * 不透明队列里并写深度，层间雾带（transparent）才能被正确遮挡。若改成
 * transparent，three.js 会把山和雾放进同一个后置队列，renderOrder 排不出
 * 「近山挡住远雾」的关系。
 *
 * 贴图只提供轮廓，颜色仍由顶点色给——空气透视要能单独调，
 * 不必为了改一档明度重出四张图。
 */
export function createRidgeRings(): RidgeField {
  const root = new THREE.Group()
  root.name = 'arena-ridges'
  const loader = new THREE.TextureLoader()
  const owned: THREE.Texture[] = []

  RIDGE_LAYERS.forEach((layer, index) => {
    const segments = 128
    const geometry = new THREE.CylinderGeometry(
      layer.radius,
      layer.radius,
      layer.height,
      segments,
      1,
      true,
    )
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    const colors = new Float32Array(position.count * 3)
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const shade = position.getY(vertex) > 0 ? 1 : layer.baseShade
      colors[vertex * 3] = shade
      colors[vertex * 3 + 1] = shade
      colors[vertex * 3 + 2] = shade
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    // 必须用 map 而不是 alphaMap。three.js 的 alphaMap **只读绿通道**，
    // 而遮罩山体是 (10,17,32,255)——绿通道 17/255 = 0.067，
    // 低于 alphaTest 阈值，整片山会被丢弃（第一次接就是这么全没的）。
    // map 才读 alpha 通道，而且这四张的 RGB 正好是各层目标色。
    const map = loader.load(layer.map)
    map.colorSpace = THREE.SRGBColorSpace
    map.wrapS = THREE.RepeatWrapping
    map.wrapT = THREE.ClampToEdgeWrapping
    map.repeat.set(layer.repeat, 1)
    map.anisotropy = 8
    owned.push(map)

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map,
        // 顶点色在这里是**明度乘子**不是颜色：贴图给色相，顶点色把山根压暗，
        // 让平涂的剪影有一点体积感。空气透视仍可单独调，不必重出图。
        vertexColors: true,
        alphaTest: 0.5,
        side: THREE.BackSide,
        fog: false,
      }),
    )
    mesh.name = `arena-ridge-${layer.radius}`
    // topY 是柱顶（不是峰顶）应处的世界高度；几何体中心在局部原点。
    mesh.position.y = layer.topY - layer.height / 2
    // 由远及近依次绘制，最远的先画。
    mesh.renderOrder = -90 + (RIDGE_LAYERS.length - 1 - index) * 2
    mesh.frustumCulled = false
    root.add(mesh)
  })

  const mists = MIST_BANDS.map((band) => {
    const segments = 96
    const geometry = new THREE.CylinderGeometry(
      band.radius,
      band.radius,
      band.height,
      segments,
      1,
      true,
    )
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    // itemSize 4 时 three.js 会启用顶点 alpha。
    const colors = new Float32Array(position.count * 4)
    const tint = new THREE.Color(MIST_COLOR)

    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const angle = Math.atan2(position.getZ(vertex), position.getX(vertex))
      // 雾在谷底最浓，往上散尽。
      const vertical = position.getY(vertex) > 0 ? 0 : 1
      const swell =
        0.42 +
        0.58 *
          (0.5 +
            0.32 * Math.sin(angle * 2.3) +
            0.12 * Math.sin(angle * 5.1 + 2.0))
      colors[vertex * 4] = tint.r
      colors[vertex * 4 + 1] = tint.g
      colors[vertex * 4 + 2] = tint.b
      colors[vertex * 4 + 3] = vertical * swell * band.opacity
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    )
    mesh.name = `arena-mist-${band.radius}`
    mesh.position.y = band.y + band.height / 2
    mesh.frustumCulled = false
    root.add(mesh)
    return { mesh, rate: band.rate }
  })

  return {
    root,
    update(timeMs: number): void {
      for (const mist of mists) {
        mist.mesh.rotation.y = timeMs * mist.rate
      }
    },
    dispose(): void {
      for (const texture of owned) texture.dispose()
    },
  }
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
