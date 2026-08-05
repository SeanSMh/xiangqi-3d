import { describe, expect, it } from 'vitest'
import {
  CHARACTER_SPECS,
  CHARACTER_VISUAL_MODE,
  getCharacterVisualSpec,
  getSilhouetteLayout,
  MAX_ROLE_FOOTPRINT,
  PIECE_KINDS,
  ROLE_RIM_SCALE,
  ROLE_VISUAL_MODE,
  resolveCharacterLayerVisibility,
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

describe('production v3 全彩角色卡规格', () => {
  it('完整映射红黑 14 张当前定稿，且不引用任何归档资源', () => {
    expect(CHARACTER_VISUAL_MODE).toBe('production-v3-color-card')

    for (const side of ['red', 'black'] as const) {
      expect(Object.keys(CHARACTER_SPECS[side]).sort()).toEqual(
        [...PIECE_KINDS].sort(),
      )

      for (const kind of PIECE_KINDS) {
        const spec = getCharacterVisualSpec(side, kind)
        expect(spec.side).toBe(side)
        expect(spec.kind).toBe(kind)
        expect(spec.colorAssetUrl).toBe(
          `/assets/characters/${side}_${kind}_v3.jpg`,
        )
        expect(spec.colorAssetUrl).not.toMatch(/archive|misaligned|failed/)
      }
    }
  })

  it('红黑同棋种共享 Alpha、锚点和占位，并保留剪影回退', () => {
    for (const kind of PIECE_KINDS) {
      const red = getCharacterVisualSpec('red', kind)
      const black = getCharacterVisualSpec('black', kind)
      const silhouette = SILHOUETTE_SPECS[kind]

      expect(red.colorAssetUrl).not.toBe(black.colorAssetUrl)
      expect(red.alphaAssetUrl).toBe(silhouette.assetUrl)
      expect(black.alphaAssetUrl).toBe(silhouette.assetUrl)
      expect(red.fallbackAssetUrl).toBe(silhouette.assetUrl)
      expect(black.fallbackAssetUrl).toBe(silhouette.assetUrl)
      expect(red.layout).toEqual(black.layout)
      expect(red.anchor).toEqual(black.anchor)
      expect(red.layout.visibleFootprintWidth * ROLE_RIM_SCALE).toBeLessThanOrEqual(
        red.maxFootprint,
      )
    }
  })

  it('颜色图与同源 Alpha 尺寸一致并使用恒等 UV，马保持 912×1136', () => {
    const identityUv = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }

    for (const side of ['red', 'black'] as const) {
      for (const kind of PIECE_KINDS) {
        const spec = getCharacterVisualSpec(side, kind)
        const silhouette = SILHOUETTE_SPECS[kind]
        expect([spec.imageWidth, spec.imageHeight]).toEqual([
          silhouette.imageWidth,
          silhouette.imageHeight,
        ])
        expect(spec.colorUvTransform).toEqual(identityUv)
        expect(spec.maskUvTransform).toEqual(identityUv)
        expect(spec.anchor.sourceX).toBeGreaterThan(0)
        expect(spec.anchor.sourceX).toBeLessThan(1)
        expect(spec.anchor.sourceY).toBeGreaterThan(0)
        expect(spec.anchor.sourceY).toBeLessThanOrEqual(1)
      }
    }

    expect(getCharacterVisualSpec('red', 'horse')).toMatchObject({
      imageWidth: 912,
      imageHeight: 1136,
    })
    expect(getCharacterVisualSpec('black', 'horse')).toMatchObject({
      imageWidth: 912,
      imageHeight: 1136,
    })
  })

  it('颜色与 Alpha 独立加载时始终保留可见角色层', () => {
    expect(resolveCharacterLayerVisibility('loading', 'loading')).toEqual({
      colorBody: false,
      silhouette: false,
      rim: false,
      geometricPlaceholder: true,
    })
    expect(resolveCharacterLayerVisibility('loading', 'ready')).toEqual({
      colorBody: false,
      silhouette: true,
      rim: true,
      geometricPlaceholder: false,
    })
    expect(resolveCharacterLayerVisibility('ready', 'ready')).toEqual({
      colorBody: true,
      silhouette: false,
      rim: true,
      geometricPlaceholder: false,
    })
    expect(resolveCharacterLayerVisibility('ready', 'failed')).toEqual({
      colorBody: false,
      silhouette: false,
      rim: false,
      geometricPlaceholder: true,
    })
  })
})
