import * as THREE from 'three'
import {
  commitPresentationTextureReplacement,
  resolvePresentationTextureRequestMode,
  resolvePresentationTextureStatusAfterFailure,
  resolvePresentationTextureUrl,
  type CharacterAssetTier,
  type PresentationProfile,
  type PresentationTextureStatus,
} from './presentationProfile'

export interface TextureRuntimeSnapshot {
  requestedTier: CharacterAssetTier
  activeTier: CharacterAssetTier | 'mixed' | null
  reloadingAssets: string[]
  failedReloadAssets: string[]
}

/**
 * 全场共用的纹理仓库：按源 URL 缓存稳定的 `THREE.Texture` 实例，切换画质档
 * 时只替换其底层 image，因此挂在材质上的引用永远不需要重建。
 *
 * 独立成模块是为了打破依赖环——棋子立绘、棋盘标记与 VFX 精灵都要取纹理，
 * 但它们彼此不应互相 import。
 */
export class TextureLibrary {
  private readonly loader = new THREE.TextureLoader()
  private readonly cache = new Map<string, THREE.Texture>()
  private readonly loadRevision = new Map<string, number>()
  private readonly status = new Map<string, PresentationTextureStatus>()
  private readonly activeTier = new Map<string, CharacterAssetTier>()
  private readonly reloading = new Set<string>()
  private readonly failedReloads = new Set<string>()
  private profile: PresentationProfile
  private maxAnisotropy: number

  constructor(profile: PresentationProfile, maxAnisotropy: number) {
    this.profile = profile
    this.maxAnisotropy = Math.max(1, maxAnisotropy)
  }

  get(url: string): THREE.Texture {
    const cached = this.cache.get(url)
    if (cached) return cached
    const texture = new THREE.Texture()
    texture.colorSpace = url.includes('/silhouettes/')
      ? THREE.NoColorSpace
      : THREE.SRGBColorSpace
    texture.anisotropy = Math.min(8, this.maxAnisotropy)
    this.cache.set(url, texture)
    this.request(url, texture)
    return texture
  }

  getStatus(url: string): PresentationTextureStatus | undefined {
    return this.status.get(url)
  }

  /** 画质档变化后重新拉取所有有衍生档的资源；无衍生档的 URL 原样保留。 */
  setProfile(profile: PresentationProfile): void {
    const tierChanged =
      profile.textures.assetTier !== this.profile.textures.assetTier
    this.profile = profile
    if (!tierChanged) return
    for (const [sourceUrl, texture] of this.cache) {
      if (!hasDerivedTier(sourceUrl)) continue
      this.request(sourceUrl, texture)
    }
  }

  getRuntimeSnapshot(assets: readonly string[]): TextureRuntimeSnapshot {
    const tiers = new Set(
      assets
        .map((url) => this.activeTier.get(url))
        .filter((tier): tier is CharacterAssetTier => Boolean(tier)),
    )
    return {
      requestedTier: this.profile.textures.assetTier,
      activeTier:
        tiers.size === 0 ? null : tiers.size === 1 ? [...tiers][0]! : 'mixed',
      reloadingAssets: assets.filter((url) => this.reloading.has(url)),
      failedReloadAssets: assets.filter((url) => this.failedReloads.has(url)),
    }
  }

  countByStatus(
    assets: readonly string[],
    status: PresentationTextureStatus,
  ): number {
    return assets.filter((url) => this.status.get(url) === status).length
  }

  filterByStatus(
    assets: readonly string[],
    status: PresentationTextureStatus,
  ): string[] {
    return assets.filter((url) => this.status.get(url) === status)
  }

  dispose(): void {
    for (const texture of this.cache.values()) texture.dispose()
    this.cache.clear()
    this.loadRevision.clear()
    this.status.clear()
    this.activeTier.clear()
    this.reloading.clear()
    this.failedReloads.clear()
  }

  private request(sourceUrl: string, target: THREE.Texture): void {
    const revision = (this.loadRevision.get(sourceUrl) ?? 0) + 1
    this.loadRevision.set(sourceUrl, revision)
    const requestedTier = this.profile.textures.assetTier
    const mode = resolvePresentationTextureRequestMode(
      this.status.get(sourceUrl),
      this.activeTier.get(sourceUrl),
      requestedTier,
    )
    this.failedReloads.delete(sourceUrl)
    if (mode === 'already-active') {
      this.reloading.delete(sourceUrl)
      return
    }
    if (mode === 'background-reload') {
      this.reloading.add(sourceUrl)
    } else {
      this.status.set(sourceUrl, 'loading')
    }
    const resolvedUrl = resolvePresentationTextureUrl(sourceUrl, requestedTier)
    this.loader.load(
      resolvedUrl,
      (replacement) => {
        const committed = commitPresentationTextureReplacement(
          target,
          replacement.image,
          revision,
          this.loadRevision.get(sourceUrl) ?? 0,
          () => this.configure(target, sourceUrl),
        )
        replacement.dispose()
        if (!committed) return
        if (hasDerivedTier(sourceUrl)) {
          this.activeTier.set(sourceUrl, requestedTier)
        }
        this.reloading.delete(sourceUrl)
        this.failedReloads.delete(sourceUrl)
        this.status.set(sourceUrl, 'ready')
      },
      undefined,
      (error) => {
        if (this.loadRevision.get(sourceUrl) !== revision) return
        const failureStatus = resolvePresentationTextureStatusAfterFailure(mode)
        if (failureStatus === 'ready') {
          this.reloading.delete(sourceUrl)
          this.failedReloads.add(sourceUrl)
          console.warn(
            `[xiangqi-3d] 纹理后台切档失败，继续使用旧图: ${resolvedUrl}`,
            error,
          )
          return
        }
        this.status.set(sourceUrl, failureStatus)
        console.error(`[xiangqi-3d] 纹理加载失败: ${resolvedUrl}`, error)
      },
    )
  }

  private configure(texture: THREE.Texture, sourceUrl: string): void {
    if (!hasDerivedTier(sourceUrl)) return
    const useMipmaps = this.profile.textures.mipmaps === 'trilinear'
    texture.generateMipmaps = useMipmaps
    texture.minFilter = useMipmaps
      ? THREE.LinearMipmapLinearFilter
      : THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
  }
}

/** 只有角色颜色卡与独立 Alpha 有 512/768 衍生档。 */
function hasDerivedTier(sourceUrl: string): boolean {
  return resolvePresentationTextureUrl(sourceUrl, '512') !== sourceUrl
}
