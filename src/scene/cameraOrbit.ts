export const CAMERA_ORBIT_RADIANS_PER_CSS_PIXEL = Math.PI / 360

export interface CameraOrbitVector3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** 把任意角度归一化到 [-PI, PI)，避免长时间拖动后数值持续增大。 */
export function normalizeCameraOrbitYaw(yawRadians: number): number {
  if (!Number.isFinite(yawRadians)) return 0
  const fullTurn = Math.PI * 2
  return ((yawRadians + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI
}

/** 向右拖动等价于从棋盘右侧环绕观察。 */
export function cameraOrbitYawAfterDrag(
  currentYawRadians: number,
  deltaXCss: number,
): number {
  if (!Number.isFinite(deltaXCss)) {
    return normalizeCameraOrbitYaw(currentYawRadians)
  }
  return normalizeCameraOrbitYaw(
    currentYawRadians - deltaXCss * CAMERA_ORBIT_RADIANS_PER_CSS_PIXEL,
  )
}

/**
 * 在不改变 profile 俯角的前提下绕世界 Y 轴旋转相机；distanceScale 仅用于
 * 响应式安全取景，1 时必须精确保留原 profile 构图。
 */
export function resolveCameraOrbitPosition(
  basePosition: CameraOrbitVector3,
  target: CameraOrbitVector3,
  yawOffsetRadians: number,
  distanceScale = 1,
): CameraOrbitVector3 {
  const yaw = normalizeCameraOrbitYaw(yawOffsetRadians)
  const scale =
    Number.isFinite(distanceScale) && distanceScale >= 1 ? distanceScale : 1
  const cosine = Math.cos(yaw)
  const sine = Math.sin(yaw)
  const offsetX = basePosition.x - target.x
  const offsetY = basePosition.y - target.y
  const offsetZ = basePosition.z - target.z

  return {
    x: target.x + (offsetX * cosine + offsetZ * sine) * scale,
    y: target.y + offsetY * scale,
    z: target.z + (-offsetX * sine + offsetZ * cosine) * scale,
  }
}

/** 相机为安全取景拉远时同步扩展线性雾距，保持棋盘可见度不随方位骤降。 */
export function resolveCameraOrbitFogRange(
  baseNear: number,
  baseFar: number,
  distanceScale: number,
): { near: number; far: number } {
  const scale =
    Number.isFinite(distanceScale) && distanceScale >= 1 ? distanceScale : 1
  return {
    near: baseNear * scale,
    far: baseFar * scale,
  }
}
