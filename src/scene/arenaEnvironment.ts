import * as THREE from 'three'
import { createRidgeRings, createSkyDome, type RidgeField } from './skyDome'

interface FloatingProp {
  object: THREE.Object3D
  baseY: number
  phase: number
  amplitude: number
  speed: number
}

export interface ArenaEnvironmentSnapshot {
  platformLayers: number
  columns: number
  floatingRocks: number
  dustParticles: number
  accentLights: number
  /** 圆台专用贴图是否按 URL 请求（加载失败时材质会退回纯色）。 */
  textured: boolean
  assets: {
    ground: string
    stageTop: string
    /** 天穹已改为程序化渐变，不再依赖贴图。 */
    sky: 'procedural-gradient-animated'
    goldRim: string
  }
}

/**
 * 竞技场地面圆盘半径。
 *
 * 这个数字**直接决定能看见多少背景**。注意相机不在圆盘正上方，而是沿 z 退到
 * −10，因此挡住视线的是圆盘**远边**（z = +radius），距相机水平 `radius + 10`：
 *
 *     遮挡角 = atan((camY + ARENA_GROUND_Y_OFFSET) / (radius - camZ))
 *
 * 桌面机位视锥顶端在水平线下 26.7°，于是：
 *   radius 22 → 20.3°，整块画面被挡死；
 *   radius 12 → 28.3°，只剩 1.6°（约 27px），天空仅在左右角落露出来；
 *   radius 8.6 → 32.5°，约 5.8°（100px），中央也能看到远景。
 *
 * 下限由台面决定：棋盘远角需要 6.02、圆台外径 8.25，所以 8.6 是安全下界。
 * 浮岩铺到 9.35 会略微探出盘外——它们本来就是「悬浮」岩，这样反而合理。
 */
export const ARENA_GROUND_RADIUS = 8.6
/** 圆盘相对棋盘平面的下沉量，遮挡角计算要用。 */
export const ARENA_GROUND_Y_OFFSET = 0.86

/**
 * 地面贴图的取样缩放。`< 1` 表示放大（只取中间一块），
 * 让辉光环从圆台底下挪到盘沿外侧。
 */
const GROUND_UV_ZOOM = 0.936


/** 与圆台几何匹配的贴图（中心不画假棋盘，留给 3D 棋盘 mesh）。 */
export const ARENA_TEXTURE_URLS = {
  ground: '/assets/arena/arena_ground_circle.jpg',
  stageTop: '/assets/arena/arena_stage_top.jpg',
  goldRim: '/assets/arena/arena_gold_rim.jpg',
} as const

/**
 * 棋盘外的纯表现层竞技场。所有位置和漂浮节奏均使用固定种子，
 * 便于 Playwright 在手动时钟下获得可重复截图。
 *
 * 贴图按圆台结构绘制：圆形地面、圆台顶、equirect 天空穹顶。
 */
export class ArenaEnvironment {
  readonly root = new THREE.Group()
  private readonly floatingProps: FloatingProp[] = []
  private readonly dust: THREE.Points<
    THREE.BufferGeometry,
    THREE.PointsMaterial
  >
  private readonly dustBaseY: Float32Array
  private readonly dustPhase: Float32Array
  private readonly ridges: RidgeField
  private readonly skyDome: THREE.Mesh<
    THREE.SphereGeometry,
    THREE.ShaderMaterial
  >
  private readonly snapshot: ArenaEnvironmentSnapshot
  private readonly textureLoader = new THREE.TextureLoader()
  private readonly ownedTextures: THREE.Texture[] = []

  constructor() {
    this.root.name = 'arena-environment'

    const groundMap = this.loadColorMap(ARENA_TEXTURE_URLS.ground)
    // 贴图自带一圈辉光边，但它画在纹理半径 0.37–0.46 处；`CircleGeometry` 把
    // 纹理半径 0.5 映到盘沿，于是辉光落在几何半径 6.4–7.9——正好被外径 8.25 的
    // 圆台盖住，露在外面的只剩辉光外侧的暗色衰减，看起来就是「一圈黑盘」。
    // 稍微放大取样，把辉光推到盘沿外侧，平台边缘才有亮边而不是死黑。
    groundMap.repeat.set(GROUND_UV_ZOOM, GROUND_UV_ZOOM)
    groundMap.offset.set((1 - GROUND_UV_ZOOM) / 2, (1 - GROUND_UV_ZOOM) / 2)
    const stageTopMap = this.loadColorMap(ARENA_TEXTURE_URLS.stageTop)
    const goldRimMap = this.loadColorMap(ARENA_TEXTURE_URLS.goldRim)

    // 天空穹顶：程序化渐变 + 星空，外加两层远山环。
    // 不再用 equirect 照片——相机只看得到全图的 11.6%，其余全是白载，
    // 而且照片是定分辨率的，用户开 4K 就又糊了。
    this.skyDome = createSkyDome()
    this.root.add(this.skyDome)
    this.ridges = createRidgeRings()
    this.root.add(this.ridges.root)

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_GROUND_RADIUS, 72),
      new THREE.MeshStandardMaterial({
        map: groundMap,
        color: 0xffffff,
        metalness: 0.06,
        roughness: 0.94,
      }),
    )
    ground.name = 'arena-ground'
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -ARENA_GROUND_Y_OFFSET
    ground.receiveShadow = true
    this.root.add(ground)

    const lowerStage = new THREE.Mesh(
      new THREE.CylinderGeometry(7.6, 8.25, 0.5, 8),
      [
        // side / top / bottom（CylinderGeometry material groups）
        new THREE.MeshStandardMaterial({
          color: 0x1b1f2d,
          metalness: 0.54,
          roughness: 0.52,
        }),
        new THREE.MeshStandardMaterial({
          map: stageTopMap,
          color: 0xffffff,
          metalness: 0.28,
          roughness: 0.7,
        }),
        new THREE.MeshStandardMaterial({
          color: 0x12151c,
          metalness: 0.4,
          roughness: 0.8,
        }),
      ],
    )
    lowerStage.name = 'arena-stage-lower'
    lowerStage.scale.z = 0.82
    lowerStage.position.y = -0.61
    enableShadows(lowerStage)
    this.root.add(lowerStage)

    const upperStage = new THREE.Mesh(
      new THREE.CylinderGeometry(7.2, 7.55, 0.22, 8),
      [
        new THREE.MeshStandardMaterial({
          color: 0x303443,
          metalness: 0.3,
          roughness: 0.72,
        }),
        new THREE.MeshStandardMaterial({
          map: stageTopMap,
          color: 0xffffff,
          metalness: 0.22,
          roughness: 0.68,
        }),
        new THREE.MeshStandardMaterial({
          color: 0x1a1e28,
          metalness: 0.35,
          roughness: 0.75,
        }),
      ],
    )
    upperStage.name = 'arena-stage-upper'
    upperStage.scale.z = 0.83
    upperStage.position.y = -0.27
    enableShadows(upperStage)
    this.root.add(upperStage)

    const stageInlay = new THREE.Mesh(
      new THREE.RingGeometry(6.55, 6.72, 64),
      new THREE.MeshBasicMaterial({
        map: goldRimMap,
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    )
    stageInlay.name = 'arena-stage-gold-inlay'
    stageInlay.rotation.x = -Math.PI / 2
    stageInlay.scale.y = 0.83
    stageInlay.position.y = -0.145
    this.root.add(stageInlay)

    const columnPositions = [
      [-6.25, -5.45, 1.95],
      [6.25, -5.45, 1.55],
      [-6.4, 5.55, 1.35],
      [6.4, 5.55, 2.1],
    ] as const
    columnPositions.forEach(([x, z, height], index) => {
      const column = createBrokenColumn(height, index)
      column.position.set(x, -0.24, z)
      this.root.add(column)
    })

    const rockPositions = [
      [-7.2, 0.8, 1.2, 0.45],
      [7.3, -0.5, 1.75, 0.58],
      [-5.8, 6.8, 2.25, 0.34],
      [5.9, 6.6, 1.4, 0.4],
      [-7.4, -5.7, 2.8, 0.3],
      [7.25, -5.9, 2.35, 0.36],
    ] as const
    rockPositions.forEach(([x, z, y, scale], index) => {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(scale, 0),
        new THREE.MeshStandardMaterial({
          color: index % 2 === 0 ? 0x343b4d : 0x2c3344,
          metalness: 0.16,
          roughness: 0.88,
        }),
      )
      rock.name = `arena-floating-rock-${index + 1}`
      rock.position.set(x, y, z)
      rock.rotation.set(index * 0.37, index * 0.61, index * 0.23)
      rock.castShadow = true
      this.root.add(rock)
      this.floatingProps.push({
        object: rock,
        baseY: y,
        phase: index * 1.13,
        amplitude: 0.08 + (index % 3) * 0.025,
        speed: 0.00032 + (index % 2) * 0.00008,
      })
    })

    const accentPositions = [
      [-5.5, 1.1, -4.5],
      [5.5, 1.1, 4.5],
    ] as const
    accentPositions.forEach(([x, y, z], index) => {
      const crystal = createAccentCrystal(index)
      crystal.position.set(x, y, z)
      this.root.add(crystal)
    })

    const dustCount = 84
    const positions = new Float32Array(dustCount * 3)
    this.dustBaseY = new Float32Array(dustCount)
    this.dustPhase = new Float32Array(dustCount)
    const random = mulberry32(0x5849414e)
    for (let index = 0; index < dustCount; index += 1) {
      const angle = random() * Math.PI * 2
      const radius = 5.1 + random() * 5.6
      const y = 0.25 + random() * 4.4
      positions[index * 3] = Math.cos(angle) * radius
      positions[index * 3 + 1] = y
      positions[index * 3 + 2] = Math.sin(angle) * radius * 0.82
      this.dustBaseY[index] = y
      this.dustPhase[index] = random() * Math.PI * 2
    }
    const dustGeometry = new THREE.BufferGeometry()
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.dust = new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        color: 0x9fc8ff,
        size: 0.045,
        transparent: true,
        opacity: 0.38,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        toneMapped: false,
      }),
    )
    this.dust.name = 'arena-dust'
    this.root.add(this.dust)

    this.snapshot = {
      platformLayers: 3,
      columns: columnPositions.length,
      floatingRocks: rockPositions.length,
      dustParticles: dustCount,
      accentLights: accentPositions.length,
      textured: true,
      assets: { ...ARENA_TEXTURE_URLS, sky: 'procedural-gradient-animated' },
    }
  }

  update(timeMs: number): void {
    const safeTime = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0
    // 天穹的漂移、闪烁与流星全部由这个时钟驱动，不读墙上时间——
    // 手动时钟下同样的 advanceTime 必须给出同样的一帧。
    this.skyDome.material.uniforms.time!.value = safeTime
    this.ridges.update(safeTime)
    for (const prop of this.floatingProps) {
      prop.object.position.y =
        prop.baseY +
        Math.sin(prop.phase + safeTime * prop.speed) * prop.amplitude
      prop.object.rotation.y = prop.phase + safeTime * prop.speed * 0.32
    }

    const positions = this.dust.geometry.getAttribute('position')
    for (let index = 0; index < this.dustBaseY.length; index += 1) {
      positions.setY(
        index,
        this.dustBaseY[index] +
          Math.sin(this.dustPhase[index] + safeTime * 0.00042) * 0.16,
      )
    }
    positions.needsUpdate = true
  }

  getSnapshot(): ArenaEnvironmentSnapshot {
    return {
      ...this.snapshot,
      assets: { ...this.snapshot.assets },
    }
  }

  dispose(): void {
    for (const texture of this.ownedTextures) texture.dispose()
    this.ownedTextures.length = 0
  }

  private loadColorMap(url: string): THREE.Texture {
    const texture = this.textureLoader.load(url)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    // 圆台顶/地面：夹紧边缘，避免圆柱侧面采样溢色
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    this.ownedTextures.push(texture)
    return texture
  }
}

function createBrokenColumn(height: number, index: number): THREE.Group {
  const group = new THREE.Group()
  group.name = `arena-column-${index + 1}`
  const stone = new THREE.MeshStandardMaterial({
    color: index % 2 === 0 ? 0x41495b : 0x363e50,
    metalness: 0.08,
    roughness: 0.9,
  })
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.58, 0.66, 0.2, 8),
    stone,
  )
  base.position.y = 0.1
  group.add(base)

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.42, height, 10),
    stone,
  )
  shaft.position.y = 0.2 + height / 2
  shaft.rotation.z = (index % 2 === 0 ? 1 : -1) * 0.035
  group.add(shaft)

  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.38, 0.16, 8),
    stone,
  )
  collar.position.y = height + 0.18
  collar.rotation.z = shaft.rotation.z
  group.add(collar)
  enableShadows(group)
  return group
}

function createAccentCrystal(index: number): THREE.Group {
  const group = new THREE.Group()
  group.name = `arena-accent-${index + 1}`
  const color = index === 0 ? 0xe8694f : 0x64aeea
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.18, 0.24, 8),
    new THREE.MeshStandardMaterial({
      color: 0x242938,
      metalness: 0.5,
      roughness: 0.54,
    }),
  )
  pedestal.position.y = -0.13
  pedestal.castShadow = true
  group.add(pedestal)
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.09, 0),
    new THREE.MeshBasicMaterial({ color, toneMapped: false }),
  )
  crystal.rotation.z = Math.PI / 4
  group.add(crystal)
  const light = new THREE.PointLight(color, 0.72, 3.6, 2)
  light.position.y = 0.08
  group.add(light)
  return group
}

function enableShadows(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
  })
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
