import type {
  ChaseThreat,
  CycleBehavior,
  GameOutcome,
  GameState,
  MoveRecord,
  NaturalLimitState,
  Piece,
  PieceKind,
  RuleFrame,
  RuleState,
  Side,
} from '../types/xiangqi'

const SIDES: readonly Side[] = ['red', 'black']

export function emptyChases(): Record<Side, ChaseThreat[]> {
  return { red: [], black: [] }
}

/** 局面签名里每个棋种占一个字母，红方大写、黑方小写。 */
const POSITION_KEY_CODES: Record<PieceKind, string> = {
  king: 'k',
  advisor: 'a',
  elephant: 'e',
  horse: 'h',
  chariot: 'r',
  cannon: 'c',
  pawn: 'p',
}

const EMPTY_SQUARE = '.'

/**
 * 同一局面只由存活棋子的颜色、种类、坐标与当前行棋方决定。
 * 棋子 id、数组顺序、历史和表现状态均不参与比较。
 *
 * 按**格**编码而不是「拼一串再排序」：顺序无关性由固定的格序天然保证，
 * 于是省掉排序——原写法要对 32 个二十来字符的串做字符串比较排序，
 * 而这个函数在每次落子时都要跑，AI 搜索里更是每个节点都跑。
 * 编码是双射的：同一摆法必定同一签名，不同摆法必定不同签名。
 */
export function positionKey(pieces: Piece[], sideToMove: Side): string {
  const squares = new Array<string>(90).fill(EMPTY_SQUARE)
  for (const piece of pieces) {
    if (piece.captured) continue
    const code = POSITION_KEY_CODES[piece.kind]
    squares[piece.rank * 9 + piece.file] =
      piece.side === 'red' ? code.toUpperCase() : code
  }
  return `${sideToMove[0]}|${squares.join('')}`
}

export function createRuleState(
  pieces: Piece[],
  sideToMove: Side,
  ply = 0,
  chases: Record<Side, ChaseThreat[]> = emptyChases(),
): RuleState {
  return {
    ruleset: 'program-competition-2023',
    frames: [
      {
        ply,
        positionKey: positionKey(pieces, sideToMove),
        chases: cloneChases(chases),
      },
    ],
    currentPositionOccurrences: 1,
    naturalLimit: initialNaturalLimit(),
  }
}

/**
 * 推进规则状态。
 *
 * 捉子分析走**回调**而不是直接收一份现成结果：是否值得付出这笔分析成本，
 * 取决于新局面是第几次出现，而这个次数只有推进到一半才算得出来。
 * 回调把「算次数」和「按次数决定要不要分析」合到一次遍历里，
 * 避免调用方为了做决定再独立算一遍局面签名和出现次数。
 *
 * 传给回调的是**未经吃子重置**的出现次数：搜索层据此判断这一着是否逼近
 * 三次同形，这个判断与吃子是否清空循环窗口无关。
 */
export function advanceRuleState(
  state: GameState,
  nextPieces: Piece[],
  nextSideToMove: Side,
  record: MoveRecord,
  resolveChases: (occurrences: number) => Record<Side, ChaseThreat[]>,
): RuleState {
  const previous = readRuleState(state)
  const key = positionKey(nextPieces, nextSideToMove)
  let occurrences = 1
  for (const candidate of previous.frames) {
    if (candidate.positionKey === key) occurrences += 1
  }

  const frame: RuleFrame = {
    ply: state.history.length + 1,
    positionKey: key,
    chases: cloneChases(resolveChases(occurrences)),
  }

  if (record.capturedId) {
    return {
      ruleset: previous.ruleset,
      // 被吃棋子不会复活，吃子前的局面不可能在当前实时分支重现。
      frames: [frame],
      currentPositionOccurrences: 1,
      naturalLimit: initialNaturalLimit(),
    }
  }

  return {
    ruleset: previous.ruleset,
    // 帧一经建立就不再改动，因此向前传递可以直接共享对象；
    // 时间线快照另有自己的深拷贝，互不影响。
    frames: [...previous.frames, frame],
    currentPositionOccurrences: occurrences,
    naturalLimit: advanceNaturalLimit(previous.naturalLimit, record),
  }
}

/**
 * 基础将死 / 困毙应在调用本函数之前判定。这里依次处理循环、自然限着、
 * 以及仅剩将士象的程序棋规和棋。
 */
export function evaluateAdjudication(state: GameState): GameOutcome | null {
  const ruleState = state.ruleState
  if (ruleState && ruleState.currentPositionOccurrences >= 3) {
    const cycle = findCurrentCycle(ruleState)
    if (cycle) {
      const red = classifyCycleSide(state.history, ruleState.frames, cycle, 'red')
      const black = classifyCycleSide(
        state.history,
        ruleState.frames,
        cycle,
        'black',
      )
      const redSeverity = cycleSeverity(red)
      const blackSeverity = cycleSeverity(black)
      if (redSeverity === blackSeverity) {
        return {
          reason: 'repetition-draw',
          winner: null,
          offender: null,
          cycle: { ...cycle, red, black },
        }
      }

      const offender: Side = redSeverity > blackSeverity ? 'red' : 'black'
      const behavior = offender === 'red' ? red : black
      return {
        reason:
          behavior === 'long-check' ? 'perpetual-check' : 'perpetual-chase',
        winner: offender === 'red' ? 'black' : 'red',
        offender,
        cycle: { ...cycle, red, black },
      }
    }
  }

  if (ruleState && ruleState.naturalLimit.countedPlies >= 120) {
    return {
      reason: 'no-capture-limit',
      winner: null,
      offender: null,
    }
  }

  if (hasBareDefenders(state.pieces)) {
    return {
      reason: 'bare-defenders',
      winner: null,
      offender: null,
    }
  }

  return null
}

export function hasBareDefenders(pieces: Piece[]): boolean {
  return pieces.every(
    (piece) =>
      piece.captured ||
      piece.kind === 'king' ||
      piece.kind === 'advisor' ||
      piece.kind === 'elephant',
  )
}

/**
 * 只读取，不复制。
 *
 * 这里原本返回一份深克隆，但**没有任何调用方会改它**——`advanceRuleState`
 * 全程只读旧状态、另建新对象。代价却是每落一子就要把整份历史帧连同各自的
 * 捉子表复制一遍，于是单步开销随棋局长度线性增长、整局呈平方。
 */
function readRuleState(state: GameState): RuleState {
  if (state.ruleState) return state.ruleState
  const ruleState = createRuleState(
    state.pieces,
    state.sideToMove,
    state.history.length,
  )
  ruleState.naturalLimit = naturalLimitFromHistory(state.history)
  return ruleState
}

function naturalLimitFromHistory(history: MoveRecord[]): NaturalLimitState {
  let value = initialNaturalLimit()
  for (const record of history) {
    value = record.capturedId
      ? initialNaturalLimit()
      : advanceNaturalLimit(value, record)
  }
  return value
}

function initialNaturalLimit(): NaturalLimitState {
  return {
    countedPlies: 0,
    checkCounts: { red: 0, black: 0 },
    skipNextReply: false,
  }
}

function advanceNaturalLimit(
  previous: NaturalLimitState,
  record: MoveRecord,
): NaturalLimitState {
  const checkCounts = { ...previous.checkCounts }
  let exceedsCheckAllowance = false
  if (record.givesCheck) {
    checkCounts[record.side] += 1
    exceedsCheckAllowance = checkCounts[record.side] > 10
  }

  const countsThisPly = !previous.skipNextReply && !exceedsCheckAllowance
  return {
    countedPlies: previous.countedPlies + (countsThisPly ? 1 : 0),
    checkCounts,
    // 第 11 次及之后的将军不计，其直接导致的下一着应将也不计。
    skipNextReply: exceedsCheckAllowance,
  }
}

function findCurrentCycle(ruleState: RuleState): {
  startPly: number
  endPly: number
  periodPlies: number
} | null {
  const current = ruleState.frames.at(-1)
  if (!current) return null
  const occurrences = ruleState.frames.filter(
    (frame) => frame.positionKey === current.positionKey,
  )
  if (occurrences.length < 3) return null
  const [first, , third] = occurrences.slice(-3)
  if (!first || !third || third.ply <= first.ply) return null
  return {
    startPly: first.ply,
    endPly: third.ply,
    periodPlies: (third.ply - first.ply) / 2,
  }
}

function classifyCycleSide(
  history: MoveRecord[],
  frames: RuleFrame[],
  cycle: { startPly: number; endPly: number },
  side: Side,
): CycleBehavior {
  const moves = history.slice(cycle.startPly, cycle.endPly)
  const ownMoves = moves.filter((record) => record.side === side)
  if (ownMoves.length === 0) return 'allowed'
  if (ownMoves.every((record) => record.givesCheck)) return 'long-check'

  // 程序棋规中，只要循环序列存在任何将军，双方均不再判“捉”。
  if (moves.some((record) => record.givesCheck)) return 'allowed'

  const frameByPly = new Map(frames.map((frame) => [frame.ply, frame]))
  let commonTargets: Set<string> | null = null
  for (let ply = cycle.startPly + 1; ply <= cycle.endPly; ply += 1) {
    const record = history[ply - 1]
    if (!record || record.side !== side) continue
    const targets = new Set(
      (frameByPly.get(ply)?.chases[side] ?? []).map(
        (threat) => threat.targetId,
      ),
    )
    if (commonTargets === null) {
      commonTargets = targets
    } else {
      const previousTargets: Set<string> = commonTargets
      commonTargets = new Set(
        [...previousTargets].filter((target) => targets.has(target)),
      )
    }
  }
  if (!commonTargets || commonTargets.size === 0) return 'allowed'

  for (const targetId of commonTargets) {
    let escapedEveryReply = true
    for (let ply = cycle.startPly + 1; ply <= cycle.endPly; ply += 1) {
      const record = history[ply - 1]
      if (!record || record.side === side) continue
      const stillChased = (frameByPly.get(ply)?.chases[side] ?? []).some(
        (threat) => threat.targetId === targetId,
      )
      if (stillChased) {
        escapedEveryReply = false
        break
      }
    }
    if (escapedEveryReply) return 'long-chase'
  }
  return 'allowed'
}

function cycleSeverity(behavior: CycleBehavior): number {
  switch (behavior) {
    case 'long-check':
      return 2
    case 'long-chase':
      return 1
    case 'allowed':
      return 0
  }
}

function cloneChases(
  chases: Record<Side, ChaseThreat[]>,
): Record<Side, ChaseThreat[]> {
  return Object.fromEntries(
    SIDES.map((side) => [
      side,
      chases[side].map((threat) => ({ ...threat })),
    ]),
  ) as Record<Side, ChaseThreat[]>
}
