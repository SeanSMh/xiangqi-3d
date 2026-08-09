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

/**
 * 攻击姿态规格。
 *
 * `alphaBounds` 与 `footCenterX` 由 `scripts/derive_pose_alpha.mjs` 从姿态图
 * 实测得出（边缘屏障抠图）。这里刻意**不**用 bounds 的水平中心当锚点——
 * 车的戟、炮的炮身会把 bounds 拉偏，改用脚部条带的中心，切换姿态时才不会横跳。
 *
 * 平面尺寸沿用同棋种待机姿态：两者是同一套生成框，共用尺寸即可保证人物大小
 * 一致；攻击姿看起来矮一点，是因为下盘拉开了架势，这是对的。
 */
export interface AttackPoseSpec {
  readonly colorAssetUrl: string
  readonly alphaAssetUrl: string
  readonly imageWidth: number
  readonly imageHeight: number
  readonly alphaBounds: AlphaBounds
  /** 脚部条带的水平中心（像素），用作横向锚点。 */
  readonly footCenterX: number
}

type AttackPoseMeasurement = readonly [
  width: number,
  height: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  footCenterX: number,
]

const ATTACK_POSE_MEASUREMENTS: Record<
  Side,
  Record<PieceKind, AttackPoseMeasurement>
> = {
  red: {
    king: [1024, 1024, 258, 42, 775, 959, 534],
    advisor: [1024, 1024, 218, 64, 808, 945, 580.5],
    elephant: [1024, 1024, 74, 176, 949, 893, 575.5],
    horse: [912, 1136, 45, 39, 879, 1135, 570.5],
    chariot: [1024, 1024, 171, 143, 967, 939, 528],
    cannon: [1024, 1024, 209, 42, 1014, 980, 509.5],
    pawn: [1024, 1024, 69, 137, 854, 914, 561.5],
  },
  black: {
    king: [1024, 1024, 258, 33, 774, 959, 533.5],
    advisor: [1024, 1024, 218, 63, 807, 943, 579],
    elephant: [1024, 1024, 73, 174, 949, 893, 575.5],
    horse: [912, 1136, 44, 39, 879, 1132, 571],
    chariot: [1024, 1024, 171, 137, 975, 939, 528.5],
    cannon: [1024, 1024, 209, 43, 1014, 981, 512],
    pawn: [1024, 1024, 70, 99, 854, 914, 562],
  },
}

/** 背向攻击姿实测（scripts/attack_back_measurements.json / 离线抠图）。 */
const ATTACK_BACK_POSE_MEASUREMENTS: Record<
  Side,
  Record<PieceKind, AttackPoseMeasurement>
> = {
  red: {
    king: [1024, 1024, 267, 43, 793, 952, 513.5],
    advisor: [1024, 1024, 270, 54, 799, 941, 512.5],
    elephant: [1024, 1024, 131, 49, 943, 942, 555.5],
    horse: [912, 1136, 30, 65, 872, 1086, 457.5],
    chariot: [1024, 1024, 95, 143, 870, 934, 542],
    cannon: [1024, 1024, 48, 40, 925, 961, 558],
    pawn: [1024, 1024, 233, 120, 957, 912, 542],
  },
  black: {
    king: [1024, 1024, 268, 45, 983, 952, 515],
    advisor: [1024, 1024, 270, 55, 799, 940, 511.5],
    elephant: [1024, 1024, 130, 39, 949, 942, 547.5],
    horse: [864, 1152, 13, 65, 847, 1102, 437],
    chariot: [1024, 1024, 94, 143, 871, 934, 542],
    cannon: [1024, 1024, 47, 40, 924, 961, 558],
    pawn: [1024, 1024, 234, 120, 958, 911, 543],
  },
}

export const ATTACK_POSE_SPECS: Record<
  Side,
  Record<PieceKind, AttackPoseSpec>
> = {
  red: createAttackSideSpecs('red', 'front'),
  black: createAttackSideSpecs('black', 'front'),
}

export const ATTACK_BACK_POSE_SPECS: Record<
  Side,
  Record<PieceKind, AttackPoseSpec>
> = {
  red: createAttackSideSpecs('red', 'back'),
  black: createAttackSideSpecs('black', 'back'),
}

export function getAttackPoseSpec(
  side: Side,
  kind: PieceKind,
  view: CharacterViewMode = 'front',
): AttackPoseSpec {
  return view === 'back'
    ? ATTACK_BACK_POSE_SPECS[side][kind]
    : ATTACK_POSE_SPECS[side][kind]
}

/** 攻击姿态卡的几何：沿用待机的平面尺寸，锚点换成脚部中心。 */
/**
 * 站立态背视的蒙版测量值，格式同攻击态：
 * `[宽, 高, left, top, right, bottom, footCenterX]`。
 *
 * `footCenterX` 单独量而不是取包围盒中心，因为器械会落地：炮管与车轮都杵在
 * 地上，转到背面后换边，会把包围盒中心拽出一百多像素，而人本身没动。
 * 取最底 6% 那一带的中心才是真正的落地锚点。
 */
const BACK_IDLE_MEASUREMENTS: Record<
  Side,
  Record<PieceKind, AttackPoseMeasurement>
> = {
  red: {
    king: [1024, 1024, 253, 42, 708, 948, 520],
    advisor: [1024, 1024, 323, 64, 726, 959, 524],
    elephant: [1024, 1024, 132, 101, 953, 925, 493],
    horse: [912, 1136, 188, 47, 683, 1086, 411.5],
    chariot: [1024, 1024, 314, 45, 744, 959, 524],
    cannon: [1024, 1024, 330, 41, 853, 965, 602],
    pawn: [1024, 1024, 318, 95, 914, 909, 527.5],
  },
  black: {
    king: [1024, 1024, 273, 46, 979, 946, 511],
    advisor: [1024, 1024, 315, 64, 735, 959, 524],
    elephant: [1024, 1024, 133, 49, 944, 930, 533],
    horse: [912, 1136, 172, 43, 682, 1087, 409],
    chariot: [1024, 1024, 315, 63, 744, 959, 523.5],
    cannon: [1024, 1024, 329, 40, 853, 965, 601],
    pawn: [1024, 1024, 236, 125, 952, 907, 544.5],
  },
}

const BACK_IDLE_SPECS: Record<Side, Record<PieceKind, AttackPoseSpec>> = {
  red: buildBackIdleSpecs('red'),
  black: buildBackIdleSpecs('black'),
}

function buildBackIdleSpecs(
  side: Side,
): Record<PieceKind, AttackPoseSpec> {
  return Object.fromEntries(
    PIECE_KINDS.map((kind) => {
      const [width, height, left, top, right, bottom, footCenterX] =
        BACK_IDLE_MEASUREMENTS[side][kind]
      return [
        kind,
        {
          colorAssetUrl: `/assets/characters/${side}_${kind}_back_v3.jpg`,
          alphaAssetUrl: `/assets/silhouettes/sil_${side}_${kind}_back_alpha.png`,
          imageWidth: width,
          imageHeight: height,
          alphaBounds: { left, top, right, bottom },
          footCenterX,
        } satisfies AttackPoseSpec,
      ]
    }),
  ) as Record<PieceKind, AttackPoseSpec>
}

/** 站立态背视资源规格。形状与攻击态一致，可共用同一套布局换算。 */
export function getBackIdleSpec(
  side: Side,
  kind: PieceKind,
): AttackPoseSpec {
  return BACK_IDLE_SPECS[side][kind]
}

/** 站立态背视的平面布局，与攻击态共用换算：横向按落地中心、纵向按底边留白。 */
export function getBackIdleLayout(
  side: Side,
  kind: PieceKind,
): SilhouetteLayout {
  return layoutFromPoseSpec(getBackIdleSpec(side, kind), kind)
}

export function getAttackPoseLayout(
  side: Side,
  kind: PieceKind,
  view: CharacterViewMode = 'front',
): SilhouetteLayout {
  return layoutFromPoseSpec(getAttackPoseSpec(side, kind, view), kind)
}

/** 攻击态与站立背视共用：横向按落地中心对齐，纵向按底边留白对齐。 */
function layoutFromPoseSpec(
  spec: AttackPoseSpec,
  kind: PieceKind,
): SilhouetteLayout {
  const idle = getSilhouetteLayout(kind)
  const bottomMargin =
    ((spec.imageHeight - 1 - spec.alphaBounds.bottom) / spec.imageHeight) *
    idle.planeHeight
  const visiblePixelWidth =
    spec.alphaBounds.right - spec.alphaBounds.left + 1
  return {
    planeWidth: idle.planeWidth,
    planeHeight: idle.planeHeight,
    geometryOffsetX:
      (0.5 - spec.footCenterX / spec.imageWidth) * idle.planeWidth,
    geometryOffsetY: idle.planeHeight / 2 - bottomMargin,
    visibleFootprintWidth:
      idle.planeWidth * (visiblePixelWidth / spec.imageWidth),
  }
}

function createAttackSideSpecs(
  side: Side,
  view: CharacterViewMode,
): Record<PieceKind, AttackPoseSpec> {
  const measurements =
    view === 'back' ? ATTACK_BACK_POSE_MEASUREMENTS : ATTACK_POSE_MEASUREMENTS
  const poseSuffix = view === 'back' ? 'attack_back' : 'attack'
  return Object.fromEntries(
    PIECE_KINDS.map((kind) => {
      const [width, height, left, top, right, bottom, footCenterX] =
        measurements[side][kind]
      return [
        kind,
        {
          colorAssetUrl: `/assets/poses/${side}_${kind}_${poseSuffix}.jpg`,
          alphaAssetUrl: `/assets/poses/sil_${side}_${kind}_${poseSuffix}_alpha.png`,
          imageWidth: width,
          imageHeight: height,
          alphaBounds: { left, top, right, bottom },
          footCenterX,
        } satisfies AttackPoseSpec,
      ]
    }),
  ) as Record<PieceKind, AttackPoseSpec>
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
