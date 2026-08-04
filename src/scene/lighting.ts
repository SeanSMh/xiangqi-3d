/**
 * 统一场景灯光（红黑共用同一套参数）
 * 概念图 rim 强度不统一时，以本模块为准，勿在贴图上各烤一套 rim。
 *
 * 参数说明见 resources/art/production/ENGINE_LIGHTING.md
 */
import * as THREE from 'three'

export const LIGHTING = {
  background: 0x0d0d14,
  fogNear: 12,
  fogFar: 28,
  ambient: { color: 0x6a7a8c, intensity: 0.42 },
  /** 主光：暖白，略偏前上 */
  key: {
    color: 0xfff0e0,
    intensity: 1.05,
    position: new THREE.Vector3(5, 14, 7),
  },
  /** 补光：冷蓝，偏后侧，避免纯黑死面 */
  fill: {
    color: 0x5a7aaa,
    intensity: 0.38,
    position: new THREE.Vector3(-7, 5, -5),
  },
  /**
   * 轮廓光（rim）：统一冷蓝
   * 红方/黑方用同一 intensity，靠材质 albedo 区分阵营
   */
  rim: {
    color: 0x6eb0ff,
    intensity: 0.55,
    position: new THREE.Vector3(-3, 6, -10),
  },
  hemi: {
    sky: 0x2a3040,
    ground: 0x0a0a10,
    intensity: 0.25,
  },
} as const

export function applyUnifiedLighting(scene: THREE.Scene): {
  key: THREE.DirectionalLight
  fill: THREE.DirectionalLight
  rim: THREE.DirectionalLight
} {
  scene.background = new THREE.Color(LIGHTING.background)
  scene.fog = new THREE.Fog(LIGHTING.background, LIGHTING.fogNear, LIGHTING.fogFar)

  const amb = new THREE.AmbientLight(LIGHTING.ambient.color, LIGHTING.ambient.intensity)
  scene.add(amb)

  const hemi = new THREE.HemisphereLight(
    LIGHTING.hemi.sky,
    LIGHTING.hemi.ground,
    LIGHTING.hemi.intensity,
  )
  scene.add(hemi)

  const key = new THREE.DirectionalLight(LIGHTING.key.color, LIGHTING.key.intensity)
  key.position.copy(LIGHTING.key.position)
  scene.add(key)

  const fill = new THREE.DirectionalLight(LIGHTING.fill.color, LIGHTING.fill.intensity)
  fill.position.copy(LIGHTING.fill.position)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(LIGHTING.rim.color, LIGHTING.rim.intensity)
  rim.position.copy(LIGHTING.rim.position)
  scene.add(rim)

  return { key, fill, rim }
}

/** 阵营材质基础色（非纯黑） */
export const FACTION_COLORS = {
  red: {
    body: 0x8b1a1a,
    trim: 0xd4af37,
    ring: 0xe53935,
    emissive: 0x000000,
    emissiveIntensity: 0,
  },
  black: {
    /** 玄青黑，禁止 0x000000 */
    body: 0x1a2838,
    trim: 0xb0bcc8,
    ring: 0x5a9fd4,
    emissive: 0x6eb0ff,
    emissiveIntensity: 0.06,
  },
} as const
