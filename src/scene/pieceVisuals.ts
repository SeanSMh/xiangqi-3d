import type { PieceKind, Side } from '../types/xiangqi'

export const ROLE_VISUAL_MODE = 'production-v3-silhouette' as const
export const CHARACTER_VISUAL_MODE = 'production-v3-color-card' as const
export const CHARACTER_BACK_VISUAL_MODE =
  'production-v3-silhouette-facing-away' as const
export const ROLE_BASE_TOP = 0.24
export const MAX_ROLE_FOOTPRINT = 0.85
export const ROLE_RIM_SCALE = 1.055
export const CHARACTER_VIEW_HYSTERESIS = 0.12

export type CharacterViewMode = 'front' | 'back'

export const PIECE_KINDS = [
  'king',
  'advisor',
  'elephant',
  'horse',
  'chariot',
  'cannon',
  'pawn',
] as const satisfies readonly PieceKind[]

export interface AlphaBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface SilhouetteSpec {
  assetUrl: string
  imageWidth: number
  imageHeight: number
  alphaBounds: AlphaBounds
  /** Alpha 轮廓的目标可见高度，单位为棋盘格距。 */
  visibleHeight: number
}

export interface SilhouetteLayout {
  planeWidth: number
  planeHeight: number
  geometryOffsetX: number
  geometryOffsetY: number
  visibleFootprintWidth: number
}

export interface UvTransform {
  readonly offsetX: number
  readonly offsetY: number
  readonly scaleX: number
  readonly scaleY: number
}

export interface CharacterAnchor {
  /** 原图左上角为原点的归一化横坐标，落在 Alpha 可见边界中心。 */
  readonly sourceX: number
  /** 原图左上角为原点的归一化纵坐标，落在 Alpha 可见边界底部。 */
  readonly sourceY: number
  /** 以脚底为局部原点时，整张卡片几何体的横向偏移。 */
  readonly planeOffsetX: number
  /** 以脚底为局部原点时，整张卡片几何体的纵向偏移。 */
  readonly planeOffsetY: number
}

/**
 * 全彩角色卡规格。JPG 负责颜色，当前同源 Alpha 负责透明轮廓；若颜色纹理
 * 加载失败，表现层应回退到 fallbackAssetUrl 的阵营色剪影。
 */
export interface CharacterVisualSpec {
  readonly side: Side
  readonly kind: PieceKind
  readonly colorAssetUrl: string
  readonly alphaAssetUrl: string
  readonly fallbackAssetUrl: string
  readonly imageWidth: number
  readonly imageHeight: number
  readonly alphaBounds: AlphaBounds
  readonly visibleHeight: number
  /** 当前 v3 颜色图与 Alpha 图共享相同像素网格，UV 均为恒等变换。 */
  readonly colorUvTransform: UvTransform
  readonly maskUvTransform: UvTransform
  readonly anchor: CharacterAnchor
  readonly layout: SilhouetteLayout
  readonly maxFootprint: number
}

export type CharacterAssetLoadStatus =
  | 'loading'
  | 'ready'
  | 'failed'
  | undefined

export interface CharacterLayerVisibility {
  colorBody: boolean
  silhouette: boolean
  rim: boolean
  geometricPlaceholder: boolean
}

/**
 * 红方向 +Z、黑方向 -Z。相机位于阵营正前方时显示全彩正面，位于背后时
 * 显示独立背面层；侧视死区沿用上次结果，避免环绕到 90° 时来回闪烁。
 */
export function resolveFactionCharacterViewMode(
  side: Side,
  cameraBearingFromBoard: { readonly x: number; readonly z: number },
  previous?: CharacterViewMode,
): CharacterViewMode {
  const length = Math.hypot(
    cameraBearingFromBoard.x,
    cameraBearingFromBoard.z,
  )
  if (!Number.isFinite(length) || length < 0.000001) {
    return previous ?? (side === 'red' ? 'back' : 'front')
  }
  const bearingZ = cameraBearingFromBoard.z / length
  const facingDot = side === 'red' ? bearingZ : -bearingZ
  if (facingDot > CHARACTER_VIEW_HYSTERESIS) return 'front'
  if (facingDot < -CHARACTER_VIEW_HYSTERESIS) return 'back'
  return previous ?? (facingDot >= 0 ? 'front' : 'back')
}

/** 棋盘文字朝向当前所在半场的观者；侧视临界区与角色翻面共用滞回。 */
export function resolveBoardViewerSide(
  cameraBearingFromBoard: { readonly x: number; readonly z: number },
  previous: Side = 'red',
): Side {
  const previousRedView: CharacterViewMode =
    previous === 'red' ? 'back' : 'front'
  return resolveFactionCharacterViewMode(
    'red',
    cameraBearingFromBoard,
    previousRedView,
  ) === 'back'
    ? 'red'
    : 'black'
}

/**
 * 两张贴图独立加载：只有颜色与 Alpha 都完成时才显示全彩；Alpha 未就绪或
 * 失败时显示不依赖纹理的几何占位，避免角色只剩底座。
 */
export function resolveCharacterLayerVisibility(
  colorStatus: CharacterAssetLoadStatus,
  maskStatus: CharacterAssetLoadStatus,
): CharacterLayerVisibility {
  const maskReady = maskStatus === 'ready'
  const colorReady = colorStatus === 'ready'
  return {
    colorBody: colorReady && maskReady,
    silhouette: maskReady && !colorReady,
    rim: maskReady,
    geometricPlaceholder: !maskReady,
  }
}

export const SILHOUETTE_SPECS: Record<PieceKind, SilhouetteSpec> = {
  king: silhouetteSpec('king', 1024, 1024, [354, 33, 753, 953], 1.28),
  advisor: silhouetteSpec(
    'advisor',
    1024,
    1024,
    [335, 55, 716, 963],
    1.12,
  ),
  elephant: silhouetteSpec(
    'elephant',
    1024,
    1024,
    [95, 121, 896, 937],
    0.82,
  ),
  horse: silhouetteSpec('horse', 912, 1136, [175, 26, 710, 1076], 1.2),
  chariot: silhouetteSpec(
    'chariot',
    1024,
    1024,
    [248, 27, 739, 971],
    1.17,
  ),
  cannon: silhouetteSpec(
    'cannon',
    1024,
    1024,
    [215, 34, 744, 984],
    1.16,
  ),
  pawn: silhouetteSpec('pawn', 1024, 1024, [132, 168, 746, 933], 0.75),
}

export const SILHOUETTE_COLORS: Record<
  Side,
  { body: number; rim: number }
> = {
  red: { body: 0x8b1a1a, rim: 0xd4af37 },
  black: { body: 0x1a2838, rim: 0x83bdf0 },
}

const IDENTITY_UV_TRANSFORM: UvTransform = {
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
}

export const CHARACTER_SPECS: Record<
  Side,
  Record<PieceKind, CharacterVisualSpec>
> = {
  red: createCharacterSideSpecs('red'),
  black: createCharacterSideSpecs('black'),
}

export function getCharacterVisualSpec(
  side: Side,
  kind: PieceKind,
): CharacterVisualSpec {
  return CHARACTER_SPECS[side][kind]
}

export function getSilhouetteLayout(kind: PieceKind): SilhouetteLayout {
  const spec = SILHOUETTE_SPECS[kind]
  const visiblePixelHeight =
    spec.alphaBounds.bottom - spec.alphaBounds.top + 1
  const visiblePixelWidth =
    spec.alphaBounds.right - spec.alphaBounds.left + 1
  const planeHeight =
    spec.visibleHeight / (visiblePixelHeight / spec.imageHeight)
  const planeWidth = planeHeight * (spec.imageWidth / spec.imageHeight)
  const bottomMargin =
    ((spec.imageHeight - 1 - spec.alphaBounds.bottom) /
      spec.imageHeight) *
    planeHeight
  const visibleCenterX =
    (spec.alphaBounds.left + spec.alphaBounds.right + 1) /
    (2 * spec.imageWidth)

  return {
    planeWidth,
    planeHeight,
    geometryOffsetX: (0.5 - visibleCenterX) * planeWidth,
    geometryOffsetY: planeHeight / 2 - bottomMargin,
    visibleFootprintWidth:
      planeWidth * (visiblePixelWidth / spec.imageWidth),
  }
}

function silhouetteSpec(
  kind: PieceKind,
  imageWidth: number,
  imageHeight: number,
  bounds: readonly [number, number, number, number],
  visibleHeight: number,
): SilhouetteSpec {
  return {
    assetUrl: `/assets/silhouettes/sil_${kind}_alpha.png`,
    imageWidth,
    imageHeight,
    alphaBounds: {
      left: bounds[0],
      top: bounds[1],
      right: bounds[2],
      bottom: bounds[3],
    },
    visibleHeight,
  }
}

function createCharacterSideSpecs(
  side: Side,
): Record<PieceKind, CharacterVisualSpec> {
  return Object.fromEntries(
    PIECE_KINDS.map((kind) => [kind, characterSpec(side, kind)]),
  ) as Record<PieceKind, CharacterVisualSpec>
}

function characterSpec(
  side: Side,
  kind: PieceKind,
): CharacterVisualSpec {
  const silhouette = SILHOUETTE_SPECS[kind]
  const layout = getSilhouetteLayout(kind)
  const visibleCenterX =
    (silhouette.alphaBounds.left + silhouette.alphaBounds.right + 1) /
    (2 * silhouette.imageWidth)
  const visibleBottomY =
    (silhouette.alphaBounds.bottom + 1) / silhouette.imageHeight

  return {
    side,
    kind,
    colorAssetUrl: `/assets/characters/${side}_${kind}_v3.jpg`,
    alphaAssetUrl: silhouette.assetUrl,
    fallbackAssetUrl: silhouette.assetUrl,
    imageWidth: silhouette.imageWidth,
    imageHeight: silhouette.imageHeight,
    alphaBounds: silhouette.alphaBounds,
    visibleHeight: silhouette.visibleHeight,
    colorUvTransform: IDENTITY_UV_TRANSFORM,
    maskUvTransform: IDENTITY_UV_TRANSFORM,
    anchor: {
      sourceX: visibleCenterX,
      sourceY: visibleBottomY,
      planeOffsetX: layout.geometryOffsetX,
      planeOffsetY: layout.geometryOffsetY,
    },
    layout,
    maxFootprint: MAX_ROLE_FOOTPRINT,
  }
}
