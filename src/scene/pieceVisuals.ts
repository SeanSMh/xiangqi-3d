import type { PieceKind, Side } from '../types/xiangqi'

export const ROLE_VISUAL_MODE = 'production-v3-silhouette' as const
export const ROLE_BASE_TOP = 0.24
export const MAX_ROLE_FOOTPRINT = 0.85
export const ROLE_RIM_SCALE = 1.055

export const PIECE_KINDS = [
  'king',
  'advisor',
  'elephant',
  'horse',
  'chariot',
  'cannon',
  'pawn',
] as const satisfies readonly PieceKind[]

interface AlphaBounds {
  left: number
  top: number
  right: number
  bottom: number
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
