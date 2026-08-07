import * as THREE from 'three'

const SPARK_COUNT = 18

export interface BattleFeedbackSnapshot {
  sparkCount: number
  sparksActive: boolean
  shockwaveActive: boolean
  impactLightActive: boolean
  cameraShake: number
}

/**
 * 吃子命中的附加表现：冲击波、火花、瞬时点光与确定性镜头震动。
 * 进度由 AnimationDirector 驱动，不读取真实时钟。
 */
export class BattleFeedback {
  readonly root = new THREE.Group()
  private readonly shockwave: THREE.Mesh<
    THREE.RingGeometry,
    THREE.MeshBasicMaterial
  >
  private readonly sparks: THREE.InstancedMesh<
    THREE.TetrahedronGeometry,
    THREE.MeshBasicMaterial
  >
  private readonly impactLight = new THREE.PointLight(0xffb04a, 0, 4.2, 2)
  private readonly tempMatrix = new THREE.Matrix4()
  private readonly tempPosition = new THREE.Vector3()
  private readonly tempQuaternion = new THREE.Quaternion()
  private readonly tempScale = new THREE.Vector3()
  private readonly cameraOffset = new THREE.Vector3()
  private cameraShake = 0
  private particleScale = 1
  private impactLightEnabled = true
  private shakeScale = 1

  /** 由画质档下发；只影响表现强度，不影响任何时间线。 */
  setBudget(budget: {
    particleScale: number
    impactLight: boolean
    shakeScale: number
  }): void {
    this.particleScale = THREE.MathUtils.clamp(budget.particleScale, 0, 1)
    this.impactLightEnabled = budget.impactLight
    this.shakeScale = THREE.MathUtils.clamp(budget.shakeScale, 0, 1)
  }

  get activeSparkCount(): number {
    return Math.max(1, Math.round(SPARK_COUNT * this.particleScale))
  }

  constructor() {
    this.root.name = 'battle-feedback'

    this.shockwave = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.43, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffc25a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    )
    this.shockwave.name = 'capture-shockwave'
    this.shockwave.rotation.x = -Math.PI / 2
    this.shockwave.renderOrder = 8
    this.shockwave.visible = false
    this.root.add(this.shockwave)

    this.sparks = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(0.035, 0),
      new THREE.MeshBasicMaterial({
        color: 0xffc45e,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      }),
      SPARK_COUNT,
    )
    this.sparks.name = 'capture-sparks'
    this.sparks.renderOrder = 9
    this.sparks.visible = false
    this.sparks.frustumCulled = false
    this.root.add(this.sparks)

    this.impactLight.name = 'capture-impact-light'
    this.impactLight.visible = false
    this.root.add(this.impactLight)
  }

  update(
    position: THREE.Vector3,
    whiteProgress: number,
    orangeProgress: number,
  ): void {
    const white = THREE.MathUtils.clamp(whiteProgress, 0, 1)
    const orange = THREE.MathUtils.clamp(orangeProgress, 0, 1)
    const shockProgress = THREE.MathUtils.clamp(
      (orange - 0.03) / 0.88,
      0,
      1,
    )
    const active = white > 0 && white < 1
    const orangeActive = orange > 0 && orange < 1
    const fade = 1 - shockProgress

    this.root.position.copy(position)
    this.root.position.y = 0

    this.shockwave.visible = orangeActive
    this.shockwave.position.y = 0.065
    this.shockwave.scale.setScalar(0.55 + shockProgress * 2.9)
    this.shockwave.material.opacity = orangeActive
      ? Math.sin(Math.PI * shockProgress) * 0.62
      : 0

    this.sparks.visible = orangeActive
    this.sparks.material.opacity = orangeActive ? fade * 0.95 : 0
    for (let index = 0; index < SPARK_COUNT; index += 1) {
      const angle = (index / SPARK_COUNT) * Math.PI * 2 + (index % 3) * 0.13
      const radialBias = 0.7 + (index % 5) * 0.085
      const distance = shockProgress * 1.2 * radialBias
      const arc = Math.sin(Math.PI * shockProgress)
      this.tempPosition.set(
        Math.cos(angle) * distance,
        0.16 + arc * (0.28 + (index % 4) * 0.055),
        Math.sin(angle) * distance,
      )
      this.tempQuaternion.setFromEuler(
        new THREE.Euler(
          angle * 0.6,
          angle + shockProgress * 4,
          shockProgress * 6 + index,
        ),
      )
      // 超出当前预算的火花缩到不可见，而不是重建 InstancedMesh。
      const size =
        index < this.activeSparkCount
          ? Math.max(0.001, (0.72 + (index % 3) * 0.16) * fade)
          : 0.0001
      this.tempScale.setScalar(size)
      this.tempMatrix.compose(
        this.tempPosition,
        this.tempQuaternion,
        this.tempScale,
      )
      this.sparks.setMatrixAt(index, this.tempMatrix)
    }
    this.sparks.instanceMatrix.needsUpdate = true

    const whitePulse = active ? Math.sin(Math.PI * white) : 0
    const orangePulse = orangeActive ? Math.sin(Math.PI * orange) : 0
    this.impactLight.visible =
      this.impactLightEnabled && (whitePulse > 0.01 || orangePulse > 0.01)
    this.impactLight.position.set(0, 0.72, 0)
    this.impactLight.color.setHex(whitePulse > orangePulse ? 0xdff6ff : 0xffa332)
    this.impactLight.intensity = this.impactLightEnabled
      ? whitePulse * 4.2 + orangePulse * 2.8
      : 0

    this.cameraShake =
      (whitePulse * (1 - white) * 0.078 + orangePulse * (1 - orange) * 0.032) *
      this.shakeScale
    this.cameraOffset.set(
      Math.sin(white * 71 + orange * 19) * this.cameraShake,
      Math.cos(white * 43 + orange * 31) * this.cameraShake * 0.42,
      Math.sin(white * 37 - orange * 23) * this.cameraShake * 0.55,
    )
  }

  clear(): void {
    this.shockwave.visible = false
    this.shockwave.material.opacity = 0
    this.sparks.visible = false
    this.sparks.material.opacity = 0
    this.impactLight.visible = false
    this.impactLight.intensity = 0
    this.cameraShake = 0
    this.cameraOffset.set(0, 0, 0)
  }

  getCameraOffset(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.cameraOffset)
  }

  getSnapshot(): BattleFeedbackSnapshot {
    return {
      sparkCount: this.activeSparkCount,
      sparksActive: this.sparks.visible,
      shockwaveActive: this.shockwave.visible,
      impactLightActive: this.impactLight.visible,
      cameraShake: round(this.cameraShake),
    }
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
