import type {
  BoardCoord,
  ChaseThreat,
  GameState,
  Move,
  MoveRecord,
  Piece,
  Side,
} from '../types/xiangqi'
import { oppositeSide } from './board'
import {
  buildOccupancy,
  findKing,
  isSquareAttackedBy,
  kingsFaceFrom,
  kingsFaceOn,
  squareIndex,
  type Occupancy,
} from './attacks'
import {
  advanceRuleState,
  emptyThreats,
  evaluateAdjudication,
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
  occupancy: Occupancy,
  piece: Piece,
  file: number,
  rank: number,
): void {
  if (!isInsideBoard(file, rank)) return
  const target = occupancy[squareIndex(file, rank)]
  if (!target) {
    moves.push(moveFor(piece, { file, rank }))
  } else if (target.side !== piece.side) {
    moves.push(moveFor(piece, { file, rank }, target.id))
  }
}

function generateChariotMoves(occupancy: Occupancy, piece: Piece): Move[] {
  const moves: Move[] = []
  for (const [df, dr] of ORTHOGONAL_DIRECTIONS) {
    let file = piece.file + df
    let rank = piece.rank + dr
    while (isInsideBoard(file, rank)) {
      const target = occupancy[squareIndex(file, rank)]
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

function generateCannonMoves(occupancy: Occupancy, piece: Piece): Move[] {
  const moves: Move[] = []
  for (const [df, dr] of ORTHOGONAL_DIRECTIONS) {
    let file = piece.file + df
    let rank = piece.rank + dr
    let crossedScreen = false

    while (isInsideBoard(file, rank)) {
      const target = occupancy[squareIndex(file, rank)]
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

function generateHorseMoves(occupancy: Occupancy, piece: Piece): Move[] {
  const moves: Move[] = []
  for (const [df, dr] of HORSE_STEPS) {
    const legFile = piece.file + (Math.abs(df) === 2 ? Math.sign(df) : 0)
    const legRank = piece.rank + (Math.abs(dr) === 2 ? Math.sign(dr) : 0)
    if (occupancy[squareIndex(legFile, legRank)]) continue
    addStepMove(moves, occupancy, piece, piece.file + df, piece.rank + dr)
  }
  return moves
}

function generateElephantMoves(occupancy: Occupancy, piece: Piece): Move[] {
  const moves: Move[] = []
  for (const [df, dr] of ELEPHANT_STEPS) {
    const file = piece.file + df
    const rank = piece.rank + dr
    if (!isInsideBoard(file, rank)) continue
    if (piece.side === 'red' ? rank > 4 : rank < 5) continue
    const eye = squareIndex(piece.file + df / 2, piece.rank + dr / 2)
    if (occupancy[eye]) continue
    addStepMove(moves, occupancy, piece, file, rank)
  }
  return moves
}

function generateAdvisorMoves(occupancy: Occupancy, piece: Piece): Move[] {
  const moves: Move[] = []
  for (const [df, dr] of ADVISOR_STEPS) {
    const file = piece.file + df
    const rank = piece.rank + dr
    if (isInsidePalace(piece.side, file, rank)) {
      addStepMove(moves, occupancy, piece, file, rank)
    }
  }
  return moves
}

function generateKingMoves(occupancy: Occupancy, piece: Piece): Move[] {
  const moves: Move[] = []
  for (const [df, dr] of ORTHOGONAL_DIRECTIONS) {
    const file = piece.file + df
    const rank = piece.rank + dr
    if (isInsidePalace(piece.side, file, rank)) {
      addStepMove(moves, occupancy, piece, file, rank)
    }
  }
  return moves
}

function generatePawnMoves(occupancy: Occupancy, piece: Piece): Move[] {
  const moves: Move[] = []
  const forward = piece.side === 'red' ? 1 : -1
  addStepMove(moves, occupancy, piece, piece.file, piece.rank + forward)

  const crossedRiver = piece.side === 'red' ? piece.rank >= 5 : piece.rank <= 4
  if (crossedRiver) {
    addStepMove(moves, occupancy, piece, piece.file - 1, piece.rank)
    addStepMove(moves, occupancy, piece, piece.file + 1, piece.rank)
  }
  return moves
}

/** 生成棋子的伪合法着，不过滤己方被将军。 */
export function generatePseudoLegalMoves(pieces: Piece[], piece: Piece): Move[] {
  return generatePseudoLegalMovesOn(buildOccupancy(pieces), piece)
}

function generatePseudoLegalMovesOn(
  occupancy: Occupancy,
  piece: Piece,
): Move[] {
  if (piece.captured) return []
  switch (piece.kind) {
    case 'chariot':
      return generateChariotMoves(occupancy, piece)
    case 'cannon':
      return generateCannonMoves(occupancy, piece)
    case 'horse':
      return generateHorseMoves(occupancy, piece)
    case 'elephant':
      return generateElephantMoves(occupancy, piece)
    case 'advisor':
      return generateAdvisorMoves(occupancy, piece)
    case 'king':
      return generateKingMoves(occupancy, piece)
    case 'pawn':
      return generatePawnMoves(occupancy, piece)
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
  return kingsFaceOn(buildOccupancy(pieces), pieces)
}

export function isInCheck(pieces: Piece[], side: Side): boolean {
  return isInCheckOn(buildOccupancy(pieces), pieces, side)
}

/**
 * 已有占位表时的将军判定。
 *
 * 原本的写法是「生成敌方全部伪合法着，看有没有落在将上」——为了一个是非题
 * 把整棵着法树摊开，而它恰好是整个规则层调用最频繁的原语（每个候选着都要问
 * 一次）。改成从将的格子反查攻击后语义完全一致，见 `attacks.ts`。
 */
function isInCheckOn(
  occupancy: Occupancy,
  pieces: Piece[],
  side: Side,
): boolean {
  const king = findKing(pieces, side)
  if (!king) return true
  if (kingsFaceOn(occupancy, pieces)) return true
  return isSquareAttackedBy(
    occupancy,
    king.file,
    king.rank,
    oppositeSide(side),
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
  return filterLegalMoves(buildOccupancy(pieces), pieces, piece)
}

/**
 * 从伪合法着里筛掉「走完自己被将」的那些。
 *
 * 原本每个候选着都要 `simulateMove` 重建 32 个棋子对象、再重新建表判将；
 * 这里改成在**同一张占位表**上落子—判断—还原。占位表只存引用、不读坐标，
 * 因此把棋子对象直接挪到目标格即可，不必复制它。
 *
 * 王的安全判定需要知道王在哪：走王时用落点，其余情况王不动。
 */
function filterLegalMoves(
  occupancy: Occupancy,
  pieces: Piece[],
  piece: Piece,
): Move[] {
  const king = findKing(pieces, piece.side)
  const enemy = oppositeSide(piece.side)
  const legal: Move[] = []

  for (const move of generatePseudoLegalMovesOn(occupancy, piece)) {
    const fromIndex = squareIndex(move.from.file, move.from.rank)
    const toIndex = squareIndex(move.to.file, move.to.rank)
    const displaced = occupancy[toIndex]
    // 象棋以将死结束，不允许把「吃将」当成普通合法着提交。
    if (displaced?.kind === 'king') continue

    occupancy[toIndex] = piece
    occupancy[fromIndex] = undefined

    const kingFile = piece.kind === 'king' ? move.to.file : king?.file
    const kingRank = piece.kind === 'king' ? move.to.rank : king?.rank
    const safe =
      kingFile !== undefined &&
      kingRank !== undefined &&
      !kingsFaceFrom(occupancy, kingFile, kingRank, piece.side) &&
      !isSquareAttackedBy(occupancy, kingFile, kingRank, enemy)

    occupancy[fromIndex] = piece
    occupancy[toIndex] = displaced

    if (safe) legal.push(move)
  }
  return legal
}

/** 无视实际轮次，为规则分析生成某方的完整合法着。 */
export function generateLegalMovesForSide(
  pieces: Piece[],
  side: Side,
): Move[] {
  return legalMovesForSideOn(buildOccupancy(pieces), pieces, side)
}

/** 整边生成时占位表只建一次，比逐子建表省下 n 次遍历。 */
function legalMovesForSideOn(
  occupancy: Occupancy,
  pieces: Piece[],
  side: Side,
): Move[] {
  const moves: Move[] = []
  for (const piece of pieces) {
    if (piece.side !== side || piece.captured) continue
    for (const move of filterLegalMoves(occupancy, pieces, piece)) {
      moves.push(move)
    }
  }
  return moves
}

export function generateAllLegalMoves(state: GameState): Move[] {
  if (state.status !== 'playing') return []
  return generateLegalMovesForSide(state.pieces, state.sideToMove)
}

/** 终局探测用：找到首个合法着即停止，避免构造完整着法数组。 */
export function hasAnyLegalMove(state: GameState): boolean {
  if (state.status !== 'playing') return false
  const occupancy = buildOccupancy(state.pieces)
  return state.pieces.some(
    (piece) =>
      piece.side === state.sideToMove &&
      !piece.captured &&
      filterLegalMoves(occupancy, state.pieces, piece).length > 0,
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
  /** 电脑搜索叶节点只在即将第三次同形时支付长捉分析成本。 */
  chaseAnalysis?: 'always' | 'if-repeated' | 'if-third'
  /** 搜索评分本身会探测无合法着；无规则终局时可延后该遍历。 */
  deferBoardTerminal?: boolean
}

/**
 * 执行已经由 generateLegalMoves 产生的规范着法。电脑搜索可复用该转换，避免
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

  const chaseAnalysis = options.chaseAnalysis ?? 'always'
  const ruleState = advanceRuleState(
    state,
    pieces,
    sideToMove,
    record,
    (occurrences) => {
      // 威胁分析是规则层最贵的一步，只在真的会被用到时才付这笔钱。
      // 将军着直接跳过：棋例里「将」已是最重威胁，不必再问它是否兼做杀或捉。
      const worthAnalyzing =
        boardResult.status === 'playing' &&
        !givesCheck &&
        (chaseAnalysis === 'always' ||
          (chaseAnalysis === 'if-repeated' && occurrences >= 2) ||
          (chaseAnalysis === 'if-third' && occurrences >= 3))
      if (!worthAnalyzing) return emptyThreats()
      return {
        chases: analyzeChases(pieces),
        moverThreatensMate: threatensMate(pieces, record.side),
      }
    },
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
 * 程序棋规中的“杀”：该方下一着企图将死对方。
 *
 * 按棋例的口径，“杀”是**威胁**而非既成事实——判定时假设对方不应对，
 * 因此只需存在一着能把对方将死即可，不必验证对方能否化解。
 * （能否化解决定的是这一手好不好，不决定它算不算杀。）
 *
 * 与“捉”一样不调用 applyMove，避免终局裁决递归。
 */
export function threatensMate(pieces: Piece[], side: Side): boolean {
  const victim = oppositeSide(side)
  for (const move of generateLegalMovesForSide(pieces, side)) {
    const after = simulateMove(pieces, move)
    // 先用便宜的将军判定过滤：不将军就一定不是将死。
    if (!isInCheck(after, victim)) continue
    if (!hasLegalMoveForSide(after, victim)) return true
  }
  return false
}

/** 无视实际轮次判断某方是否还有合法着；找到首个即停止。 */
function hasLegalMoveForSide(pieces: Piece[], side: Side): boolean {
  const occupancy = buildOccupancy(pieces)
  return pieces.some(
    (piece) =>
      piece.side === side &&
      !piece.captured &&
      filterLegalMoves(occupancy, pieces, piece).length > 0,
  )
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
