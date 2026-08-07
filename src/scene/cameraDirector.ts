import * as THREE from 'three'
import { BOARD_EDGE_MARGIN, BOARD_H, BOARD_W, CELL } from './boardGeometry'
import {
  cameraOrbitYawAfterDrag,
  resolveCameraOrbitFogRange,
  resolveCameraOrbitPosition,
} from './cameraOrbit'
import { LIGHTING } from './lighting'
import type { PresentationProfile } from './presentationProfile'

export interface CameraBearing {
  readonly x: number
  readonly z: number
}

export interface Vector3Like {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface ScreenBounds {
  left: number
  right: number
  top: number
  bottom: number
}

export interface BoardProjection {
  bounds: ScreenBounds
  safeBounds: ScreenBounds
  cellSpacing: number
  cellSpacingByAxis: { horizontal: number; vertical: number }
  fullyVisible: boolean
  clearOfHud: boolean
}

const ZERO: Vector3Like = { x: 0, y: 0, z: 0 }

/**
 * 相机三层合成器。
 *
 * 1. **用户轨道**：`profile` 给出的基准构图 + 用户 yaw + 安全取景比例。这一层
 *    是唯一的「真」相机，规则拾取只使用它。
 * 2. **剧情偏移**：演出期间的推进／侧移，是相对轨道层的**纯偏移**，且在演出
 *    首尾必须精确为 0——否则每次吃子都会把镜头往外推一点，反复累积后漂移。
 * 3. **命中震动**：逐帧写入、渲染后立刻还原，不进入任何持久状态。
 */
export class CameraDirector {
  readonly camera: THREE.PerspectiveCamera
  private profile: PresentationProfile
  private readonly onPoseChanged: () => void

  private readonly restPosition = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly orbitOffset = new THREE.Vector3()
  private readonly cinematicPosition = new THREE.Vector3()
  private readonly cinematicTarget = new THREE.Vector3()
  private readonly cinematicScratch = new THREE.Vector3()
  private readonly composedPosition = new THREE.Vector3()
  private readonly composedTarget = new THREE.Vector3()

  private readonly fitCamera = new THREE.PerspectiveCamera()
  private readonly fitCandidate = new THREE.Vector3()
  private readonly fitPoint = new THREE.Vector3()
  private readonly baselineBounds: ScreenBounds = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  }
  private readonly candidateBounds: ScreenBounds = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  }

  private yawOffsetRadians = 0
  private framingScale = 1
  private dragging = false
  private tactical = false

  constructor(profile: PresentationProfile, onPoseChanged: () => void) {
    this.profile = profile
    this.onPoseChanged = onPoseChanged
    this.camera = new THREE.PerspectiveCamera(
      profile.camera.fov,
      profile.viewport.aspect,
      0.1,
      100,
    )
    applyPresentationCameraProjection(this.camera, profile)
    this.restPosition.copy(profile.camera.position)
    this.target.copy(profile.camera.target)
    this.camera.position.copy(this.restPosition)
    this.camera.lookAt(this.target)
  }

  setProfile(profile: PresentationProfile): void {
    this.profile = profile
    applyPresentationCameraProjection(this.camera, profile)
    this.target.copy(profile.camera.target)
    this.updatePose()
  }

  /** 由统一 pointer 手势驱动，仅环绕 Y 轴，不改变 profile 的俯角与投影。 */
  rotateByCssDelta(deltaXCss: number): boolean {
    const nextYaw = cameraOrbitYawAfterDrag(this.yawOffsetRadians, deltaXCss)
    if (nextYaw === this.yawOffsetRadians) return false
    this.yawOffsetRadians = nextYaw
    this.updatePose()
    return true
  }

  setDragging(dragging: boolean): void {
    this.dragging = dragging
  }

  isDragging(): boolean {
    return this.dragging
  }

  /**
   * 战术俯视：一个**离散的**备用构图，而不是放开自由俯角。
   *
   * 立绘是广告牌，连续俯角会暴露「卡片贴在平板上」；这里由调用方同时隐藏
   * 立绘、只留底座汉字，因此俯视是安全的。yaw 仍然生效。
   */
  setTacticalView(active: boolean): void {
    if (this.tactical === active) return
    this.tactical = active
    this.updatePose()
  }

  isTacticalView(): boolean {
    return this.tactical
  }

  /** 俯视基准机位：只解算高度，让整块棋盘落进 HUD 安全框。 */
  private tacticalBasePosition(): Vector3Like {
    const halfFov = (this.profile.camera.fov * Math.PI) / 360
    const target = this.profile.camera.target
    const height =
      (BOARD_H / 2 + BOARD_EDGE_MARGIN) / Math.max(0.05, Math.tan(halfFov))
    // 轻微后仰而非严格垂直：避免 lookAt 退化，也让棋盘文字朝向与常规视角一致。
    return { x: target.x, y: target.y + height, z: target.z - 0.35 }
  }

  /**
   * 设置剧情层偏移。调用方负责保证演出首尾传入 0；`clearCinematic()` 是
   * 取消路径必须走的复位入口。
   */
  setCinematic(position: Vector3Like, target: Vector3Like = ZERO): void {
    this.cinematicPosition.set(position.x, position.y, position.z)
    this.cinematicTarget.set(target.x, target.y, target.z)
  }

  clearCinematic(): void {
    this.cinematicPosition.set(0, 0, 0)
    this.cinematicTarget.set(0, 0, 0)
  }

  /**
   * 战斗镜头：注视点向战斗发生处平移，机位同时沿视线推近一点点，读作
   * 「凑近看」而不是整体平移。两者都与 `gain` 成正比，`gain=0` 即完全复位。
   */
  setCombatFocus(worldPoint: Vector3Like | null, gain: number): void {
    const amount = Number.isFinite(gain) ? Math.min(1, Math.max(0, gain)) : 0
    if (!worldPoint || amount <= 0.0005) {
      this.clearCinematic()
      return
    }
    this.cinematicTarget.set(
      (worldPoint.x - this.target.x) * 0.14 * amount,
      0,
      (worldPoint.z - this.target.z) * 0.14 * amount,
    )
    this.cinematicScratch
      .copy(this.target)
      .sub(this.restPosition)
      .multiplyScalar(0.05 * amount)
    this.cinematicPosition.copy(this.cinematicScratch).add(this.cinematicTarget)
  }

  hasCinematicOffset(): boolean {
    return (
      this.cinematicPosition.lengthSq() > 0 ||
      this.cinematicTarget.lengthSq() > 0
    )
  }

  /** 渲染前合成三层；`shake` 由 BattleFeedback 提供，不进入持久状态。 */
  composeForRender(shake: THREE.Vector3): void {
    this.composedTarget.copy(this.target).add(this.cinematicTarget)
    this.composedPosition
      .copy(this.restPosition)
      .add(this.cinematicPosition)
      .add(shake)
    this.camera.position.copy(this.composedPosition)
    this.camera.lookAt(this.composedTarget)
    this.camera.updateMatrixWorld(true)
  }

  /**
   * 规则拾取与广告牌朝向只使用轨道层：剧情推进和命中震动都不得改变落点
   * 射线，否则演出中的一帧点击会打到另一个交点上。
   */
  composeForPicking(): THREE.PerspectiveCamera {
    this.camera.position.copy(this.restPosition)
    this.camera.lookAt(this.target)
    this.camera.updateMatrixWorld(true)
    return this.camera
  }

  getRestPosition(): THREE.Vector3 {
    return this.restPosition
  }

  getTarget(): THREE.Vector3 {
    return this.target
  }

  getBearing(): CameraBearing {
    return {
      x: this.restPosition.x - this.target.x,
      z: this.restPosition.z - this.target.z,
    }
  }

  getFramingScale(): number {
    return this.framingScale
  }

  getFogRange(): { near: number; far: number } {
    return resolveCameraOrbitFogRange(
      LIGHTING.fogNear,
      LIGHTING.fogFar,
      this.framingScale,
    )
  }

  getViewSnapshot() {
    return {
      interaction: 'primary-drag-horizontal-orbit',
      yawOffsetRadians: Math.round(this.yawOffsetRadians * 1_000_000) / 1_000_000,
      yawOffsetDegrees:
        Math.round(((this.yawOffsetRadians * 180) / Math.PI) * 10) / 10,
      framingScale: Math.round(this.framingScale * 10_000) / 10_000,
      dragging: this.dragging,
      tactical: this.tactical,
      position: {
        x: this.restPosition.x,
        y: this.restPosition.y,
        z: this.restPosition.z,
      },
      target: { x: this.target.x, y: this.target.y, z: this.target.z },
      cinematic: {
        active: this.hasCinematicOffset(),
        position: {
          x: round(this.cinematicPosition.x),
          y: round(this.cinematicPosition.y),
          z: round(this.cinematicPosition.z),
        },
        target: {
          x: round(this.cinematicTarget.x),
          y: round(this.cinematicTarget.y),
          z: round(this.cinematicTarget.z),
        },
      },
    }
  }

  private updatePose(): void {
    const profileCamera = this.profile.camera
    this.target.copy(profileCamera.target)
    const basePosition = this.tactical
      ? this.tacticalBasePosition()
      : profileCamera.position
    const orbitPosition = resolveCameraOrbitPosition(
      basePosition,
      profileCamera.target,
      this.yawOffsetRadians,
    )
    const offset = this.orbitOffset.set(
      orbitPosition.x - this.target.x,
      orbitPosition.y - this.target.y,
      orbitPosition.z - this.target.z,
    )
    this.framingScale = this.resolveFramingScale(offset)
    this.restPosition
      .copy(this.target)
      .addScaledVector(offset, this.framingScale)
    this.camera.position.copy(this.restPosition)
    this.camera.lookAt(this.target)
    this.camera.updateMatrixWorld(true)
    this.onPoseChanged()
  }

  /** 以当前设备 0° 基准棋盘矩形为安全框，二分求最小可清屏的拉远比例。 */
  private resolveFramingScale(rotatedOffset: THREE.Vector3): number {
    applyPresentationCameraProjection(this.fitCamera, this.profile)
    if (this.tactical) {
      // 俯视构图与 3/4 视角的投影矩形形状不同，用后者当安全框会永远解不出来；
      // 这里只以 HUD 安全区为准。
      this.baselineBounds.left = Number.NEGATIVE_INFINITY
      this.baselineBounds.right = Number.POSITIVE_INFINITY
      this.baselineBounds.top = Number.NEGATIVE_INFINITY
      this.baselineBounds.bottom = Number.POSITIVE_INFINITY
    } else {
      this.measureProjectedBounds(
        this.profile.camera.position,
        this.baselineBounds,
      )
    }
    const { width, height } = this.profile.viewport
    // 俯视是备用构图，必须按 HUD 真实占用矩形取景；主视角沿用其自身内缩
    // （桌面为 0——那套构图本来就是照着避开 HUD 画的）。
    const insets = this.tactical
      ? this.profile.hudReservedCss
      : this.profile.framingInsetsCss
    this.baselineBounds.left = Math.max(this.baselineBounds.left, insets.left)
    this.baselineBounds.right = Math.min(
      this.baselineBounds.right,
      width - insets.right,
    )
    this.baselineBounds.top = Math.max(this.baselineBounds.top, insets.top)
    this.baselineBounds.bottom = Math.min(
      this.baselineBounds.bottom,
      height - insets.bottom,
    )
    const clearsAt = (scale: number) => {
      this.fitCandidate
        .copy(this.target)
        .addScaledVector(rotatedOffset, scale)
      return this.positionClearsFraming(this.fitCandidate)
    }

    if (clearsAt(1)) return 1
    let low = 1
    let high = 1.25
    while (high < 4 && !clearsAt(high)) high *= 1.25
    if (!clearsAt(high)) return high
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const middle = (low + high) / 2
      if (clearsAt(middle)) high = middle
      else low = middle
    }
    return high
  }

  /** 高频拖动路径复用相机与投影点，避免每次二分都 clone/分配对象。 */
  private positionClearsFraming(cameraPosition: THREE.Vector3): boolean {
    this.measureProjectedBounds(cameraPosition, this.candidateBounds)
    const bounds = this.candidateBounds
    const safe = this.baselineBounds
    return (
      bounds.left >= safe.left &&
      bounds.right <= safe.right &&
      bounds.top >= safe.top &&
      bounds.bottom <= safe.bottom
    )
  }

  private measureProjectedBounds(
    cameraPosition: Vector3Like,
    bounds: ScreenBounds,
  ): void {
    const camera = this.fitCamera
    camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z)
    camera.lookAt(this.target)
    camera.updateMatrixWorld(true)

    const { width, height } = this.profile.viewport
    const edgeX = BOARD_W / 2 + BOARD_EDGE_MARGIN
    const edgeZ = BOARD_H / 2 + BOARD_EDGE_MARGIN
    let left = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    let top = Number.POSITIVE_INFINITY
    let bottom = Number.NEGATIVE_INFINITY
    for (let xSign = -1; xSign <= 1; xSign += 2) {
      for (let zSign = -1; zSign <= 1; zSign += 2) {
        const projected = this.fitPoint
          .set(xSign * edgeX, 0.05, zSign * edgeZ)
          .project(camera)
        const x = ((projected.x + 1) / 2) * width
        const y = ((1 - projected.y) / 2) * height
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
    bounds.left = left
    bounds.right = right
    bounds.top = top
    bounds.bottom = bottom
  }

  /** 供自动化验收测量棋盘在屏幕上的实际外沿与最小格距。 */
  measureBoardProjection(): BoardProjection {
    const { width, height } = this.profile.viewport
    const activeInsets = this.tactical
      ? this.profile.hudReservedCss
      : this.profile.framingInsetsCss
    const project = this.createProjector(this.restPosition)
    const rawBounds = projectedBoardBounds(project)

    let horizontal = Number.POSITIVE_INFINITY
    let vertical = Number.POSITIVE_INFINITY
    for (let rank = 0; rank <= 9; rank += 1) {
      for (let file = 0; file < 8; file += 1) {
        horizontal = Math.min(
          horizontal,
          screenDistance(
            project((file - 4) * CELL, (rank - 4.5) * CELL),
            project((file + 1 - 4) * CELL, (rank - 4.5) * CELL),
          ),
        )
      }
    }
    for (let file = 0; file <= 8; file += 1) {
      for (let rank = 0; rank < 9; rank += 1) {
        vertical = Math.min(
          vertical,
          screenDistance(
            project((file - 4) * CELL, (rank - 4.5) * CELL),
            project((file - 4) * CELL, (rank + 1 - 4.5) * CELL),
          ),
        )
      }
    }

    const safeBounds: ScreenBounds = {
      left: activeInsets.left,
      right: width - activeInsets.right,
      top: activeInsets.top,
      bottom: height - activeInsets.bottom,
    }
    return {
      bounds: {
        left: round1(rawBounds.left),
        right: round1(rawBounds.right),
        top: round1(rawBounds.top),
        bottom: round1(rawBounds.bottom),
      },
      safeBounds,
      cellSpacing: round1(Math.min(horizontal, vertical)),
      cellSpacingByAxis: {
        horizontal: round1(horizontal),
        vertical: round1(vertical),
      },
      fullyVisible:
        rawBounds.left >= 0 &&
        rawBounds.right <= width &&
        rawBounds.top >= 0 &&
        rawBounds.bottom <= height,
      clearOfHud:
        rawBounds.left >= safeBounds.left &&
        rawBounds.right <= safeBounds.right &&
        rawBounds.top >= safeBounds.top &&
        rawBounds.bottom <= safeBounds.bottom,
    }
  }

  /**
   * 把棋盘世界坐标投到 CSS 像素。供自动化验收定位交点，避免测试脚本
   * 硬编码像素——相机构图随视口和 yaw 变化，硬编码坐标一改就失效。
   */
  projectBoardPoint(x: number, z: number): { x: number; y: number } {
    return this.createProjector(this.restPosition)(x, z)
  }

  private createProjector(cameraPosition: THREE.Vector3) {
    const { width, height } = this.profile.viewport
    const camera = this.camera.clone()
    camera.position.copy(cameraPosition)
    camera.lookAt(this.target)
    applyPresentationCameraProjection(camera, this.profile)
    camera.updateMatrixWorld(true)

    return (x: number, z: number) => {
      const point = new THREE.Vector3(x, 0.05, z).project(camera)
      return {
        x: ((point.x + 1) / 2) * width,
        y: ((1 - point.y) / 2) * height,
      }
    }
  }
}

export function applyPresentationCameraProjection(
  camera: THREE.PerspectiveCamera,
  profile: PresentationProfile,
): void {
  camera.fov = profile.camera.fov
  camera.aspect = profile.viewport.aspect
  const offset = profile.camera.projectionCenterOffsetCss
  if (offset.x === 0 && offset.y === 0) {
    camera.clearViewOffset()
  } else {
    camera.setViewOffset(
      profile.viewport.width,
      profile.viewport.height,
      -offset.x,
      -offset.y,
      profile.viewport.width,
      profile.viewport.height,
    )
  }
  camera.updateProjectionMatrix()
}

function projectedBoardBounds(
  project: (x: number, z: number) => { x: number; y: number },
): ScreenBounds {
  const edgeX = BOARD_W / 2 + BOARD_EDGE_MARGIN
  const edgeZ = BOARD_H / 2 + BOARD_EDGE_MARGIN
  const corners = [
    project(-edgeX, -edgeZ),
    project(edgeX, -edgeZ),
    project(-edgeX, edgeZ),
    project(edgeX, edgeZ),
  ]
  return {
    left: Math.min(...corners.map((point) => point.x)),
    right: Math.max(...corners.map((point) => point.x)),
    top: Math.min(...corners.map((point) => point.y)),
    bottom: Math.max(...corners.map((point) => point.y)),
  }
}

function screenDistance(
  first: { x: number; y: number },
  second: { x: number; y: number },
): number {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
