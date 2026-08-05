export type HudLayoutMode =
  | 'desktop'
  | 'portrait'
  | 'compact'
  | 'side-rail'

export interface HudLayoutProfile {
  mode: HudLayoutMode
  orientation: 'landscape' | 'portrait'
  topReservedPx: number
  bottomReservedPx: number
  leftReservedPx: number
  rightReservedPx: number
  minimumTouchTargetPx: number
}

/**
 * HUD 的响应式断点保持为纯函数，方便在没有 DOM 的环境中验证目标视口。
 * 四周预留供棋谱抽屉和后续相机适配共用，不包含设备 safe-area inset。
 */
export function resolveHudLayout(
  viewportWidth: number,
  viewportHeight: number,
): HudLayoutProfile {
  const validViewport =
    isValidViewportDimension(viewportWidth) &&
    isValidViewportDimension(viewportHeight)
  const width = normalizeViewportDimension(viewportWidth)
  const height = normalizeViewportDimension(viewportHeight)
  const orientation = height > width ? 'portrait' : 'landscape'

  if (
    validViewport &&
    width <= 900 &&
    height <= 500 &&
    orientation === 'landscape'
  ) {
    return {
      mode: 'side-rail',
      orientation,
      topReservedPx: 8,
      bottomReservedPx: 8,
      leftReservedPx: 184,
      rightReservedPx: 124,
      minimumTouchTargetPx: 44,
    }
  }

  if (width <= 600) {
    return {
      mode: 'compact',
      orientation,
      topReservedPx: 150,
      bottomReservedPx: 142,
      leftReservedPx: 8,
      rightReservedPx: 8,
      minimumTouchTargetPx: 44,
    }
  }

  if (width <= 900 || orientation === 'portrait') {
    return {
      mode: 'portrait',
      orientation,
      topReservedPx: 160,
      bottomReservedPx: 92,
      leftReservedPx: 12,
      rightReservedPx: 12,
      minimumTouchTargetPx: 44,
    }
  }

  return {
    mode: 'desktop',
    orientation,
    topReservedPx: 76,
    bottomReservedPx: 76,
    leftReservedPx: 16,
    rightReservedPx: 16,
    minimumTouchTargetPx: 32,
  }
}

function normalizeViewportDimension(value: number): number {
  return isValidViewportDimension(value) ? value : 1
}

function isValidViewportDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0
}
