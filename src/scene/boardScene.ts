import * as THREE from 'three'
import type {
  AnimationEvent,
  AnimationSurface,
  PiecePose,
} from '../animation/animationDirector'
import type { BoardCoord, GameState, Move, Side } from '../types/xiangqi'
import { ArenaEnvironment } from './arenaEnvironment'
import { BOARD_H, BOARD_W, CELL, fileRankToWorld } from './boardGeometry'
import { CameraDirector } from './cameraDirector'
import { CombatEffects } from './combatEffects'
import {
  applyUnifiedLighting,
  configureKeyLightShadow,
  invalidateShadowAwareMaterials,
} from './lighting'
import { PiecePresenter } from './piecePresenter'
import {
  resolvePresentationProfile,
  type PresentationProfile,
  type SafeAreaInsetsCss,
} from './presentationProfile'
import {
  resolveEffectiveQuality,
  type EffectiveQuality,
  type QualityTier,
} from './qualityTier'
import {
  CHARACTER_VISUAL_MODE,
  PIECE_KINDS,
  getCharacterVisualSpec,
  resolveBoardViewerSide,
} from './pieceVisuals'
import { TextureLibrary } from './textureLibrary'

export {
  BOARD_H,
  BOARD_W,
  CELL,
  OCCUPANCY_DIAMETER,
  fileRankToWorld,
} from './boardGeometry'

/** 将军宣告后的强 flare 时长；随后长驻在 watch 亮度上。 */
const CHECK_FLARE_MS = 620
/** 长驻观察亮度：足够被余光注意到，又不至于盖住棋盘。 */
const CHECK_WATCH_OPACITY = 0.16

/**
 * 场景组合根。
 *
 * 它自己只负责棋盘本体、交点标记和拾取；相机、棋子、特效与纹理都下放给
 * 专门的子系统，本类的职责是把它们接在一起并对外维持 `AnimationSurface`
 * 契约——规则状态仍是唯一真相，这里永远不做任何规则判断。
 */
export class BoardScene implements AnimationSurface {
  readonly scene = new THREE.Scene()
  readonly renderer: THREE.WebGLRenderer

  private readonly cameraDirector: CameraDirector
  private readonly textures: TextureLibrary
  private readonly pieces: PiecePresenter
  private readonly effects: CombatEffects
  private readonly arenaEnvironment = new ArenaEnvironment()

  private readonly boardRoot = new THREE.Group()
  private readonly markerRoot = new THREE.Group()
  private checkMarker: THREE.Mesh<
    THREE.RingGeometry,
    THREE.MeshBasicMaterial
  > | null = null
  private boardTypography: THREE.Mesh | null = null
  private boardViewerSide: Side = 'red'
  private checkFlareStartMs = -1
  private checkSquareKey = ''

  private readonly pointer = new THREE.Vector2()
  private readonly raycaster = new THREE.Raycaster()
  private readonly boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly cameraShakeOffset = new THREE.Vector3()

  private presentationTimeMs = 0
  private presentationProfile: PresentationProfile
  private qualityTier: QualityTier = 'high'
  private effectiveQuality: EffectiveQuality | null = null
  private readonly keyLight: THREE.DirectionalLight
  private resizeObserver: ResizeObserver | null = null
  private readonly container: HTMLElement
  private componentsReady = false

  constructor(container: HTMLElement) {
    this.container = container
    const width = container.clientWidth
    const height = container.clientHeight
    this.presentationProfile = resolvePresentationProfile(
      width,
      height,
      window.devicePixelRatio,
      readSafeAreaInsetsCss(container),
    )

    this.cameraDirector = new CameraDirector(this.presentationProfile, () =>
      this.handleCameraPoseChanged(),
    )

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(this.presentationProfile.renderer.pixelRatio)
    this.renderer.setSize(width, height)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.renderer.shadowMap.enabled = this.presentationProfile.renderer.shadows
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.shadowMap.autoUpdate =
      this.presentationProfile.renderer.shadowAutoUpdate
    this.renderer.domElement.id = 'game-canvas'
    this.renderer.domElement.setAttribute(
      'aria-label',
      '中国象棋棋盘，点按走棋，拖动旋转视角',
    )
    this.renderer.domElement.style.touchAction = 'none'
    this.renderer.domElement.style.cursor = 'grab'
    container.appendChild(this.renderer.domElement)

    this.textures = new TextureLibrary(
      this.presentationProfile,
      this.renderer.capabilities.getMaxAnisotropy(),
    )
    this.pieces = new PiecePresenter(
      this.boardRoot,
      this.textures,
      this.presentationProfile,
    )
    this.effects = new CombatEffects(this.textures, this.cameraDirector.camera)

    this.keyLight = applyUnifiedLighting(this.scene).key
    this.applyQuality()
    this.scene.add(this.arenaEnvironment.root)
    this.buildBoard()
    this.scene.add(this.boardRoot)
    this.boardRoot.add(this.markerRoot)
    this.boardRoot.add(this.effects.root)
    this.boardRoot.add(this.pieces.auraRoot)
    this.componentsReady = true

    const refit = () =>
      this.resize(container.clientWidth, container.clientHeight)
    window.addEventListener('resize', refit)
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(refit)
      this.resizeObserver.observe(container)
    }
  }

  get camera(): THREE.PerspectiveCamera {
    return this.cameraDirector.camera
  }

  /** 容器、全屏状态或 DPR 改变后统一重算相机与渲染预算。 */
  resize(
    width: number,
    height: number,
    devicePixelRatio = window.devicePixelRatio,
    safeAreaInsetsCss = readSafeAreaInsetsCss(this.container),
  ): void {
    const previous = this.presentationProfile
    const profile = resolvePresentationProfile(
      width,
      height,
      devicePixelRatio,
      safeAreaInsetsCss,
    )
    const sizeChanged =
      profile.viewport.width !== previous.viewport.width ||
      profile.viewport.height !== previous.viewport.height
    const dprChanged =
      profile.viewport.devicePixelRatio !== previous.viewport.devicePixelRatio
    const framingChanged = !equalInsets(
      profile.framingInsetsCss,
      previous.framingInsetsCss,
    )
    if (!sizeChanged && !dprChanged && !framingChanged) return

    this.presentationProfile = profile

    if (sizeChanged || framingChanged) {
      this.cameraDirector.setProfile(profile)
    }
    if (sizeChanged) {
      this.renderer.setSize(profile.viewport.width, profile.viewport.height)
    }
    if (profile.renderer.shadowAutoUpdate !== previous.renderer.shadowAutoUpdate) {
      this.renderer.shadowMap.autoUpdate = profile.renderer.shadowAutoUpdate
    }
    // DPR、阴影开关与阴影贴图尺寸统一走 applyQuality，避免 profile 与画质档
    // 两条路径各写一半、互相覆盖。
    this.applyQuality()

    this.pieces.setProfile(profile)
    this.textures.setProfile(profile)
  }

  setPresentationTime(timeMs: number): void {
    this.presentationTimeMs = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0
    this.arenaEnvironment.update(this.presentationTimeMs)
    // 一次性特效（落步扬尘）与角色辉光/光点也走模拟时钟，回放与手动时钟才能复现。
    this.effects.update(this.presentationTimeMs)
    this.pieces.update(this.presentationTimeMs)
  }

  /** 由统一 pointer 手势驱动，仅环绕 Y 轴，不改变 profile 的俯角与投影。 */
  rotateViewByCssDelta(deltaXCss: number): boolean {
    return this.cameraDirector.rotateByCssDelta(deltaXCss)
  }

  setViewDragging(dragging: boolean): void {
    this.cameraDirector.setDragging(dragging)
    this.renderer.domElement.style.cursor = dragging ? 'grabbing' : 'grab'
  }

  // ------------------------------------------------------ AnimationSurface

  snapTo(state: GameState): void {
    this.pieces.sync(state)
  }

  setPiecePose(pieceId: string, pose: PiecePose): boolean {
    return this.pieces.setPose(pieceId, pose)
  }

  setMoveTrail(
    from: BoardCoord,
    to: BoardCoord,
    progress: number,
    opacity: number,
    side: Side,
  ): void {
    this.effects.setMoveTrail(from, to, progress, opacity, side)
  }

  setCannonProjectile(
    pose: PiecePose,
    trailFrom: PiecePose,
    opacity: number,
  ): void {
    this.effects.setCannonProjectile(pose, trailFrom, opacity)
  }

  setCaptureImpact(
    square: BoardCoord,
    whiteProgress: number,
    orangeProgress: number,
  ): void {
    this.effects.setCaptureImpact(square, whiteProgress, orangeProgress)
  }

  setPieceDissolve(pieceId: string, progress: number): void {
    this.pieces.setDissolve(pieceId, progress)
  }

  setPieceAttackPose(pieceId: string, active: boolean): void {
    this.pieces.setAttackPose(pieceId, active)
  }

  setWindupTell(
    square: BoardCoord,
    progress: number,
    strength: number,
    side: Side,
  ): void {
    this.effects.setWindupTell(square, progress, strength, side)
  }

  setClaimPulse(square: BoardCoord, progress: number, strength: number): void {
    this.effects.setClaimPulse(square, progress, strength)
  }

  /**
   * 切换运行时画质档。与设备 profile 逐项取较严者后一次性下发；
   * 只在真正变化时重建阴影贴图，避免抖动时反复付出重建代价。
   */
  setQualityTier(tier: QualityTier): void {
    if (tier === this.qualityTier) return
    this.qualityTier = tier
    this.applyQuality()
  }

  getQualityTier(): QualityTier {
    return this.qualityTier
  }

  private applyQuality(): void {
    const previous = this.effectiveQuality
    const quality = resolveEffectiveQuality(
      this.presentationProfile,
      this.qualityTier,
    )
    this.effectiveQuality = quality
    if (quality.pixelRatio !== previous?.pixelRatio) {
      this.renderer.setPixelRatio(quality.pixelRatio)
    }
    if (quality.shadows !== previous?.shadows) {
      this.renderer.shadowMap.enabled = quality.shadows
      invalidateShadowAwareMaterials(this.scene)
    }
    if (quality.shadowMapSize !== previous?.shadowMapSize) {
      configureKeyLightShadow(this.keyLight, quality.shadowMapSize)
    }
    if (
      quality.shadows &&
      (quality.shadows !== previous?.shadows ||
        quality.shadowMapSize !== previous?.shadowMapSize)
    ) {
      this.renderer.shadowMap.needsUpdate = true
    }
    this.effects.setQualityBudget(quality)
    this.pieces.setQualityBudget(quality)
  }

  /** 战术俯视：离散备用构图 + 隐藏立绘，两者必须同时切换。 */
  setTacticalView(active: boolean): void {
    this.cameraDirector.setTacticalView(active)
    this.pieces.setFlatMode(active)
  }

  isTacticalView(): boolean {
    return this.cameraDirector.isTacticalView()
  }

  setCombatFocus(
    square: BoardCoord | null,
    amount: number,
    strength: number,
  ): void {
    if (!square) {
      this.cameraDirector.setCombatFocus(null, 0)
      return
    }
    this.cameraDirector.setCombatFocus(
      fileRankToWorld(square.file, square.rank),
      amount * strength,
    )
  }

  onAnimationEvent(event: AnimationEvent): void {
    this.effects.onEvent(event)
  }

  clearTransientEffects(): void {
    this.effects.clear()
    // 消散与剧情镜头都是持久状态，取消路径必须一并复位，
    // 否则演出中途悔棋会留下半透明棋子或偏移的镜头。
    this.pieces.clearDissolve()
    this.pieces.clearAttackPoses()
    this.cameraDirector.clearCinematic()
  }

  // --------------------------------------------------------------- 交互

  /** 将浏览器坐标投射为棋盘交点。 */
  pickSquare(clientX: number, clientY: number): BoardCoord | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null

    // 规则拾取只使用无剧情推进、无震屏的轨道相机。
    const camera = this.cameraDirector.composeForPicking()

    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, camera)
    const hit = new THREE.Vector3()
    const hitsPlane = this.raycaster.ray.intersectPlane(this.boardPlane, hit)
    const planeDistance = hitsPlane
      ? this.raycaster.ray.origin.distanceTo(hit)
      : Number.POSITIVE_INFINITY

    // 立绘有一格多高，会盖住身后的交点。命中棋子碰撞体且比地面更近时，
    // 说明用户瞄的是这枚棋子而不是它背后的空点。
    const pieceHit = this.pieces.raycastColliders(this.raycaster)
    if (pieceHit && pieceHit.distance < planeDistance) return pieceHit.square

    if (!hitsPlane) return null
    const file = Math.round(hit.x / CELL + 4)
    const rank = Math.round(hit.z / CELL + 4.5)
    if (file < 0 || file > 8 || rank < 0 || rank > 9) return null
    return { file, rank }
  }

  /** 交点在屏幕上的 CSS 坐标，供自动化验收精确点击。 */
  projectSquare(file: number, rank: number): { x: number; y: number } {
    const world = fileRankToWorld(file, rank)
    return this.cameraDirector.projectBoardPoint(world.x, world.z)
  }

  setInteractionState(
    state: GameState,
    selectedId: string | null,
    legalMoves: readonly Move[],
  ): void {
    this.clearMarkers()
    this.pieces.resetScales()

    if (selectedId) {
      const selected = state.pieces.find((piece) => piece.id === selectedId)
      if (selected && !selected.captured) {
        this.addMarker(selected.file, selected.rank, 'select')
        this.pieces.emphasize(selected.id, 1.08)
      }
    }

    for (const move of legalMoves) {
      this.addMarker(
        move.to.file,
        move.to.rank,
        move.capturedId ? 'capture' : 'legal',
      )
    }
    this.setCheckState(state)
  }

  // --------------------------------------------------------------- 渲染

  render(): void {
    this.updateAmbientMotion()
    // 广告牌与资源可见性都基于轨道层：剧情推进不得改变角色朝向。
    this.cameraDirector.composeForPicking()
    this.syncViewerFacing()
    this.pieces.orientBillboards(this.cameraDirector.getRestPosition())
    this.pieces.syncAssetVisibility()

    this.effects.getCameraShake(this.cameraShakeOffset)
    this.cameraDirector.composeForRender(this.cameraShakeOffset)
    this.renderer.render(this.scene, this.cameraDirector.camera)
    // 渲染后立刻回到轨道层，震屏与剧情偏移不进入任何持久状态。
    this.cameraDirector.composeForPicking()
  }

  getPresentationSnapshot(state: GameState) {
    const boardProjection = this.cameraDirector.measureBoardProjection()
    const colorAssets = (['red', 'black'] as const).flatMap((side) =>
      PIECE_KINDS.map((kind) => getCharacterVisualSpec(side, kind).colorAssetUrl),
    )
    const maskAssets = PIECE_KINDS.map(
      (kind) => getCharacterVisualSpec('red', kind).alphaAssetUrl,
    )
    const presentationAssets = [...new Set([...colorAssets, ...maskAssets])]

    return {
      renderer: CHARACTER_VISUAL_MODE,
      assetRevision: 'locked-v3',
      billboard: 'cylindrical-y-with-faction-facing',
      sharedShapeAcrossFactions: false,
      factionSpecificArt: true,
      shadows: this.renderer.shadowMap.enabled,
      quality: this.effectiveQuality,
      presentationProfile: this.presentationProfile,
      viewport: this.presentationProfile.viewport,
      cameraProfile: this.presentationProfile.camera,
      cameraView: {
        ...this.cameraDirector.getViewSnapshot(),
        characterViewBySide: this.pieces.getViewBySide(),
        boardTypography: {
          viewerSide: this.boardViewerSide,
          rotationDegrees: this.boardViewerSide === 'red' ? 180 : 0,
        },
      },
      textureRuntime: this.textures.getRuntimeSnapshot(presentationAssets),
      projectedBoardBoundsCss: boardProjection.bounds,
      safeBoundsCss: boardProjection.safeBounds,
      projectedCellSpacingCss: boardProjection.cellSpacing,
      projectedCellSpacingByAxisCss: boardProjection.cellSpacingByAxis,
      boardFullyVisible: boardProjection.fullyVisible,
      boardClearOfHud: boardProjection.clearOfHud,
      checkPulseActive: Boolean(this.checkMarker?.visible),
      checkAlarm: {
        active: Boolean(this.checkMarker?.visible),
        stage:
          !this.checkMarker?.visible
            ? 'idle'
            : this.checkFlareEnvelope() > 0
              ? 'flare'
              : 'watch',
        flare: Math.round(this.checkFlareEnvelope() * 1000) / 1000,
        flareDurationMs: CHECK_FLARE_MS,
      },
      environment: this.arenaEnvironment.getSnapshot(),
      battleEffects: this.effects.getSnapshot(),
      ...this.pieces.getSnapshot(state),
      readyAssets: this.textures.countByStatus(colorAssets, 'ready'),
      expectedAssets: colorAssets.length,
      readyMasks: this.textures.countByStatus(maskAssets, 'ready'),
      expectedMasks: maskAssets.length,
      loadingAssets: this.textures.filterByStatus(colorAssets, 'loading'),
      failedAssets: this.textures.filterByStatus(colorAssets, 'failed'),
      loadingMasks: this.textures.filterByStatus(maskAssets, 'loading'),
      failedMasks: this.textures.filterByStatus(maskAssets, 'failed'),
    }
  }

  // --------------------------------------------------------------- 内部

  private handleCameraPoseChanged(): void {
    if (!this.componentsReady) return
    const fogRange = this.cameraDirector.getFogRange()
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = fogRange.near
      this.scene.fog.far = fogRange.far
    }
    this.syncViewerFacing()
  }

  /** 棋盘文字与角色正背面共用同一份滞回，避免侧视时两者步调不一致。 */
  private syncViewerFacing(): void {
    const bearing = this.cameraDirector.getBearing()
    this.pieces.syncFacing(bearing)
    this.boardViewerSide = resolveBoardViewerSide(bearing, this.boardViewerSide)
    if (this.boardTypography) {
      this.boardTypography.rotation.z =
        this.boardViewerSide === 'red' ? Math.PI : 0
    }
  }

  private updateAmbientMotion(): void {
    const wave = (Math.sin(this.presentationTimeMs * 0.007) + 1) / 2
    for (const marker of this.markerRoot.children) {
      const kind = marker.userData.markerKind as string | undefined
      if (kind === 'select') {
        marker.scale.setScalar(0.98 + wave * 0.08)
      } else if (kind === 'capture') {
        marker.scale.setScalar(1 + wave * 0.05)
      }
    }
    if (this.checkMarker?.visible) {
      const flare = this.checkFlareEnvelope()
      const eased = flare * flare
      this.checkMarker.scale.setScalar(1 + wave * 0.09 + eased * 0.62)
      this.checkMarker.material.opacity = Math.min(
        1,
        CHECK_WATCH_OPACITY + wave * 0.14 + eased * 0.78,
      )
    }
  }

  private addMarker(
    file: number,
    rank: number,
    kind: 'select' | 'legal' | 'capture',
  ): void {
    const url = {
      select: '/assets/ui/ring_select_gold.png',
      legal: '/assets/ui/ring_legal_white.png',
      capture: '/assets/ui/ring_capture_red.png',
    }[kind]
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 0.92),
      new THREE.MeshBasicMaterial({
        map: this.textures.get(url),
        transparent: true,
        opacity: kind === 'legal' ? 0.78 : 0.96,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    marker.name = `${kind}-marker-${file}-${rank}`
    marker.userData.markerKind = kind
    marker.rotation.x = -Math.PI / 2
    const position = fileRankToWorld(file, rank)
    marker.position.set(position.x, 0.035, position.z)
    marker.renderOrder = 2
    this.markerRoot.add(marker)
  }

  private clearMarkers(): void {
    for (const child of this.markerRoot.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material]
        for (const material of materials) material.dispose()
      }
    }
    this.markerRoot.clear()
  }

  private setCheckState(state: GameState): void {
    if (!state.inCheck || state.status !== 'playing') {
      if (this.checkMarker) this.checkMarker.visible = false
      this.checkFlareStartMs = -1
      this.checkSquareKey = ''
      return
    }
    const king = state.pieces.find(
      (piece) =>
        !piece.captured &&
        piece.side === state.sideToMove &&
        piece.kind === 'king',
    )
    if (!king) return
    if (!this.checkMarker) {
      this.checkMarker = new THREE.Mesh(
        new THREE.RingGeometry(0.43, 0.52, 48),
        new THREE.MeshBasicMaterial({
          color: 0xff3b30,
          transparent: true,
          opacity: 0.58,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
      )
      this.checkMarker.name = 'king-in-check-pulse'
      this.checkMarker.rotation.x = -Math.PI / 2
      this.checkMarker.renderOrder = 3
      this.boardRoot.add(this.checkMarker)
    }
    const position = fileRankToWorld(king.file, king.rank)
    this.checkMarker.position.set(position.x, 0.052, position.z)
    this.checkMarker.visible = true

    // 将军拆成两段：宣告瞬间来一次强 flare，随后退到低亮 watch 长驻。
    // 长期高亮会盖住棋盘，也让「刚被将」和「一直被将」读起来一样。
    const squareKey = `${state.sideToMove}:${king.file},${king.rank}`
    if (squareKey !== this.checkSquareKey) {
      this.checkSquareKey = squareKey
      this.checkFlareStartMs = this.presentationTimeMs
    }
  }

  /** 0–1 的 flare 包络；模拟时钟驱动，因此悔棋与回放完全可复现。 */
  private checkFlareEnvelope(): number {
    if (this.checkFlareStartMs < 0) return 0
    const elapsed = this.presentationTimeMs - this.checkFlareStartMs
    if (elapsed < 0 || elapsed >= CHECK_FLARE_MS) return 0
    return 1 - elapsed / CHECK_FLARE_MS
  }

  private buildBoard(): void {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W + 1.35, 0.3, BOARD_H + 1.35),
      new THREE.MeshStandardMaterial({
        color: 0x151620,
        metalness: 0.64,
        roughness: 0.42,
      }),
    )
    base.name = 'board-metal-plinth'
    base.position.y = -0.22
    base.castShadow = true
    base.receiveShadow = true
    this.boardRoot.add(base)

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W + 0.72, 0.16, BOARD_H + 0.72),
      new THREE.MeshStandardMaterial({
        color: 0x35323a,
        metalness: 0.12,
        roughness: 0.9,
      }),
    )
    slab.name = 'board-stone-slab'
    slab.position.y = -0.06
    slab.castShadow = true
    slab.receiveShadow = true
    this.boardRoot.add(slab)

    const playingSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W + 0.12, BOARD_H + 0.12),
      new THREE.MeshStandardMaterial({
        color: 0x2b2b34,
        metalness: 0.08,
        roughness: 0.96,
      }),
    )
    playingSurface.name = 'board-playing-surface'
    playingSurface.rotation.x = -Math.PI / 2
    playingSurface.position.y = 0.022
    playingSurface.receiveShadow = true
    this.boardRoot.add(playingSurface)

    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0xa98334,
      emissive: 0x1f1606,
      emissiveIntensity: 0.08,
      metalness: 0.58,
      roughness: 0.4,
    })
    const horizontalTrimGeometry = new THREE.BoxGeometry(BOARD_W + 0.86, 0.07, 0.09)
    const verticalTrimGeometry = new THREE.BoxGeometry(0.09, 0.07, BOARD_H + 0.86)
    for (const z of [-BOARD_H / 2 - 0.37, BOARD_H / 2 + 0.37]) {
      const trim = new THREE.Mesh(horizontalTrimGeometry, trimMaterial)
      trim.position.set(0, 0.035, z)
      trim.castShadow = true
      this.boardRoot.add(trim)
    }
    for (const x of [-BOARD_W / 2 - 0.37, BOARD_W / 2 + 0.37]) {
      const trim = new THREE.Mesh(verticalTrimGeometry, trimMaterial)
      trim.position.set(x, 0.035, 0)
      trim.castShadow = true
      this.boardRoot.add(trim)
    }

    const lineMat = new THREE.LineBasicMaterial({ color: 0xc9a227 })
    const points: THREE.Vector3[] = []

    // 边线贯穿全盘；内部竖线在楚河汉界处断开。
    for (let file = 0; file <= 8; file += 1) {
      const x = (file - 4) * CELL
      if (file === 0 || file === 8) {
        addLine(points, x, -BOARD_H / 2, x, BOARD_H / 2)
      } else {
        addLine(points, x, -BOARD_H / 2, x, -CELL / 2)
        addLine(points, x, CELL / 2, x, BOARD_H / 2)
      }
    }
    for (let rank = 0; rank <= 9; rank += 1) {
      const z = (rank - 4.5) * CELL
      addLine(points, -BOARD_W / 2, z, BOARD_W / 2, z)
    }

    // 红黑九宫斜线。
    addBoardLine(points, 3, 0, 5, 2)
    addBoardLine(points, 5, 0, 3, 2)
    addBoardLine(points, 3, 7, 5, 9)
    addBoardLine(points, 5, 7, 3, 9)

    this.boardRoot.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(points),
        lineMat,
      ),
    )

    const river = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W - 0.05, CELL * 0.82),
      new THREE.MeshStandardMaterial({
        color: 0x142337,
        transparent: true,
        opacity: 0.82,
        metalness: 0.2,
        roughness: 0.8,
      }),
    )
    river.rotation.x = -Math.PI / 2
    river.position.set(0, 0.028, 0)
    this.boardRoot.add(river)

    const typography = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W + 1.05, BOARD_H + 1.05),
      new THREE.MeshBasicMaterial({
        map: createBoardTypographyTexture(),
        transparent: true,
        opacity: 0.86,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    typography.name = 'board-typography'
    typography.rotation.x = -Math.PI / 2
    typography.rotation.z = Math.PI
    typography.position.y = 0.041
    typography.renderOrder = 1
    this.boardTypography = typography
    this.boardRoot.add(typography)
  }
}

function addLine(
  points: THREE.Vector3[],
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): void {
  points.push(new THREE.Vector3(x1, 0.03, z1), new THREE.Vector3(x2, 0.03, z2))
}

function addBoardLine(
  points: THREE.Vector3[],
  file1: number,
  rank1: number,
  file2: number,
  rank2: number,
): void {
  const from = fileRankToWorld(file1, rank1)
  const to = fileRankToWorld(file2, rank2)
  addLine(points, from.x, from.z, to.x, to.z)
}

function createBoardTypographyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1152
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('无法创建棋盘文字纹理')
  }

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = 'rgba(222, 186, 83, 0.92)'
  context.shadowColor = 'rgba(255, 209, 92, 0.25)'
  context.shadowBlur = 8
  context.font = '700 48px "Songti SC", "STSong", "Noto Serif CJK SC", serif'
  context.fillText('楚  河', canvas.width * 0.31, canvas.height * 0.5)
  context.fillText('汉  界', canvas.width * 0.69, canvas.height * 0.5)

  context.shadowBlur = 4
  context.fillStyle = 'rgba(221, 193, 112, 0.76)'
  context.font = '600 19px ui-monospace, "SFMono-Regular", Menlo, monospace'
  const horizontalMargin = 94
  const verticalMargin = 76
  for (let file = 0; file <= 8; file += 1) {
    const x =
      horizontalMargin + (file / 8) * (canvas.width - horizontalMargin * 2)
    context.fillText(String(file + 1), x, verticalMargin * 0.48)
    context.fillText(String(9 - file), x, canvas.height - verticalMargin * 0.48)
  }

  context.fillStyle = 'rgba(155, 188, 222, 0.55)'
  context.font = '500 14px ui-monospace, "SFMono-Regular", Menlo, monospace'
  for (let rank = 0; rank <= 9; rank += 1) {
    const y =
      verticalMargin + (rank / 9) * (canvas.height - verticalMargin * 2)
    const label = String(10 - rank)
    context.fillText(label, horizontalMargin * 0.38, y)
    context.fillText(label, canvas.width - horizontalMargin * 0.38, y)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.name = 'board-typography-v1'
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function readSafeAreaInsetsCss(container: HTMLElement): SafeAreaInsetsCss {
  const style = window.getComputedStyle(container)
  return {
    top: readCssPixelValue(style, '--xq-safe-top'),
    right: readCssPixelValue(style, '--xq-safe-right'),
    bottom: readCssPixelValue(style, '--xq-safe-bottom'),
    left: readCssPixelValue(style, '--xq-safe-left'),
  }
}

function readCssPixelValue(
  style: CSSStyleDeclaration,
  property: string,
): number {
  const value = Number.parseFloat(style.getPropertyValue(property))
  return Number.isFinite(value) && value > 0 ? value : 0
}

function equalInsets(
  left: SafeAreaInsetsCss,
  right: SafeAreaInsetsCss,
): boolean {
  return (
    left.top === right.top &&
    left.right === right.right &&
    left.bottom === right.bottom &&
    left.left === right.left
  )
}
