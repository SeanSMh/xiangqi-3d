import type {
  BoardCoord,
  ChaseThreat,
  GameState,
  Move,
  MoveRecord,
  Piece,
  Side,
} from '../types/xiangqi'
import { oppositeSide, pieceAt } from './board'
import {
  advanceRuleState,
  emptyChases,
  evaluateAdjudication,
  nextPositionOccurrenceCount,
} from './adjudication'

const ORTHOGONAL_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

const HORSE_STEPS = [
  [1, 2],
  [-1, 2],
  [1, -2],
  [-1, -2],
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
] as const

const ELEPHANT_STEPS = [
  [2, 2],
  [-2, 2],
  [2, -2],
  [-2, -2],
] as const

const ADVISOR_STEPS = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
] as const

export function isInsideBoard(file: number, rank: number): boolean {
  return file >= 0 && file <= 8 && rank >= 0 && rank <= 9
}

function isInsidePalace(side: Side, file: number, rank: number): boolean {
  if (file < 3 || file > 5) return false
  return side === 'red' ? rank >= 0 && rank <= 2 : rank >= 7 && rank <= 9
}

function moveFor(piece: Piece, to: BoardCoord, capturedId?: string): Move {
  return {
    pieceId: piece.id,
    from: { file: piece.file, rank: piece.rank },
    to,
    ...(capturedId ? { capturedId } : {}),
  }
}

function addStepMove(
  moves: Move[],
  pieces: Piece[],
  piece: Piece,
  file: number,
  rank: number,
): void {
  if (!isInsideBoard(file, rank)) return
  const target = pieceAt(pieces, file, rank)
  if (!target) {
    moves.push(moveFor(piece, { file, rank }))
  } else if (target.side !== piece.side) {
    moves.push(moveFor(piece, { file, rank }, target.id))
  }
}

function generateChariotMoves(pieces: Piece[], piece: Piece): Move[] {
  const moves: Move[] = []
  for (const [df, dr] of ORTHOGONAL_DIRECTIONS) {
    let file = piece.file + df
    let rank = piece.rank + dr
    while (isInsideBoard(file, rank)) {
      const target = pieceAt(pieces, file, rank)
      if (!target) {
        moves.push(moveFor(piece, { file, rank }))
      } else {
        if (target.side !== piece.side) {
          moves.push(moveFor(piece, { file, rank }, target.id))
        }
        break
      }
      file += df
      rank += dr
    }
  }
  return moves
}

function generateCannonMoves(pieces: Piece[], piece: Piece): Move[] {
  const moves: Move[] = []
  for (const [df, dr] of ORTHOGONAL_DIRECTIONS) {
    let file = piece.file + df
    let rank = piece.rank + dr
    let crossedScreen = false

    while (isInsideBoard(file, rank)) {
      const target = pieceAt(pieces, file, rank)
      if (!crossedScreen) {
        if (!target) {
          moves.push(moveFor(piece, { file, rank }))
        } else {
          crossedScreen = true
        }
      } else if (target) {
        if (target.side !== piece.side) {
          moves.push(moveFor(piece, { file, rank }, target.id))
        }
        break
      }

      file += df
      rank += dr
    }
  }
  return moves
}

function generateHorseMoves(pieces: Piece[], piece: Piece): Move[] {
  const moves: Move[] = []
  for (const [df, dr] of HORSE_STEPS) {
    const legFile = piece.file + (Math.abs(df) === 2 ? Math.sign(df) : 0)
    const legRank = piece.rank + (Math.abs(dr) === 2 ? Math.sign(dr) : 0)
    if (pieceAt(pieces, legFile, legRank)) continue
    addStepMove(moves, pieces, piece, piece.file + df, piece.rank + dr)
  }
  return moves
}

function generateElephantMoves(pieces: Piece[], piece: Piece): Move[] {
  const moves: Move[] = []
  for (const [df, dr] of ELEPHANT_STEPS) {
    const file = piece.file + df
    const rank = piece.rank + dr
    if (!isInsideBoard(file, rank)) continue
    if (piece.side === 'red' ? rank > 4 : rank < 5) continue
    if (pieceAt(pieces, piece.file + df / 2, piece.rank + dr / 2)) continue
    addStepMove(moves, pieces, piece, file, rank)
  }
  return moves
}

function generateAdvisorMoves(pieces: Piece[], piece: Piece): Move[] {
  const moves: Move[] = []
  for (const [df, dr] of ADVISOR_STEPS) {
    const file = piece.file + df
    const rank = piece.rank + dr
    if (isInsidePalace(piece.side, file, rank)) {
      addStepMove(moves, pieces, piece, file, rank)
    }
  }
  return moves
}

function generateKingMoves(pieces: Piece[], piece: Piece): Move[] {
  const moves: Move[] = []
  for (const [df, dr] of ORTHOGONAL_DIRECTIONS) {
    const file = piece.file + df
    const rank = piece.rank + dr
    if (isInsidePalace(piece.side, file, rank)) {
      addStepMove(moves, pieces, piece, file, rank)
    }
  }
  return moves
}

function generatePawnMoves(pieces: Piece[], piece: Piece): Move[] {
  const moves: Move[] = []
  const forward = piece.side === 'red' ? 1 : -1
  addStepMove(moves, pieces, piece, piece.file, piece.rank + forward)

  const crossedRiver = piece.side === 'red' ? piece.rank >= 5 : piece.rank <= 4
  if (crossedRiver) {
    addStepMove(moves, pieces, piece, piece.file - 1, piece.rank)
    addStepMove(moves, pieces, piece, piece.file + 1, piece.rank)
  }
  return moves
}

/** 生成棋子的伪合法着，不过滤己方被将军。 */
export function generatePseudoLegalMoves(pieces: Piece[], piece: Piece): Move[] {
  if (piece.captured) return []
  switch (piece.kind) {
    case 'chariot':
      return generateChariotMoves(pieces, piece)
    case 'cannon':
      return generateCannonMoves(pieces, piece)
    case 'horse':
      return generateHorseMoves(pieces, piece)
    case 'elephant':
      return generateElephantMoves(pieces, piece)
    case 'advisor':
      return generateAdvisorMoves(pieces, piece)
    case 'king':
      return generateKingMoves(pieces, piece)
    case 'pawn':
      return generatePawnMoves(pieces, piece)
  }
}

export function simulateMove(pieces: Piece[], move: Move): Piece[] {
  return pieces.map((piece) => {
    if (piece.id === move.pieceId) {
      return { ...piece, file: move.to.file, rank: move.to.rank }
    }
    if (piece.id === move.capturedId) {
      return { ...piece, captured: true }
    }
    return { ...piece }
  })
}

export function kingsFace(pieces: Piece[]): boolean {
  const redKing = pieces.find((piece) => piece.kind === 'king' && piece.side === 'red' && !piece.captured)
  const blackKing = pieces.find((piece) => piece.kind === 'king' && piece.side === 'black' && !piece.captured)
  if (!redKing || !blackKing || redKing.file !== blackKing.file) return false

  const minRank = Math.min(redKing.rank, blackKing.rank)
  const maxRank = Math.max(redKing.rank, blackKing.rank)
  return !pieces.some(
    (piece) =>
      !piece.captured &&
      piece.kind !== 'king' &&
      piece.file === redKing.file &&
      piece.rank > minRank &&
      piece.rank < maxRank,
  )
}

export function isInCheck(pieces: Piece[], side: Side): boolean {
  const king = pieces.find(
    (piece) => piece.kind === 'king' && piece.side === side && !piece.captured,
  )
  if (!king) return true
  if (kingsFace(pieces)) return true

  return pieces.some(
    (piece) =>
      piece.side !== side &&
      !piece.captured &&
      generatePseudoLegalMoves(pieces, piece).some(
        (move) => move.to.file === king.file && move.to.rank === king.rank,
      ),
  )
}

/** 生成当前行棋方某枚棋子的完整合法着。 */
export function generateLegalMoves(state: GameState, piece: Piece): Move[] {
  const currentPiece = state.pieces.find(
    (candidate) => candidate.id === piece.id,
  )
  if (
    state.status !== 'playing' ||
    !currentPiece ||
    currentPiece.captured ||
    currentPiece.side !== state.sideToMove
  ) {
    return []
  }

  return generateLegalMovesForPiece(state.pieces, currentPiece)
}

function generateLegalMovesForPiece(pieces: Piece[], piece: Piece): Move[] {
  return generatePseudoLegalMoves(pieces, piece).filter((move) => {
    const captured = move.capturedId
      ? pieces.find((candidate) => candidate.id === move.capturedId)
      : undefined
    if (captured?.kind === 'king') return false
    return !isInCheck(simulateMove(pieces, move), piece.side)
  })
}

/** 无视实际轮次，为规则分析生成某方的完整合法着。 */
export function generateLegalMovesForSide(
  pieces: Piece[],
  side: Side,
): Move[] {
  return pieces.flatMap((piece) =>
    piece.side === side && !piece.captured
      ? generateLegalMovesForPiece(pieces, piece)
      : [],
  )
}

export function generateAllLegalMoves(state: GameState): Move[] {
  if (state.status !== 'playing') return []
  return state.pieces.flatMap((piece) =>
    piece.side === state.sideToMove && !piece.captured
      ? generateLegalMoves(state, piece)
      : [],
  )
}

/** 终局探测用：找到首个合法着即停止，避免构造完整着法数组。 */
export function hasAnyLegalMove(state: GameState): boolean {
  if (state.status !== 'playing') return false
  return state.pieces.some(
    (piece) =>
      piece.side === state.sideToMove &&
      !piece.captured &&
      generateLegalMoves(state, piece).length > 0,
  )
}

export function evaluateGameState(state: GameState): GameState {
  if (state.status !== 'playing') return state

  const base: GameState = {
    ...state,
    inCheck: isInCheck(state.pieces, state.sideToMove),
    winner: null,
    status: 'playing',
    outcome: null,
  }
  if (hasAnyLegalMove(base)) return base

  const winner = oppositeSide(base.sideToMove)
  const status = base.inCheck ? 'checkmate' : 'stalemate'
  return {
    ...base,
    winner,
    status,
    outcome: {
      reason: status,
      winner,
      offender: base.sideToMove,
    },
  }
}

function sameDestination(move: Move, candidate: Move): boolean {
  return (
    move.pieceId === candidate.pieceId &&
    move.from.file === candidate.from.file &&
    move.from.rank === candidate.from.rank &&
    move.to.file === candidate.to.file &&
    move.to.rank === candidate.to.rank
  )
}

/** 校验并执行一步，返回新的不可变局面。 */
export function applyMove(state: GameState, requestedMove: Move): GameState {
  if (state.status !== 'playing') {
    throw new Error('游戏已经结束')
  }
  const piece = state.pieces.find((candidate) => candidate.id === requestedMove.pieceId)
  if (!piece || piece.captured) {
    throw new Error(`找不到可移动棋子：${requestedMove.pieceId}`)
  }

  const move = generateLegalMoves(state, piece).find((candidate) =>
    sameDestination(requestedMove, candidate),
  )
  if (!move) {
    throw new Error('非法着法')
  }

  return applyKnownLegalMove(state, move)
}

export interface ApplyKnownLegalMoveOptions {
  /** AI 叶节点只在即将第三次同形时支付长捉分析成本。 */
  chaseAnalysis?: 'always' | 'if-repeated' | 'if-third'
  /** 搜索评分本身会探测无合法着；无规则终局时可延后该遍历。 */
  deferBoardTerminal?: boolean
}

/**
 * 执行已经由 generateLegalMoves 产生的规范着法。AI 可复用该转换，避免
 * 搜索层自行拼装不完整 GameState；外部玩家输入仍应使用 applyMove。
 */
export function applyKnownLegalMove(
  state: GameState,
  move: Move,
  options: ApplyKnownLegalMoveOptions = {},
): GameState {
  if (state.status !== 'playing') {
    throw new Error('游戏已经结束')
  }

  const pieces = simulateMove(state.pieces, move)
  const sideToMove = oppositeSide(state.sideToMove)
  const givesCheck = isInCheck(pieces, sideToMove)
  const record: MoveRecord = {
    ...move,
    side: state.sideToMove,
    givesCheck,
  }

  const candidate: GameState = {
    pieces,
    sideToMove,
    history: [...state.history, record],
    inCheck: givesCheck,
    winner: null,
    status: 'playing',
    outcome: null,
    ruleState: state.ruleState,
  }
  const boardResult = options.deferBoardTerminal
    ? candidate
    : evaluateGameState(candidate)

  const occurrenceCount = nextPositionOccurrenceCount(
    state,
    pieces,
    sideToMove,
  )
  const chaseAnalysis = options.chaseAnalysis ?? 'always'
  const shouldAnalyzeChases =
    boardResult.status === 'playing' &&
    !givesCheck &&
    (chaseAnalysis === 'always' ||
      (chaseAnalysis === 'if-repeated' && occurrenceCount >= 2) ||
      (chaseAnalysis === 'if-third' && occurrenceCount >= 3))
  const ruleState = advanceRuleState(
    state,
    pieces,
    sideToMove,
    record,
    shouldAnalyzeChases ? analyzeChases(pieces) : emptyChases(),
  )
  const withRuleState: GameState = { ...boardResult, ruleState }
  if (withRuleState.status !== 'playing') return withRuleState

  const outcome = evaluateAdjudication(withRuleState)
  if (!outcome) return withRuleState
  if (options.deferBoardTerminal) {
    const boardTerminal = evaluateGameState(withRuleState)
    if (boardTerminal.status !== 'playing') return boardTerminal
  }
  return {
    ...withRuleState,
    status: outcome.winner ? 'adjudicated' : 'draw',
    winner: outcome.winner,
    outcome,
  }
}

/**
 * 计算程序棋规中的“捉”。此分析不调用 applyMove，避免终局裁决递归。
 */
export function analyzeChases(
  pieces: Piece[],
): Record<Side, ChaseThreat[]> {
  return {
    red: analyzeSideChases(pieces, 'red'),
    black: analyzeSideChases(pieces, 'black'),
  }
}

function analyzeSideChases(pieces: Piece[], side: Side): ChaseThreat[] {
  const threats: ChaseThreat[] = []
  const seen = new Set<string>()
  for (const capture of generateLegalMovesForSide(pieces, side)) {
    if (!capture.capturedId) continue
    const attacker = pieces.find((piece) => piece.id === capture.pieceId)
    const target = pieces.find((piece) => piece.id === capture.capturedId)
    if (!attacker || !target || target.kind === 'king') continue
    if (attacker.kind === 'king' || attacker.kind === 'pawn') continue
    if (target.kind === 'pawn' && !hasCrossedRiver(target)) continue

    const reciprocalSameKind =
      attacker.kind === target.kind &&
      canPieceLegallyCapture(pieces, target, attacker.id)
    if (reciprocalSameKind) continue

    const afterCapture = simulateMove(pieces, capture)
    const attackerCanBeRecaptured = canLegallyCapture(
      afterCapture,
      target.side,
      attacker.id,
    )
    if (
      attackerCanBeRecaptured &&
      !protectedCaptureException(attacker, target)
    ) {
      continue
    }

    const key = `${attacker.id}:${target.id}`
    if (seen.has(key)) continue
    seen.add(key)
    threats.push({ attackerId: attacker.id, targetId: target.id })
  }
  return threats.sort(
    (left, right) =>
      left.targetId.localeCompare(right.targetId) ||
      left.attackerId.localeCompare(right.attackerId),
  )
}

function canLegallyCapture(
  pieces: Piece[],
  side: Side,
  targetId: string,
): boolean {
  return generateLegalMovesForSide(pieces, side).some(
    (move) => move.capturedId === targetId,
  )
}

function canPieceLegallyCapture(
  pieces: Piece[],
  piece: Piece,
  targetId: string,
): boolean {
  return generateLegalMovesForPiece(pieces, piece).some(
    (move) => move.capturedId === targetId,
  )
}

function hasCrossedRiver(piece: Piece): boolean {
  return piece.side === 'red' ? piece.rank >= 5 : piece.rank <= 4
}

function protectedCaptureException(attacker: Piece, target: Piece): boolean {
  if (
    (attacker.kind === 'horse' || attacker.kind === 'cannon') &&
    target.kind === 'chariot'
  ) {
    return true
  }
  return (
    (attacker.kind === 'advisor' || attacker.kind === 'elephant') &&
    (target.kind === 'horse' ||
      target.kind === 'cannon' ||
      target.kind === 'chariot')
  )
}
