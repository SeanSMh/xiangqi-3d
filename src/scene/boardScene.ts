import * as THREE from 'three'
import type { BoardCoord, GameState, Move } from '../types/xiangqi'
import { pieceLabel } from '../engine/board'
import { applyUnifiedLighting, FACTION_COLORS } from './lighting'

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

export class BoardScene {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  private pieceMeshes = new Map<string, THREE.Group>()
  private boardRoot = new THREE.Group()
  private markerRoot = new THREE.Group()
  private textureLoader = new THREE.TextureLoader()
  private textureCache = new Map<string, THREE.Texture>()
  private pointer = new THREE.Vector2()
  private raycaster = new THREE.Raycaster()
  private boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  constructor(container: HTMLElement) {
    const w = container.clientWidth
    const h = container.clientHeight
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100)
    // 固定斜俯视（对齐参考包镜头）
    this.camera.position.set(0, 11, -10)
    this.camera.lookAt(0, 0, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.renderer.domElement.id = 'game-canvas'
    this.renderer.domElement.setAttribute('aria-label', '中国象棋棋盘')
    this.renderer.domElement.style.touchAction = 'none'
    this.renderer.domElement.style.cursor = 'pointer'
    container.appendChild(this.renderer.domElement)

    applyUnifiedLighting(this.scene)
    this.buildBoard()
    this.scene.add(this.boardRoot)
    this.boardRoot.add(this.markerRoot)

    window.addEventListener('resize', () => {
      const cw = container.clientWidth
      const ch = container.clientHeight
      this.camera.aspect = cw / ch
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(cw, ch)
    })
  }

  private buildBoard() {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W + 1.2, 0.15, BOARD_H + 1.2),
      new THREE.MeshStandardMaterial({
        color: 0x211822,
        metalness: 0.38,
        roughness: 0.58,
      }),
    )
    base.position.y = -0.08
    this.boardRoot.add(base)

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
    river.position.set(0, 0.02, 0)
    this.boardRoot.add(river)
  }

  /** 根据权威局面同步棋子 mesh。 */
  syncPieces(state: GameState) {
    const alive = new Set<string>()
    for (const p of state.pieces) {
      if (p.captured) continue
      alive.add(p.id)
      let g = this.pieceMeshes.get(p.id)
      if (!g) {
        g = this.createPieceMesh(p.side, pieceLabel(p.kind, p.side))
        g.name = `piece-${p.id}`
        g.userData.pieceId = p.id
        this.pieceMeshes.set(p.id, g)
        this.boardRoot.add(g)
      }
      const pos = fileRankToWorld(p.file, p.rank)
      g.position.set(pos.x, 0.05, pos.z)
    }
    for (const [id, mesh] of this.pieceMeshes) {
      if (!alive.has(id)) {
        this.boardRoot.remove(mesh)
        this.pieceMeshes.delete(id)
      }
    }
  }

  private createPieceMesh(side: 'red' | 'black', label: string): THREE.Group {
    const g = new THREE.Group()
    const faction = FACTION_COLORS[side]
    const radius = (OCCUPANCY_DIAMETER / 2) * 0.9

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
    body.position.y = 0.12
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

    return g
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

  private loadTexture(url: string): THREE.Texture {
    const cached = this.textureCache.get(url)
    if (cached) return cached
    const texture = this.textureLoader.load(url)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    )
    this.textureCache.set(url, texture)
    return texture
  }

  render() {
    this.renderer.render(this.scene, this.camera)
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
