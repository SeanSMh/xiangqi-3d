import type { ComputerDifficulty } from '../computer/types'
import type { GameState, Side } from '../types/xiangqi'

export type MatchMode = 'local' | 'computer'

export interface MatchConfig {
  mode: MatchMode
  difficulty: ComputerDifficulty
}

export const HUMAN_SIDE: Side = 'red'
export const COMPUTER_SIDE: Side = 'black'

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  mode: 'local',
  difficulty: 'normal',
}

export function isComputerTurn(config: MatchConfig, state: GameState): boolean {
  return (
    config.mode === 'computer' &&
    state.status === 'playing' &&
    state.sideToMove === COMPUTER_SIDE
  )
}

export function computerDifficultyLabel(difficulty: ComputerDifficulty): string {
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
    : `人机 · ${computerDifficultyLabel(config.difficulty)}`
}
