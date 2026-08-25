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

/**
 * 循环区间内单着的定性，按轻重排列：将 > 杀 > 捉 > 闲。
 *
 * 只有「闲」是允许着法。着着有威胁（哪怕手段混合，如一将一捉）即为禁止；
 * 只要出现一步闲着，整个循环对该方就是允许的（一将一闲、一捉一闲皆然）。
 */
export type CycleAction = 'check' | 'mate' | 'chase' | 'idle'

/**
 * 某方在循环区间内的整体定性。禁止着法按其**最重**威胁命名——
 * 因此「一将一捉」记为 `long-check`，判罚等级与长将同档，
 * 但 `CycleAdjudication.actions` 保留了逐着定性以便解释判罚。
 */
export type CycleBehavior =
  | 'long-check'
  | 'long-mate'
  | 'long-chase'
  | 'allowed'

export type GameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'repetition-draw'
  | 'perpetual-check'
  | 'perpetual-mate'
  | 'perpetual-chase'
  | 'no-capture-limit'
  | 'bare-defenders'

export interface CycleAdjudication {
  startPly: number
  endPly: number
  periodPlies: number
  red: CycleBehavior
  black: CycleBehavior
  /** 循环区间内各方自己每一着的定性，按出现顺序；只用于解释，不参与比较。 */
  actions: Record<Side, CycleAction[]>
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
  /**
   * **走出这一着的一方**是否在做杀（下一着企图将死对方）。
   *
   * 与 `chases` 不同，这里不按阵营各存一份：棋例只在给某方自己的着定性时
   * 用到「杀」，而那一着的行棋方必然就是被定性的一方。存成双方会多算一倍，
   * 还会留下一个永远读不到的字段。
   */
  moverThreatensMate: boolean
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
