import type {
  ComputerDifficulty,
  ComputerSearchResult,
  ComputerWorkerRequest,
  ComputerWorkerResponse,
} from '../computer/types'
import type { GameState, Move } from '../types/xiangqi'

export type ComputerPhase = 'idle' | 'thinking' | 'animating' | 'error'

export const COMPUTER_THINK_DELAY_MS: Record<ComputerDifficulty, number> = {
  easy: 420,
  normal: 650,
  hard: 900,
}

export interface ComputerDecisionSummary {
  move: Move
  score: number
  completedDepth: number
  nodes: number
}

export interface ComputerRuntimeSnapshot {
  phase: ComputerPhase
  pending: boolean
  requestId: number | null
  timelineRevision: number | null
  elapsedMs: number
  minimumThinkMs: number
  resultReady: boolean
  error: string | null
  lastDecision: ComputerDecisionSummary | null
}

export interface ComputerWorkerLike {
  onmessage: ((event: MessageEvent<ComputerWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: ComputerWorkerRequest): void
  terminate(): void
}

export type ComputerWorkerFactory = () => ComputerWorkerLike

interface ActiveRequest {
  requestId: number
  timelineRevision: number
  difficulty: ComputerDifficulty
}

/** 管理 Worker、最短思考演出与陈旧结果失效，不决定何时轮到电脑对手。 */
export class ComputerCoordinator {
  private readonly workerFactory: ComputerWorkerFactory
  private readonly onStateChange: () => void
  private worker: ComputerWorkerLike | null = null
  private activeRequest: ActiveRequest | null = null
  private nextRequestId = 0
  private phase: ComputerPhase = 'idle'
  private elapsedMs = 0
  private readyResult: ComputerSearchResult | null = null
  private error: string | null = null
  private lastDecision: ComputerDecisionSummary | null = null

  constructor(
    workerFactory: ComputerWorkerFactory = createComputerWorker,
    onStateChange: () => void = () => undefined,
  ) {
    this.workerFactory = workerFactory
    this.onStateChange = onStateChange
  }

  begin(
    state: GameState,
    difficulty: ComputerDifficulty,
    timelineRevision: number,
  ): number {
    this.cancel()
    const requestId = ++this.nextRequestId
    this.activeRequest = { requestId, timelineRevision, difficulty }
    this.phase = 'thinking'
    this.elapsedMs = 0
    this.readyResult = null
    this.error = null

    try {
      const worker = this.workerFactory()
      this.worker = worker
      worker.onmessage = (event) => this.handleMessage(event.data)
      worker.onerror = (event) => {
        event.preventDefault()
        this.fail(event.message || '电脑对手 Worker 运行失败')
      }
      worker.postMessage({
        type: 'search',
        requestId,
        timelineRevision,
        state,
        options: { difficulty },
      })
    } catch (error) {
      this.fail(
        error instanceof Error ? error.message : '无法启动电脑对手 Worker',
      )
      return requestId
    }
    this.onStateChange()
    return requestId
  }

  advance(milliseconds: number, timelineRevision: number): ComputerSearchResult | null {
    if (this.phase !== 'thinking' || !this.activeRequest) return null
    if (this.activeRequest.timelineRevision !== timelineRevision) {
      this.cancel()
      return null
    }
    if (Number.isFinite(milliseconds) && milliseconds > 0) {
      this.elapsedMs += milliseconds
    }
    const minimumThinkMs = COMPUTER_THINK_DELAY_MS[this.activeRequest.difficulty]
    if (!this.readyResult || this.elapsedMs < minimumThinkMs) return null

    const result = this.readyResult
    this.readyResult = null
    return result
  }

  markCommitted(result: ComputerSearchResult): void {
    if (!result.move) {
      this.fail('电脑对手没有返回可执行着法')
      return
    }
    this.stopWorker()
    this.activeRequest = null
    this.phase = 'animating'
    this.elapsedMs = 0
    this.error = null
    this.lastDecision = {
      move: cloneMove(result.move),
      score: result.score,
      completedDepth: result.completedDepth,
      nodes: result.nodes,
    }
  }

  finishAnimation(): void {
    if (this.phase !== 'animating') return
    this.phase = 'idle'
    this.onStateChange()
  }

  fail(message: string): void {
    this.stopWorker()
    this.activeRequest = null
    this.readyResult = null
    this.phase = 'error'
    this.elapsedMs = 0
    this.error = message
    this.onStateChange()
  }

  cancel(clearLastDecision = false): void {
    this.stopWorker()
    this.activeRequest = null
    this.readyResult = null
    this.phase = 'idle'
    this.elapsedMs = 0
    this.error = null
    if (clearLastDecision) this.lastDecision = null
  }

  getSnapshot(difficulty: ComputerDifficulty): ComputerRuntimeSnapshot {
    return {
      phase: this.phase,
      pending: this.phase === 'thinking',
      requestId: this.activeRequest?.requestId ?? null,
      timelineRevision: this.activeRequest?.timelineRevision ?? null,
      elapsedMs: this.elapsedMs,
      minimumThinkMs:
        this.activeRequest === null
          ? COMPUTER_THINK_DELAY_MS[difficulty]
          : COMPUTER_THINK_DELAY_MS[this.activeRequest.difficulty],
      resultReady: this.readyResult !== null,
      error: this.error,
      lastDecision: this.lastDecision
        ? {
            ...this.lastDecision,
            move: cloneMove(this.lastDecision.move),
          }
        : null,
    }
  }

  private handleMessage(response: ComputerWorkerResponse): void {
    const active = this.activeRequest
    if (
      !active ||
      response.requestId !== active.requestId ||
      response.timelineRevision !== active.timelineRevision
    ) {
      return
    }
    if (response.type === 'error') {
      this.fail(response.message)
      return
    }
    this.stopWorker()
    this.readyResult = response.result
    this.onStateChange()
  }

  private stopWorker(): void {
    if (!this.worker) return
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.terminate()
    this.worker = null
  }
}

function createComputerWorker(): ComputerWorkerLike {
  return new Worker(new URL('../computer/computer.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function cloneMove(move: Move): Move {
  return {
    ...move,
    from: { ...move.from },
    to: { ...move.to },
  }
}
