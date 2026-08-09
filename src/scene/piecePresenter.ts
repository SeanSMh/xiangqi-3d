import * as THREE from 'three'
import type { PiecePose } from '../animation/animationDirector'
import { pieceLabel } from '../engine/board'
import type {
  BoardCoord,
  GameState,
  Piece,
  PieceKind,
  Side,
} from '../types/xiangqi'
import { OCCUPANCY_DIAMETER, fileRankToWorld } from './boardGeometry'
import { CharacterAura, auraPhaseFromId } from './characterAura'
import type { CameraBearing } from './cameraDirector'
import { FACTION_COLORS } from './lighting'
import type { PresentationProfile } from './presentationProfile'
import {
  CHARACTER_BACK_VISUAL_MODE,
  CHARACTER_VISUAL_MODE,
  PIECE_KINDS,
  ROLE_BASE_TOP,
  ROLE_RIM_SCALE,
  SILHOUETTE_COLORS,
  SILHOUETTE_SPECS,
  getAttackPoseLayout,
  getAttackPoseSpec,
  getCharacterVisualSpec,
  resolveCharacterLayerVisibility,
  resolveFactionCharacterViewMode,
  type CharacterViewMode,
} from './pieceVisuals'
import type { TextureLibrary } from './textureLibrary'

/**
 * 临时开关：两侧一律显示正面图。
 *
 * 背向站立态的原画还不存在（简报见
 * `resources/art/production/back_idle/`），缺图时背向一方渲染的是
 * `role-fallback`——用蒙版填单色的纯色剪影，形状对但没有画面内容。
 * 打开这个开关等于「不做背视」：两军都面朝镜头，好看但不再符合空间逻辑
 * （红军背对自己的对手）。很多 2.5D 棋类就是这么处理的。
 *
 * 置 false 即恢复按相机方位翻面。注意这里只截断 PiecePresenter 的翻面，
 * 不动 `resolveFactionCharacterViewMode`（它还被棋盘文字朝向复用，且有测试钉着）。
 */
const FORCE_FRONT_VIEW = true

/**
 * 棋子表现层：底座、全彩角色卡、被俘陈列与广告牌朝向。
 *
 * 它只消费权威局面与 AnimationDirector 推来的姿态，自身不含任何规则判断，
 * 也不持有相机——朝向所需的相机方位由 BoardScene 传入。
 */
export class PiecePresenter {
  private readonly meshes = new Map<string, THREE.Group>()
  private readonly capturedMeshes = new Map<string, THREE.Group>()
  private readonly textures: TextureLibrary
  private readonly parent: THREE.Object3D
  private readonly localCameraPosition = new THREE.Vector3()
  private profile: PresentationProfile
  private readonly aura = new CharacterAura()
  private readonly phases = new Map<string, number>()
  private glowEnabled = true
  private flatMode = false
  private viewBySide: Record<Side, CharacterViewMode> = {
    red: FORCE_FRONT_VIEW ? 'front' : 'back',
    black: 'front',
  }

  constructor(
    parent: THREE.Object3D,
    textures: TextureLibrary,
    profile: PresentationProfile,
  ) {
    this.parent = parent
    this.textures = textures
    this.profile = profile
    this.aura.setViewportHeight(profile.viewport.height)
  }

  setProfile(profile: PresentationProfile): void {
    const capturedModeChanged =
      profile.capturedDisplayMode !== this.profile.capturedDisplayMode
    this.profile = profile
    // 点尺寸的透视衰减基准跟着视口走，换分辨率时光点不会忽大忽小。
    this.aura.setViewportHeight(profile.viewport.height)
    if (!capturedModeChanged) return
    const visible = profile.capturedDisplayMode === 'side-columns'
    for (const token of this.capturedMeshes.values()) token.visible = visible
  }

  /** 根据权威局面同步棋子 mesh。 */
  sync(state: GameState): void {
    const alive = new Set<string>()
    for (const piece of state.pieces) {
      if (piece.captured) continue
      alive.add(piece.id)
      let group = this.meshes.get(piece.id)
      if (
        group &&
        (group.userData.pieceKind !== piece.kind ||
          group.userData.side !== piece.side)
      ) {
        this.parent.remove(group)
        disposeObject(group)
        this.meshes.delete(piece.id)
        group = undefined
      }
      if (!group) {
        group = this.createPieceMesh(
          piece.kind,
          piece.side,
          pieceLabel(piece.kind, piece.side),
        )
        group.name = `piece-${piece.id}`
        group.userData.pieceId = piece.id
        group.userData.pieceKind = piece.kind
        group.userData.side = piece.side
        this.meshes.set(piece.id, group)
        this.parent.add(group)
      }
      const position = fileRankToWorld(piece.file, piece.rank)
      group.position.set(position.x, 0.05, position.z)
      group.rotation.set(0, 0, 0)
      group.scale.setScalar(1)
      group.visible = true
      // 拾取要按权威局面认交点，不能从 mesh 坐标反推——演出期间 mesh 是移动的。
      const collider = group.userData.collider as THREE.Mesh | undefined
      if (collider) {
        collider.userData.square = { file: piece.file, rank: piece.rank }
      }
    }
    for (const [id, mesh] of this.meshes) {
      if (alive.has(id)) continue
      this.parent.remove(mesh)
      disposeObject(mesh)
      this.meshes.delete(id)
    }
    this.syncCapturedDisplay(state)
  }

  setPose(pieceId: string, pose: PiecePose): boolean {
    const mesh = this.meshes.get(pieceId)
    if (!mesh) return false
    const position = fileRankToWorld(pose.file, pose.rank)
    mesh.position.set(position.x, 0.05 + pose.lift, position.z)
    mesh.scale.setScalar(pose.scale)
    mesh.rotation.y = pose.rotationY
    return true
  }

  /**
   * 受击立绘的消散进度。
   *
   * 全彩、剪影与描边三层共享同一个 uniform，因此不论棋子当前落在哪一级
   * 回退上都会一起散尽；几何占位没有 UV，退化为整体淡出。
   */
  setDissolve(pieceId: string, progress: number): void {
    const card = this.meshes
      .get(pieceId)
      ?.getObjectByName('role-billboard')
    if (!card) return
    const clamped = THREE.MathUtils.clamp(progress, 0, 1)
    const uniform = card.userData.dissolveUniform as
      | { value: number }
      | undefined
    if (uniform) uniform.value = clamped
    const fallbacks = card.userData.dissolveFallbacks as
      | Array<{ material: THREE.MeshBasicMaterial; baseOpacity: number }>
      | undefined
    if (!fallbacks) return
    for (const entry of fallbacks) {
      entry.material.opacity = entry.baseOpacity * (1 - clamped)
    }
  }

  /**
   * 切换攻击姿态。
   *
   * 姿态贴图**首次真正用到时才创建并加载**：14 棋种 ×（彩图 + 蒙版）= 28 张，
   * 全部塞进初始加载会让开局多等一大截，而一局里真正出手的通常只有几枚棋子。
   * 代价是某枚棋子的第一次出手可能仍显示待机姿——这正好落在既有的三级回退里。
   */
  setAttackPose(pieceId: string, active: boolean): void {
    const group = this.meshes.get(pieceId)
    const card = group?.getObjectByName('role-billboard')
    if (!group || !card) return
    if (active) {
      const kind = group.userData.pieceKind as PieceKind
      const side = group.userData.side as Side
      const dissolve = card.userData.dissolveUniform as
        | { value: number }
        | undefined
      // 正/背向各一层：背向绝不用正脸镜像，正面层与背向层独立懒加载。
      if (!card.getObjectByName('role-attack-body')) {
        card.add(this.createAttackLayer(kind, side, 'front', dissolve))
      }
      // 强制正面时背向层永远不可能可见，别白白拉两张贴图（颜色 + 蒙版）。
      if (
        !FORCE_FRONT_VIEW &&
        !card.getObjectByName('role-attack-body-back')
      ) {
        card.add(this.createAttackLayer(kind, side, 'back', dissolve))
      }
    }
    const attack = card.getObjectByName('role-attack-body')
    const attackBack = card.getObjectByName('role-attack-body-back')
    if (!attack && !attackBack) return
    card.userData.attackPose = active
    // 可见性最终由 syncAssetVisibility 统一裁决——贴图没就绪时不能露出空白面。
    if (attack) attack.visible = false
    if (attackBack) attackBack.visible = false
  }

  /** 取消或吸附时必须复位，否则残留 uniform 会让复活的棋子半透明。 */
  clearAttackPoses(): void {
    for (const group of this.meshes.values()) {
      const card = group.getObjectByName('role-billboard')
      if (card) card.userData.attackPose = false
    }
  }

  /** 取消或吸附时必须复位，否则残留 uniform 会让复活的棋子半透明。 */
  clearDissolve(): void {
    for (const mesh of this.meshes.values()) {
      const card = mesh.getObjectByName('role-billboard')
      if (!card) continue
      const uniform = card.userData.dissolveUniform as
        | { value: number }
        | undefined
      if (uniform) uniform.value = 0
      const fallbacks = card.userData.dissolveFallbacks as
        | Array<{ material: THREE.MeshBasicMaterial; baseOpacity: number }>
        | undefined
      if (!fallbacks) continue
      for (const entry of fallbacks) {
        entry.material.opacity = entry.baseOpacity
      }
    }
  }

  resetScales(): void {
    for (const mesh of this.meshes.values()) mesh.scale.setScalar(1)
  }

  /** 光点系统的根节点，由 BoardScene 挂进棋盘。 */
  get auraRoot(): THREE.Object3D {
    return this.aura.points
  }

  setQualityBudget(budget: {
    characterGlow: boolean
    motesPerPiece: number
  }): void {
    this.glowEnabled = budget.characterGlow
    this.aura.setMotesPerPiece(budget.motesPerPiece)
    if (budget.motesPerPiece === 0) this.aura.clear()
  }

  /**
   * 逐帧推进辉光呼吸与环绕光点。由**模拟时钟**驱动，因此悔棋、回放和手动时钟
   * 得到一致画面；每枚棋子的相位由 id 派生，同一局面下排布完全可复现。
   */
  update(timeMs: number): void {
    const motes = this.flatMode ? 0 : this.aura.getMotesPerPiece()
    this.aura.begin(motes > 0 ? this.meshes.size : 0)
    for (const [id, group] of this.meshes) {
      const phase = this.phaseFor(id)
      const card = group.getObjectByName('role-billboard')
      const glow = card?.userData.glowUniform as GlowUniform | undefined
      if (glow) {
        const attacking = card?.userData.attackPose === true
        const breath = 0.34 + 0.14 * Math.sin(timeMs * 0.0016 + phase)
        // 出手时明显亮起来，读作蓄力灌注。
        glow.value = this.glowEnabled ? breath + (attacking ? 0.6 : 0) : 0
      }
      if (motes > 0) {
        const kind = group.userData.pieceKind as PieceKind
        const side = group.userData.side as Side
        this.aura.addSource(
          group.position,
          side,
          SILHOUETTE_SPECS[kind].visibleHeight,
          phase,
          timeMs,
        )
      }
    }
    this.aura.commit()
  }

  private phaseFor(id: string): number {
    let phase = this.phases.get(id)
    if (phase === undefined) {
      phase = auraPhaseFromId(id)
      this.phases.set(id, phase)
    }
    return phase
  }

  /**
   * 用不可见碰撞体拾取棋子。
   *
   * 刻意**不** raycast 立绘平面：Three 的 raycast 不做 alpha 测试，打在贴图的
   * 透明角落上会把旁边空交点的点击吞掉。碰撞体按 Alpha 可见宽度收窄，且半径
   * 不超过半格，因此不会越界抢邻居的点击。
   */
  raycastColliders(
    raycaster: THREE.Raycaster,
  ): { square: BoardCoord; distance: number } | null {
    const colliders: THREE.Mesh[] = []
    for (const group of this.meshes.values()) {
      const collider = group.userData.collider as THREE.Mesh | undefined
      if (collider) colliders.push(collider)
    }
    const hit = raycaster.intersectObjects(colliders, false)[0]
    const square = hit?.object.userData.square as BoardCoord | undefined
    if (!hit || !square) return null
    return { square: { ...square }, distance: hit.distance }
  }

  /** 战术俯视：隐藏立绘，只留底座与汉字面，让每个交点都不被遮挡。 */
  setFlatMode(active: boolean): void {
    this.flatMode = active
    if (active) this.aura.clear()
    for (const group of [...this.meshes.values(), ...this.capturedMeshes.values()]) {
      const card = group.getObjectByName('role-billboard')
      if (card) card.visible = !active
    }
  }

  emphasize(pieceId: string, scale: number): void {
    this.meshes.get(pieceId)?.scale.setScalar(scale)
  }

  /**
   * 红方朝 +Z、黑方朝 -Z。相机在阵营正前方时显示全彩正面，绕到背后时
   * 换独立背面层；侧视临界区沿用上次结果，避免 90° 附近来回闪烁。
   */
  syncFacing(bearing: CameraBearing): void {
    if (FORCE_FRONT_VIEW) {
      this.viewBySide.red = 'front'
      this.viewBySide.black = 'front'
      return
    }
    for (const side of ['red', 'black'] as const) {
      this.viewBySide[side] = resolveFactionCharacterViewMode(
        side,
        bearing,
        this.viewBySide[side],
      )
    }
  }

  /** 广告牌只跟随轨道层相机，不受剧情推进和命中震动影响。 */
  orientBillboards(orbitCameraPosition: THREE.Vector3): void {
    for (const root of this.allRoots()) {
      const card = root.getObjectByName('role-billboard')
      if (!card) continue
      const side = root.userData.side as Side
      card.userData.viewMode = root.userData.capturedDisplay
        ? 'front'
        : this.viewBySide[side]
      this.localCameraPosition.copy(orbitCameraPosition)
      root.worldToLocal(this.localCameraPosition)
      card.rotation.y = Math.atan2(
        this.localCameraPosition.x,
        this.localCameraPosition.z,
      )
      card.rotation.x = this.profile.camera.billboardPitchRadians
      card.scale.setScalar(this.profile.camera.billboardScale)
    }
  }

  syncAssetVisibility(): void {
    for (const root of this.allRoots()) {
      const card = root.getObjectByName('role-billboard')
      if (!card) continue
      const colorBody = card.getObjectByName('role-color-body')
      const fallback = card.getObjectByName('role-fallback')
      const rim = card.getObjectByName('role-rim')
      const placeholder = card.getObjectByName('role-geometric-placeholder')
      const assetUrl = card.userData.assetUrl as string | undefined
      const maskAssetUrl = card.userData.maskAssetUrl as string | undefined
      const visibility = resolveCharacterLayerVisibility(
        assetUrl ? this.textures.getStatus(assetUrl) : undefined,
        maskAssetUrl ? this.textures.getStatus(maskAssetUrl) : undefined,
      )
      const backFacing = card.userData.viewMode === 'back'
      const attack = card.getObjectByName('role-attack-body')
      const attackBack = card.getObjectByName('role-attack-body-back')
      const attackPoseActive = card.userData.attackPose === true
      const frontAttackReady =
        attackPoseActive &&
        !backFacing &&
        Boolean(attack) &&
        this.textures.getStatus(
          card.userData.attackColorUrl as string,
        ) === 'ready' &&
        this.textures.getStatus(
          card.userData.attackMaskUrl as string,
        ) === 'ready'
      const backAttackReady =
        attackPoseActive &&
        backFacing &&
        Boolean(attackBack) &&
        this.textures.getStatus(
          card.userData.attackBackColorUrl as string,
        ) === 'ready' &&
        this.textures.getStatus(
          card.userData.attackBackMaskUrl as string,
        ) === 'ready'
      if (attack) attack.visible = frontAttackReady
      if (attackBack) attackBack.visible = backAttackReady
      // 辉光靠蒙版算，蒙版没就绪就不能亮。
      const halo = card.getObjectByName('role-halo')
      if (halo) halo.visible = this.glowEnabled && visibility.rim
      // 出手姿到位时让位：两层同时可见会重影。
      if (colorBody) {
        colorBody.visible =
          !backFacing && visibility.colorBody && !frontAttackReady
      }
      // 背向：有背向攻击姿则显示攻击层；否则仍用同源轮廓剪影（绝不镜像正脸）。
      if (fallback) {
        fallback.visible = backFacing
          ? visibility.rim && !backAttackReady
          : visibility.silhouette && !frontAttackReady
      }
      if (rim) rim.visible = visibility.rim
      if (placeholder) placeholder.visible = visibility.geometricPlaceholder
      card.userData.visualMode = backFacing
        ? backAttackReady
          ? 'production-v3-attack-pose-back'
          : visibility.rim
            ? CHARACTER_BACK_VISUAL_MODE
            : 'geometric-placeholder'
        : frontAttackReady
          ? 'production-v3-attack-pose'
          : visibility.colorBody
            ? CHARACTER_VISUAL_MODE
            : visibility.silhouette
              ? 'production-v3-silhouette-fallback'
              : 'geometric-placeholder'
    }
  }

  getViewBySide(): Record<Side, CharacterViewMode> {
    return { ...this.viewBySide }
  }

  getSnapshot(state: GameState) {
    const renderedKinds = new Set<PieceKind>()
    let redInstances = 0
    let blackInstances = 0
    let fallbackInstances = 0
    let placeholderInstances = 0
    let backViewInstances = 0
    let attackPoseInstances = 0
    let attackPoseBackInstances = 0
    for (const mesh of this.meshes.values()) {
      const kind = mesh.userData.pieceKind as PieceKind | undefined
      if (kind) renderedKinds.add(kind)
      if (mesh.userData.side === 'red') redInstances += 1
      if (mesh.userData.side === 'black') blackInstances += 1
      const card = mesh.getObjectByName('role-billboard')
      const placeholderVisible =
        card?.getObjectByName('role-geometric-placeholder')?.visible === true
      const loadingFallbackVisible =
        card?.userData.viewMode !== 'back' &&
        card?.getObjectByName('role-fallback')?.visible === true
      if (loadingFallbackVisible || placeholderVisible) fallbackInstances += 1
      if (placeholderVisible) placeholderInstances += 1
      if (card?.userData.viewMode === 'back') backViewInstances += 1
      const mode = card?.userData.visualMode
      if (mode === 'production-v3-attack-pose') attackPoseInstances += 1
      if (mode === 'production-v3-attack-pose-back') attackPoseBackInstances += 1
    }

    const capturedTokens = [...this.capturedMeshes.values()]
    return {
      logicalAlive: state.pieces.filter((piece) => !piece.captured).length,
      renderedInstances: this.meshes.size,
      capturedDisplayInstances: this.capturedMeshes.size,
      capturedDisplayVisibleInstances: capturedTokens.filter(
        (mesh) => mesh.visible,
      ).length,
      capturedDisplayBySide: {
        red: capturedTokens.filter((mesh) => mesh.userData.side === 'red')
          .length,
        black: capturedTokens.filter((mesh) => mesh.userData.side === 'black')
          .length,
      },
      renderedBySide: { red: redInstances, black: blackInstances },
      renderedKinds: PIECE_KINDS.filter((kind) => renderedKinds.has(kind)),
      fallbackInstances,
      placeholderInstances,
      backViewInstances,
      // 正/背向出手姿各自真正显示出来的实例数，供验收判定「接上了没有」。
      attackPoseInstances,
      attackPoseBackInstances,
      aura: {
        glowEnabled: this.glowEnabled,
        motesPerPiece: this.aura.getMotesPerPiece(),
        activeMotes: this.aura.getActiveCount(),
        cometsFalling: this.aura.getCometsFalling(),
      },
    }
  }

  private allRoots(): THREE.Group[] {
    return [...this.meshes.values(), ...this.capturedMeshes.values()]
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
        let token = this.capturedMeshes.get(piece.id)
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
          this.capturedMeshes.set(piece.id, token)
          this.parent.add(token)
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
        token.visible = this.profile.capturedDisplayMode === 'side-columns'
      })
    }

    for (const [id, token] of this.capturedMeshes) {
      if (captured.has(id)) continue
      this.parent.remove(token)
      disposeObject(token)
      this.capturedMeshes.delete(id)
    }
  }

  private createPieceMesh(
    kind: PieceKind,
    side: Side,
    label: string,
  ): THREE.Group {
    const group = new THREE.Group()
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
    group.add(contactShadow)

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
    group.add(body)

    // 使用 production 定稿底座 PNG；红黑只换材质，不更换棋种造型。
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2.02, radius * 2.02),
      new THREE.MeshBasicMaterial({
        map: this.textures.get(`/assets/bases/base_${side}_${label}.png`),
        transparent: true,
        alphaTest: 0.02,
        side: THREE.DoubleSide,
      }),
    )
    face.name = 'piece-base-face'
    face.rotation.x = -Math.PI / 2
    face.position.y = 0.235
    group.add(face)

    group.add(this.createCharacterCard(kind, side))

    const spec = getCharacterVisualSpec(side, kind)
    // 半径按可见轮廓收窄，并夹在半格以内，避免抢走相邻交点的点击。
    const colliderRadius = Math.min(
      0.42,
      Math.max(0.22, spec.layout.visibleFootprintWidth * 0.42),
    )
    const colliderHeight = ROLE_BASE_TOP + spec.visibleHeight
    const collider = new THREE.Mesh(
      new THREE.CylinderGeometry(colliderRadius, colliderRadius, colliderHeight, 10),
      // material.visible=false 只跳过渲染；raycast 仍然命中。
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    collider.name = 'piece-collider'
    collider.position.y = colliderHeight / 2
    collider.renderOrder = -1
    group.add(collider)
    group.userData.collider = collider

    return group
  }

  /** 出手姿态层：与待机卡同尺寸，锚点换成脚部中心，避免切换时横跳。 */
  private createAttackLayer(
    kind: PieceKind,
    side: Side,
    view: CharacterViewMode = 'front',
    dissolve: { value: number } = { value: 0 },
  ): THREE.Mesh {
    const spec = getAttackPoseSpec(side, kind, view)
    const layout = getAttackPoseLayout(side, kind, view)
    const geometry = new THREE.PlaneGeometry(
      layout.planeWidth,
      layout.planeHeight,
    )
    geometry.translate(layout.geometryOffsetX, layout.geometryOffsetY, 0)
    const mesh = new THREE.Mesh(
      geometry,
      createCharacterCardMaterial(
        this.textures.get(spec.colorAssetUrl),
        this.textures.get(spec.alphaAssetUrl),
        dissolve,
        new THREE.Color(SILHOUETTE_COLORS[side].rim),
      ),
    )
    mesh.name =
      view === 'back' ? 'role-attack-body-back' : 'role-attack-body'
    mesh.position.z = view === 'back' ? 0.017 : 0.016
    mesh.renderOrder = 7
    mesh.visible = false
    return mesh
  }

  private createCharacterCard(kind: PieceKind, side: Side): THREE.Group {
    const spec = getCharacterVisualSpec(side, kind)
    const layout = spec.layout
    const maskTexture = this.textures.get(spec.alphaAssetUrl)
    const colorTexture = this.textures.get(spec.colorAssetUrl)
    const card = new THREE.Group()
    card.name = 'role-billboard'
    card.position.y = ROLE_BASE_TOP
    card.userData.assetUrl = spec.colorAssetUrl
    card.userData.maskAssetUrl = spec.alphaAssetUrl
    card.userData.fallbackAssetUrl = spec.fallbackAssetUrl
    card.userData.kind = kind
    card.userData.side = side

    // 三个立绘层共享同一个消散 uniform：无论当前落在哪一级回退上，
    // 被吃的棋子都会以同一条曲线散尽。
    const dissolve: DissolveUniform = { value: 0 }
    const emberColor = new THREE.Color(SILHOUETTE_COLORS[side].rim)
    card.userData.dissolveUniform = dissolve
    card.userData.attackPose = false
    const attackSpec = getAttackPoseSpec(side, kind, 'front')
    const attackBackSpec = getAttackPoseSpec(side, kind, 'back')
    card.userData.attackColorUrl = attackSpec.colorAssetUrl
    card.userData.attackMaskUrl = attackSpec.alphaAssetUrl
    card.userData.attackBackColorUrl = attackBackSpec.colorAssetUrl
    card.userData.attackBackMaskUrl = attackBackSpec.alphaAssetUrl

    const cardGeometry = () => {
      const geometry = new THREE.PlaneGeometry(
        layout.planeWidth,
        layout.planeHeight,
      )
      geometry.translate(layout.geometryOffsetX, layout.geometryOffsetY, 0)
      return geometry
    }

    const glow: GlowUniform = { value: 0 }
    card.userData.glowUniform = glow
    const halo = new THREE.Mesh(
      cardGeometry(),
      createHaloMaterial(maskTexture, emberColor, glow),
    )
    halo.name = 'role-halo'
    // 略放大并压在本体之后：光晕要从轮廓外侧透出来。
    halo.scale.setScalar(1.16)
    halo.position.z = -0.006
    halo.renderOrder = 3
    halo.visible = false
    card.add(halo)

    const rim = new THREE.Mesh(
      cardGeometry(),
      createSilhouetteMaterial(
        maskTexture,
        SILHOUETTE_COLORS[side].rim,
        dissolve,
        emberColor,
      ),
    )
    rim.name = 'role-rim'
    rim.scale.setScalar(ROLE_RIM_SCALE)
    rim.renderOrder = 4
    rim.visible = false
    card.add(rim)

    const fallback = new THREE.Mesh(
      cardGeometry(),
      createSilhouetteMaterial(
        maskTexture,
        SILHOUETTE_COLORS[side].body,
        dissolve,
        emberColor,
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
    // 占位没有贴图坐标，无法做噪声消散；退化为整体淡出。
    card.userData.dissolveFallbacks = geometricPlaceholder.children
      .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
      .map((child) => {
        const material = child.material as THREE.MeshBasicMaterial
        return { material, baseOpacity: material.opacity }
      })

    const colorBody = new THREE.Mesh(
      cardGeometry(),
      createCharacterCardMaterial(
        colorTexture,
        maskTexture,
        dissolve,
        emberColor,
      ),
    )
    colorBody.name = 'role-color-body'
    colorBody.position.z = 0.012
    colorBody.renderOrder = 6
    colorBody.visible = false
    card.add(colorBody)

    return card
  }
}

interface DissolveUniform {
  value: number
}

type GlowUniform = DissolveUniform

/**
 * 自下而上的噪声消散＋发光边缘。
 *
 * 参考项目用骨骼死亡动画表达「倒下」，2.5D 立绘做不到；用消散代替既避开了
 * 缺少背面与倒地帧的问题，视觉分量又足够接近。噪声完全在着色器里生成，
 * 不引入任何额外贴图。
 */
const DISSOLVE_PARS = /* glsl */ `
uniform float roleDissolve;
uniform vec3 roleEmberColor;

float roleDissolveNoise(vec2 uv) {
  vec2 grid = floor(uv * 26.0);
  float value = fract(sin(dot(grid, vec2(12.9898, 78.233))) * 43758.5453);
  vec2 fine = fract(uv * 26.0);
  float smoothed = value * (0.65 + 0.35 * fine.x * fine.y);
  return clamp(smoothed, 0.0, 1.0);
}
`

const DISSOLVE_FRAGMENT = /* glsl */ `
if (roleDissolve > 0.0) {
  float field = roleDissolveNoise(vMapUv) * 0.45 + vMapUv.y * 0.55;
  float threshold = roleDissolve * 1.35 - 0.2;
  if (field < threshold) discard;
  float edge = 1.0 - smoothstep(threshold, threshold + 0.14, field);
  diffuseColor.rgb = mix(diffuseColor.rgb, roleEmberColor, edge * 0.92);
  diffuseColor.a = min(1.0, diffuseColor.a + edge * 0.35);
}
`

function injectDissolve(
  shader: { fragmentShader: string; uniforms: Record<string, unknown> },
  dissolve: DissolveUniform,
  emberColor: THREE.Color,
): void {
  shader.uniforms.roleDissolve = dissolve
  shader.uniforms.roleEmberColor = { value: emberColor }
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <alphatest_fragment>',
    `${DISSOLVE_FRAGMENT}
#include <alphatest_fragment>`,
  )
}

/**
 * 轮廓辉光。
 *
 * 对角色**自己的** Alpha 蒙版做一圈多点采样并取平均，得到一张放大、模糊过的
 * 剪影——所以光晕严丝合缝地贴着每个棋种各自的身形。用一张通用光斑贴图做不到
 * 这件事：七个棋种轮廓各不相同，通用光斑必然对不齐。
 */
function createHaloMaterial(
  maskTexture: THREE.Texture,
  color: THREE.Color,
  glow: GlowUniform,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: maskTexture,
    color,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  material.name = 'character-halo'
  material.fog = false
  material.onBeforeCompile = (shader) => {
    shader.uniforms.haloGlow = glow
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_pars_fragment>',
      `#include <map_pars_fragment>
uniform float haloGlow;`,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
#ifdef USE_MAP
  float haloAcc = 0.0;
  // 8 个方向单圈。原来是 12 方向 × 2 圈 = 24 次采样，×32 枚棋子后成了新增的
  // 主要开销，反过来把画质档压降、把辉光自己关掉。放大 1.16 倍再模糊之后，
  // 8 次与 24 次的观感差别很小。
  for (int i = 0; i < 8; i++) {
    float haloAngle = float(i) * 0.7853982;
    vec2 haloDir = vec2(cos(haloAngle), sin(haloAngle));
    haloAcc += texture2D(map, vMapUv + haloDir * 0.019).a;
  }
  diffuseColor.a *= clamp(haloAcc / 8.0, 0.0, 1.0) * haloGlow;
#endif
      `,
    )
  }
  material.customProgramCacheKey = () => 'character-halo-v1'
  return material
}

function createSilhouetteMaterial(
  texture: THREE.Texture,
  color: number,
  dissolve: DissolveUniform,
  emberColor: THREE.Color,
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
      '#include <map_pars_fragment>',
      `#include <map_pars_fragment>
${DISSOLVE_PARS}`,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  diffuseColor.a *= sampledDiffuseColor.a;
#endif
      `,
    )
    injectDissolve(shader, dissolve, emberColor)
  }
  material.customProgramCacheKey = () => 'production-v3-alpha-silhouette-v2'
  return material
}

function createCharacterCardMaterial(
  colorTexture: THREE.Texture,
  maskTexture: THREE.Texture,
  dissolve: DissolveUniform,
  emberColor: THREE.Color,
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
uniform sampler2D roleAlphaMask;
${DISSOLVE_PARS}`,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
diffuseColor.a *= texture2D(roleAlphaMask, vMapUv).a;`,
    )
    injectDissolve(shader, dissolve, emberColor)
  }
  material.customProgramCacheKey = () => 'production-v3-color-card-v2'
  return material
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
