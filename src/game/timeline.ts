import { applyMove } from '../engine/moves'
import type { GameState, Move } from '../types/xiangqi'

export interface TimelineSnapshot {
  cursorPly: number
  livePly: number
  firstAvailablePly: number
  isReviewing: boolean
  canUndo: boolean
  canStepBackward: boolean
  canStepForward: boolean
  canReturnToLive: boolean
  canReplay: boolean
}

/**
 * 保存每个已提交着法对应的不可变局面快照。
 *
 * 棋盘默认展示 cursor 指向的局面；最后一个快照始终是可继续行棋的
 * live 局面。回放只移动 cursor，不改变 live 分支；悔棋才会移除最后
 * 一个 live 快照。
 */
export class GameTimeline {
  private readonly baseline: GameState
  private states: GameState[]
  private cursorIndex = 0

  constructor(initialState: GameState) {
    this.baseline = cloneGameState(initialState)
    this.states = [cloneGameState(this.baseline)]
  }

  getState(): GameState {
    return cloneGameState(this.states[this.cursorIndex]!)
  }

  getLiveState(): GameState {
    return cloneGameState(this.states.at(-1)!)
  }

  getSnapshot(): TimelineSnapshot {
    const lastIndex = this.states.length - 1
    const isReviewing = this.cursorIndex !== lastIndex
    const cursorState = this.states[this.cursorIndex]!
    const liveState = this.states[lastIndex]!
    return {
      cursorPly: cursorState.history.length,
      livePly: liveState.history.length,
      firstAvailablePly: this.states[0]!.history.length,
      isReviewing,
      canUndo: !isReviewing && this.states.length > 1,
      canStepBackward: this.cursorIndex > 0,
      canStepForward: this.cursorIndex < lastIndex,
      canReturnToLive: isReviewing,
      canReplay: this.states.length > 1,
    }
  }

  commitMove(move: Move): GameState {
    if (this.getSnapshot().isReviewing) {
      throw new Error('回放中不能提交新着法')
    }
    const nextState = applyMove(this.states.at(-1)!, move)
    this.states.push(cloneGameState(nextState))
    this.cursorIndex = this.states.length - 1
    return cloneGameState(nextState)
  }

  undo(): boolean {
    if (!this.getSnapshot().canUndo) return false
    this.states.pop()
    this.cursorIndex = this.states.length - 1
    return true
  }

  stepBackward(): boolean {
    if (this.cursorIndex <= 0) return false
    this.cursorIndex -= 1
    return true
  }

  stepForward(): boolean {
    if (this.cursorIndex >= this.states.length - 1) return false
    this.cursorIndex += 1
    return true
  }

  seek(ply: number): boolean {
    if (!Number.isInteger(ply)) return false
    const index = this.states.findIndex(
      (state) => state.history.length === ply,
    )
    if (index < 0 || index === this.cursorIndex) return false
    this.cursorIndex = index
    return true
  }

  returnToLive(): boolean {
    const lastIndex = this.states.length - 1
    if (this.cursorIndex === lastIndex) return false
    this.cursorIndex = lastIndex
    return true
  }

  reset(): void {
    this.states = [cloneGameState(this.baseline)]
    this.cursorIndex = 0
  }
}

function cloneGameState(state: GameState): GameState {
  return {
    ...state,
    pieces: state.pieces.map((piece) => ({ ...piece })),
    history: state.history.map((record) => ({
      ...record,
      from: { ...record.from },
      to: { ...record.to },
    })),
  }
}
