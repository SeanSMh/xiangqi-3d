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

export type CycleBehavior = 'long-check' | 'long-chase' | 'allowed'

export type GameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'repetition-draw'
  | 'perpetual-check'
  | 'perpetual-chase'
  | 'no-capture-limit'
  | 'bare-defenders'

export interface CycleAdjudication {
  startPly: number
  endPly: number
  periodPlies: number
  red: CycleBehavior
  black: CycleBehavior
}

export interface GameOutcome {
  reason: GameEndReason
  winner: Side | null
  offender: Side | null
  cycle?: CycleAdjudication
}

export interface ChaseThreat {
  attackerId: string
  targetId: string
}

export interface RuleFrame {
  /** 该帧对应的绝对着数；初始帧为当前 history.length。 */
  ply: number
  /** 不含棋子 id、与 pieces 数组顺序无关，并包含行棋方。 */
  positionKey: string
  chases: Record<Side, ChaseThreat[]>
}

export interface NaturalLimitState {
  /** 程序棋规中的“有效未吃子步”，达到 120 判和。 */
  countedPlies: number
  checkCounts: Record<Side, number>
  /** 上一着为某方第 11 次及之后的将军，本次应将不计步。 */
  skipNextReply: boolean
}

export interface RuleState {
  ruleset: 'program-competition-2023'
  /** 自最近一次吃子后的局面帧；吃子前局面不可能再次出现。 */
  frames: RuleFrame[]
  currentPositionOccurrences: number
  naturalLimit: NaturalLimitState
}

export type GameStatus =
  | 'playing'
  | 'checkmate'
  | 'stalemate'
  | 'adjudicated'
  | 'draw'

export interface GameState {
  pieces: Piece[]
  sideToMove: Side
  history: MoveRecord[]
  inCheck: boolean
  winner: Side | null
  status: GameStatus
  /** 旧测试局面可省略；第一次进入规则引擎时会按当前局面初始化。 */
  outcome?: GameOutcome | null
  ruleState?: RuleState
}
