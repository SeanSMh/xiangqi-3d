/** 红方 / 黑方 */
export type Side = 'red' | 'black'

/**
 * 棋子种类（不含颜色）
 * 帅将、仕士、相象 用统一 kind + side 区分
 */
export type PieceKind =
  | 'king' // 帅 / 将
  | 'advisor' // 仕 / 士
  | 'elephant' // 相 / 象
  | 'horse' // 马
  | 'chariot' // 车
  | 'cannon' // 炮
  | 'pawn' // 兵 / 卒

export interface Piece {
  id: string
  kind: PieceKind
  side: Side
  /** 竖线 0–8（对应 1–9 路） */
  file: number
  /** 横线 0–9（红方底为 0） */
  rank: number
  captured?: boolean
}

export interface BoardCoord {
  file: number
  rank: number
}

export interface Move {
  pieceId: string
  from: BoardCoord
  to: BoardCoord
  /** 被吃子 id（若有） */
  capturedId?: string
}

export interface MoveRecord extends Move {
  side: Side
  givesCheck: boolean
}

export type GameStatus = 'playing' | 'checkmate' | 'stalemate'

export interface GameState {
  pieces: Piece[]
  sideToMove: Side
  history: MoveRecord[]
  inCheck: boolean
  winner: Side | null
  status: GameStatus
}
