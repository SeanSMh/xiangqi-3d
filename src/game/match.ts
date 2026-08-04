import type { AiDifficulty } from '../ai/types'
import type { GameState, Side } from '../types/xiangqi'

export type MatchMode = 'local' | 'ai'

export interface MatchConfig {
  mode: MatchMode
  difficulty: AiDifficulty
}

export const HUMAN_SIDE: Side = 'red'
export const AI_SIDE: Side = 'black'

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  mode: 'local',
  difficulty: 'normal',
}

export function isAiTurn(config: MatchConfig, state: GameState): boolean {
  return (
    config.mode === 'ai' &&
    state.status === 'playing' &&
    state.sideToMove === AI_SIDE
  )
}

export function aiDifficultyLabel(difficulty: AiDifficulty): string {
  switch (difficulty) {
    case 'easy':
      return '入门'
    case 'normal':
      return '标准'
    case 'hard':
      return '挑战'
  }
}

export function matchModeLabel(config: MatchConfig): string {
  return config.mode === 'local'
    ? '本地双人'
    : `人机 · ${aiDifficultyLabel(config.difficulty)}`
}
