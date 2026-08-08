import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  ARENA_GROUND_RADIUS,
  ARENA_GROUND_Y_OFFSET,
} from './arenaEnvironment'
import { invalidateShadowAwareMaterials } from './lighting'
import {
  commitPresentationTextureReplacement,
  resolvePresentationProfile,
  resolvePresentationTextureRequestMode,
  resolvePresentationTextureStatusAfterFailure,
  resolvePresentationTextureUrl,
} from './presentationProfile'

describe('resolvePresentationProfile', () => {
  it('桌面镜头俯角留出远景，且仍是高质量预算', () => {
    const profile = resolvePresentationProfile(1280, 720, 2)

    // 钉住真正的不变量：**视锥顶端必须越过竞技场地面圆盘**，否则背景全被挡住。
    // 这条约束横跨两个文件（机位在这里、圆盘半径在 arenaEnvironment），
    // 任何一边单独改都可能悄悄把背景挡死，所以断言写在一起。
    const { position, target, fov } = profile.camera
    const pitchDeg =
      (Math.atan2(position.y - target.y, target.z - position.z) * 180) /
      Math.PI
    const topOfFrameDeg = pitchDeg - fov / 2
    // 相机沿 z 退到 -10，并不在圆盘正上方，所以挡视线的是圆盘**远边**，
    // 水平距离是 `radius - camZ` 而不是 `radius`。之前漏掉这一项，
    // 把遮挡角算大了 16°，测试因此放过了「中央仍被挡死」的构图。
    const discOcclusionDeg =
      (Math.atan2(
        position.y + ARENA_GROUND_Y_OFFSET,
        ARENA_GROUND_RADIUS - position.z,
      ) *
        180) /
      Math.PI
    // 至少留出 1/9 画面高度的远景（约 100px @720p）。
    // 这条上限受机位俯角约束：视锥顶端已在水平线下 26.7°，
    // 再多就得压低相机，而那会把格距从 33.5px 打到 19.4px。
    expect(discOcclusionDeg - topOfFrameDeg).toBeGreaterThan(fov / 9)
    // 同时必须仍是清晰可读的 3/4 俯视，不能为了背景把棋盘压平。
    expect(pitchDeg).toBeGreaterThan(40)

    expect(profile).toMatchObject({
      id: 'desktop-desktop-landscape',
      renderer: {
        pixelRatio: 2,
        shadows: true,
        shadowMapSize: 2048,
        shadowAutoUpdate: true,
      },
      textures: {
        assetTier: 'source',
        maxCharacterTextureSize: 1136,
        mipmaps: 'trilinear',
      },
      capturedDisplayMode: 'side-columns',
    })
  })

  it('为平板横屏缩小像素比、阴影图与角色纹理', () => {
    const profile = resolvePresentationProfile(1024, 768, 2.5)

    expect(profile.id).toBe('tablet-compact-landscape')
    expect(profile.camera).toMatchObject({
      fov: 46,
      position: { x: 0, y: 12, z: -11 },
    })
    expect(profile.renderer).toEqual({
      pixelRatio: 1.5,
      shadows: true,
      shadowMapSize: 1024,
      shadowAutoUpdate: true,
    })
    expect(profile.textures.maxCharacterTextureSize).toBe(768)
    expect(profile.textures.assetTier).toBe('768')
  })

  it('为手机竖屏完整取景并采用轻量渲染预算', () => {
    const profile = resolvePresentationProfile(390, 844, 3)

    expect(profile.id).toBe('phone-portrait')
    expect(profile.camera.fov).toBe(52)
    expect(profile.camera.position.y).toBeGreaterThan(20)
    expect(profile.renderer).toEqual({
      pixelRatio: 1.25,
      shadows: false,
      shadowMapSize: 512,
      shadowAutoUpdate: false,
    })
    expect(profile.textures).toEqual({
      assetTier: '512',
      maxCharacterTextureSize: 512,
      mipmaps: 'linear-no-mipmaps',
    })
    expect(profile.capturedDisplayMode).toBe('hud-only')
    expect(profile.framingInsetsCss).toEqual({
      top: 150,
      right: 8,
      bottom: 142,
      left: 8,
    })
    expect(profile.camera.billboardPitchRadians).toBeLessThan(0)
  })

  it('极窄竖屏比普通竖屏进一步拉远镜头', () => {
    const regular = resolvePresentationProfile(390, 844, 3)
    const narrow = resolvePresentationProfile(320, 900, 3)

    expect(narrow.camera.position.y).toBeGreaterThan(
      regular.camera.position.y,
    )
    expect(narrow.camera.position.z).toBeLessThan(
      regular.camera.position.z,
    )
  })

  it('360×640 按扣除 HUD 后的纵向安全高度拉远镜头', () => {
    const baseline = resolvePresentationProfile(375, 667, 3)
    const compact = resolvePresentationProfile(360, 640, 3)

    expect(baseline.camera.fitAxis).toBe('horizontal')
    expect(compact.camera.fitAxis).toBe('vertical')
    expect(compact.camera.position.y).toBeGreaterThan(
      baseline.camera.position.y,
    )
  })

  it.each([
    [844, 390],
    [667, 375],
  ] as const)('%d×%d 横屏按左右 HUD 侧栏取景', (width, height) => {
    const profile = resolvePresentationProfile(width, height, 3)

    expect(profile.id).toBe('phone-compact-landscape')
    expect(profile.framingInsetsCss).toEqual({
      top: 8,
      right: 124,
      bottom: 8,
      left: 184,
    })
    expect(profile.camera.position.x).toBe(0)
    expect(profile.camera.target.x).toBe(profile.camera.position.x)
    expect(profile.camera.projectionCenterOffsetCss).toEqual({ x: 30, y: 0 })
    expect(profile.camera.fitAxis).not.toBe('fixed')
    expect(profile.camera.billboardPitchRadians).toBeLessThan(0)
    expect(profile.camera.billboardScale).toBeLessThan(1)
  })

  it('800×600 的 HUD 上下预留参与相机取景', () => {
    const profile = resolvePresentationProfile(800, 600, 2)

    expect(profile.id).toBe('phone-compact-landscape')
    expect(profile.framingInsetsCss).toEqual({
      top: 160,
      right: 12,
      bottom: 92,
      left: 12,
    })
    expect(profile.camera.projectionCenterOffsetCss).toEqual({ x: 0, y: 30 })
    expect(profile.camera.fitAxis).not.toBe('fixed')
  })

  it('将 CSS safe-area 叠加进 HUD 棋盘安全矩形', () => {
    const profile = resolvePresentationProfile(390, 844, 3, {
      top: 47,
      right: 0,
      bottom: 34,
      left: 0,
    })

    expect(profile.safeAreaInsetsCss).toEqual({
      top: 47,
      right: 0,
      bottom: 34,
      left: 0,
    })
    expect(profile.framingInsetsCss).toEqual({
      top: 197,
      right: 8,
      bottom: 176,
      left: 8,
    })
  })

  it('修正无效 viewport 与 DPR，避免无穷宽高比', () => {
    const profile = resolvePresentationProfile(0, Number.NaN, 0, {
      top: Number.NaN,
      right: -12,
    })

    expect(profile.viewport).toEqual({
      width: 1,
      height: 1,
      aspect: 1,
      devicePixelRatio: 1,
    })
    expect(profile.renderer.pixelRatio).toBe(1)
    expect(profile.safeAreaInsetsCss).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    })
  })

  it('只映射角色颜色卡与独立 Alpha 的运行时衍生资源', () => {
    expect(
      resolvePresentationTextureUrl(
        '/assets/characters/red_horse_v3.jpg',
        '512',
      ),
    ).toBe('/assets/runtime/512/characters/red_horse_v3.jpg')
    expect(
      resolvePresentationTextureUrl(
        '/assets/silhouettes/sil_horse_alpha.png',
        '768',
      ),
    ).toBe('/assets/runtime/768/silhouettes/sil_horse_alpha.png')
    expect(
      resolvePresentationTextureUrl('/assets/ui/ring_select_gold.png', '512'),
    ).toBe('/assets/ui/ring_select_gold.png')
    expect(
      resolvePresentationTextureUrl(
        '/assets/characters/red_horse_v3.jpg',
        'source',
      ),
    ).toBe('/assets/characters/red_horse_v3.jpg')
  })

  it('只提交当前 revision，并在换图前先释放旧 GPU storage', () => {
    const events: string[] = []
    let image = 'old'
    let needsUpdate = false
    const target = {
      get image() {
        return image
      },
      set image(value: string) {
        events.push(`image:${value}`)
        image = value
      },
      get needsUpdate() {
        return needsUpdate
      },
      set needsUpdate(value: boolean) {
        events.push(`needsUpdate:${value}`)
        needsUpdate = value
      },
      dispose() {
        events.push('dispose')
      },
    }

    expect(
      commitPresentationTextureReplacement(target, 'stale', 1, 2),
    ).toBe(false)
    expect(events).toEqual([])
    expect(image).toBe('old')

    expect(
      commitPresentationTextureReplacement(
        target,
        'current',
        2,
        2,
        () => events.push('configure'),
      ),
    ).toBe(true)
    expect(events).toEqual([
      'dispose',
      'image:current',
      'configure',
      'needsUpdate:true',
    ])
    expect(image).toBe('current')
    expect(target.needsUpdate).toBe(true)
  })

  it('阴影布尔档切换只使相关灯光材质重新编译一次', () => {
    const scene = new THREE.Scene()
    const standard = new THREE.MeshStandardMaterial()
    const basic = new THREE.MeshBasicMaterial()
    scene.add(
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), standard),
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [standard, basic]),
    )
    const standardVersion = standard.version
    const basicVersion = basic.version

    expect(invalidateShadowAwareMaterials(scene)).toBe(1)
    expect(standard.version).toBe(standardVersion + 1)
    expect(basic.version).toBe(basicVersion)
  })

  it('ready 纹理后台切档不进入 loading，已命中档位无需重复加载', () => {
    expect(
      resolvePresentationTextureRequestMode(undefined, undefined, '512'),
    ).toBe('initial')
    expect(
      resolvePresentationTextureRequestMode('failed', undefined, '512'),
    ).toBe('initial')
    expect(
      resolvePresentationTextureRequestMode('ready', 'source', '512'),
    ).toBe('background-reload')
    expect(
      resolvePresentationTextureRequestMode('ready', '512', '512'),
    ).toBe('already-active')
    expect(resolvePresentationTextureStatusAfterFailure('initial')).toBe(
      'failed',
    )
    expect(
      resolvePresentationTextureStatusAfterFailure('background-reload'),
    ).toBe('ready')
  })
})
