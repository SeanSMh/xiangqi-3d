import type { GameState, Move } from '../types/xiangqi'

export type ComputerDifficulty = 'easy' | 'normal' | 'hard'

export interface ComputerSearchOptions {
  difficulty: ComputerDifficulty
  maxNodes?: number
  seed?: number
}

export interface ComputerSearchResult {
  move: Move | null
  score: number
  completedDepth: number
  nodes: number
  principalVariation: Move[]
}

export interface ComputerWorkerRequest {
  type: 'search'
  requestId: number
  timelineRevision: number
  state: GameState
  options: ComputerSearchOptions
}

export type ComputerWorkerResponse =
  | {
      type: 'result'
      requestId: number
      timelineRevision: number
      result: ComputerSearchResult
    }
  | {
      type: 'error'
      requestId: number
      timelineRevision: number
      message: string
    }
