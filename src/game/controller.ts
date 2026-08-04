import { createInitialState, pieceAt, pieceLabel } from '../engine/board'
import { applyMove, generateLegalMoves, isInsideBoard } from '../engine/moves'
import type { GameState, Move, Piece } from '../types/xiangqi'

export type InteractionType = 'selected' | 'moved' | 'cleared' | 'ignored'

export interface InteractionResult {
  type: InteractionType
  move?: Move
}

/**
 * 棋局交互控制器：只处理局面、选择与合法着，不持有任何 Three.js 对象。
 */
export class GameController {
  private state: GameState
  private selectedId: string | null = null
  private legalMoves: Move[] = []

  constructor(initialState: GameState = createInitialState()) {
    this.state = initialState
  }

  getState(): GameState {
    return this.state
  }

  getSelectedId(): string | null {
    return this.selectedId
  }

  getSelectedPiece(): Piece | undefined {
    return this.state.pieces.find(
      (candidate) => candidate.id === this.selectedId && !candidate.captured,
    )
  }

  getSelectedLabel(): string | null {
    const selected = this.getSelectedPiece()
    return selected ? pieceLabel(selected.kind, selected.side) : null
  }

  getLegalMoves(): readonly Move[] {
    return this.legalMoves
  }

  handleSquare(file: number, rank: number): InteractionResult {
    if (
      this.state.status !== 'playing' ||
      !isInsideBoard(file, rank)
    ) {
      return { type: 'ignored' }
    }

    const target = pieceAt(this.state.pieces, file, rank)
    const selected = this.getSelectedPiece()

    if (selected) {
      const move = this.legalMoves.find(
        (candidate) =>
          candidate.to.file === file && candidate.to.rank === rank,
      )
      if (move) {
        this.state = applyMove(this.state, move)
        this.clearSelection()
        return { type: 'moved', move }
      }

      if (target?.id === selected.id) {
        this.clearSelection()
        return { type: 'cleared' }
      }
    }

    if (target?.side === this.state.sideToMove) {
      this.select(target)
      return { type: 'selected' }
    }

    this.clearSelection()
    return { type: 'cleared' }
  }

  reset(): void {
    this.state = createInitialState()
    this.clearSelection()
  }

  private select(piece: Piece): void {
    this.selectedId = piece.id
    this.legalMoves = generateLegalMoves(this.state, piece)
  }

  private clearSelection(): void {
    this.selectedId = null
    this.legalMoves = []
  }
}
