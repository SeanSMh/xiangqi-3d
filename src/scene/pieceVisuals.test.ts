import { describe, expect, it } from 'vitest'
import {
  getSilhouetteLayout,
  MAX_ROLE_FOOTPRINT,
  PIECE_KINDS,
  ROLE_RIM_SCALE,
  ROLE_VISUAL_MODE,
  SILHOUETTE_COLORS,
  SILHOUETTE_SPECS,
} from './pieceVisuals'

describe('production v3 棋子剪影规格', () => {
  it('完整映射七棋种，且只引用独立的当前 Alpha 资源', () => {
    expect(ROLE_VISUAL_MODE).toBe('production-v3-silhouette')
    expect(Object.keys(SILHOUETTE_SPECS).sort()).toEqual(
      [...PIECE_KINDS].sort(),
    )

    for (const kind of PIECE_KINDS) {
      const url = SILHOUETTE_SPECS[kind].assetUrl
      expect(url).toBe(`/assets/silhouettes/sil_${kind}_alpha.png`)
      expect(url).not.toMatch(/archive|sheet|misaligned/)
    }
  })

  it('按 Alpha 边界落地，所有待机轮廓均不超过 0.85 格占位', () => {
    for (const kind of PIECE_KINDS) {
      const layout = getSilhouetteLayout(kind)
      expect(layout.visibleFootprintWidth * ROLE_RIM_SCALE).toBeLessThanOrEqual(
        MAX_ROLE_FOOTPRINT,
      )
      expect(Math.abs(layout.geometryOffsetX)).toBeLessThan(
        layout.planeWidth / 2,
      )
      expect(layout.geometryOffsetY).toBeGreaterThan(0)
    }

    expect(SILHOUETTE_SPECS.king.visibleHeight).toBeGreaterThan(
      SILHOUETTE_SPECS.pawn.visibleHeight,
    )
    expect(getSilhouetteLayout('elephant').visibleFootprintWidth).toBeGreaterThan(
      getSilhouetteLayout('advisor').visibleFootprintWidth,
    )
  })

  it('黑方使用玄青而非纯黑，红黑共用资源但使用不同轮廓色', () => {
    expect(SILHOUETTE_COLORS.black.body).not.toBe(0x000000)
    expect(SILHOUETTE_COLORS.black).not.toEqual(SILHOUETTE_COLORS.red)
  })
})
