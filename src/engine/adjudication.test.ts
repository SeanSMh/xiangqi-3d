import { describe, expect, it } from 'vitest'
import type {
  GameState,
  Move,
  MoveRecord,
  Piece,
  PieceKind,
  Side,
} from '../types/xiangqi'
import { chooseAiMove } from '../ai/search'
import { GameTimeline } from '../game/timeline'
import {
  advanceRuleState,
  createRuleState,
  emptyChases,
  evaluateAdjudication,
  positionKey,
} from './adjudication'
import { pieceAt } from './board'
import { analyzeChases, applyMove, isInCheck } from './moves'

describe('程序棋规局面签名', () => {
  it('忽略棋子 id 与数组顺序，但包含当前行棋方', () => {
    const pieces = [
      piece('red-rook-a', 'chariot', 'red', 0, 0),
      piece('red-rook-b', 'chariot', 'red', 8, 0),
      piece('rk', 'king', 'red', 4, 0),
      piece('bk', 'king', 'black', 3, 9),
      { ...piece('gone', 'pawn', 'black', 0, 6), captured: true },
    ]
    const renamedAndReordered = [...pieces]
      .reverse()
      .map((candidate, index) => ({ ...candidate, id: `other-${index}` }))

    expect(positionKey(pieces, 'red')).toBe(
      positionKey(renamedAndReordered, 'red'),
    )
    expect(positionKey(pieces, 'red')).not.toBe(positionKey(pieces, 'black'))
  })
})

describe('三次同形与循环责任', () => {
  it('同类棋子互相攻击按兑处理，不记为捉', () => {
    const pieces = [
      piece('rk', 'king', 'red', 4, 0),
      piece('bk', 'king', 'black', 3, 9),
      piece('red-cannon', 'cannon', 'red', 0, 2),
      piece('screen', 'advisor', 'red', 0, 3),
      piece('black-cannon', 'cannon', 'black', 0, 5),
    ]
    const threats = analyzeChases(pieces)
    expect(threats.red).not.toContainEqual({
      attackerId: 'red-cannon',
      targetId: 'black-cannon',
    })
    expect(threats.black).not.toContainEqual({
      attackerId: 'black-cannon',
      targetId: 'red-cannon',
    })
  })

  it('第二次同形继续对局，第三次允许循环判和', () => {
    const state = fromFen(
      '4k4/9/2c2an2/4c4/6R2/9/9/4B4/4A4/3K1AB2 w',
    )
    const cycle = ['g5e5', 'f7e8', 'e5g5', 'e8f7']
    const twice = play(state, cycle)
    expect(twice).toMatchObject({
      status: 'playing',
      winner: null,
      ruleState: { currentPositionOccurrences: 2 },
    })

    const third = play(twice, cycle)
    expect(third).toMatchObject({
      status: 'draw',
      winner: null,
      outcome: {
        reason: 'repetition-draw',
        offender: null,
        cycle: { red: 'allowed', black: 'allowed', periodPlies: 4 },
      },
    })
  })

  it('连续长将方在第三次同形时判负', () => {
    const state = fromFen('3k5/2R6/9/9/9/9/9/9/6r2/4K1N2 w')
    const beforeFinal = play(state, [
      'c8c9',
      'd9d8',
      'c9c8',
      'd8d9',
      'c8c9',
      'd9d8',
      'c9c8',
    ])
    // 同时达到自然限着时，循环责任裁决优先。
    beforeFinal.ruleState!.naturalLimit.countedPlies = 119
    const terminal = applyMove(beforeFinal, parseMove(beforeFinal, 'd8d9'))

    expect(terminal).toMatchObject({
      status: 'adjudicated',
      winner: 'black',
      outcome: {
        reason: 'perpetual-check',
        offender: 'red',
        cycle: { red: 'long-check', black: 'allowed' },
      },
    })
  })

  it('长捉同一目标且对方每着逃捉时，长捉方判负', () => {
    const state = fromFen('4k3c/9/4bn2n/8c/6R2/6P2/9/9/9/3K5 w')
    const terminal = play(state, [
      'g5i5',
      'i6f6',
      'i5g5',
      'f6i6',
      'g5i5',
      'i6f6',
      'i5g5',
      'f6i6',
    ])

    expect(terminal).toMatchObject({
      status: 'adjudicated',
      winner: 'red',
      outcome: {
        reason: 'perpetual-chase',
        offender: 'black',
        cycle: { red: 'allowed', black: 'long-chase' },
      },
    })
  })

  it('受保护目标可反吃攻击子时不算长捉', () => {
    const state = fromFen('2ba1k1r1/4a4/4b4/9/9/9/7c1/1R7/9/4K2R1 w')
    const terminal = play(state, [
      'b2b3',
      'h3h2',
      'b3b2',
      'h2h3',
      'b2b3',
      'h3h2',
      'b3b2',
      'h2h3',
    ])
    expect(terminal).toMatchObject({
      status: 'draw',
      outcome: {
        reason: 'repetition-draw',
        cycle: { red: 'allowed', black: 'allowed' },
      },
    })
  })

  it('未过河兵不是长捉目标', () => {
    const state = fromFen('5k3/9/9/p1CcC4/c8/9/9/9/9/4K4 w')
    const terminal = play(state, [
      'c6c5',
      'd6d5',
      'c5c6',
      'd5d6',
      'c6c5',
      'd6d5',
      'c5c6',
      'd5d6',
    ])
    expect(terminal).toMatchObject({
      status: 'draw',
      outcome: {
        reason: 'repetition-draw',
        cycle: { red: 'allowed', black: 'allowed' },
      },
    })
  })

  it('移动子不是攻击子时，仍能识别闪击形成的长捉', () => {
    const state = fromFen('5k3/9/9/9/9/3C5/9/4B4/3K5/2p6 w')
    const terminal = play(state, [
      'd1e1',
      'c0d0',
      'e1d1',
      'd0c0',
      'd1e1',
      'c0d0',
      'e1d1',
      'd0c0',
    ])
    expect(terminal).toMatchObject({
      status: 'adjudicated',
      winner: 'black',
      outcome: {
        reason: 'perpetual-chase',
        offender: 'red',
        cycle: { red: 'long-chase', black: 'allowed' },
      },
    })
  })

  it('双方同为长捉时违规等级相同，判和', () => {
    const state = fromFen('3a1kb2/4a4/8b/9/4n4/2R6/9/4B4/9/4K4 w')
    const cycle = [
      'c4c5',
      'e5d3',
      'c5d5',
      'd3b4',
      'd5d4',
      'b4c6',
      'd4c4',
      'c6e5',
    ]
    const terminal = play(play(state, cycle), cycle)
    expect(terminal).toMatchObject({
      status: 'draw',
      outcome: {
        reason: 'repetition-draw',
        cycle: { red: 'long-chase', black: 'long-chase' },
      },
    })
  })

  it('循环区间从实际第三次出现的局面开始，不强制从开局开始', () => {
    const state = fromFen('3a1kb2/4a4/8b/9/4n4/2R6/9/4B4/9/4K4 w')
    const terminal = play(state, [
      'c4c5',
      'e5d3',
      'c5d5',
      'd3b4',
      'd5d4',
      'b4c6',
      'd4c4',
      'c6e5',
      'c4c5',
      'e5d3',
      'c5c3',
      'd3e5',
      'c3c5',
    ])
    expect(terminal).toMatchObject({
      status: 'adjudicated',
      winner: 'black',
      outcome: {
        reason: 'perpetual-chase',
        offender: 'red',
        cycle: { startPly: 1, endPly: 13, red: 'long-chase', black: 'allowed' },
      },
    })
  })

  it('AI 不选择会立即令己方因长捉判负的第三次同形着', () => {
    const state = fromFen('4k3c/9/4bn2n/8c/6R2/6P2/9/9/9/3K5 w')
    const beforeFinal = play(state, [
      'g5i5',
      'i6f6',
      'i5g5',
      'f6i6',
      'g5i5',
      'i6f6',
      'i5g5',
    ])
    const losingMove = parseMove(beforeFinal, 'f6i6')
    expect(applyMove(beforeFinal, losingMove)).toMatchObject({
      status: 'adjudicated',
      winner: 'red',
    })

    for (const seed of [0, 1, 2, 3, 7, 11]) {
      const selected = chooseAiMove(beforeFinal, {
        difficulty: 'easy',
        seed,
      }).move
      expect(selected).not.toBeNull()
      expect(selected).not.toMatchObject({
        pieceId: losingMove.pieceId,
        from: losingMove.from,
        to: losingMove.to,
      })
    }

    for (const difficulty of ['normal', 'hard'] as const) {
      const selected = chooseAiMove(beforeFinal, { difficulty }).move
      expect(selected).not.toBeNull()
      expect(selected).not.toMatchObject({
        pieceId: losingMove.pieceId,
        from: losingMove.from,
        to: losingMove.to,
      })
    }
  })
})

describe('其他程序终局与时间线', () => {
  it('将死与困毙的棋盘终局优先于自然限着', () => {
    const state = game([
      piece('rk', 'king', 'red', 4, 0),
      piece('bk', 'king', 'black', 4, 9),
      piece('attack', 'chariot', 'red', 4, 7),
      piece('left', 'chariot', 'red', 3, 8),
      piece('right', 'chariot', 'red', 5, 8),
    ])
    state.ruleState!.naturalLimit.countedPlies = 119
    const terminal = applyMove(state, move('attack', 4, 7, 4, 8))
    expect(terminal).toMatchObject({
      status: 'checkmate',
      winner: 'red',
      outcome: { reason: 'checkmate' },
      ruleState: { naturalLimit: { countedPlies: 120 } },
    })
  })

  it('自然限着第120个有效未吃子步判和', () => {
    const state = game([
      piece('rk', 'king', 'red', 4, 0),
      piece('bk', 'king', 'black', 3, 9),
      piece('rook', 'chariot', 'red', 0, 0),
    ])
    state.ruleState!.naturalLimit.countedPlies = 119
    const next = applyMove(state, move('rook', 0, 0, 0, 1))
    expect(next).toMatchObject({
      status: 'draw',
      outcome: { reason: 'no-capture-limit', winner: null },
      ruleState: { naturalLimit: { countedPlies: 120 } },
    })
  })

  it('吃子后清空自然限着计数与循环窗口', () => {
    const state = game([
      piece('rk', 'king', 'red', 4, 0),
      piece('bk', 'king', 'black', 3, 9),
      piece('red-rook', 'chariot', 'red', 0, 0),
      piece('target', 'pawn', 'black', 0, 2),
      piece('black-rook', 'chariot', 'black', 8, 9),
    ])
    state.ruleState!.naturalLimit = {
      countedPlies: 119,
      checkCounts: { red: 10, black: 7 },
      skipNextReply: true,
    }
    state.ruleState!.frames.push({
      ...state.ruleState!.frames[0]!,
      ply: 2,
    })
    state.ruleState!.currentPositionOccurrences = 2

    const next = applyMove(state, move('red-rook', 0, 0, 0, 2))
    expect(next).toMatchObject({
      status: 'playing',
      ruleState: {
        currentPositionOccurrences: 1,
        naturalLimit: {
          countedPlies: 0,
          checkCounts: { red: 0, black: 0 },
          skipNextReply: false,
        },
      },
    })
    expect(next.ruleState?.frames).toHaveLength(1)
  })

  it('第11次及之后的将军和直接应将均不计入自然限着', () => {
    const state = game([
      piece('rk', 'king', 'red', 4, 0),
      piece('bk', 'king', 'black', 3, 9),
      piece('rook', 'chariot', 'red', 0, 0),
    ])
    state.ruleState!.naturalLimit = {
      countedPlies: 42,
      checkCounts: { red: 10, black: 0 },
      skipNextReply: false,
    }
    const checking: MoveRecord = {
      ...move('rook', 0, 0, 0, 1),
      side: 'red',
      givesCheck: true,
    }
    const afterCheck = advanceRuleState(
      state,
      state.pieces,
      'black',
      checking,
      emptyChases(),
    )
    expect(afterCheck.naturalLimit).toEqual({
      countedPlies: 42,
      checkCounts: { red: 11, black: 0 },
      skipNextReply: true,
    })

    const replyState: GameState = {
      ...state,
      sideToMove: 'black',
      history: [checking],
      ruleState: afterCheck,
    }
    const reply: MoveRecord = {
      ...move('bk', 3, 9, 4, 9),
      side: 'black',
      givesCheck: false,
    }
    const afterReply = advanceRuleState(
      replyState,
      replyState.pieces,
      'red',
      reply,
      emptyChases(),
    )
    expect(afterReply.naturalLimit).toEqual({
      countedPlies: 42,
      checkCounts: { red: 11, black: 0 },
      skipNextReply: false,
    })
  })

  it('只剩将士象时判和', () => {
    const state = game([
      piece('rk', 'king', 'red', 4, 0),
      piece('ra', 'advisor', 'red', 3, 0),
      piece('bk', 'king', 'black', 3, 9),
      piece('be', 'elephant', 'black', 2, 9),
    ])
    expect(evaluateAdjudication(state)).toMatchObject({
      reason: 'bare-defenders',
      winner: null,
    })
  })

  it('循环裁决着可由 Timeline 悔棋恢复为 playing', () => {
    const root = fromFen('3k5/2R6/9/9/9/9/9/9/6r2/4K1N2 w')
    const timeline = new GameTimeline(root)
    const sequence = [
      'c8c9',
      'd9d8',
      'c9c8',
      'd8d9',
      'c8c9',
      'd9d8',
      'c9c8',
      'd8d9',
    ]
    for (const notation of sequence) {
      timeline.commitMove(parseMove(timeline.getLiveState(), notation))
    }
    expect(timeline.getLiveState().status).toBe('adjudicated')
    expect(timeline.undo()).toBe(true)
    expect(timeline.getLiveState()).toMatchObject({
      status: 'playing',
      outcome: null,
      ruleState: { currentPositionOccurrences: 2 },
    })
  })
})

function fromFen(fen: string): GameState {
  const [placement, turn] = fen.trim().split(/\s+/)
  if (!placement || !turn) throw new Error(`无效 FEN：${fen}`)
  const rows = placement.split('/')
  if (rows.length !== 10) throw new Error(`无效 FEN 行数：${fen}`)
  const pieces: Piece[] = []
  let id = 0
  const kinds: Record<string, PieceKind> = {
    k: 'king',
    a: 'advisor',
    b: 'elephant',
    n: 'horse',
    r: 'chariot',
    c: 'cannon',
    p: 'pawn',
  }
  rows.forEach((row, rowIndex) => {
    let file = 0
    for (const token of row) {
      if (/\d/.test(token)) {
        file += Number(token)
        continue
      }
      const kind = kinds[token.toLowerCase()]
      if (!kind) throw new Error(`未知 FEN 棋子：${token}`)
      pieces.push({
        id: `fen-${++id}`,
        kind,
        side: token === token.toUpperCase() ? 'red' : 'black',
        file,
        rank: 9 - rowIndex,
      })
      file += 1
    }
    if (file !== 9) throw new Error(`无效 FEN 宽度：${row}`)
  })
  return game(pieces, turn === 'w' ? 'red' : 'black')
}

function play(state: GameState, sequence: string[]): GameState {
  return sequence.reduce(
    (current, notation) => applyMove(current, parseMove(current, notation)),
    state,
  )
}

function parseMove(state: GameState, notation: string): Move {
  if (!/^[a-i][0-9][a-i][0-9]$/.test(notation)) {
    throw new Error(`无效 UCCI 着法：${notation}`)
  }
  const fromFile = notation.charCodeAt(0) - 97
  const fromRank = Number(notation[1])
  const toFile = notation.charCodeAt(2) - 97
  const toRank = Number(notation[3])
  const moving = pieceAt(state.pieces, fromFile, fromRank)
  if (!moving) throw new Error(`起点没有棋子：${notation}`)
  const captured = pieceAt(state.pieces, toFile, toRank)
  return {
    pieceId: moving.id,
    from: { file: fromFile, rank: fromRank },
    to: { file: toFile, rank: toRank },
    ...(captured ? { capturedId: captured.id } : {}),
  }
}

function game(pieces: Piece[], sideToMove: Side = 'red'): GameState {
  return {
    pieces,
    sideToMove,
    history: [],
    inCheck: isInCheck(pieces, sideToMove),
    winner: null,
    status: 'playing',
    outcome: null,
    ruleState: createRuleState(pieces, sideToMove),
  }
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

function move(
  pieceId: string,
  fromFile: number,
  fromRank: number,
  toFile: number,
  toRank: number,
): Move {
  return {
    pieceId,
    from: { file: fromFile, rank: fromRank },
    to: { file: toFile, rank: toRank },
  }
}
