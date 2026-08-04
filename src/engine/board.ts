import type { GameState, Piece, Side } from '../types/xiangqi'
import { createRuleState } from './adjudication'

/** 标准开局布局（红方在 rank 0 一侧） */
export function createInitialPieces(): Piece[] {
  const pieces: Piece[] = []
  let n = 0
  const id = () => `p${++n}`

  const back: Array<[number, Piece['kind']]> = [
    [0, 'chariot'],
    [1, 'horse'],
    [2, 'elephant'],
    [3, 'advisor'],
    [4, 'king'],
    [5, 'advisor'],
    [6, 'elephant'],
    [7, 'horse'],
    [8, 'chariot'],
  ]

  for (const side of ['red', 'black'] as Side[]) {
    const backRank = side === 'red' ? 0 : 9
    const cannonRank = side === 'red' ? 2 : 7
    const pawnRank = side === 'red' ? 3 : 6

    for (const [file, kind] of back) {
      pieces.push({ id: id(), kind, side, file, rank: backRank })
    }
    pieces.push({ id: id(), kind: 'cannon', side, file: 1, rank: cannonRank })
    pieces.push({ id: id(), kind: 'cannon', side, file: 7, rank: cannonRank })
    for (const file of [0, 2, 4, 6, 8]) {
      pieces.push({ id: id(), kind: 'pawn', side, file, rank: pawnRank })
    }
  }

  return pieces
}

export function createInitialState(): GameState {
  const pieces = createInitialPieces()
  return {
    pieces,
    sideToMove: 'red',
    history: [],
    inCheck: false,
    winner: null,
    status: 'playing',
    outcome: null,
    ruleState: createRuleState(pieces, 'red'),
  }
}

export function pieceAt(
  pieces: Piece[],
  file: number,
  rank: number,
): Piece | undefined {
  return pieces.find((p) => !p.captured && p.file === file && p.rank === rank)
}

/** 显示用汉字 */
export function pieceLabel(kind: Piece['kind'], side: Side): string {
  const red: Record<Piece['kind'], string> = {
    king: '帅',
    advisor: '仕',
    elephant: '相',
    horse: '马',
    chariot: '车',
    cannon: '炮',
    pawn: '兵',
  }
  const black: Record<Piece['kind'], string> = {
    king: '将',
    advisor: '士',
    elephant: '象',
    horse: '马',
    chariot: '车',
    cannon: '炮',
    pawn: '卒',
  }
  return side === 'red' ? red[kind] : black[kind]
}

export function oppositeSide(side: Side): Side {
  return side === 'red' ? 'black' : 'red'
}
