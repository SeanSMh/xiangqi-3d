import type { BoardCoord, GameState, Piece, Side } from '../types/xiangqi'
import { pieceAt } from './board'
import { isInCheck, isInsideBoard, kingsFace, simulateMove } from './moves'

/**
 * 与 UI 的 InteractionFeedbackReason 同名，可由控制器直接转交提示层。
 * null 表示目标是完整合法着，不需要非法着提示。
 */
export type IllegalMoveReason =
  | 'wrong-side'
  | 'friendly-occupied'
  | 'outside-board'
  | 'illegal-pattern'
  | 'path-blocked'
  | 'horse-leg-blocked'
  | 'elephant-eye-blocked'
  | 'elephant-cross-river'
  | 'palace-bound'
  | 'cannon-screen'
  | 'pawn-direction'
  | 'must-answer-check'
  | 'exposes-own-king'
  | 'kings-facing'
  | 'terminal'

type GeometryReason = Exclude<
  IllegalMoveReason,
  | 'wrong-side'
  | 'friendly-occupied'
  | 'outside-board'
  | 'must-answer-check'
  | 'exposes-own-king'
  | 'kings-facing'
  | 'terminal'
>

/**
 * 解释从 piece 所在点走到 target 为何非法。
 *
 * 本函数不修改输入状态，也不执行终局裁决。它先判断棋子几何和阻挡，
 * 只有伪合法着才继续模拟己方王安全，因此不会用“未应将”掩盖马腿、
 * 象眼、炮架等更直接的错误原因。
 */
export function explainIllegalMove(
  state: GameState,
  piece: Piece,
  target: BoardCoord,
): IllegalMoveReason | null {
  if (state.status !== 'playing') return 'terminal'

  const currentPiece = state.pieces.find(
    (candidate) => candidate.id === piece.id && !candidate.captured,
  )
  if (!currentPiece) return 'illegal-pattern'
  if (currentPiece.side !== state.sideToMove) return 'wrong-side'

  if (
    !Number.isInteger(target.file) ||
    !Number.isInteger(target.rank) ||
    !isInsideBoard(target.file, target.rank)
  ) {
    return 'outside-board'
  }

  const targetPiece = pieceAt(state.pieces, target.file, target.rank)
  if (targetPiece?.side === currentPiece.side) return 'friendly-occupied'

  // 象棋以将死结束，不允许把“吃将”作为普通合法着提交。
  if (targetPiece?.kind === 'king') return 'illegal-pattern'

  const geometryReason = explainGeometry(
    state.pieces,
    currentPiece,
    target,
    targetPiece,
  )
  if (geometryReason) return geometryReason

  const simulated = simulateMove(state.pieces, {
    pieceId: currentPiece.id,
    from: { file: currentPiece.file, rank: currentPiece.rank },
    to: target,
    ...(targetPiece ? { capturedId: targetPiece.id } : {}),
  })

  // 将帅照面是最明确的王安全错误，优先于笼统的未应将/送将提示。
  if (kingsFace(simulated)) return 'kings-facing'

  if (!isInCheck(simulated, currentPiece.side)) return null
  return isInCheck(state.pieces, currentPiece.side)
    ? 'must-answer-check'
    : 'exposes-own-king'
}

function explainGeometry(
  pieces: Piece[],
  piece: Piece,
  target: BoardCoord,
  targetPiece: Piece | undefined,
): GeometryReason | null {
  const df = target.file - piece.file
  const dr = target.rank - piece.rank
  const absFile = Math.abs(df)
  const absRank = Math.abs(dr)

  switch (piece.kind) {
    case 'chariot': {
      if (!isOrthogonal(df, dr)) return 'illegal-pattern'
      return countBetween(pieces, piece, target) > 0 ? 'path-blocked' : null
    }

    case 'cannon': {
      if (!isOrthogonal(df, dr)) return 'illegal-pattern'
      const screens = countBetween(pieces, piece, target)
      const expectedScreens = targetPiece ? 1 : 0
      return screens === expectedScreens ? null : 'cannon-screen'
    }

    case 'horse': {
      if (!((absFile === 1 && absRank === 2) || (absFile === 2 && absRank === 1))) {
        return 'illegal-pattern'
      }
      const legFile = piece.file + (absFile === 2 ? Math.sign(df) : 0)
      const legRank = piece.rank + (absRank === 2 ? Math.sign(dr) : 0)
      return pieceAt(pieces, legFile, legRank)
        ? 'horse-leg-blocked'
        : null
    }

    case 'elephant': {
      if (absFile !== 2 || absRank !== 2) return 'illegal-pattern'
      if (crossesElephantRiver(piece.side, target.rank)) {
        return 'elephant-cross-river'
      }
      return pieceAt(pieces, piece.file + df / 2, piece.rank + dr / 2)
        ? 'elephant-eye-blocked'
        : null
    }

    case 'advisor': {
      if (absFile !== 1 || absRank !== 1) return 'illegal-pattern'
      return isInsidePalace(piece.side, target) ? null : 'palace-bound'
    }

    case 'king': {
      if (absFile + absRank !== 1) return 'illegal-pattern'
      return isInsidePalace(piece.side, target) ? null : 'palace-bound'
    }

    case 'pawn': {
      const forward = piece.side === 'red' ? 1 : -1
      const crossedRiver =
        piece.side === 'red' ? piece.rank >= 5 : piece.rank <= 4
      const movesForward = df === 0 && dr === forward
      const movesSideways = crossedRiver && absFile === 1 && dr === 0
      return movesForward || movesSideways ? null : 'pawn-direction'
    }
  }
}

function isOrthogonal(df: number, dr: number): boolean {
  return (df === 0) !== (dr === 0)
}

function countBetween(
  pieces: Piece[],
  from: Pick<Piece, 'file' | 'rank'>,
  to: BoardCoord,
): number {
  const stepFile = Math.sign(to.file - from.file)
  const stepRank = Math.sign(to.rank - from.rank)
  let file = from.file + stepFile
  let rank = from.rank + stepRank
  let count = 0

  while (file !== to.file || rank !== to.rank) {
    if (pieceAt(pieces, file, rank)) count += 1
    file += stepFile
    rank += stepRank
  }
  return count
}

function isInsidePalace(side: Side, target: BoardCoord): boolean {
  if (target.file < 3 || target.file > 5) return false
  return side === 'red'
    ? target.rank >= 0 && target.rank <= 2
    : target.rank >= 7 && target.rank <= 9
}

function crossesElephantRiver(side: Side, targetRank: number): boolean {
  return side === 'red' ? targetRank > 4 : targetRank < 5
}
