import type {
  ChaseThreat,
  CycleAction,
  CycleAdjudication,
  CycleBehavior,
  GameEndReason,
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

/** 一帧里与棋例相关的全部威胁信息。 */
export interface FrameThreats {
  chases: Record<Side, ChaseThreat[]>
  /** 走出这一着的一方是否在做杀。 */
  moverThreatensMate: boolean
}

export function emptyThreats(): FrameThreats {
  return { chases: emptyChases(), moverThreatensMate: false }
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
 * 而这个函数在每次落子时都要跑，电脑搜索里更是每个节点都跑。
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
        moverThreatensMate: false,
      },
    ],
    currentPositionOccurrences: 1,
    naturalLimit: initialNaturalLimit(),
  }
}

/**
 * 推进规则状态。
 *
 * 威胁分析（捉与杀）走**回调**而不是直接收一份现成结果：是否值得付出这笔成本，
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
  resolveThreats: (occurrences: number) => FrameThreats,
): RuleState {
  const previous = readRuleState(state)
  const key = positionKey(nextPieces, nextSideToMove)
  let occurrences = 1
  for (const candidate of previous.frames) {
    if (candidate.positionKey === key) occurrences += 1
  }

  const threats = resolveThreats(occurrences)
  const frame: RuleFrame = {
    ply: state.history.length + 1,
    positionKey: key,
    chases: cloneChases(threats.chases),
    moverThreatensMate: threats.moverThreatensMate,
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
      const adjudication: CycleAdjudication = {
        ...cycle,
        red: red.behavior,
        black: black.behavior,
        actions: { red: red.actions, black: black.actions },
      }
      const redSeverity = cycleSeverity(red.behavior)
      const blackSeverity = cycleSeverity(black.behavior)
      if (redSeverity === blackSeverity) {
        return {
          reason: 'repetition-draw',
          winner: null,
          offender: null,
          cycle: adjudication,
        }
      }

      const offender: Side = redSeverity > blackSeverity ? 'red' : 'black'
      const behavior = offender === 'red' ? red.behavior : black.behavior
      return {
        reason: violationReason(behavior),
        winner: offender === 'red' ? 'black' : 'red',
        offender,
        cycle: adjudication,
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

/** 判负时给出与最重威胁对应的终局原因。 */
function violationReason(behavior: CycleBehavior): GameEndReason {
  switch (behavior) {
    case 'long-check':
      return 'perpetual-check'
    case 'long-mate':
      return 'perpetual-mate'
    case 'long-chase':
      return 'perpetual-chase'
    case 'allowed':
      // 等级更高的一方不可能是 allowed（allowed 为最低级 0）。
      return 'repetition-draw'
  }
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

export interface CycleSideVerdict {
  behavior: CycleBehavior
  /** 该方在循环区间内自己每一着的定性，按出现顺序。 */
  actions: CycleAction[]
}

/**
 * 给某方在循环区间内的每一着定性，再据此得出整体结论。
 *
 * 棋例的核心是「着着有威胁才算禁止」，而不是「手段必须始终如一」：
 * 一将一捉、一杀一捉同样禁止，一将一闲、一捉一闲则允许。
 * 因此先逐着分出 将／杀／捉／闲，再看有没有闲着。
 *
 * 定性优先级 将 > 杀 > 捉：将军已是最重威胁，不必再问它是否兼做杀或捉。
 */
function classifyCycleSide(
  history: MoveRecord[],
  frames: RuleFrame[],
  cycle: { startPly: number; endPly: number },
  side: Side,
): CycleSideVerdict {
  const frameByPly = new Map(frames.map((frame) => [frame.ply, frame]))
  const ownPlies: number[] = []
  for (let ply = cycle.startPly + 1; ply <= cycle.endPly; ply += 1) {
    const record = history[ply - 1]
    if (record && record.side === side) ownPlies.push(ply)
  }
  if (ownPlies.length === 0) return { behavior: 'allowed', actions: [] }

  // 先定将与杀；剩下的才需要问「是不是在捉」。
  const actions = new Map<number, CycleAction>()
  const undecided: number[] = []
  for (const ply of ownPlies) {
    if (history[ply - 1]!.givesCheck) {
      actions.set(ply, 'check')
    } else if (frameByPly.get(ply)?.moverThreatensMate) {
      actions.set(ply, 'mate')
    } else if (history[ply - 2]?.givesCheck) {
      // 应将：上一着是对方将军，这一着是被迫的，棋例不因它顺带攻到某子就判捉。
      // 象棋严格轮流，因此 ply-2 必是对方的着。
      actions.set(ply, 'idle')
    } else {
      undecided.push(ply)
    }
  }

  // 长捉要求「同一枚子被反复捉」，因此只在尚未定性的那些着之间求交集：
  // 将军着本就不参与，否则一将一捉会因为将军那一着不捉该子而交集落空。
  const chased = undecided.length > 0
    ? perpetualChaseExists(history, frameByPly, cycle, side, undecided)
    : false
  for (const ply of undecided) {
    actions.set(ply, chased ? 'chase' : 'idle')
  }

  const ordered = ownPlies.map((ply) => actions.get(ply)!)
  return { behavior: resolveBehavior(ordered), actions: ordered }
}

/** 着着有威胁即禁止，按最重威胁命名；出现任一闲着则整体允许。 */
function resolveBehavior(actions: CycleAction[]): CycleBehavior {
  if (actions.length === 0 || actions.includes('idle')) return 'allowed'
  if (actions.includes('check')) return 'long-check'
  if (actions.includes('mate')) return 'long-mate'
  return 'long-chase'
}

/**
 * 是否存在一枚棋子被反复捉：该方每一着（在给定的候选着里）都捉它，
 * 且对方每一着都使它脱身——否则那只是一个静止的攻击关系，不是「捉」。
 */
function perpetualChaseExists(
  history: MoveRecord[],
  frameByPly: Map<number, RuleFrame>,
  cycle: { startPly: number; endPly: number },
  side: Side,
  chasingPlies: number[],
): boolean {
  let commonTargets: Set<string> | null = null
  for (const ply of chasingPlies) {
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
    if (commonTargets.size === 0) return false
  }
  if (!commonTargets || commonTargets.size === 0) return false

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
    if (escapedEveryReply) return true
  }
  return false
}

/**
 * 判罚等级。同级判和，高者判负。
 *
 * 将 > 杀 > 捉 沿用原有的「长将对长捉判长将负」口径；
 * 混合威胁（如一将一捉）按其最重威胁归档，因此与长将同级。
 */
function cycleSeverity(behavior: CycleBehavior): number {
  switch (behavior) {
    case 'long-check':
      return 3
    case 'long-mate':
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
