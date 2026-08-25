import { describe, expect, it } from 'vitest'
import type { Move, Piece, PieceKind, Side } from '../types/xiangqi'
import { createInitialState } from './board'
import {
  buildOccupancy,
  isSquareAttackedBy,
  kingsFaceOn,
  occupantAt,
} from './attacks'
import {
  applyKnownLegalMove,
  generateAllLegalMoves,
  generateLegalMovesForSide,
  generatePseudoLegalMoves,
  isInCheck,
  kingsFace,
  simulateMove,
} from './moves'

function moveKey(move: Move): string {
  const from = `${move.from.file}${move.from.rank}`
  const to = `${move.to.file}${move.to.rank}`
  return `${move.pieceId}:${from}-${to}:${move.capturedId ?? ''}`
}

/**
 * 攻击反查必须与「摊开敌方全部伪合法着」逐格同义。
 *
 * 这条等价性是后续所有规则层性能改动的地基：只要它成立，
 * 就可以放心把慢的那条路径整段换掉，而不必逐个裁决场景重新验证。
 * 因此参照实现直接用 `generatePseudoLegalMoves`（未被改动的那一份），
 * 而不是把新写法抄一遍。
 */
function referenceAttacks(
  pieces: Piece[],
  bySide: Side,
  file: number,
  rank: number,
): boolean {
  return pieces.some(
    (piece) =>
      piece.side === bySide &&
      !piece.captured &&
      generatePseudoLegalMoves(pieces, piece).some(
        (move) => move.to.file === file && move.to.rank === rank,
      ),
  )
}

function referenceKingsFace(pieces: Piece[]): boolean {
  const red = pieces.find(
    (piece) => piece.kind === 'king' && piece.side === 'red' && !piece.captured,
  )
  const black = pieces.find(
    (piece) =>
      piece.kind === 'king' && piece.side === 'black' && !piece.captured,
  )
  if (!red || !black || red.file !== black.file) return false
  const minRank = Math.min(red.rank, black.rank)
  const maxRank = Math.max(red.rank, black.rank)
  return !pieces.some(
    (piece) =>
      !piece.captured &&
      piece.kind !== 'king' &&
      piece.file === red.file &&
      piece.rank > minRank &&
      piece.rank < maxRank,
  )
}

function referenceInCheck(pieces: Piece[], side: Side): boolean {
  const king = pieces.find(
    (piece) => piece.kind === 'king' && piece.side === side && !piece.captured,
  )
  if (!king) return true
  if (referenceKingsFace(pieces)) return true
  return referenceAttacks(
    pieces,
    side === 'red' ? 'black' : 'red',
    king.file,
    king.rank,
  )
}

/** 固定种子 PRNG：失败可复现，不受运行顺序影响。 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** 沿随机合法着走一局，沿途收集真实可达局面。 */
function playoutPositions(seed: number, plies: number): Piece[][] {
  const random = createRandom(seed)
  const positions: Piece[][] = []
  let state = createInitialState()
  for (let ply = 0; ply < plies; ply += 1) {
    positions.push(state.pieces)
    if (state.status !== 'playing') break
    const moves = generateAllLegalMoves(state)
    if (moves.length === 0) break
    const move = moves[Math.floor(random() * moves.length)]!
    state = applyKnownLegalMove(state, move)
  }
  return positions
}

const ALL_KINDS: readonly PieceKind[] = [
  'king',
  'advisor',
  'elephant',
  'horse',
  'chariot',
  'cannon',
  'pawn',
]

/**
 * 散布局面：棋子被丢到棋盘任意位置，包括士出宫、象过河、兵倒退等
 * 实战不可能出现的摆法。这类局面照样会经过规则层（悔棋分支、AI 叶节点、
 * 捉子分析里的假想吃子），而且专挑几何判据的边界。
 */
function scatteredPosition(seed: number): Piece[] {
  const random = createRandom(seed)
  const used = new Set<number>()
  const pieces: Piece[] = []
  const count = 4 + Math.floor(random() * 16)

  for (const side of ['red', 'black'] as const) {
    pieces.push(placePiece(pieces.length, 'king', side, random, used))
  }
  for (let index = 0; index < count; index += 1) {
    const kind = ALL_KINDS[Math.floor(random() * ALL_KINDS.length)]!
    if (kind === 'king') continue
    const side: Side = random() < 0.5 ? 'red' : 'black'
    pieces.push(placePiece(pieces.length, kind, side, random, used))
  }
  return pieces
}

function placePiece(
  index: number,
  kind: PieceKind,
  side: Side,
  random: () => number,
  used: Set<number>,
): Piece {
  let square = Math.floor(random() * 90)
  while (used.has(square)) square = (square + 1) % 90
  used.add(square)
  return {
    id: `s${index}`,
    kind,
    side,
    file: square % 9,
    rank: Math.floor(square / 9),
  }
}

function expectAttacksMatchEverywhere(pieces: Piece[], label: string): void {
  const occupancy = buildOccupancy(pieces)
  for (const bySide of ['red', 'black'] as const) {
    for (let rank = 0; rank <= 9; rank += 1) {
      for (let file = 0; file <= 8; file += 1) {
        const actual = isSquareAttackedBy(occupancy, file, rank, bySide)
        const expected = referenceAttacks(pieces, bySide, file, rank)
        if (actual !== expected) {
          throw new Error(
            `${label}: ${bySide} 对 (${file},${rank}) 的攻击判定不一致，` +
              `反查=${actual} 参照=${expected}`,
          )
        }
      }
    }
  }
}

describe('攻击反查与摊开着法等价', () => {
  it('占位表与 pieceAt 一致，且被吃子不占格', () => {
    const pieces = createInitialState().pieces
    const captured = pieces.map((piece, index) =>
      index === 0 ? { ...piece, captured: true } : piece,
    )
    const occupancy = buildOccupancy(captured)

    const removed = captured[0]!
    expect(occupantAt(occupancy, removed.file, removed.rank)).toBeUndefined()
    expect(occupantAt(occupancy, 4, 0)?.kind).toBe('king')
    expect(occupantAt(occupancy, 4, 5)).toBeUndefined()
    expect(occupantAt(occupancy, -1, 0)).toBeUndefined()
    expect(occupantAt(occupancy, 9, 10)).toBeUndefined()
  })

  it('实战局面：每一格的攻击判定都与参照一致', () => {
    const positions = [
      ...playoutPositions(0x51a1, 60),
      ...playoutPositions(0xbeef, 60),
      ...playoutPositions(0x2026, 60),
    ]
    expect(positions.length).toBeGreaterThan(100)
    positions.forEach((pieces, index) => {
      expectAttacksMatchEverywhere(pieces, `playout#${index}`)
    })
  })

  it('散布局面：士出宫、象过河、兵倒退等边界也一致', () => {
    for (let seed = 0; seed < 120; seed += 1) {
      expectAttacksMatchEverywhere(
        scatteredPosition(0x9e37 + seed),
        `scatter#${seed}`,
      )
    }
  })

  it('isInCheck 与 kingsFace 在两类局面上都与参照一致', () => {
    const positions = [
      ...playoutPositions(0x7fff, 80),
      ...Array.from({ length: 200 }, (_, seed) =>
        scatteredPosition(0x1234 + seed),
      ),
    ]
    for (const pieces of positions) {
      const occupancy = buildOccupancy(pieces)
      expect(kingsFace(pieces)).toBe(referenceKingsFace(pieces))
      expect(kingsFaceOn(occupancy, pieces)).toBe(referenceKingsFace(pieces))
      for (const side of ['red', 'black'] as const) {
        expect(isInCheck(pieces, side)).toBe(referenceInCheck(pieces, side))
      }
    }
  })

  it('合法着法与「克隆整副棋子再判将」的旧写法逐条一致', () => {
    // 合法性筛选改成了在同一张占位表上落子—判断—还原。这是整轮改动里最容易
    // 出错的一步：还原漏一格、或攻击判定读到棋子对象上的**旧坐标**，
    // 都会让个别着法凭空出现或消失。因此直接对着旧写法逐条比。
    const referenceLegalMoves = (pieces: Piece[], side: Side): string[] =>
      pieces
        .filter((piece) => piece.side === side && !piece.captured)
        .flatMap((piece) =>
          generatePseudoLegalMoves(pieces, piece).filter((move) => {
            const captured = move.capturedId
              ? pieces.find((candidate) => candidate.id === move.capturedId)
              : undefined
            if (captured?.kind === 'king') return false
            return !referenceInCheck(simulateMove(pieces, move), side)
          }),
        )
        .map(moveKey)
        .sort()

    const positions = [
      ...playoutPositions(0x3141, 80),
      ...playoutPositions(0xc0de, 80),
      ...Array.from({ length: 150 }, (_, seed) =>
        scatteredPosition(0x5150 + seed),
      ),
    ]
    for (const pieces of positions) {
      for (const side of ['red', 'black'] as const) {
        const actual = generateLegalMovesForSide(pieces, side)
        expect(actual.map(moveKey).sort()).toEqual(
          referenceLegalMoves(pieces, side),
        )
      }
    }
  })

  it('缺将视为被将，与原实现一致', () => {
    const pieces = createInitialState().pieces.filter(
      (piece) => !(piece.kind === 'king' && piece.side === 'red'),
    )
    expect(isInCheck(pieces, 'red')).toBe(true)
    expect(isInCheck(pieces, 'red')).toBe(referenceInCheck(pieces, 'red'))
  })
})
