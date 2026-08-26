import { oppositeSide } from '../engine/board'
import { positionKey } from '../engine/adjudication'
import {
  applyKnownLegalMove,
  generateAllLegalMoves,
  hasAnyLegalMove,
} from '../engine/moves'
import type {
  GameState,
  Move,
  Piece,
  PieceKind,
  Side,
} from '../types/xiangqi'
import type {
  ComputerDifficulty,
  ComputerSearchOptions,
  ComputerSearchResult,
} from './types'

export const COMPUTER_MATE_SCORE = 1_000_000

const DEFAULT_NODE_BUDGET: Record<ComputerDifficulty, number> = {
  easy: 500,
  normal: 2_000,
  hard: 8_000,
}

const PIECE_VALUES: Record<PieceKind, number> = {
  king: 0,
  advisor: 200,
  elephant: 200,
  horse: 400,
  chariot: 900,
  cannon: 450,
  pawn: 100,
}

interface Candidate {
  move: Move
  score: number
  principalVariation: Move[]
  fullDepth: boolean
}

interface SearchContext {
  rootSide: Side
  maxNodes: number
  nodes: number
}

interface RootCandidate {
  move: Move
  state: GameState
  shallow: Candidate
}

/**
 * 为当前行棋方选择一步棋。搜索节点只使用轻量局面转换，最终落子仍需
 * 由 GameController / applyMove 再次权威校验。
 */
export function chooseComputerMove(
  state: GameState,
  options: ComputerSearchOptions,
): ComputerSearchResult {
  const rootSide = state.sideToMove
  if (state.status !== 'playing') {
    return emptyResult(terminalScore(state.winner, rootSide, 0))
  }

  const legalMoves = orderMoves(state, generateAllLegalMoves(state))
  if (legalMoves.length === 0) {
    return emptyResult(-COMPUTER_MATE_SCORE)
  }

  const requestedMaxNodes = options.maxNodes
  const maxNodes =
    requestedMaxNodes !== undefined &&
    Number.isFinite(requestedMaxNodes) &&
    requestedMaxNodes > 0
      ? Math.floor(requestedMaxNodes)
      : DEFAULT_NODE_BUDGET[options.difficulty]
  const context: SearchContext = {
    rootSide,
    // 至少完整看完每个根着法；更小的预算只限制第二层。
    maxNodes: Math.max(maxNodes, legalMoves.length),
    nodes: 0,
  }

  const roots: RootCandidate[] = []
  for (const move of legalMoves) {
    const next = applySearchMove(state, move, 'if-repeated')
    context.nodes += 1
    roots.push({
      move,
      state: next,
      shallow: scoreShallowCandidate(
        next,
        move,
        context,
        options.difficulty === 'hard' ? 'normal' : options.difficulty,
      ),
    })
  }

  let candidates = roots.map((root) => root.shallow)
  let completedDepth = 1
  if (options.difficulty === 'hard') {
    const deepCandidates: Candidate[] = []
    for (const root of roots) {
      const candidate = scoreHardCandidate(root.state, root.move, context)
      if (!candidate.fullDepth) break
      deepCandidates.push(candidate)
    }
    // 只有整轮第二层都完成时才采用深层分数，禁止混合深度排序。
    if (deepCandidates.length === roots.length) {
      candidates = deepCandidates
      completedDepth = 2
    }
  }

  candidates.sort(compareCandidates)
  const selected =
    options.difficulty === 'easy'
      ? selectEasyCandidate(candidates, state, options.seed)
      : candidates[0]

  if (!selected) return emptyResult(-COMPUTER_MATE_SCORE)
  return {
    move: cloneMove(selected.move),
    score: selected.score,
    completedDepth,
    nodes: context.nodes,
    principalVariation: selected.principalVariation.map(cloneMove),
  }
}

function scoreShallowCandidate(
  state: GameState,
  move: Move,
  context: SearchContext,
  difficulty: Exclude<ComputerDifficulty, 'hard'>,
): Candidate {
  if (state.status !== 'playing') {
    return {
      move,
      score: terminalScore(state.winner, context.rootSide, 1),
      principalVariation: [move],
      fullDepth: true,
    }
  }
  let score = evaluatePosition(state, context.rootSide)

  if (difficulty === 'normal') {
    const replies = generateAllLegalMoves(state)
    if (replies.length === 0) {
      score = terminalScore(oppositeSide(state.sideToMove), context.rootSide, 1)
    } else {
      score -= replies.length * 0.15
    }
  } else if (!hasAnyLegalMove(state)) {
    score = terminalScore(oppositeSide(state.sideToMove), context.rootSide, 1)
  }

  return {
    move,
    score,
    principalVariation: [move],
    fullDepth: true,
  }
}

function scoreHardCandidate(
  state: GameState,
  move: Move,
  context: SearchContext,
): Candidate {
  if (state.status !== 'playing') {
    return {
      move,
      score: terminalScore(state.winner, context.rootSide, 1),
      principalVariation: [move],
      fullDepth: true,
    }
  }
  const replies = orderMoves(state, generateAllLegalMoves(state))
  if (replies.length === 0) {
    return {
      move,
      score: terminalScore(oppositeSide(state.sideToMove), context.rootSide, 1),
      principalVariation: [move],
      fullDepth: true,
    }
  }

  let worstScore = Number.POSITIVE_INFINITY
  let worstReply: Move | null = null
  let fullDepth = true
  for (const reply of replies) {
    if (context.nodes >= context.maxNodes) {
      fullDepth = false
      break
    }
    const leaf = applySearchMove(state, reply, 'if-third')
    context.nodes += 1
    let score =
      leaf.status === 'playing'
        ? evaluatePosition(leaf, context.rootSide)
        : terminalScore(leaf.winner, context.rootSide, 2)

    // 中国象棋将死与困毙均为当前方失败；短路探测避免枚举整棵下一层。
    if (leaf.status === 'playing' && !hasAnyLegalMove(leaf)) {
      score = terminalScore(
        oppositeSide(leaf.sideToMove),
        context.rootSide,
        2,
      )
    }

    if (
      score < worstScore ||
      (score === worstScore &&
        worstReply !== null &&
        moveKey(reply) < moveKey(worstReply))
    ) {
      worstScore = score
      worstReply = reply
    }
  }

  if (worstReply === null) {
    worstScore = evaluatePosition(state, context.rootSide)
  }
  return {
    move,
    score: worstScore,
    principalVariation: worstReply ? [move, worstReply] : [move],
    fullDepth,
  }
}

function applySearchMove(
  state: GameState,
  move: Move,
  chaseAnalysis: 'if-repeated' | 'if-third',
): GameState {
  return applyKnownLegalMove(state, move, {
    chaseAnalysis,
    deferBoardTerminal: true,
  })
}

function evaluatePosition(state: GameState, rootSide: Side): number {
  let score = 0
  for (const piece of state.pieces) {
    if (piece.captured) continue
    const sign = piece.side === rootSide ? 1 : -1
    score += sign * (PIECE_VALUES[piece.kind] + positionalValue(piece))
  }
  if (state.inCheck) {
    score += state.sideToMove === rootSide ? -45 : 45
  }
  return score
}

function positionalValue(piece: Piece): number {
  const center = 4 - Math.abs(piece.file - 4)
  switch (piece.kind) {
    case 'pawn': {
      const advance = piece.side === 'red' ? piece.rank : 9 - piece.rank
      const crossedRiver = piece.side === 'red' ? piece.rank >= 5 : piece.rank <= 4
      return advance * 6 + (crossedRiver ? 22 : 0) + center * 2
    }
    case 'horse':
      return center * 7
    case 'cannon':
      return center * 4
    case 'chariot':
      return center * 2
    case 'king':
    case 'advisor':
    case 'elephant':
      return 0
  }
}

function orderMoves(state: GameState, moves: Move[]): Move[] {
  return [...moves].sort((left, right) => {
    const tactical = moveOrderScore(state, right) - moveOrderScore(state, left)
    return tactical || moveKey(left).localeCompare(moveKey(right))
  })
}

function moveOrderScore(state: GameState, move: Move): number {
  const moving = state.pieces.find((piece) => piece.id === move.pieceId)
  const captured = move.capturedId
    ? state.pieces.find((piece) => piece.id === move.capturedId)
    : undefined
  const captureScore = captured
    ? PIECE_VALUES[captured.kind] * 16 - PIECE_VALUES[moving?.kind ?? 'pawn']
    : 0
  const center = 4 - Math.abs(move.to.file - 4)
  return captureScore + center
}

function selectEasyCandidate(
  candidates: Candidate[],
  state: GameState,
  explicitSeed: number | undefined,
): Candidate | undefined {
  const mate = candidates.find((candidate) => candidate.score >= COMPUTER_MATE_SCORE - 8)
  if (mate) return mate
  const nonLosing = candidates.filter(
    (candidate) => candidate.score > -COMPUTER_MATE_SCORE + 8,
  )
  const source = nonLosing.length > 0 ? nonLosing : candidates
  const pool = source.slice(0, Math.min(4, source.length))
  if (pool.length === 0) return undefined
  const seed = mixSeed(explicitSeed ?? 0x9e3779b9, hashPosition(state))
  return pool[seed % pool.length]
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return right.score - left.score || moveKey(left.move).localeCompare(moveKey(right.move))
}

function terminalScore(winner: Side | null, rootSide: Side, ply: number): number {
  if (!winner) return 0
  return winner === rootSide ? COMPUTER_MATE_SCORE - ply : -COMPUTER_MATE_SCORE + ply
}

function emptyResult(score: number): ComputerSearchResult {
  return {
    move: null,
    score,
    completedDepth: 0,
    nodes: 0,
    principalVariation: [],
  }
}

function moveKey(move: Move): string {
  return `${move.pieceId}:${move.from.file}${move.from.rank}-${move.to.file}${move.to.rank}`
}

function cloneMove(move: Move): Move {
  return {
    ...move,
    from: { ...move.from },
    to: { ...move.to },
  }
}

function hashPosition(state: GameState): number {
  const canonical = positionKey(state.pieces, state.sideToMove)
  let hash = 0x811c9dc5
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function mixSeed(seed: number, positionHash: number): number {
  let value = (seed ^ positionHash) >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return value >>> 0
}
