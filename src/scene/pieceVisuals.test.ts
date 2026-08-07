import { describe, expect, it } from 'vitest'
import {
  CHARACTER_BACK_VISUAL_MODE,
  CHARACTER_SPECS,
  CHARACTER_VIEW_HYSTERESIS,
  CHARACTER_VISUAL_MODE,
  getAttackPoseLayout,
  getAttackPoseSpec,
  getCharacterVisualSpec,
  getSilhouetteLayout,
  MAX_ROLE_FOOTPRINT,
  PIECE_KINDS,
  ROLE_RIM_SCALE,
  ROLE_VISUAL_MODE,
  resolveCharacterLayerVisibility,
  resolveBoardViewerSide,
  resolveFactionCharacterViewMode,
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

  it('按阵营世界朝向区分正背面，并在侧视死区保持稳定', () => {
    expect(CHARACTER_BACK_VISUAL_MODE).toBe(
      'production-v3-silhouette-facing-away',
    )
    const defaultBearing = { x: 0, z: -1 }
    expect(resolveFactionCharacterViewMode('red', defaultBearing)).toBe(
      'back',
    )
    expect(resolveFactionCharacterViewMode('black', defaultBearing)).toBe(
      'front',
    )

    const oppositeBearing = { x: 0, z: 1 }
    expect(resolveFactionCharacterViewMode('red', oppositeBearing)).toBe(
      'front',
    )
    expect(resolveFactionCharacterViewMode('black', oppositeBearing)).toBe(
      'back',
    )

    const sideBearing = {
      x: 1,
      z: CHARACTER_VIEW_HYSTERESIS / 2,
    }
    expect(
      resolveFactionCharacterViewMode('red', sideBearing, 'back'),
    ).toBe('back')
    expect(
      resolveFactionCharacterViewMode('red', sideBearing, 'front'),
    ).toBe('front')

    expect(resolveBoardViewerSide(defaultBearing)).toBe('red')
    expect(resolveBoardViewerSide(oppositeBearing)).toBe('black')
    expect(resolveBoardViewerSide(sideBearing, 'red')).toBe('red')
    expect(resolveBoardViewerSide(sideBearing, 'black')).toBe('black')
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

describe('背向攻击姿态规格', () => {
  it('红黑 14 种背向攻击姿 URL 与蒙版命名约定一致', () => {
    for (const side of ['red', 'black'] as const) {
      for (const kind of PIECE_KINDS) {
        const front = getAttackPoseSpec(side, kind, 'front')
        const back = getAttackPoseSpec(side, kind, 'back')
        expect(front.colorAssetUrl).toBe(
          `/assets/poses/${side}_${kind}_attack.jpg`,
        )
        expect(front.alphaAssetUrl).toBe(
          `/assets/poses/sil_${side}_${kind}_attack_alpha.png`,
        )
        expect(back.colorAssetUrl).toBe(
          `/assets/poses/${side}_${kind}_attack_back.jpg`,
        )
        expect(back.alphaAssetUrl).toBe(
          `/assets/poses/sil_${side}_${kind}_attack_back_alpha.png`,
        )
        expect(back.imageWidth).toBeGreaterThan(0)
        expect(back.imageHeight).toBeGreaterThan(0)
        expect(back.footCenterX).toBeGreaterThan(0)
        expect(back.footCenterX).toBeLessThan(back.imageWidth)
      }
    }
  })

  it('背向攻击姿沿用待机平面尺寸，脚部锚点可算', () => {
    for (const side of ['red', 'black'] as const) {
      for (const kind of PIECE_KINDS) {
        const layout = getAttackPoseLayout(side, kind, 'back')
        const idle = getSilhouetteLayout(kind)
        expect(layout.planeWidth).toBe(idle.planeWidth)
        expect(layout.planeHeight).toBe(idle.planeHeight)
        expect(layout.geometryOffsetY).toBeGreaterThan(0)
      }
    }
  })
})
