import type {
  ChaseThreat,
  CycleBehavior,
  GameOutcome,
  GameState,
  MoveRecord,
  NaturalLimitState,
  Piece,
  RuleFrame,
  RuleState,
  Side,
} from '../types/xiangqi'

const SIDES: readonly Side[] = ['red', 'black']

export function emptyChases(): Record<Side, ChaseThreat[]> {
  return { red: [], black: [] }
}

/**
 * 同一局面只由存活棋子的颜色、种类、坐标与当前行棋方决定。
 * 棋子 id、数组顺序、历史和表现状态均不参与比较。
 */
export function positionKey(pieces: Piece[], sideToMove: Side): string {
  const placement = pieces
    .filter((piece) => !piece.captured)
    .map(
      (piece) =>
        `${piece.side[0]}:${piece.kind}:${piece.file},${piece.rank}`,
    )
    .sort()
    .join('|')
  return `${sideToMove}|${placement}`
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

/** 供搜索层判断新局面是否将直接成为第三次同形。 */
export function nextPositionOccurrenceCount(
  state: GameState,
  pieces: Piece[],
  sideToMove: Side,
): number {
  const key = positionKey(pieces, sideToMove)
  const ruleState = normalizeRuleState(state)
  return ruleState.frames.filter((frame) => frame.positionKey === key).length + 1
}

export function advanceRuleState(
  state: GameState,
  nextPieces: Piece[],
  nextSideToMove: Side,
  record: MoveRecord,
  chases: Record<Side, ChaseThreat[]>,
): RuleState {
  const previous = normalizeRuleState(state)
  const frame: RuleFrame = {
    ply: state.history.length + 1,
    positionKey: positionKey(nextPieces, nextSideToMove),
    chases: cloneChases(chases),
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

  const frames = [...previous.frames.map(cloneFrame), frame]
  return {
    ruleset: previous.ruleset,
    frames,
    currentPositionOccurrences: frames.filter(
      (candidate) => candidate.positionKey === frame.positionKey,
    ).length,
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

function normalizeRuleState(state: GameState): RuleState {
  if (state.ruleState) return cloneRuleState(state.ruleState)
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

function cloneFrame(frame: RuleFrame): RuleFrame {
  return {
    ...frame,
    chases: cloneChases(frame.chases),
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

function cloneRuleState(ruleState: RuleState): RuleState {
  return {
    ...ruleState,
    frames: ruleState.frames.map(cloneFrame),
    naturalLimit: {
      ...ruleState.naturalLimit,
      checkCounts: { ...ruleState.naturalLimit.checkCounts },
    },
  }
}
