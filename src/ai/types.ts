import type { GameState, Move } from '../types/xiangqi'

export type AiDifficulty = 'easy' | 'normal' | 'hard'

export interface AiSearchOptions {
  difficulty: AiDifficulty
  maxNodes?: number
  seed?: number
}

export interface AiSearchResult {
  move: Move | null
  score: number
  completedDepth: number
  nodes: number
  principalVariation: Move[]
}

export interface AiWorkerRequest {
  type: 'search'
  requestId: number
  timelineRevision: number
  state: GameState
  options: AiSearchOptions
}

export type AiWorkerResponse =
  | {
      type: 'result'
      requestId: number
      timelineRevision: number
      result: AiSearchResult
    }
  | {
      type: 'error'
      requestId: number
      timelineRevision: number
      message: string
    }
