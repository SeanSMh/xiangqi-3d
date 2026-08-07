import { resolveHudLayout } from '../ui/responsiveHud'

export type PresentationDeviceClass = 'desktop' | 'tablet' | 'phone'
export type PresentationLayout =
  | 'desktop-landscape'
  | 'compact-landscape'
  | 'portrait'
export type CharacterMipmapStrategy = 'trilinear' | 'linear-no-mipmaps'
export type CharacterAssetTier = 'source' | '768' | '512'
export type PresentationTextureStatus = 'loading' | 'ready' | 'failed'
export type PresentationTextureRequestMode =
  | 'initial'
  | 'background-reload'
  | 'already-active'

export interface PresentationVector3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface SafeAreaInsetsCss {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface PresentationProfile {
  readonly id: `${PresentationDeviceClass}-${PresentationLayout}`
  readonly deviceClass: PresentationDeviceClass
  readonly layout: PresentationLayout
  readonly viewport: {
    readonly width: number
    readonly height: number
    readonly aspect: number
    readonly devicePixelRatio: number
  }
  readonly camera: {
    readonly fov: number
    readonly position: PresentationVector3
    readonly target: PresentationVector3
    readonly projectionCenterOffsetCss: {
      readonly x: number
      readonly y: number
    }
    readonly billboardPitchRadians: number
    readonly billboardScale: number
    readonly fitAxis: 'fixed' | 'horizontal' | 'vertical'
  }
  readonly renderer: {
    readonly pixelRatio: number
    readonly shadows: boolean
    readonly shadowMapSize: 512 | 1024 | 2048
    readonly shadowAutoUpdate: boolean
  }
  readonly textures: {
    readonly assetTier: CharacterAssetTier
    readonly maxCharacterTextureSize: 512 | 768 | 1136
    readonly mipmaps: CharacterMipmapStrategy
  }
  readonly capturedDisplayMode: 'side-columns' | 'hud-only'
  readonly safeAreaInsetsCss: SafeAreaInsetsCss
  /**
   * 3/4 主视角的取景内缩。桌面横屏为 0——那套构图本来就是照着避开 HUD 画的，
   * 再内缩只会让棋盘无谓变小。
   */
  readonly framingInsetsCss: SafeAreaInsetsCss
  /**
   * HUD 实际占用的矩形（预留 + 设备安全区），**始终**包含 HUD 预留。
   * 备用构图（如战术俯视）不能沿用主视角的 0 内缩，否则会顶到工具栏底下。
   */
  readonly hudReservedCss: SafeAreaInsetsCss
}

export interface PresentationTextureReloadTarget<Image = unknown> {
  image: Image
  needsUpdate: boolean
  dispose(): void
}

/**
 * WebGL 纹理换档必须先释放旧 texStorage，再挂载新尺寸图片。revision 不匹配
 * 时完全不触碰目标，避免较慢的旧请求覆盖新档资源。
 */
export function commitPresentationTextureReplacement<Image>(
  target: PresentationTextureReloadTarget<Image>,
  replacementImage: Image,
  completedRevision: number,
  activeRevision: number,
  configure?: (target: PresentationTextureReloadTarget<Image>) => void,
): boolean {
  if (completedRevision !== activeRevision) return false
  target.dispose()
  target.image = replacementImage
  configure?.(target)
  target.needsUpdate = true
  return true
}

/** ready 纹理切档时继续展示旧图；已处于目标档则只取消过期请求。 */
export function resolvePresentationTextureRequestMode(
  currentStatus: PresentationTextureStatus | undefined,
  activeTier: CharacterAssetTier | undefined,
  requestedTier: CharacterAssetTier,
): PresentationTextureRequestMode {
  if (currentStatus !== 'ready') return 'initial'
  return activeTier === requestedTier
    ? 'already-active'
    : 'background-reload'
}

export function resolvePresentationTextureStatusAfterFailure(
  mode: PresentationTextureRequestMode,
): PresentationTextureStatus {
  return mode === 'initial' ? 'failed' : 'ready'
}

const DESKTOP_CAMERA_POSITION: PresentationVector3 = {
  x: 0,
  y: 11,
  z: -10,
}

const ORIGIN: PresentationVector3 = { x: 0, y: 0, z: 0 }

/**
 * 只依赖 viewport、DPR 与已解析的 CSS 安全区。避免把响应式判断散落到
 * Three 场景中，也让移动端的画质预算可在无 DOM 环境下稳定测试。
 */
export function resolvePresentationProfile(
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
  safeAreaInsetsCss: Partial<SafeAreaInsetsCss> = {},
): PresentationProfile {
  const width = sanitizeDimension(viewportWidth)
  const height = sanitizeDimension(viewportHeight)
  const dpr = sanitizeDpr(devicePixelRatio)
  const aspect = width / height
  const shortSide = Math.min(width, height)
  const longSide = Math.max(width, height)

  const deviceClass: PresentationDeviceClass =
    shortSide <= 600 && longSide <= 1000
      ? 'phone'
      : width < 1200 || height < 700
        ? 'tablet'
        : 'desktop'

  const layout: PresentationLayout =
    aspect < 0.86
      ? 'portrait'
      : deviceClass === 'desktop'
        ? 'desktop-landscape'
        : 'compact-landscape'

  const safeArea = sanitizeSafeAreaInsets(safeAreaInsetsCss)
  const hudReservedCss = resolveHudReserved(width, height, safeArea)
  const framingInsetsCss = resolveFramingInsets(
    width,
    height,
    layout,
    safeArea,
  )
  const camera = resolveCamera(
    layout,
    aspect,
    deviceClass,
    height,
    framingInsetsCss,
  )
  const renderer = resolveRenderer(deviceClass, dpr)
  const textures = resolveTextureBudget(deviceClass)

  return {
    id: `${deviceClass}-${layout}`,
    deviceClass,
    layout,
    viewport: { width, height, aspect, devicePixelRatio: dpr },
    camera,
    renderer,
    textures,
    capturedDisplayMode:
      deviceClass === 'phone' ? 'hud-only' : 'side-columns',
    safeAreaInsetsCss: safeArea,
    framingInsetsCss,
    hudReservedCss,
  }
}

function resolveHudReserved(
  viewportWidth: number,
  viewportHeight: number,
  safeAreaInsetsCss: SafeAreaInsetsCss,
): SafeAreaInsetsCss {
  const hud = resolveHudLayout(viewportWidth, viewportHeight)
  return {
    top: hud.topReservedPx + safeAreaInsetsCss.top,
    right: hud.rightReservedPx + safeAreaInsetsCss.right,
    bottom: hud.bottomReservedPx + safeAreaInsetsCss.bottom,
    left: hud.leftReservedPx + safeAreaInsetsCss.left,
  }
}

function resolveCamera(
  layout: PresentationLayout,
  aspect: number,
  deviceClass: PresentationDeviceClass,
  viewportHeight: number,
  framingInsetsCss: PresentationProfile['framingInsetsCss'],
): PresentationProfile['camera'] {
  const verticalCenterOffsetCss =
    (framingInsetsCss.top - framingInsetsCss.bottom) / 2
  const projectionCenterOffsetCss = {
    x: (framingInsetsCss.left - framingInsetsCss.right) / 2,
    // compact 横屏近乎俯视时，棋盘透视中心天然比 viewport 中心低约 4px。
    // 竖屏斜俯视构图已有充足纵向余量，不再叠加 HUD 中心偏移。
    y:
      layout === 'compact-landscape' && verticalCenterOffsetCss !== 0
        ? verticalCenterOffsetCss - 4
        : 0,
  }
  if (layout === 'desktop-landscape') {
    return {
      fov: 42,
      position: DESKTOP_CAMERA_POSITION,
      target: ORIGIN,
      projectionCenterOffsetCss,
      billboardPitchRadians: 0,
      billboardScale: 1,
      fitAxis: 'fixed',
    }
  }

  const sideRailLandscape =
    layout === 'compact-landscape' && framingInsetsCss.left >= 100
  const hudFramed = Object.values(framingInsetsCss).some((inset) => inset > 0)

  if (layout === 'compact-landscape' && !sideRailLandscape && !hudFramed) {
    return {
      fov: 46,
      position: { x: 0, y: 12, z: -11 },
      target: { x: 0, y: 0, z: 0.1 },
      projectionCenterOffsetCss,
      billboardPitchRadians: 0,
      billboardScale: 1,
      fitAxis: 'fixed',
    }
  }

  // 竖屏与手机横屏侧栏都按 HUD 安全矩形 contain 棋盘。
  const fov = 52
  // 手机由 HUD 呈现战果，不为两侧 3D 俘获陈列牺牲棋盘可点间距。
  const targetFramingWidth = sideRailLandscape
    ? 9
    : deviceClass === 'phone'
      ? 10
      : 12.6
  const halfVerticalFov = (fov * Math.PI) / 360
  const horizontalDistance =
    targetFramingWidth / (2 * Math.tan(halfVerticalFov) * aspect)
  const safeHeight = Math.max(
    1,
    viewportHeight - framingInsetsCss.top - framingInsetsCss.bottom,
  )
  const safeHeightRatio = safeHeight / viewportHeight
  const viewportWidth = viewportHeight * aspect
  const safeWidth = Math.max(
    1,
    viewportWidth - framingInsetsCss.left - framingInsetsCss.right,
  )
  const safeWidthRatio = safeWidth / viewportWidth
  const safeAspect = aspect * safeWidthRatio
  const safeHorizontalDistance =
    targetFramingWidth / (2 * Math.tan(halfVerticalFov) * safeAspect)
  const targetFramingHeight = sideRailLandscape
    ? 11.2
    : layout === 'compact-landscape'
      ? 11
      : 10
  const verticalDistance =
    targetFramingHeight /
    (2 * Math.tan(halfVerticalFov) * safeHeightRatio)
  const requiredHorizontalDistance = sideRailLandscape
    ? safeHorizontalDistance
    : horizontalDistance
  const distance = Math.max(requiredHorizontalDistance, verticalDistance)
  const fitAxis =
    verticalDistance > requiredHorizontalDistance ? 'vertical' : 'horizontal'
  const direction = sideRailLandscape
    ? { y: 24, z: -0.6 }
    : deviceClass === 'phone'
      ? { y: 24, z: -2 }
      : { y: 22, z: -15.2 }
  const directionLength = Math.hypot(direction.y, direction.z)
  const distanceScale = Math.min(
    1.65,
    Math.max(sideRailLandscape ? 0.4 : 0.66, distance / directionLength),
  )
  const horizontalCenterOffset = 0

  return {
    fov,
    position: {
      x: horizontalCenterOffset,
      y: direction.y * distanceScale,
      z: direction.z * distanceScale,
    },
    target:
      sideRailLandscape
        ? { x: horizontalCenterOffset, y: 0, z: 0 }
        : deviceClass === 'phone'
        ? fitAxis === 'vertical'
          ? { x: 0, y: 0, z: 0.02 }
          : ORIGIN
        : { x: 0, y: 0, z: 0.15 },
    projectionCenterOffsetCss,
    billboardPitchRadians: deviceClass === 'phone' ? -Math.PI / 5 : 0,
    billboardScale: sideRailLandscape ? 0.68 : 1,
    fitAxis,
  }
}

function resolveFramingInsets(
  viewportWidth: number,
  viewportHeight: number,
  layout: PresentationLayout,
  safeAreaInsetsCss: SafeAreaInsetsCss,
): PresentationProfile['framingInsetsCss'] {
  const hud = resolveHudLayout(viewportWidth, viewportHeight)
  const includeHudInsets = layout === 'portrait' || hud.mode !== 'desktop'
  return {
    top: (includeHudInsets ? hud.topReservedPx : 0) + safeAreaInsetsCss.top,
    right:
      (includeHudInsets ? hud.rightReservedPx : 0) + safeAreaInsetsCss.right,
    bottom:
      (includeHudInsets ? hud.bottomReservedPx : 0) + safeAreaInsetsCss.bottom,
    left: (includeHudInsets ? hud.leftReservedPx : 0) + safeAreaInsetsCss.left,
  }
}

function resolveRenderer(
  deviceClass: PresentationDeviceClass,
  dpr: number,
): PresentationProfile['renderer'] {
  if (deviceClass === 'desktop') {
    return {
      pixelRatio: Math.min(dpr, 2),
      shadows: true,
      shadowMapSize: 2048,
      shadowAutoUpdate: true,
    }
  }
  if (deviceClass === 'tablet') {
    return {
      pixelRatio: Math.min(dpr, 1.5),
      shadows: true,
      shadowMapSize: 1024,
      shadowAutoUpdate: true,
    }
  }
  return {
    pixelRatio: Math.min(dpr, 1.25),
    shadows: false,
    shadowMapSize: 512,
    shadowAutoUpdate: false,
  }
}

function resolveTextureBudget(
  deviceClass: PresentationDeviceClass,
): PresentationProfile['textures'] {
  if (deviceClass === 'desktop') {
    return {
      assetTier: 'source',
      maxCharacterTextureSize: 1136,
      mipmaps: 'trilinear',
    }
  }
  if (deviceClass === 'tablet') {
    return {
      assetTier: '768',
      maxCharacterTextureSize: 768,
      mipmaps: 'trilinear',
    }
  }
  return {
    assetTier: '512',
    maxCharacterTextureSize: 512,
    mipmaps: 'linear-no-mipmaps',
  }
}

/** 只为角色颜色卡和独立 Alpha 选择衍生资源，其他 UI/VFX URL 原样返回。 */
export function resolvePresentationTextureUrl(
  sourceUrl: string,
  assetTier: CharacterAssetTier,
): string {
  if (assetTier === 'source') return sourceUrl
  const relativePath = sourceUrl.match(
    /^\/assets\/(characters\/[^/]+\.jpg|silhouettes\/sil_[^/]+_alpha\.png)$/,
  )?.[1]
  return relativePath
    ? `/assets/runtime/${assetTier}/${relativePath}`
    : sourceUrl
}

function sanitizeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function sanitizeDpr(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, value) : 1
}

function sanitizeSafeAreaInsets(
  value: Partial<SafeAreaInsetsCss>,
): SafeAreaInsetsCss {
  return {
    top: sanitizeInset(value.top),
    right: sanitizeInset(value.right),
    bottom: sanitizeInset(value.bottom),
    left: sanitizeInset(value.left),
  }
}

function sanitizeInset(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0
}
