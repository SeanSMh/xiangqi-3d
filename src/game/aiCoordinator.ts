import type {
  AiDifficulty,
  AiSearchResult,
  AiWorkerRequest,
  AiWorkerResponse,
} from '../ai/types'
import type { GameState, Move } from '../types/xiangqi'

export type AiPhase = 'idle' | 'thinking' | 'animating' | 'error'

export const AI_THINK_DELAY_MS: Record<AiDifficulty, number> = {
  easy: 420,
  normal: 650,
  hard: 900,
}

export interface AiDecisionSummary {
  move: Move
  score: number
  completedDepth: number
  nodes: number
}

export interface AiRuntimeSnapshot {
  phase: AiPhase
  pending: boolean
  requestId: number | null
  timelineRevision: number | null
  elapsedMs: number
  minimumThinkMs: number
  resultReady: boolean
  error: string | null
  lastDecision: AiDecisionSummary | null
}

export interface AiWorkerLike {
  onmessage: ((event: MessageEvent<AiWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: AiWorkerRequest): void
  terminate(): void
}

export type AiWorkerFactory = () => AiWorkerLike

interface ActiveRequest {
  requestId: number
  timelineRevision: number
  difficulty: AiDifficulty
}

/** 管理 Worker、最短思考演出与陈旧结果失效，不决定何时轮到 AI。 */
export class AiCoordinator {
  private readonly workerFactory: AiWorkerFactory
  private readonly onStateChange: () => void
  private worker: AiWorkerLike | null = null
  private activeRequest: ActiveRequest | null = null
  private nextRequestId = 0
  private phase: AiPhase = 'idle'
  private elapsedMs = 0
  private readyResult: AiSearchResult | null = null
  private error: string | null = null
  private lastDecision: AiDecisionSummary | null = null

  constructor(
    workerFactory: AiWorkerFactory = createAiWorker,
    onStateChange: () => void = () => undefined,
  ) {
    this.workerFactory = workerFactory
    this.onStateChange = onStateChange
  }

  begin(
    state: GameState,
    difficulty: AiDifficulty,
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
        this.fail(event.message || 'AI Worker 运行失败')
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
        error instanceof Error ? error.message : '无法启动 AI Worker',
      )
      return requestId
    }
    this.onStateChange()
    return requestId
  }

  advance(milliseconds: number, timelineRevision: number): AiSearchResult | null {
    if (this.phase !== 'thinking' || !this.activeRequest) return null
    if (this.activeRequest.timelineRevision !== timelineRevision) {
      this.cancel()
      return null
    }
    if (Number.isFinite(milliseconds) && milliseconds > 0) {
      this.elapsedMs += milliseconds
    }
    const minimumThinkMs = AI_THINK_DELAY_MS[this.activeRequest.difficulty]
    if (!this.readyResult || this.elapsedMs < minimumThinkMs) return null

    const result = this.readyResult
    this.readyResult = null
    return result
  }

  markCommitted(result: AiSearchResult): void {
    if (!result.move) {
      this.fail('AI 没有返回可执行着法')
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

  getSnapshot(difficulty: AiDifficulty): AiRuntimeSnapshot {
    return {
      phase: this.phase,
      pending: this.phase === 'thinking',
      requestId: this.activeRequest?.requestId ?? null,
      timelineRevision: this.activeRequest?.timelineRevision ?? null,
      elapsedMs: this.elapsedMs,
      minimumThinkMs:
        this.activeRequest === null
          ? AI_THINK_DELAY_MS[difficulty]
          : AI_THINK_DELAY_MS[this.activeRequest.difficulty],
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

  private handleMessage(response: AiWorkerResponse): void {
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

function createAiWorker(): AiWorkerLike {
  return new Worker(new URL('../ai/ai.worker.ts', import.meta.url), {
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
