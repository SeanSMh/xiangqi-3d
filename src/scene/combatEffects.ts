import * as THREE from 'three'
import type {
  AnimationEvent,
  PiecePose,
} from '../animation/animationDirector'
import type { BoardCoord, Side } from '../types/xiangqi'
import { BattleFeedback } from './battleFeedback'
import { fileRankToWorld } from './boardGeometry'
import { FACTION_COLORS } from './lighting'
import type { TextureLibrary } from './textureLibrary'

/** 落步扬尘的存活时长与并发上限。 */
const DUST_LIFE_MS = 620
const DUST_POOL_SIZE = 8

/**
 * 火球贴图里烘焙好的拖尾方向：头在右上约 45°。旋转 sprite 时要先减掉它，
 * 才能让尾巴真正落在飞行轨迹后面。
 */
const FIREBALL_BAKED_ANGLE = Math.PI / 4

interface DustPuff {
  sprite: THREE.Sprite
  startedAtMs: number
  strength: number
  active: boolean
}

/**
 * 一次演出期间的全部瞬时特效：移动拖尾、炮弹道、命中冲击、蓄力预兆与占领脉冲。
 *
 * 连续量由 AnimationDirector 逐帧推入；一次性瞬间（落步扬尘）走 `onEvent`，
 * 由本模块按**模拟时钟**自行衰减——不读 wall clock，因此悔棋、回放和手动时钟
 * 都得到一致画面。
 */
export class CombatEffects {
  readonly root = new THREE.Group()
  private readonly textures: TextureLibrary
  private readonly camera: THREE.PerspectiveCamera
  private readonly battleFeedback = new BattleFeedback()

  private slashTrail: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshBasicMaterial
  > | null = null
  private fireball: THREE.Sprite | null = null
  private whiteImpact: THREE.Sprite | null = null
  private orangeImpact: THREE.Sprite | null = null
  private claimRing: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshBasicMaterial
  > | null = null
  private claimActive = false
  private windupRing: THREE.Mesh<
    THREE.RingGeometry,
    THREE.MeshBasicMaterial
  > | null = null
  private windupActive = false

  private readonly dust: DustPuff[] = []
  private dustCursor = 0
  private presentationTimeMs = 0
  private particleScale = 1

  constructor(textures: TextureLibrary, camera: THREE.PerspectiveCamera) {
    this.textures = textures
    this.camera = camera
    this.root.name = 'combat-effects'
    this.root.add(this.battleFeedback.root)
    this.ensureImpactSprites()
  }

  /** 由 BoardScene 用模拟时钟驱动；一次性特效的衰减全靠它。 */
  update(presentationTimeMs: number): void {
    this.presentationTimeMs = presentationTimeMs
    for (const puff of this.dust) {
      if (!puff.active) continue
      const progress = (presentationTimeMs - puff.startedAtMs) / DUST_LIFE_MS
      if (progress < 0 || progress >= 1) {
        puff.active = false
        puff.sprite.visible = false
        continue
      }
      // 起爆快、消散慢：扬尘一瞬间腾起，然后慢慢飘散。
      const rise = 1 - (1 - progress) ** 2
      puff.sprite.material.opacity =
        Math.sin(Math.PI * Math.min(1, progress * 1.15)) * 0.42 * puff.strength
      puff.sprite.scale.setScalar(0.42 + rise * 0.55)
      puff.sprite.position.y = 0.16 + rise * 0.2
    }
  }

  onEvent(event: AnimationEvent): void {
    if (event.type !== 'footfall') return
    this.spawnDust(event.square, event.strength)
  }

  /**
   * 车的冲锋刀光。用 Alpha 作形状、阵营色作颜色——原图是红金的，直接叠加会让
   * 黑方也拖出红光；只取轮廓才能保住阵营识别。
   */
  setMoveTrail(
    from: BoardCoord,
    to: BoardCoord,
    progress: number,
    opacity: number,
    side: Side,
  ): void {
    if (!this.slashTrail && opacity <= 0.001) return
    this.ensureSlashTrail()
    const trail = this.slashTrail
    if (!trail) return

    const clamped = THREE.MathUtils.clamp(progress, 0, 1)
    const start = fileRankToWorld(from.file, from.rank)
    const destination = fileRankToWorld(to.file, to.rank)
    const end = start.clone().lerp(destination, clamped)
    const dx = end.x - start.x
    const dz = end.z - start.z
    const length = Math.hypot(dx, dz)

    trail.visible = opacity > 0.001 && length > 0.001
    if (!trail.visible) return
    // 抬到棋盘线与落点标记之上；贴地太低会被线条和标记的加色叠加吃掉。
    trail.position.set((start.x + end.x) / 2, 0.12, (start.z + end.z) / 2)
    // Euler XYZ：Z 先在贴图自身平面内自转，再由 X 把它放倒贴地，
    // 于是贴图的「向右」精确指向行进方向。
    trail.rotation.set(-Math.PI / 2, 0, Math.atan2(-dz, dx))
    // 平铺在棋盘上会被 45° 视角压扁，因此给足宽度才读得出来。
    trail.scale.set(length + 0.7, 1.35, 1)
    // 只提一点点亮度：提太多会洗成白色，反而丢掉阵营识别。
    trail.material.color.set(brighten(FACTION_COLORS[side].ring, 0.15))
    trail.material.opacity = opacity
  }

  /** 炮弹道：贴图自带拖尾，因此要按屏幕空间飞行方向旋转。 */
  setCannonProjectile(
    pose: PiecePose,
    trailFrom: PiecePose,
    opacity: number,
  ): void {
    const alpha = THREE.MathUtils.clamp(opacity, 0, 1)
    if (!this.fireball && alpha <= 0.001) return
    this.ensureFireball()
    const fireball = this.fireball
    if (!fireball) return

    const position = fileRankToWorld(pose.file, pose.rank)
    position.y = 0.14 + pose.lift
    fireball.position.copy(position)
    fireball.visible = alpha > 0.001
    fireball.material.opacity = alpha
    // 贴图四周留白很多，弹体本身只占约七成；不放大到 1.4 格看着就是个火星。
    fireball.scale.setScalar(1.4 * pose.scale)
    if (!fireball.visible) return

    const tail = fileRankToWorld(trailFrom.file, trailFrom.rank)
    tail.y = 0.14 + trailFrom.lift
    fireball.material.rotation =
      this.screenAngleBetween(tail, position) - FIREBALL_BAKED_ANGLE
  }

  setCaptureImpact(
    square: BoardCoord,
    whiteProgress: number,
    orangeProgress: number,
  ): void {
    this.ensureImpactSprites()
    const position = fileRankToWorld(square.file, square.rank)
    position.y = 0.62
    this.battleFeedback.update(position, whiteProgress, orangeProgress)

    if (this.whiteImpact) {
      this.whiteImpact.position.copy(position)
      const peak = 70 / 170
      const p = THREE.MathUtils.clamp(whiteProgress, 0, 1)
      if (p <= peak) {
        const t = p / peak
        setSpriteVisual(
          this.whiteImpact,
          p > 0,
          t,
          THREE.MathUtils.lerp(0.28, 0.9, t),
        )
      } else {
        const t = (p - peak) / (1 - peak)
        setSpriteVisual(
          this.whiteImpact,
          p < 1,
          1 - t,
          THREE.MathUtils.lerp(0.9, 1.15, t),
        )
      }
    }

    if (this.orangeImpact) {
      this.orangeImpact.position.copy(position)
      const peak = 180 / 430
      const p = THREE.MathUtils.clamp(orangeProgress, 0, 1)
      if (p <= peak) {
        const t = p / peak
        setSpriteVisual(
          this.orangeImpact,
          p > 0,
          THREE.MathUtils.lerp(0.9, 0.35, t),
          THREE.MathUtils.lerp(0.45, 1.2, t),
        )
      } else {
        const t = (p - peak) / (1 - peak)
        setSpriteVisual(
          this.orangeImpact,
          p < 1,
          0.35 * (1 - t),
          THREE.MathUtils.lerp(1.2, 1.42, t),
        )
      }
    }
  }

  /**
   * 蓄力预兆：出手前在**起点**收紧的一圈地面环。
   *
   * 这是七棋种差异化里最省的一笔——强度直接由 CombatProfile 的命中强度驱动，
   * 于是帅将、车、炮起手时地面会明显发沉，仕士与兵卒几乎看不见。
   */
  setWindupTell(
    square: BoardCoord,
    progress: number,
    strength: number,
    side: Side,
  ): void {
    const p = THREE.MathUtils.clamp(progress, 0, 1)
    if (!this.windupRing && p <= 0) return
    this.ensureWindupRing()
    const ring = this.windupRing
    if (!ring) return
    if (p <= 0 || p >= 1 || strength < 0.5) {
      ring.visible = false
      this.windupActive = false
      return
    }
    const position = fileRankToWorld(square.file, square.rank)
    ring.position.set(position.x, 0.043, position.z)
    // 由外向内收紧，读作把力气聚拢起来。
    ring.scale.setScalar(1.55 - p * 0.78)
    ring.material.color.setHex(FACTION_COLORS[side].ring)
    ring.material.opacity = Math.sin(Math.PI * p) * 0.46 * strength
    ring.visible = true
    this.windupActive = true
  }

  /**
   * 占领落点：清场之后压住交点时的地面波。
   *
   * 与命中冲击刻意分开——命中是「打中了」，占领是「这个交点现在归我」，
   * 两个节拍在参考项目里也是分开演的。
   */
  setClaimPulse(square: BoardCoord, progress: number, strength: number): void {
    const p = THREE.MathUtils.clamp(progress, 0, 1)
    if (!this.claimRing && p <= 0) return
    this.ensureClaimRing()
    const ring = this.claimRing
    if (!ring) return
    if (p <= 0 || p >= 1) {
      ring.visible = false
      this.claimActive = false
      return
    }
    const position = fileRankToWorld(square.file, square.rank)
    ring.position.set(position.x, 0.046, position.z)
    const eased = 1 - (1 - p) ** 2
    ring.scale.setScalar(0.9 + eased * (1.5 + strength * 1.3))
    ring.rotation.z = p * 0.6
    ring.material.opacity = Math.sin(Math.PI * p) * 0.62 * (0.5 + strength * 0.5)
    ring.visible = true
    this.claimActive = true
  }

  clear(): void {
    if (this.slashTrail) this.slashTrail.visible = false
    if (this.fireball) this.fireball.visible = false
    if (this.whiteImpact) this.whiteImpact.visible = false
    if (this.orangeImpact) this.orangeImpact.visible = false
    if (this.claimRing) this.claimRing.visible = false
    if (this.windupRing) this.windupRing.visible = false
    for (const puff of this.dust) {
      puff.active = false
      puff.sprite.visible = false
    }
    this.claimActive = false
    this.windupActive = false
    this.battleFeedback.clear()
  }

  getCameraShake(target: THREE.Vector3): THREE.Vector3 {
    return this.battleFeedback.getCameraOffset(target)
  }

  setQualityBudget(budget: {
    particleScale: number
    impactLight: boolean
    shakeScale: number
  }): void {
    this.particleScale = THREE.MathUtils.clamp(budget.particleScale, 0, 1)
    this.battleFeedback.setBudget(budget)
  }

  getSnapshot() {
    return {
      ...this.battleFeedback.getSnapshot(),
      claimRingActive: this.claimActive,
      windupTellActive: this.windupActive,
      dustPuffsActive: this.dust.filter((puff) => puff.active).length,
      authoredVfx: true,
    }
  }

  // ------------------------------------------------------------------ 内部

  /** 把两个世界点之间的方向换算成屏幕空间角度（y 向上，逆时针为正）。 */
  private screenAngleBetween(from: THREE.Vector3, to: THREE.Vector3): number {
    const tail = from.clone().project(this.camera)
    const head = to.clone().project(this.camera)
    const dx = head.x - tail.x
    const dy = head.y - tail.y
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return 0
    // sprite 四边形在世界里是正方形，投影后像素也是正方形，
    // 因此把 NDC 的 x 乘以 aspect 就得到真实的像素方向。
    return Math.atan2(dy, dx * this.camera.aspect)
  }

  private spawnDust(square: BoardCoord, strength: number): void {
    const capacity = Math.max(1, Math.round(DUST_POOL_SIZE * this.particleScale))
    this.ensureDustPool(capacity)
    const puff = this.dust[this.dustCursor % capacity]
    if (!puff) return
    this.dustCursor = (this.dustCursor + 1) % capacity
    const position = fileRankToWorld(square.file, square.rank)
    // 落点附近做确定性抖动，避免连续落步的尘土完全重叠。
    const jitter = ((this.dustCursor * 37) % 11) / 11 - 0.5
    puff.sprite.position.set(position.x + jitter * 0.22, 0.16, position.z)
    puff.startedAtMs = this.presentationTimeMs
    puff.strength = THREE.MathUtils.clamp(strength, 0, 1)
    puff.active = true
    puff.sprite.visible = true
  }

  private ensureDustPool(capacity: number): void {
    while (this.dust.length < capacity) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.textures.get('/assets/vfx/vfx_footstep_dust_alpha.png'),
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
          toneMapped: false,
        }),
      )
      sprite.name = `footstep-dust-${this.dust.length}`
      sprite.visible = false
      sprite.renderOrder = 6
      this.root.add(sprite)
      this.dust.push({ sprite, startedAtMs: 0, strength: 0, active: false })
    }
  }

  private ensureSlashTrail(): void {
    if (this.slashTrail) return
    const trail = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      createAlphaShapeMaterial(
        this.textures.get('/assets/vfx/vfx_chariot_slash_trail_alpha.png'),
      ),
    )
    trail.name = 'chariot-slash-trail'
    trail.renderOrder = 6
    trail.visible = false
    this.root.add(trail)
    this.slashTrail = trail
  }

  private ensureFireball(): void {
    if (this.fireball) return
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.textures.get('/assets/vfx/vfx_cannon_fireball_alpha.png'),
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      }),
    )
    sprite.name = 'cannon-fireball'
    sprite.visible = false
    sprite.renderOrder = 9
    this.root.add(sprite)
    this.fireball = sprite
  }

  private ensureImpactSprites(): void {
    if (!this.whiteImpact) {
      this.whiteImpact = this.createImpactSprite(
        '/assets/vfx/vfx_blast_white_cyan_alpha.png',
      )
    }
    if (!this.orangeImpact) {
      this.orangeImpact = this.createImpactSprite(
        '/assets/vfx/vfx_blast_orange_gold_alpha.png',
      )
    }
  }

  private createImpactSprite(url: string): THREE.Sprite {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.textures.get(url),
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      }),
    )
    sprite.visible = false
    sprite.renderOrder = 10
    this.root.add(sprite)
    return sprite
  }

  private ensureClaimRing(): void {
    if (this.claimRing) return
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      createAlphaShapeMaterial(
        this.textures.get('/assets/vfx/vfx_ground_wave_ring_alpha.png'),
        0xe6d2a0,
      ),
    )
    ring.name = 'occupy-claim-ring'
    ring.rotation.x = -Math.PI / 2
    ring.renderOrder = 7
    ring.visible = false
    this.root.add(ring)
    this.claimRing = ring
  }

  private ensureWindupRing(): void {
    if (this.windupRing) return
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.46, 0.55, 44),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    )
    ring.name = 'windup-tell-ring'
    ring.rotation.x = -Math.PI / 2
    ring.renderOrder = 7
    ring.visible = false
    this.root.add(ring)
    this.windupRing = ring
  }
}

/**
 * 只取贴图的 Alpha 作形状，颜色由 `material.color` 决定。
 *
 * 原始 VFX 是红金配色，直接叠加会让黑方也拖出红光；乘一个蓝色又会把红金乘成
 * 黑色。只用轮廓才能既保住作者画好的形状，又保住阵营识别。
 */
function createAlphaShapeMaterial(
  texture: THREE.Texture,
  color = 0xffffff,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
  material.name = 'vfx-alpha-shape'
  material.fog = false
  material.onBeforeCompile = (shader) => {
    // 这几张 VFX 是很淡的软遮罩（车刀光 alpha 均值仅 14.6/255），
    // 直接当形状用会发虚；抬一档 gamma 把中间调提起来再叠加。
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
#ifdef USE_MAP
  float vfxAlpha = texture2D(map, vMapUv).a;
  diffuseColor.a *= clamp(pow(vfxAlpha, 0.5) * 1.55, 0.0, 1.0);
#endif
      `,
    )
  }
  material.customProgramCacheKey = () => 'vfx-alpha-shape-v2'
  return material
}

/** 加色混合下，颜色越亮越突出；把阵营色往白里提一点再叠。 */
function brighten(hex: number, amount: number): THREE.Color {
  return new THREE.Color(hex).lerp(new THREE.Color(0xffffff), amount)
}

function setSpriteVisual(
  sprite: THREE.Sprite,
  visible: boolean,
  opacity: number,
  scale: number,
): void {
  sprite.visible = visible
  sprite.material.opacity = THREE.MathUtils.clamp(opacity, 0, 1)
  sprite.scale.setScalar(scale)
}
