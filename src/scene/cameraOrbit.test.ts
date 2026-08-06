import { describe, expect, it } from 'vitest'
import {
  CAMERA_ORBIT_RADIANS_PER_CSS_PIXEL,
  cameraOrbitYawAfterDrag,
  normalizeCameraOrbitYaw,
  resolveCameraOrbitFogRange,
  resolveCameraOrbitPosition,
} from './cameraOrbit'

describe('camera orbit', () => {
  it('零偏移精确保留响应式 profile 的基准相机', () => {
    expect(
      resolveCameraOrbitPosition(
        { x: 0, y: 11, z: -10 },
        { x: 0, y: 0, z: 0 },
        0,
      ),
    ).toEqual({ x: 0, y: 11, z: -10 })
  })

  it('水平拖动只改变绕 Y 轴方位并保持原俯角比例', () => {
    const yaw = cameraOrbitYawAfterDrag(0, -180)
    expect(yaw).toBeCloseTo(Math.PI / 2)

    const position = resolveCameraOrbitPosition(
      { x: 0, y: 11, z: -10 },
      { x: 0, y: 0, z: 0 },
      yaw,
    )
    expect(position.x).toBeCloseTo(-10)
    expect(position.y).toBeCloseTo(11)
    expect(position.z).toBeCloseTo(0)
  })

  it('持续环绕会归一化角度，无效输入不会污染状态', () => {
    expect(normalizeCameraOrbitYaw(Math.PI * 5)).toBeCloseTo(-Math.PI)
    expect(normalizeCameraOrbitYaw(Number.NaN)).toBe(0)
    expect(cameraOrbitYawAfterDrag(0.4, Number.NaN)).toBeCloseTo(0.4)
    expect(CAMERA_ORBIT_RADIANS_PER_CSS_PIXEL).toBeGreaterThan(0)
  })

  it('安全取景缩放只沿相机到 target 的向量拉远', () => {
    expect(
      resolveCameraOrbitPosition(
        { x: 0, y: 11, z: -10 },
        { x: 0, y: 1, z: 0 },
        0,
        1.5,
      ),
    ).toEqual({ x: 0, y: 16, z: -15 })
  })

  it('安全取景拉远时同步扩展雾距，非法缩放回退到原值', () => {
    expect(resolveCameraOrbitFogRange(12, 28, 1.5)).toEqual({
      near: 18,
      far: 42,
    })
    expect(resolveCameraOrbitFogRange(12, 28, Number.NaN)).toEqual({
      near: 12,
      far: 28,
    })
  })
})
