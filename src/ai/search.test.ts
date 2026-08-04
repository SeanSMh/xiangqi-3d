import { describe, expect, it } from 'vitest'
import { createInitialState } from '../engine/board'
import { applyMove, generateAllLegalMoves } from '../engine/moves'
import type { GameState, Move, Piece, PieceKind, Side } from '../types/xiangqi'
import { AI_MATE_SCORE, chooseAiMove } from './search'
import type { AiDifficulty } from './types'

describe('chooseAiMove', () => {
  it('三个难度都返回确定、可由权威引擎执行的合法着', () => {
    const state = createInitialState()
    const legalKeys = new Set(generateAllLegalMoves(state).map(moveKey))

    for (const difficulty of ['easy', 'normal', 'hard'] as AiDifficulty[]) {
      const first = chooseAiMove(state, { difficulty, seed: 7 })
      const second = chooseAiMove(
        { ...state, pieces: [...state.pieces].reverse() },
        { difficulty, seed: 7 },
      )
      expect(first.move).not.toBeNull()
      expect(legalKeys.has(moveKey(first.move!))).toBe(true)
      expect(second).toEqual(first)
      expect(() => applyMove(state, first.move!)).not.toThrow()
    }
  }, 10_000)

  it('标准与挑战难度会优先吃掉高价值目标', () => {
    const state = game(
      [
        piece('rk', 'king', 'red', 4, 0),
        piece('bk', 'king', 'black', 3, 9),
        piece('rr', 'chariot', 'red', 0, 0),
        piece('bc', 'chariot', 'black', 0, 3),
      ],
      'red',
    )
    for (const difficulty of ['normal', 'hard'] as AiDifficulty[]) {
      expect(chooseAiMove(state, { difficulty, seed: 1 }).move).toMatchObject({
        pieceId: 'rr',
        capturedId: 'bc',
        to: { file: 0, rank: 3 },
      })
    }
  })

  it('三个难度都选择一步绝杀', () => {
    const state = mateFixture()
    for (const difficulty of ['easy', 'normal', 'hard'] as AiDifficulty[]) {
      const result = chooseAiMove(state, { difficulty, seed: 11 })
      expect(result.move).not.toBeNull()
      const next = applyMove(state, result.move!)
      expect(next).toMatchObject({ status: 'checkmate', winner: 'red' })
      expect(result.score).toBeGreaterThanOrEqual(AI_MATE_SCORE - 8)
    }
  })

  it('被将军时三个难度都只返回合法应将着', () => {
    const state = game(
      [
        piece('rk', 'king', 'red', 4, 0),
        piece('bk', 'king', 'black', 4, 9),
        piece('block', 'pawn', 'red', 4, 5),
        piece('attack', 'chariot', 'red', 4, 7),
        piece('left', 'chariot', 'red', 3, 8),
      ],
      'black',
    )
    state.inCheck = true
    expect(generateAllLegalMoves(state)).toHaveLength(1)
    for (const difficulty of ['easy', 'normal', 'hard'] as AiDifficulty[]) {
      expect(chooseAiMove(state, { difficulty }).move).toMatchObject({
        pieceId: 'bk',
        from: { file: 4, rank: 9 },
        to: { file: 5, rank: 9 },
      })
    }
  })

  it('挑战难度使用固定两层预算且不会修改输入局面', () => {
    const state = createInitialState()
    const before = structuredClone(state)
    const result = chooseAiMove(state, { difficulty: 'hard', maxNodes: 8_000 })
    expect(result.completedDepth).toBe(2)
    expect(result.nodes).toBeGreaterThan(44)
    expect(result.nodes).toBeLessThanOrEqual(8_000)
    expect(result.principalVariation).toHaveLength(2)
    expect(state).toEqual(before)
  }, 10_000)

  it('挑战难度预算不足时整轮回退到完整一层结果', () => {
    const state = createInitialState()
    const shallow = chooseAiMove(state, { difficulty: 'normal' })
    const limited = chooseAiMove(state, {
      difficulty: 'hard',
      maxNodes: 50,
    })
    expect(limited.completedDepth).toBe(1)
    expect(limited.nodes).toBeLessThanOrEqual(50)
    expect(limited.move).toEqual(shallow.move)
  })

  it('挑战难度会看穿可被卒反吃的车诱饵', () => {
    const state = game(
      [
        piece('rk', 'king', 'red', 4, 0),
        piece('bk', 'king', 'black', 3, 9),
        piece('rr', 'chariot', 'red', 0, 0),
        piece('bait', 'chariot', 'black', 0, 3),
        piece('guard', 'pawn', 'black', 0, 4),
      ],
      'red',
    )
    const normal = chooseAiMove(state, { difficulty: 'normal' })
    const hard = chooseAiMove(state, { difficulty: 'hard' })

    expect(normal.move).toMatchObject({
      pieceId: 'rr',
      from: { file: 0, rank: 0 },
      to: { file: 0, rank: 3 },
      capturedId: 'bait',
    })
    const afterBait = applyMove(state, normal.move!)
    const punished = applyMove(afterBait, {
      pieceId: 'guard',
      from: { file: 0, rank: 4 },
      to: { file: 0, rank: 3 },
    })
    expect(
      punished.pieces.find((candidate) => candidate.id === 'rr')?.captured,
    ).toBe(true)

    expect(hard).toMatchObject({
      move: {
        pieceId: 'rr',
        from: { file: 0, rank: 0 },
        to: { file: 3, rank: 0 },
      },
      completedDepth: 2,
    })
    const afterSafe = applyMove(state, hard.move!)
    expect(afterSafe.inCheck).toBe(true)
    const forcedReplies = generateAllLegalMoves(afterSafe)
    expect(forcedReplies).toHaveLength(1)
    expect(forcedReplies[0]).toMatchObject({
      pieceId: 'bait',
      from: { file: 0, rank: 3 },
      to: { file: 3, rank: 3 },
    })
    expect(hard.principalVariation[1]).toEqual(forcedReplies[0])
    const afterReply = applyMove(afterSafe, forcedReplies[0]!)
    expect(
      afterReply.pieces.find((candidate) => candidate.id === 'rr')?.captured,
    ).not.toBe(true)
  })

  it('已终局或无合法着时返回空结果', () => {
    const terminal = applyMove(mateFixture(), {
      pieceId: 'attack',
      from: { file: 4, rank: 7 },
      to: { file: 4, rank: 8 },
    })
    expect(chooseAiMove(terminal, { difficulty: 'hard' })).toMatchObject({
      move: null,
      nodes: 0,
      completedDepth: 0,
    })

    const draw: GameState = {
      ...terminal,
      status: 'draw',
      winner: null,
      outcome: {
        reason: 'repetition-draw',
        winner: null,
        offender: null,
      },
    }
    expect(chooseAiMove(draw, { difficulty: 'hard' })).toMatchObject({
      move: null,
      score: 0,
      nodes: 0,
      completedDepth: 0,
    })

    const stalemate = game(
      [
        piece('rk', 'king', 'red', 4, 0),
        piece('bk', 'king', 'black', 4, 9),
        piece('block', 'pawn', 'red', 4, 5),
        piece('left', 'chariot', 'red', 3, 8),
        piece('right', 'chariot', 'red', 5, 8),
      ],
      'black',
    )
    expect(chooseAiMove(stalemate, { difficulty: 'normal' })).toMatchObject({
      move: null,
      score: -AI_MATE_SCORE,
      nodes: 0,
    })
  })
})

function mateFixture(): GameState {
  return game([
    piece('rk', 'king', 'red', 4, 0),
    piece('bk', 'king', 'black', 4, 9),
    piece('attack', 'chariot', 'red', 4, 7),
    piece('left', 'chariot', 'red', 3, 8),
    piece('right', 'chariot', 'red', 5, 8),
  ])
}

function piece(
  id: string,
  kind: PieceKind,
  side: Side,
  file: number,
  rank: number,
): Piece {
  return { id, kind, side, file, rank }
}

function game(pieces: Piece[], sideToMove: Side = 'red'): GameState {
  return {
    pieces,
    sideToMove,
    history: [],
    inCheck: false,
    winner: null,
    status: 'playing',
  }
}

function moveKey(move: Move): string {
  return `${move.pieceId}:${move.from.file},${move.from.rank}-${move.to.file},${move.to.rank}`
}
