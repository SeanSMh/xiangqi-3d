import { createInitialState, pieceAt, pieceLabel } from '../engine/board'
import { generateLegalMoves, isInsideBoard } from '../engine/moves'
import type {
  BoardCoord,
  GameState,
  Move,
  Piece,
  Side,
} from '../types/xiangqi'
import { GameTimeline, type TimelineSnapshot } from './timeline'

export type InteractionResult =
  | { type: 'moved'; move: Move }
  | { type: 'selected' | 'cleared' | 'ignored' }

export interface MoveLogEntry {
  ply: number
  round: number
  side: Side
  pieceId: string
  pieceLabel: string
  from: BoardCoord
  to: BoardCoord
  capturedId: string | null
  capturedLabel: string | null
  givesCheck: boolean
  text: string
}

/**
 * 棋局交互控制器：只处理局面、选择与合法着，不持有任何 Three.js 对象。
 */
export class GameController {
  private timeline: GameTimeline
  private selectedId: string | null = null
  private legalMoves: Move[] = []

  constructor(initialState: GameState = createInitialState()) {
    this.timeline = new GameTimeline(initialState)
  }

  getState(): GameState {
    return this.timeline.getState()
  }

  getTimelineSnapshot(): TimelineSnapshot {
    return this.timeline.getSnapshot()
  }

  getMoveLog(): MoveLogEntry[] {
    const liveState = this.timeline.getLiveState()
    return liveState.history.map((record, index) => {
      const piece = liveState.pieces.find(
        (candidate) => candidate.id === record.pieceId,
      )
      const captured = record.capturedId
        ? liveState.pieces.find(
            (candidate) => candidate.id === record.capturedId,
          )
        : undefined
      const movingLabel = piece
        ? pieceLabel(piece.kind, piece.side)
        : record.pieceId
      const capturedLabel = captured
        ? `${sideName(captured.side)}${pieceLabel(captured.kind, captured.side)}`
        : null
      const action = capturedLabel ? `× ${capturedLabel}` : '→'
      const checkSuffix = record.givesCheck ? ' · 将军' : ''
      return {
        ply: index + 1,
        round: Math.floor(index / 2) + 1,
        side: record.side,
        pieceId: record.pieceId,
        pieceLabel: movingLabel,
        from: { ...record.from },
        to: { ...record.to },
        capturedId: record.capturedId ?? null,
        capturedLabel,
        givesCheck: record.givesCheck,
        text: `${sideName(record.side)}${movingLabel} (${record.from.file + 1},${record.from.rank + 1}) ${action} (${record.to.file + 1},${record.to.rank + 1})${checkSuffix}`,
      }
    })
  }

  getSelectedId(): string | null {
    return this.selectedId
  }

  getSelectedPiece(): Piece | undefined {
    return this.getState().pieces.find(
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
    const state = this.getState()
    if (
      this.timeline.getSnapshot().isReviewing ||
      state.status !== 'playing' ||
      !isInsideBoard(file, rank)
    ) {
      return { type: 'ignored' }
    }

    const target = pieceAt(state.pieces, file, rank)
    const selected = this.getSelectedPiece()

    if (selected) {
      const move = this.legalMoves.find(
        (candidate) =>
          candidate.to.file === file && candidate.to.rank === rank,
      )
      if (move) {
        this.timeline.commitMove(move)
        this.clearSelection()
        return { type: 'moved', move }
      }

      if (target?.id === selected.id) {
        this.clearSelection()
        return { type: 'cleared' }
      }
    }

    if (target?.side === state.sideToMove) {
      this.select(target)
      return { type: 'selected' }
    }

    this.clearSelection()
    return { type: 'cleared' }
  }

  reset(): void {
    this.timeline.reset()
    this.clearSelection()
  }

  undoLastMove(): boolean {
    const changed = this.timeline.undo()
    if (changed) this.clearSelection()
    return changed
  }

  stepReplayBackward(): boolean {
    const changed = this.timeline.stepBackward()
    if (changed) this.clearSelection()
    return changed
  }

  stepReplayForward(): boolean {
    const changed = this.timeline.stepForward()
    if (changed) this.clearSelection()
    return changed
  }

  seekReplay(ply: number): boolean {
    const changed = this.timeline.seek(ply)
    if (changed) this.clearSelection()
    return changed
  }

  returnToLive(): boolean {
    const changed = this.timeline.returnToLive()
    if (changed) this.clearSelection()
    return changed
  }

  private select(piece: Piece): void {
    this.selectedId = piece.id
    this.legalMoves = generateLegalMoves(this.getState(), piece)
  }

  private clearSelection(): void {
    this.selectedId = null
    this.legalMoves = []
  }
}

function sideName(side: Side): string {
  return side === 'red' ? '红' : '黑'
}
