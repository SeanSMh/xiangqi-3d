import type { Piece, Side } from '../types/xiangqi'

/**
 * 棋盘占位索引与攻击反查。
 *
 * 规则层最热的两个问题是「这个格子有子吗」和「这个格子被攻击了吗」，
 * 而朴素写法都在做多余的工作：
 *
 * - `pieceAt` 每次线性扫 32 枚棋子，而车的一条射线要问 8 次；
 * - `isInCheck` 原本**生成敌方全部伪合法着**再看有没有落在将上，
 *   等于为了回答一个是非题把整棵着法树摊开。
 *
 * 这里把两件事都改成常数级：占位表是一次 32 次写入的 90 格数组，
 * 攻击判定从**目标格反向**出发——沿四方向各走一趟找前两个挡子，
 * 再定点查马、象、士、兵的有限个来源格。
 *
 * 语义上刻意与 `generatePseudoLegalMoves` **逐条对齐**（含马腿、象眼、
 * 九宫、河界、炮架、落点不能是己方子），因此可以整体替换而不改变任何裁决。
 */

/** 90 格占位表，下标 `rank * 9 + file`；空点为 `undefined`。 */
export type Occupancy = Array<Piece | undefined>

const BOARD_FILES = 9
const BOARD_RANKS = 10
const BOARD_SQUARES = BOARD_FILES * BOARD_RANKS

const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

const HORSE_SOURCES: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [-1, 2],
  [1, -2],
  [-1, -2],
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
]

const DIAGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
]

export function squareIndex(file: number, rank: number): number {
  return rank * BOARD_FILES + file
}

export function isInsideBoardSquare(file: number, rank: number): boolean {
  return (
    file >= 0 && file < BOARD_FILES && rank >= 0 && rank < BOARD_RANKS
  )
}

export function isInsidePalaceSquare(
  side: Side,
  file: number,
  rank: number,
): boolean {
  if (file < 3 || file > 5) return false
  return side === 'red' ? rank >= 0 && rank <= 2 : rank >= 7 && rank <= 9
}

/** 一次遍历建表；被吃的棋子不占格。 */
export function buildOccupancy(pieces: readonly Piece[]): Occupancy {
  const occupancy: Occupancy = new Array(BOARD_SQUARES)
  for (const piece of pieces) {
    if (piece.captured) continue
    occupancy[squareIndex(piece.file, piece.rank)] = piece
  }
  return occupancy
}

export function occupantAt(
  occupancy: Occupancy,
  file: number,
  rank: number,
): Piece | undefined {
  return isInsideBoardSquare(file, rank)
    ? occupancy[squareIndex(file, rank)]
    : undefined
}

export function findKing(
  pieces: readonly Piece[],
  side: Side,
): Piece | undefined {
  for (const piece of pieces) {
    if (piece.kind === 'king' && piece.side === side && !piece.captured) {
      return piece
    }
  }
  return undefined
}

/**
 * 将帅照面：同一竖线且中间无子。
 *
 * 与 `moves.ts` 的导出版本同义，但沿竖线只走两王之间的格子，
 * 不再对全部棋子做一次 `some`。
 */
export function kingsFaceOn(
  occupancy: Occupancy,
  pieces: readonly Piece[],
): boolean {
  const red = findKing(pieces, 'red')
  const black = findKing(pieces, 'black')
  if (!red || !black || red.file !== black.file) return false

  const from = Math.min(red.rank, black.rank) + 1
  const to = Math.max(red.rank, black.rank)
  for (let rank = from; rank < to; rank += 1) {
    if (occupancy[squareIndex(red.file, rank)]) return false
  }
  return true
}

/**
 * 从给定的王位出发判断照面，**不读 `pieces` 的坐标**。
 *
 * 合法性筛选是在同一张占位表上落子—判断—还原的，被挪动的棋子对象仍带着
 * 旧坐标；任何依赖 `piece.file/rank` 的写法在那条路径上都会读到过期值。
 * 沿竖线找到的第一个子若是对方的王，即为照面。
 */
export function kingsFaceFrom(
  occupancy: Occupancy,
  file: number,
  rank: number,
  side: Side,
): boolean {
  for (const step of [1, -1]) {
    let scanRank = rank + step
    while (scanRank >= 0 && scanRank < BOARD_RANKS) {
      const occupant = occupancy[squareIndex(file, scanRank)]
      if (occupant) {
        if (occupant.kind === 'king' && occupant.side !== side) return true
        break
      }
      scanRank += step
    }
  }
  return false
}

/**
 * `bySide` 是否存在一步**伪合法着**，其落点正是 `(file, rank)`。
 *
 * 注意落点是否有子会改变判据，两种情况都要覆盖：
 * - 落点有子：车吃子要求中间无挡，炮吃子要求**恰好一个**炮架；
 * - 落点是空点：车照旧要求无挡，炮则要求**没有**炮架（炮不隔子不能走空点）。
 *
 * 因此沿射线要同时拿到前两个挡子：第一个决定车／帅，第二个决定隔子的炮。
 */
export function isSquareAttackedBy(
  occupancy: Occupancy,
  file: number,
  rank: number,
  bySide: Side,
): boolean {
  const occupant = occupancy[squareIndex(file, rank)]
  // 落点是己方子时不存在任何落到该点的着法，与 addStepMove 的判据一致。
  if (occupant && occupant.side === bySide) return false
  const capturing = occupant !== undefined

  for (const [deltaFile, deltaRank] of ORTHOGONAL) {
    let scanFile = file + deltaFile
    let scanRank = rank + deltaRank
    let distance = 1
    let first: Piece | undefined
    let firstDistance = 0

    while (isInsideBoardSquare(scanFile, scanRank)) {
      const candidate = occupancy[squareIndex(scanFile, scanRank)]
      if (candidate) {
        if (!first) {
          first = candidate
          firstDistance = distance
          // 车：路径上第一个子就是它，中间自然无挡。
          if (candidate.side === bySide && candidate.kind === 'chariot') {
            return true
          }
          // 帅／将：正交相邻，且落点必须在它自己的九宫内。
          if (
            candidate.side === bySide &&
            candidate.kind === 'king' &&
            firstDistance === 1 &&
            isInsidePalaceSquare(bySide, file, rank)
          ) {
            return true
          }
          // 炮走空点不能隔子：第一个子就是炮才算。
          if (
            !capturing &&
            candidate.side === bySide &&
            candidate.kind === 'cannon'
          ) {
            return true
          }
          if (!capturing) break
        } else {
          // 炮吃子恰好隔一个炮架：第二个子是炮才算。
          if (candidate.side === bySide && candidate.kind === 'cannon') {
            return true
          }
          break
        }
      }
      scanFile += deltaFile
      scanRank += deltaRank
      distance += 1
    }
  }

  for (const [deltaFile, deltaRank] of HORSE_SOURCES) {
    const horseFile = file + deltaFile
    const horseRank = rank + deltaRank
    if (!isInsideBoardSquare(horseFile, horseRank)) continue
    const candidate = occupancy[squareIndex(horseFile, horseRank)]
    if (!candidate || candidate.side !== bySide || candidate.kind !== 'horse') {
      continue
    }
    // 马腿在马自己那一侧的长轴相邻格；从落点看就是回退一格长轴分量。
    const legFile =
      horseFile + (Math.abs(deltaFile) === 2 ? -Math.sign(deltaFile) : 0)
    const legRank =
      horseRank + (Math.abs(deltaRank) === 2 ? -Math.sign(deltaRank) : 0)
    if (!occupancy[squareIndex(legFile, legRank)]) return true
  }

  for (const [deltaFile, deltaRank] of DIAGONAL) {
    const elephantFile = file + deltaFile * 2
    const elephantRank = rank + deltaRank * 2
    if (isInsideBoardSquare(elephantFile, elephantRank)) {
      const candidate = occupancy[squareIndex(elephantFile, elephantRank)]
      if (
        candidate &&
        candidate.side === bySide &&
        candidate.kind === 'elephant' &&
        // 象不过河：落点必须仍在它自己那一半。
        !(bySide === 'red' ? rank > 4 : rank < 5) &&
        !occupancy[squareIndex(file + deltaFile, rank + deltaRank)]
      ) {
        return true
      }
    }

    const advisorFile = file + deltaFile
    const advisorRank = rank + deltaRank
    if (!isInsideBoardSquare(advisorFile, advisorRank)) continue
    const advisor = occupancy[squareIndex(advisorFile, advisorRank)]
    if (
      advisor &&
      advisor.side === bySide &&
      advisor.kind === 'advisor' &&
      isInsidePalaceSquare(bySide, file, rank)
    ) {
      return true
    }
  }

  // 兵／卒：正前方一格必然可达；过河后才有左右两个来源。
  const forward = bySide === 'red' ? 1 : -1
  const pusherRank = rank - forward
  if (isInsideBoardSquare(file, pusherRank)) {
    const pusher = occupancy[squareIndex(file, pusherRank)]
    if (pusher && pusher.side === bySide && pusher.kind === 'pawn') return true
  }
  // 横走不改变横线，因此过河判据直接用落点所在横线。
  if (bySide === 'red' ? rank >= 5 : rank <= 4) {
    for (const deltaFile of [-1, 1]) {
      const pawnFile = file + deltaFile
      if (!isInsideBoardSquare(pawnFile, rank)) continue
      const pawn = occupancy[squareIndex(pawnFile, rank)]
      if (pawn && pawn.side === bySide && pawn.kind === 'pawn') return true
    }
  }

  return false
}
