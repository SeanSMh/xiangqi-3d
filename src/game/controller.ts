import { createInitialState, pieceAt, pieceLabel } from '../engine/board'
import {
  explainIllegalMove,
  type IllegalMoveReason,
} from '../engine/illegalMove'
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
  | { type: 'selected' }
  | {
      type: 'cleared'
      reason: IllegalMoveReason | 'no-selection' | 'cancelled'
    }
  | {
      type: 'ignored'
      reason: 'reviewing' | 'terminal' | 'outside-board' | 'illegal'
    }

export type CommitMoveResult =
  | { type: 'moved'; move: Move }
  | {
      type: 'ignored'
      reason: 'reviewing' | 'terminal' | 'illegal'
    }

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
    if (this.timeline.getSnapshot().isReviewing) {
      return { type: 'ignored', reason: 'reviewing' }
    }
    if (state.status !== 'playing') {
      return { type: 'ignored', reason: 'terminal' }
    }
    if (!isInsideBoard(file, rank)) {
      return { type: 'ignored', reason: 'outside-board' }
    }

    const target = pieceAt(state.pieces, file, rank)
    const selected = this.getSelectedPiece()

    if (selected) {
      const move = this.legalMoves.find(
        (candidate) =>
          candidate.to.file === file && candidate.to.rank === rank,
      )
      if (move) {
        const committed = this.tryCommitMove(move)
        return committed.type === 'moved'
          ? committed
          : { type: 'ignored', reason: committed.reason }
      }

      if (target?.id === selected.id) {
        this.clearSelection()
        return { type: 'cleared', reason: 'cancelled' }
      }
    }

    if (target?.side === state.sideToMove) {
      this.select(target)
      return { type: 'selected' }
    }

    const reason = selected
      ? explainIllegalMove(state, selected, { file, rank }) ?? 'illegal-pattern'
      : target
        ? 'wrong-side'
        : 'no-selection'
    this.clearSelection()
    return { type: 'cleared', reason }
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

  /** 人机模式使用：原子回退到指定阵营的上一个决策点。 */
  undoToSide(side: Side): number {
    const undone = this.timeline.undoToSide(side)
    if (undone > 0) this.clearSelection()
    return undone
  }

  /** 程序化落子统一入口；电脑对手与棋盘点击最终都由规则引擎二次校验。 */
  tryCommitMove(requestedMove: Move): CommitMoveResult {
    const timeline = this.timeline.getSnapshot()
    if (timeline.isReviewing) {
      return { type: 'ignored', reason: 'reviewing' }
    }
    if (this.getState().status !== 'playing') {
      return { type: 'ignored', reason: 'terminal' }
    }
    try {
      const state = this.timeline.commitMove(requestedMove)
      const record = state.history.at(-1)
      if (!record) return { type: 'ignored', reason: 'illegal' }
      const move: Move = {
        pieceId: record.pieceId,
        from: { ...record.from },
        to: { ...record.to },
        ...(record.capturedId ? { capturedId: record.capturedId } : {}),
      }
      this.clearSelection()
      return { type: 'moved', move }
    } catch {
      return { type: 'ignored', reason: 'illegal' }
    }
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
