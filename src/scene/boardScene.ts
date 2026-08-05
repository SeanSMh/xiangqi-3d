import * as THREE from 'three'
import type {
  AnimationSurface,
  PiecePose,
} from '../animation/animationDirector'
import type {
  BoardCoord,
  GameState,
  Move,
  Piece,
  PieceKind,
  Side,
} from '../types/xiangqi'
import { pieceLabel } from '../engine/board'
import { ArenaEnvironment } from './arenaEnvironment'
import { BattleFeedback } from './battleFeedback'
import {
  applyUnifiedLighting,
  configureKeyLightShadow,
  FACTION_COLORS,
  invalidateShadowAwareMaterials,
} from './lighting'
import {
  commitPresentationTextureReplacement,
  resolvePresentationProfile,
  resolvePresentationTextureRequestMode,
  resolvePresentationTextureStatusAfterFailure,
  resolvePresentationTextureUrl,
  type CharacterAssetTier,
  type PresentationProfile,
  type SafeAreaInsetsCss,
  type PresentationTextureStatus,
} from './presentationProfile'
import {
  CHARACTER_VISUAL_MODE,
  getCharacterVisualSpec,
  PIECE_KINDS,
  resolveCharacterLayerVisibility,
  ROLE_BASE_TOP,
  ROLE_RIM_SCALE,
  SILHOUETTE_COLORS,
} from './pieceVisuals'

/** 格距：交点间距 */
export const CELL = 1.0
/** 棋盘：9 竖线 × 10 横线 → 宽 8 格距，高 9 格距 */
export const BOARD_W = 8 * CELL
export const BOARD_H = 9 * CELL
/** 待机占位：直径不超过 0.85 格（交点周围） */
export const OCCUPANCY_DIAMETER = 0.85 * CELL

export function fileRankToWorld(file: number, rank: number): THREE.Vector3 {
  const x = (file - 4) * CELL
  const z = (rank - 4.5) * CELL
  return new THREE.Vector3(x, 0, z)
}

export class BoardScene implements AnimationSurface {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  private pieceMeshes = new Map<string, THREE.Group>()
  private capturedDisplayMeshes = new Map<string, THREE.Group>()
  private arenaEnvironment = new ArenaEnvironment()
  private battleFeedback = new BattleFeedback()
  private boardRoot = new THREE.Group()
  private markerRoot = new THREE.Group()
  private checkMarker: THREE.Mesh<
    THREE.RingGeometry,
    THREE.MeshBasicMaterial
  > | null = null
  private textureLoader = new THREE.TextureLoader()
  private textureCache = new Map<string, THREE.Texture>()
  private textureLoadRevision = new Map<string, number>()
  private textureStatus = new Map<string, PresentationTextureStatus>()
  private textureActiveTier = new Map<string, CharacterAssetTier>()
  private reloadingTextures = new Set<string>()
  private failedTextureReloads = new Set<string>()
  private billboardWorldPosition = new THREE.Vector3()
  private pointer = new THREE.Vector2()
  private raycaster = new THREE.Raycaster()
  private boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private moveTrail: THREE.Mesh<
    THREE.CylinderGeometry,
    THREE.MeshBasicMaterial
  > | null = null
  private cannonProjectile: THREE.Group | null = null
  private cannonProjectileCore: THREE.Mesh<
    THREE.SphereGeometry,
    THREE.MeshBasicMaterial
  > | null = null
  private cannonProjectileShell: THREE.Mesh<
    THREE.SphereGeometry,
    THREE.MeshBasicMaterial
  > | null = null
  private cannonProjectileTrail: THREE.Mesh<
    THREE.CylinderGeometry,
    THREE.MeshBasicMaterial
  > | null = null
  private whiteImpact: THREE.Sprite | null = null
  private orangeImpact: THREE.Sprite | null = null
  private presentationTimeMs = 0
  private cameraRestPosition = new THREE.Vector3(0, 11, -10)
  private cameraTarget = new THREE.Vector3()
  private cameraShakeOffset = new THREE.Vector3()
  private presentationProfile: PresentationProfile
  private keyLight: THREE.DirectionalLight
  private resizeObserver: ResizeObserver | null = null
  private readonly container: HTMLElement

  constructor(container: HTMLElement) {
    this.container = container
    const w = container.clientWidth
    const h = container.clientHeight
    this.presentationProfile = resolvePresentationProfile(
      w,
      h,
      window.devicePixelRatio,
      readSafeAreaInsetsCss(container),
    )
    this.camera = new THREE.PerspectiveCamera(
      this.presentationProfile.camera.fov,
      w / h,
      0.1,
      100,
    )
    applyPresentationCameraProjection(
      this.camera,
      this.presentationProfile,
    )
    this.cameraRestPosition.copy(this.presentationProfile.camera.position)
    this.cameraTarget.copy(this.presentationProfile.camera.target)
    this.camera.position.copy(this.cameraRestPosition)
    this.camera.lookAt(this.cameraTarget)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(this.presentationProfile.renderer.pixelRatio)
    this.renderer.setSize(w, h)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.renderer.shadowMap.enabled =
      this.presentationProfile.renderer.shadows
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.shadowMap.autoUpdate =
      this.presentationProfile.renderer.shadowAutoUpdate
    this.renderer.domElement.id = 'game-canvas'
    this.renderer.domElement.setAttribute('aria-label', '中国象棋棋盘')
    this.renderer.domElement.style.touchAction = 'manipulation'
    this.renderer.domElement.style.cursor = 'pointer'
    container.appendChild(this.renderer.domElement)

    this.keyLight = applyUnifiedLighting(this.scene).key
    configureKeyLightShadow(
      this.keyLight,
      this.presentationProfile.renderer.shadowMapSize,
    )
    this.scene.add(this.arenaEnvironment.root)
    this.buildBoard()
    this.scene.add(this.boardRoot)
    this.boardRoot.add(this.markerRoot)
    this.boardRoot.add(this.battleFeedback.root)
    this.ensureImpactSprites()

    const refit = () => this.resize(container.clientWidth, container.clientHeight)
    window.addEventListener('resize', refit)
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(refit)
      this.resizeObserver.observe(container)
    }
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

    const pixelRatioChanged =
      profile.renderer.pixelRatio !== previous.renderer.pixelRatio
    const shadowsChanged =
      profile.renderer.shadows !== previous.renderer.shadows
    const shadowMapSizeChanged =
      profile.renderer.shadowMapSize !== previous.renderer.shadowMapSize
    this.presentationProfile = profile

    if (sizeChanged || framingChanged) {
      applyPresentationCameraProjection(this.camera, profile)
      this.cameraRestPosition.copy(profile.camera.position)
      this.cameraTarget.copy(profile.camera.target)
      this.camera.position.copy(this.cameraRestPosition)
      this.camera.lookAt(this.cameraTarget)
    }
    if (pixelRatioChanged) {
      this.renderer.setPixelRatio(profile.renderer.pixelRatio)
    }
    if (sizeChanged) {
      this.renderer.setSize(profile.viewport.width, profile.viewport.height)
    }
    if (shadowsChanged) {
      this.renderer.shadowMap.enabled = profile.renderer.shadows
      invalidateShadowAwareMaterials(this.scene)
    }
    if (
      profile.renderer.shadowAutoUpdate !==
      previous.renderer.shadowAutoUpdate
    ) {
      this.renderer.shadowMap.autoUpdate = profile.renderer.shadowAutoUpdate
    }
    if (shadowMapSizeChanged) {
      configureKeyLightShadow(this.keyLight, profile.renderer.shadowMapSize)
    }
    if (
      profile.renderer.shadows &&
      (shadowsChanged || shadowMapSizeChanged)
    ) {
      this.renderer.shadowMap.needsUpdate = true
    }

    if (profile.capturedDisplayMode !== previous.capturedDisplayMode) {
      const showCapturedDisplays =
        profile.capturedDisplayMode === 'side-columns'
      for (const token of this.capturedDisplayMeshes.values()) {
        token.visible = showCapturedDisplays
      }
    }
    if (profile.textures.assetTier !== previous.textures.assetTier) {
      this.reloadPresentationTextures()
    }
  }

  setPresentationTime(timeMs: number): void {
    this.presentationTimeMs = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0
    this.arenaEnvironment.update(this.presentationTimeMs)
  }

  private buildBoard() {
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
    const horizontalTrimGeometry = new THREE.BoxGeometry(
      BOARD_W + 0.86,
      0.07,
      0.09,
    )
    const verticalTrimGeometry = new THREE.BoxGeometry(
      0.09,
      0.07,
      BOARD_H + 0.86,
    )
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
    for (let f = 0; f <= 8; f++) {
      const x = (f - 4) * CELL
      if (f === 0 || f === 8) {
        addLine(points, x, -BOARD_H / 2, x, BOARD_H / 2)
      } else {
        addLine(points, x, -BOARD_H / 2, x, -CELL / 2)
        addLine(points, x, CELL / 2, x, BOARD_H / 2)
      }
    }
    for (let r = 0; r <= 9; r++) {
      const z = (r - 4.5) * CELL
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
    this.boardRoot.add(typography)
  }

  /** 根据权威局面同步棋子 mesh。 */
  syncPieces(state: GameState) {
    const alive = new Set<string>()
    for (const p of state.pieces) {
      if (p.captured) continue
      alive.add(p.id)
      let g = this.pieceMeshes.get(p.id)
      if (
        g &&
        (g.userData.pieceKind !== p.kind || g.userData.side !== p.side)
      ) {
        this.boardRoot.remove(g)
        disposeObject(g)
        this.pieceMeshes.delete(p.id)
        g = undefined
      }
      if (!g) {
        g = this.createPieceMesh(p.kind, p.side, pieceLabel(p.kind, p.side))
        g.name = `piece-${p.id}`
        g.userData.pieceId = p.id
        g.userData.pieceKind = p.kind
        g.userData.side = p.side
        this.pieceMeshes.set(p.id, g)
        this.boardRoot.add(g)
      }
      const pos = fileRankToWorld(p.file, p.rank)
      g.position.set(pos.x, 0.05, pos.z)
      g.rotation.set(0, 0, 0)
      g.scale.setScalar(1)
      g.visible = true
    }
    for (const [id, mesh] of this.pieceMeshes) {
      if (!alive.has(id)) {
        this.boardRoot.remove(mesh)
        disposeObject(mesh)
        this.pieceMeshes.delete(id)
      }
    }
    this.syncCapturedDisplay(state)
  }

  private syncCapturedDisplay(state: GameState): void {
    const captured = new Set<string>()
    const bySide: Record<Side, Piece[]> = { red: [], black: [] }
    for (const piece of state.pieces) {
      if (!piece.captured) continue
      captured.add(piece.id)
      bySide[piece.side].push(piece)
    }

    for (const side of ['red', 'black'] as const) {
      bySide[side].forEach((piece, index) => {
        let token = this.capturedDisplayMeshes.get(piece.id)
        if (!token) {
          token = this.createPieceMesh(
            piece.kind,
            piece.side,
            pieceLabel(piece.kind, piece.side),
          )
          token.name = `captured-display-${piece.id}`
          token.userData.pieceId = piece.id
          token.userData.pieceKind = piece.kind
          token.userData.side = piece.side
          token.userData.capturedDisplay = true
          this.capturedDisplayMeshes.set(piece.id, token)
          this.boardRoot.add(token)
        }
        const column = Math.floor(index / 8)
        const row = index % 8
        const direction = side === 'red' ? -1 : 1
        token.position.set(
          direction * (5.05 + column * 0.58),
          0.05,
          -3.15 + row * 0.88,
        )
        token.rotation.set(0, 0, 0)
        token.scale.setScalar(0.46)
        token.visible =
          this.presentationProfile.capturedDisplayMode === 'side-columns'
      })
    }

    for (const [id, token] of this.capturedDisplayMeshes) {
      if (captured.has(id)) continue
      this.boardRoot.remove(token)
      disposeObject(token)
      this.capturedDisplayMeshes.delete(id)
    }
  }

  snapTo(state: GameState): void {
    this.syncPieces(state)
  }

  setPiecePose(pieceId: string, pose: PiecePose): boolean {
    const mesh = this.pieceMeshes.get(pieceId)
    if (!mesh) return false
    const position = fileRankToWorld(pose.file, pose.rank)
    mesh.position.set(position.x, 0.05 + pose.lift, position.z)
    mesh.scale.setScalar(pose.scale)
    mesh.rotation.y = pose.rotationY
    return true
  }

  private createPieceMesh(
    kind: PieceKind,
    side: Side,
    label: string,
  ): THREE.Group {
    const g = new THREE.Group()
    const faction = FACTION_COLORS[side]
    const radius = (OCCUPANCY_DIAMETER / 2) * 0.9

    const contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 1.06, 28),
      new THREE.MeshBasicMaterial({
        color: 0x050509,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
    )
    contactShadow.name = 'piece-contact-shadow'
    contactShadow.rotation.x = -Math.PI / 2
    contactShadow.position.y = 0.045
    contactShadow.scale.set(1.15, 0.64, 1)
    contactShadow.renderOrder = 1
    g.add(contactShadow)

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.92, radius, 0.22, 32),
      new THREE.MeshStandardMaterial({
        color: faction.body,
        metalness: 0.48,
        roughness: 0.42,
        emissive: faction.emissive,
        emissiveIntensity: faction.emissiveIntensity,
      }),
    )
    body.name = 'piece-base-body'
    body.position.y = 0.12
    body.castShadow = true
    body.receiveShadow = true
    g.add(body)

    // 使用 production 定稿底座 PNG；红黑只换材质，不更换棋种造型。
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2.02, radius * 2.02),
      new THREE.MeshBasicMaterial({
        map: this.loadTexture(`/assets/bases/base_${side}_${label}.png`),
        transparent: true,
        alphaTest: 0.02,
        side: THREE.DoubleSide,
      }),
    )
    face.rotation.x = -Math.PI / 2
    face.position.y = 0.235
    g.add(face)

    g.add(this.createCharacterCard(kind, side))

    return g
  }

  private createCharacterCard(kind: PieceKind, side: Side): THREE.Group {
    const spec = getCharacterVisualSpec(side, kind)
    const layout = spec.layout
    const maskTexture = this.loadTexture(spec.alphaAssetUrl)
    const colorTexture = this.loadTexture(spec.colorAssetUrl)
    const card = new THREE.Group()
    card.name = 'role-billboard'
    card.position.y = ROLE_BASE_TOP
    card.userData.assetUrl = spec.colorAssetUrl
    card.userData.maskAssetUrl = spec.alphaAssetUrl
    card.userData.fallbackAssetUrl = spec.fallbackAssetUrl
    card.userData.kind = kind
    card.userData.side = side

    const rimGeometry = new THREE.PlaneGeometry(
      layout.planeWidth,
      layout.planeHeight,
    )
    rimGeometry.translate(
      layout.geometryOffsetX,
      layout.geometryOffsetY,
      0,
    )
    const rim = new THREE.Mesh(
      rimGeometry,
      createSilhouetteMaterial(
        maskTexture,
        SILHOUETTE_COLORS[side].rim,
      ),
    )
    rim.name = 'role-rim'
    rim.scale.setScalar(ROLE_RIM_SCALE)
    rim.renderOrder = 4
    rim.visible = false
    card.add(rim)

    const fallbackGeometry = new THREE.PlaneGeometry(
      layout.planeWidth,
      layout.planeHeight,
    )
    fallbackGeometry.translate(
      layout.geometryOffsetX,
      layout.geometryOffsetY,
      0,
    )
    const fallback = new THREE.Mesh(
      fallbackGeometry,
      createSilhouetteMaterial(
        maskTexture,
        SILHOUETTE_COLORS[side].body,
      ),
    )
    fallback.name = 'role-fallback'
    fallback.position.z = 0.008
    fallback.renderOrder = 5
    fallback.visible = false
    card.add(fallback)

    const geometricPlaceholder = createGeometricCharacterPlaceholder(
      side,
      spec.visibleHeight,
    )
    geometricPlaceholder.visible = true
    card.add(geometricPlaceholder)

    const colorGeometry = new THREE.PlaneGeometry(
      layout.planeWidth,
      layout.planeHeight,
    )
    colorGeometry.translate(
      layout.geometryOffsetX,
      layout.geometryOffsetY,
      0,
    )
    const colorBody = new THREE.Mesh(
      colorGeometry,
      createCharacterCardMaterial(colorTexture, maskTexture),
    )
    colorBody.name = 'role-color-body'
    colorBody.position.z = 0.012
    colorBody.renderOrder = 6
    colorBody.visible = false
    card.add(colorBody)

    return card
  }

  /** 将浏览器坐标投射为棋盘交点。 */
  pickSquare(clientX: number, clientY: number): BoardCoord | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null

    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, hit)) return null

    const file = Math.round(hit.x / CELL + 4)
    const rank = Math.round(hit.z / CELL + 4.5)
    if (file < 0 || file > 8 || rank < 0 || rank > 9) return null
    return { file, rank }
  }

  setInteractionState(
    state: GameState,
    selectedId: string | null,
    legalMoves: readonly Move[],
  ): void {
    this.clearMarkers()
    for (const mesh of this.pieceMeshes.values()) mesh.scale.setScalar(1)

    if (selectedId) {
      const selected = state.pieces.find((piece) => piece.id === selectedId)
      if (selected && !selected.captured) {
        this.addMarker(selected.file, selected.rank, 'select')
        this.pieceMeshes.get(selected.id)?.scale.setScalar(1.08)
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
        map: this.loadTexture(url),
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
  }

  private loadTexture(url: string): THREE.Texture {
    const cached = this.textureCache.get(url)
    if (cached) return cached
    const texture = new THREE.Texture()
    texture.colorSpace = url.includes('/silhouettes/')
      ? THREE.NoColorSpace
      : THREE.SRGBColorSpace
    texture.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    )
    this.textureCache.set(url, texture)
    this.requestTextureImage(url, texture)
    return texture
  }

  private reloadPresentationTextures(): void {
    for (const [sourceUrl, texture] of this.textureCache) {
      if (
        resolvePresentationTextureUrl(sourceUrl, '512') === sourceUrl
      ) {
        continue
      }
      this.requestTextureImage(sourceUrl, texture)
    }
  }

  private requestTextureImage(
    sourceUrl: string,
    target: THREE.Texture,
  ): void {
    const revision = (this.textureLoadRevision.get(sourceUrl) ?? 0) + 1
    this.textureLoadRevision.set(sourceUrl, revision)
    const requestedTier = this.presentationProfile.textures.assetTier
    const mode = resolvePresentationTextureRequestMode(
      this.textureStatus.get(sourceUrl),
      this.textureActiveTier.get(sourceUrl),
      requestedTier,
    )
    this.failedTextureReloads.delete(sourceUrl)
    if (mode === 'already-active') {
      this.reloadingTextures.delete(sourceUrl)
      return
    }
    if (mode === 'background-reload') {
      this.reloadingTextures.add(sourceUrl)
    } else {
      this.textureStatus.set(sourceUrl, 'loading')
    }
    const resolvedUrl = resolvePresentationTextureUrl(
      sourceUrl,
      requestedTier,
    )
    this.textureLoader.load(
      resolvedUrl,
      (replacement) => {
        const committed = commitPresentationTextureReplacement(
          target,
          replacement.image,
          revision,
          this.textureLoadRevision.get(sourceUrl) ?? 0,
          () => this.configurePresentationTexture(target, sourceUrl),
        )
        replacement.dispose()
        if (!committed) return
        if (resolvePresentationTextureUrl(sourceUrl, '512') !== sourceUrl) {
          this.textureActiveTier.set(sourceUrl, requestedTier)
        }
        this.reloadingTextures.delete(sourceUrl)
        this.failedTextureReloads.delete(sourceUrl)
        this.textureStatus.set(sourceUrl, 'ready')
      },
      undefined,
      (error) => {
        if (this.textureLoadRevision.get(sourceUrl) !== revision) return
        const failureStatus =
          resolvePresentationTextureStatusAfterFailure(mode)
        if (failureStatus === 'ready') {
          this.reloadingTextures.delete(sourceUrl)
          this.failedTextureReloads.add(sourceUrl)
          console.warn(
            `[xiangqi-3d] 纹理后台切档失败，继续使用旧图: ${resolvedUrl}`,
            error,
          )
          return
        }
        this.textureStatus.set(sourceUrl, failureStatus)
        console.error(
          `[xiangqi-3d] 纹理加载失败: ${resolvedUrl}`,
          error,
        )
      },
    )
  }

  private configurePresentationTexture(
    texture: THREE.Texture,
    sourceUrl: string,
  ): void {
    if (resolvePresentationTextureUrl(sourceUrl, '512') === sourceUrl) return
    const useMipmaps =
      this.presentationProfile.textures.mipmaps === 'trilinear'
    texture.generateMipmaps = useMipmaps
    texture.minFilter = useMipmaps
      ? THREE.LinearMipmapLinearFilter
      : THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
  }

  getPresentationSnapshot(state: GameState) {
    const boardProjection = this.measureBoardProjection()
    const colorAssets = (['red', 'black'] as const).flatMap((side) =>
      PIECE_KINDS.map(
        (kind) => getCharacterVisualSpec(side, kind).colorAssetUrl,
      ),
    )
    const maskAssets = PIECE_KINDS.map(
      (kind) => getCharacterVisualSpec('red', kind).alphaAssetUrl,
    )
    const presentationAssets = [...new Set([...colorAssets, ...maskAssets])]
    const activeTextureTiers = new Set(
      presentationAssets
        .map((url) => this.textureActiveTier.get(url))
        .filter((tier): tier is CharacterAssetTier => Boolean(tier)),
    )
    const renderedKinds = new Set<PieceKind>()
    let redInstances = 0
    let blackInstances = 0
    let fallbackInstances = 0
    let placeholderInstances = 0
    for (const mesh of this.pieceMeshes.values()) {
      const kind = mesh.userData.pieceKind as PieceKind | undefined
      if (kind) renderedKinds.add(kind)
      if (mesh.userData.side === 'red') redInstances += 1
      if (mesh.userData.side === 'black') blackInstances += 1
      const card = mesh.getObjectByName('role-billboard')
      if (
        card?.getObjectByName('role-fallback')?.visible ||
        card?.getObjectByName('role-geometric-placeholder')?.visible
      ) {
        fallbackInstances += 1
      }
      if (card?.getObjectByName('role-geometric-placeholder')?.visible) {
        placeholderInstances += 1
      }
    }

    return {
      renderer: CHARACTER_VISUAL_MODE,
      assetRevision: 'locked-v3',
      billboard: 'cylindrical-y',
      sharedShapeAcrossFactions: false,
      factionSpecificArt: true,
      shadows: this.renderer.shadowMap.enabled,
      presentationProfile: this.presentationProfile,
      viewport: this.presentationProfile.viewport,
      cameraProfile: this.presentationProfile.camera,
      textureRuntime: {
        requestedTier: this.presentationProfile.textures.assetTier,
        activeTier:
          activeTextureTiers.size === 0
            ? null
            : activeTextureTiers.size === 1
              ? [...activeTextureTiers][0]
              : 'mixed',
        reloadingAssets: presentationAssets.filter((url) =>
          this.reloadingTextures.has(url),
        ),
        failedReloadAssets: presentationAssets.filter((url) =>
          this.failedTextureReloads.has(url),
        ),
      },
      projectedBoardBoundsCss: boardProjection.bounds,
      safeBoundsCss: boardProjection.safeBounds,
      projectedCellSpacingCss: boardProjection.cellSpacing,
      projectedCellSpacingByAxisCss: boardProjection.cellSpacingByAxis,
      boardFullyVisible: boardProjection.fullyVisible,
      boardClearOfHud: boardProjection.clearOfHud,
      checkPulseActive: Boolean(this.checkMarker?.visible),
      environment: this.arenaEnvironment.getSnapshot(),
      battleEffects: this.battleFeedback.getSnapshot(),
      logicalAlive: state.pieces.filter((piece) => !piece.captured).length,
      renderedInstances: this.pieceMeshes.size,
      capturedDisplayInstances: this.capturedDisplayMeshes.size,
      capturedDisplayVisibleInstances: [
        ...this.capturedDisplayMeshes.values(),
      ].filter((mesh) => mesh.visible).length,
      capturedDisplayBySide: {
        red: [...this.capturedDisplayMeshes.values()].filter(
          (mesh) => mesh.userData.side === 'red',
        ).length,
        black: [...this.capturedDisplayMeshes.values()].filter(
          (mesh) => mesh.userData.side === 'black',
        ).length,
      },
      renderedBySide: { red: redInstances, black: blackInstances },
      renderedKinds: PIECE_KINDS.filter((kind) => renderedKinds.has(kind)),
      readyAssets: colorAssets.filter(
        (url) => this.textureStatus.get(url) === 'ready',
      ).length,
      expectedAssets: colorAssets.length,
      readyMasks: maskAssets.filter(
        (url) => this.textureStatus.get(url) === 'ready',
      ).length,
      expectedMasks: maskAssets.length,
      fallbackInstances,
      placeholderInstances,
      loadingAssets: colorAssets.filter(
        (url) => this.textureStatus.get(url) === 'loading',
      ),
      failedAssets: colorAssets.filter(
        (url) => this.textureStatus.get(url) === 'failed',
      ),
      loadingMasks: maskAssets.filter(
        (url) => this.textureStatus.get(url) === 'loading',
      ),
      failedMasks: maskAssets.filter(
        (url) => this.textureStatus.get(url) === 'failed',
      ),
    }
  }

  private measureBoardProjection(): {
    bounds: { left: number; right: number; top: number; bottom: number }
    safeBounds: { left: number; right: number; top: number; bottom: number }
    cellSpacing: number
    cellSpacingByAxis: { horizontal: number; vertical: number }
    fullyVisible: boolean
    clearOfHud: boolean
  } {
    const { width, height } = this.presentationProfile.viewport
    const camera = this.camera.clone()
    camera.position.copy(this.cameraRestPosition)
    camera.lookAt(this.cameraTarget)
    applyPresentationCameraProjection(camera, this.presentationProfile)
    camera.updateMatrixWorld(true)

    const project = (x: number, z: number) => {
      const point = new THREE.Vector3(x, 0.05, z).project(camera)
      return {
        x: ((point.x + 1) / 2) * width,
        y: ((1 - point.y) / 2) * height,
      }
    }
    const edgeX = BOARD_W / 2 + 0.47
    const edgeZ = BOARD_H / 2 + 0.47
    const corners = [
      project(-edgeX, -edgeZ),
      project(edgeX, -edgeZ),
      project(-edgeX, edgeZ),
      project(edgeX, edgeZ),
    ]
    const rawBounds = {
      left: Math.min(...corners.map((point) => point.x)),
      right: Math.max(...corners.map((point) => point.x)),
      top: Math.min(...corners.map((point) => point.y)),
      bottom: Math.max(...corners.map((point) => point.y)),
    }

    let horizontal = Number.POSITIVE_INFINITY
    let vertical = Number.POSITIVE_INFINITY
    for (let rank = 0; rank <= 9; rank += 1) {
      for (let file = 0; file < 8; file += 1) {
        horizontal = Math.min(
          horizontal,
          screenDistance(
            project((file - 4) * CELL, (rank - 4.5) * CELL),
            project((file + 1 - 4) * CELL, (rank - 4.5) * CELL),
          ),
        )
      }
    }
    for (let file = 0; file <= 8; file += 1) {
      for (let rank = 0; rank < 9; rank += 1) {
        vertical = Math.min(
          vertical,
          screenDistance(
            project((file - 4) * CELL, (rank - 4.5) * CELL),
            project((file - 4) * CELL, (rank + 1 - 4.5) * CELL),
          ),
        )
      }
    }

    const round = (value: number) => Math.round(value * 10) / 10
    const bounds = {
      left: round(rawBounds.left),
      right: round(rawBounds.right),
      top: round(rawBounds.top),
      bottom: round(rawBounds.bottom),
    }
    const insets = this.presentationProfile.framingInsetsCss
    const safeBounds = {
      left: insets.left,
      right: width - insets.right,
      top: insets.top,
      bottom: height - insets.bottom,
    }
    const fullyVisible =
      rawBounds.left >= 0 &&
      rawBounds.right <= width &&
      rawBounds.top >= 0 &&
      rawBounds.bottom <= height
    return {
      bounds,
      safeBounds,
      cellSpacing: round(Math.min(horizontal, vertical)),
      cellSpacingByAxis: {
        horizontal: round(horizontal),
        vertical: round(vertical),
      },
      fullyVisible,
      clearOfHud:
        rawBounds.left >= safeBounds.left &&
        rawBounds.right <= safeBounds.right &&
        rawBounds.top >= safeBounds.top &&
        rawBounds.bottom <= safeBounds.bottom,
    }
  }

  setMoveTrail(
    from: BoardCoord,
    to: BoardCoord,
    progress: number,
    opacity: number,
    side: 'red' | 'black',
  ): void {
    if (!this.moveTrail) {
      this.moveTrail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.14, 1, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: FACTION_COLORS[side].ring,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
        }),
      )
      this.moveTrail.renderOrder = 6
      this.boardRoot.add(this.moveTrail)
    }

    const clampedProgress = THREE.MathUtils.clamp(progress, 0, 1)
    const start = fileRankToWorld(from.file, from.rank)
    const destination = fileRankToWorld(to.file, to.rank)
    const end = start.clone().lerp(destination, clampedProgress)
    start.y = 0.2
    end.y = 0.2
    const direction = end.clone().sub(start)
    const length = direction.length()

    this.moveTrail.visible = opacity > 0.001 && length > 0.001
    if (!this.moveTrail.visible) return
    this.moveTrail.position.copy(start).add(end).multiplyScalar(0.5)
    this.moveTrail.scale.set(1, length, 1)
    this.moveTrail.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    )
    this.moveTrail.material.color.setHex(FACTION_COLORS[side].ring)
    this.moveTrail.material.opacity = opacity
  }

  setCannonProjectile(
    pose: PiecePose,
    trailFrom: PiecePose,
    opacity: number,
  ): void {
    const alpha = THREE.MathUtils.clamp(opacity, 0, 1)
    if (!this.cannonProjectile && alpha <= 0.001) return
    this.ensureCannonProjectile()
    if (
      !this.cannonProjectile ||
      !this.cannonProjectileCore ||
      !this.cannonProjectileShell ||
      !this.cannonProjectileTrail
    ) {
      return
    }

    const position = fileRankToWorld(pose.file, pose.rank)
    position.y = 0.12 + pose.lift
    this.cannonProjectile.position.copy(position)
    this.cannonProjectile.rotation.y = pose.rotationY
    this.cannonProjectile.scale.setScalar(pose.scale)
    this.cannonProjectile.visible = alpha > 0.001
    this.cannonProjectileCore.material.opacity = alpha
    this.cannonProjectileShell.material.opacity = alpha * 0.35

    const trailOrigin = fileRankToWorld(trailFrom.file, trailFrom.rank)
    trailOrigin.y = 0.12 + trailFrom.lift
    const direction = position.clone().sub(trailOrigin)
    const travelled = direction.length()
    this.cannonProjectileTrail.visible = alpha > 0.001 && travelled > 0.02
    if (!this.cannonProjectileTrail.visible) return

    const trailLength = Math.min(0.42, travelled)
    const unitDirection = direction.normalize()
    const tail = position.clone().addScaledVector(unitDirection, -trailLength)
    this.cannonProjectileTrail.position
      .copy(tail)
      .add(position)
      .multiplyScalar(0.5)
    this.cannonProjectileTrail.scale.set(1, trailLength, 1)
    this.cannonProjectileTrail.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      unitDirection,
    )
    this.cannonProjectileTrail.material.opacity = alpha * 0.55
  }

  setCaptureImpact(
    square: BoardCoord,
    whiteProgress: number,
    orangeProgress: number,
  ): void {
    this.ensureImpactSprites()
    const position = fileRankToWorld(square.file, square.rank)
    position.y = 0.62
    this.battleFeedback.update(position, whiteProgress, orangeProgress)

    if (this.whiteImpact) {
      this.whiteImpact.position.copy(position)
      const peak = 70 / 170
      const p = THREE.MathUtils.clamp(whiteProgress, 0, 1)
      if (p <= peak) {
        const t = p / peak
        setSpriteVisual(
          this.whiteImpact,
          p > 0,
          t,
          THREE.MathUtils.lerp(0.28, 0.9, t),
        )
      } else {
        const t = (p - peak) / (1 - peak)
        setSpriteVisual(
          this.whiteImpact,
          p < 1,
          1 - t,
          THREE.MathUtils.lerp(0.9, 1.15, t),
        )
      }
    }

    if (this.orangeImpact) {
      this.orangeImpact.position.copy(position)
      const peak = 180 / 430
      const p = THREE.MathUtils.clamp(orangeProgress, 0, 1)
      if (p <= peak) {
        const t = p / peak
        setSpriteVisual(
          this.orangeImpact,
          p > 0,
          THREE.MathUtils.lerp(0.9, 0.35, t),
          THREE.MathUtils.lerp(0.45, 1.2, t),
        )
      } else {
        const t = (p - peak) / (1 - peak)
        setSpriteVisual(
          this.orangeImpact,
          p < 1,
          0.35 * (1 - t),
          THREE.MathUtils.lerp(1.2, 1.42, t),
        )
      }
    }
  }

  clearTransientEffects(): void {
    if (this.moveTrail) this.moveTrail.visible = false
    if (this.cannonProjectile) this.cannonProjectile.visible = false
    if (this.cannonProjectileTrail) {
      this.cannonProjectileTrail.visible = false
    }
    if (this.whiteImpact) this.whiteImpact.visible = false
    if (this.orangeImpact) this.orangeImpact.visible = false
    this.battleFeedback.clear()
  }

  private ensureImpactSprites(): void {
    if (!this.whiteImpact) {
      this.whiteImpact = this.createImpactSprite(
        '/assets/vfx/vfx_blast_white_cyan_alpha.png',
      )
    }
    if (!this.orangeImpact) {
      this.orangeImpact = this.createImpactSprite(
        '/assets/vfx/vfx_blast_orange_gold_alpha.png',
      )
    }
  }

  private ensureCannonProjectile(): void {
    if (this.cannonProjectile) return

    const projectile = new THREE.Group()
    projectile.name = 'cannon-projectile'
    projectile.renderOrder = 9

    this.cannonProjectileCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xfff1c2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    projectile.add(this.cannonProjectileCore)

    this.cannonProjectileShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.105, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xff9d28,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    projectile.add(this.cannonProjectileShell)
    projectile.visible = false
    this.boardRoot.add(projectile)
    this.cannonProjectile = projectile

    this.cannonProjectileTrail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.015, 1, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      }),
    )
    this.cannonProjectileTrail.name = 'cannon-projectile-trail'
    this.cannonProjectileTrail.visible = false
    this.cannonProjectileTrail.renderOrder = 8
    this.boardRoot.add(this.cannonProjectileTrail)
  }

  private createImpactSprite(url: string): THREE.Sprite {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.loadTexture(url),
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      }),
    )
    sprite.visible = false
    sprite.renderOrder = 10
    this.boardRoot.add(sprite)
    return sprite
  }

  private orientCharacterBillboards(): void {
    const roleRoots = [
      ...this.pieceMeshes.values(),
      ...this.capturedDisplayMeshes.values(),
    ]
    for (const root of roleRoots) {
      const card = root.getObjectByName('role-billboard')
      if (!card) continue
      root.getWorldPosition(this.billboardWorldPosition)
      const worldYaw = Math.atan2(
        this.camera.position.x - this.billboardWorldPosition.x,
        this.camera.position.z - this.billboardWorldPosition.z,
      )
      card.rotation.y = worldYaw - root.rotation.y
      card.rotation.x =
        this.presentationProfile.camera.billboardPitchRadians
      card.scale.setScalar(this.presentationProfile.camera.billboardScale)
    }
  }

  private syncCharacterAssetVisibility(): void {
    const roleRoots = [
      ...this.pieceMeshes.values(),
      ...this.capturedDisplayMeshes.values(),
    ]
    for (const root of roleRoots) {
      const card = root.getObjectByName('role-billboard')
      if (!card) continue
      const colorBody = card.getObjectByName('role-color-body')
      const fallback = card.getObjectByName('role-fallback')
      const rim = card.getObjectByName('role-rim')
      const placeholder = card.getObjectByName('role-geometric-placeholder')
      const assetUrl = card.userData.assetUrl as string | undefined
      const maskAssetUrl = card.userData.maskAssetUrl as string | undefined
      const visibility = resolveCharacterLayerVisibility(
        assetUrl ? this.textureStatus.get(assetUrl) : undefined,
        maskAssetUrl ? this.textureStatus.get(maskAssetUrl) : undefined,
      )
      if (colorBody) colorBody.visible = visibility.colorBody
      if (fallback) fallback.visible = visibility.silhouette
      if (rim) rim.visible = visibility.rim
      if (placeholder) placeholder.visible = visibility.geometricPlaceholder
      card.userData.visualMode = visibility.colorBody
        ? CHARACTER_VISUAL_MODE
        : visibility.silhouette
          ? 'production-v3-silhouette-fallback'
          : 'geometric-placeholder'
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
      this.checkMarker.scale.setScalar(1 + wave * 0.16)
      this.checkMarker.material.opacity = 0.34 + wave * 0.38
    }
  }

  render() {
    this.syncCharacterAssetVisibility()
    this.updateAmbientMotion()
    this.orientCharacterBillboards()
    this.battleFeedback.getCameraOffset(this.cameraShakeOffset)
    this.camera.position
      .copy(this.cameraRestPosition)
      .add(this.cameraShakeOffset)
    this.camera.lookAt(this.cameraTarget)
    this.renderer.render(this.scene, this.camera)
    this.camera.position.copy(this.cameraRestPosition)
    this.camera.lookAt(this.cameraTarget)
  }
}

function addLine(
  points: THREE.Vector3[],
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): void {
  points.push(
    new THREE.Vector3(x1, 0.03, z1),
    new THREE.Vector3(x2, 0.03, z2),
  )
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

function setSpriteVisual(
  sprite: THREE.Sprite,
  visible: boolean,
  opacity: number,
  scale: number,
): void {
  sprite.visible = visible
  sprite.material.opacity = THREE.MathUtils.clamp(opacity, 0, 1)
  sprite.scale.setScalar(scale)
}

function screenDistance(
  first: { x: number; y: number },
  second: { x: number; y: number },
): number {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function createSilhouetteMaterial(
  texture: THREE.Texture,
  color: number,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color,
    transparent: true,
    opacity: 1,
    alphaTest: 0.06,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
    toneMapped: false,
  })
  material.name = 'production-v3-alpha-silhouette'
  material.fog = false
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  diffuseColor.a *= sampledDiffuseColor.a;
#endif
      `,
    )
  }
  material.customProgramCacheKey = () => 'production-v3-alpha-silhouette-v1'
  return material
}

function createCharacterCardMaterial(
  colorTexture: THREE.Texture,
  maskTexture: THREE.Texture,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: colorTexture,
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    alphaTest: 0.06,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
    toneMapped: false,
  })
  material.name = 'production-v3-color-card'
  material.fog = false
  material.onBeforeCompile = (shader) => {
    shader.uniforms.roleAlphaMask = { value: maskTexture }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_pars_fragment>',
      `#include <map_pars_fragment>
uniform sampler2D roleAlphaMask;`,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
diffuseColor.a *= texture2D(roleAlphaMask, vMapUv).a;`,
    )
  }
  material.customProgramCacheKey = () => 'production-v3-color-card-v1'
  return material
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
  context.font =
    '700 48px "Songti SC", "STSong", "Noto Serif CJK SC", serif'
  context.fillText('楚  河', canvas.width * 0.31, canvas.height * 0.5)
  context.fillText('汉  界', canvas.width * 0.69, canvas.height * 0.5)

  context.shadowBlur = 4
  context.fillStyle = 'rgba(221, 193, 112, 0.76)'
  context.font =
    '600 19px ui-monospace, "SFMono-Regular", Menlo, monospace'
  const horizontalMargin = 94
  const verticalMargin = 76
  for (let file = 0; file <= 8; file += 1) {
    const x =
      horizontalMargin +
      (file / 8) * (canvas.width - horizontalMargin * 2)
    context.fillText(String(file + 1), x, verticalMargin * 0.48)
    context.fillText(
      String(9 - file),
      x,
      canvas.height - verticalMargin * 0.48,
    )
  }

  context.fillStyle = 'rgba(155, 188, 222, 0.55)'
  context.font =
    '500 14px ui-monospace, "SFMono-Regular", Menlo, monospace'
  for (let rank = 0; rank <= 9; rank += 1) {
    const y =
      verticalMargin +
      (rank / 9) * (canvas.height - verticalMargin * 2)
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

function createGeometricCharacterPlaceholder(
  side: Side,
  visibleHeight: number,
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'role-geometric-placeholder'
  const height = Math.max(0.62, visibleHeight * 0.82)
  const width = Math.min(0.52, height * 0.5)
  const shape = new THREE.Shape()
  shape.moveTo(-width * 0.22, 0)
  shape.lineTo(-width * 0.42, height * 0.13)
  shape.lineTo(-width * 0.5, height * 0.56)
  shape.lineTo(-width * 0.3, height * 0.82)
  shape.lineTo(0, height)
  shape.lineTo(width * 0.3, height * 0.82)
  shape.lineTo(width * 0.5, height * 0.56)
  shape.lineTo(width * 0.42, height * 0.13)
  shape.lineTo(width * 0.22, 0)
  shape.closePath()

  const geometry = new THREE.ShapeGeometry(shape)
  const rim = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: SILHOUETTE_COLORS[side].rim,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  )
  rim.name = 'geometric-placeholder-rim'
  rim.scale.set(1.09, 1.045, 1)
  rim.renderOrder = 4
  group.add(rim)

  const body = new THREE.Mesh(
    geometry.clone(),
    new THREE.MeshBasicMaterial({
      color: SILHOUETTE_COLORS[side].body,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  )
  body.name = 'geometric-placeholder-body'
  body.position.z = 0.009
  body.scale.set(0.9, 0.94, 1)
  body.renderOrder = 5
  group.add(body)
  return group
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material]
    for (const material of materials) material.dispose()
  })
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

function applyPresentationCameraProjection(
  camera: THREE.PerspectiveCamera,
  profile: PresentationProfile,
): void {
  camera.fov = profile.camera.fov
  camera.aspect = profile.viewport.aspect
  const offset = profile.camera.projectionCenterOffsetCss
  if (offset.x === 0 && offset.y === 0) {
    camera.clearViewOffset()
  } else {
    camera.setViewOffset(
      profile.viewport.width,
      profile.viewport.height,
      -offset.x,
      -offset.y,
      profile.viewport.width,
      profile.viewport.height,
    )
  }
  camera.updateProjectionMatrix()
}
