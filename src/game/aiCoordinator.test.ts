import { describe, expect, it } from 'vitest'
import { createInitialState } from '../engine/board'
import type {
  AiSearchResult,
  AiWorkerRequest,
  AiWorkerResponse,
} from '../ai/types'
import {
  AI_THINK_DELAY_MS,
  AiCoordinator,
  type AiWorkerLike,
} from './aiCoordinator'

describe('AiCoordinator', () => {
  it('同时等待 Worker 结果与确定性最短思考时间', () => {
    const workers: FakeWorker[] = []
    const coordinator = new AiCoordinator(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })
    const requestId = coordinator.begin(createInitialState(), 'normal', 7)
    const worker = workers[0]!
    expect(worker.posted).toMatchObject({ requestId, timelineRevision: 7 })
    expect(coordinator.getSnapshot('normal')).toMatchObject({
      phase: 'thinking',
      pending: true,
      resultReady: false,
    })

    worker.emitResult(decision(worker.posted!))
    expect(coordinator.advance(AI_THINK_DELAY_MS.normal - 1, 7)).toBeNull()
    expect(coordinator.advance(1, 7)).toEqual(decision(worker.posted!).result)
  })

  it('revision 改变会终止请求并忽略同 ply 的陈旧结果', () => {
    const workers: FakeWorker[] = []
    const coordinator = new AiCoordinator(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })
    coordinator.begin(createInitialState(), 'hard', 3)
    const stale = workers[0]!
    expect(coordinator.advance(20, 4)).toBeNull()
    expect(stale.terminated).toBe(true)
    expect(coordinator.getSnapshot('hard').phase).toBe('idle')

    coordinator.begin(createInitialState(), 'hard', 4)
    stale.emitResult(decision(stale.posted!))
    expect(coordinator.getSnapshot('hard').resultReady).toBe(false)
    expect(workers[1]!.posted?.requestId).not.toBe(stale.posted?.requestId)
  })

  it('提交、动画完成、取消和 Worker 错误都有明确状态', () => {
    const worker = new FakeWorker()
    const coordinator = new AiCoordinator(() => worker)
    coordinator.begin(createInitialState(), 'easy', 1)
    const result = decision(worker.posted!).result
    coordinator.markCommitted(result)
    expect(coordinator.getSnapshot('easy')).toMatchObject({
      phase: 'animating',
      pending: false,
      lastDecision: { nodes: 12, completedDepth: 1 },
    })
    coordinator.finishAnimation()
    expect(coordinator.getSnapshot('easy').phase).toBe('idle')

    coordinator.begin(createInitialState(), 'easy', 2)
    worker.emitError('boom')
    expect(coordinator.getSnapshot('easy')).toMatchObject({
      phase: 'error',
      error: 'boom',
    })
    coordinator.cancel(true)
    expect(coordinator.getSnapshot('easy')).toMatchObject({
      phase: 'idle',
      lastDecision: null,
    })
  })

  it('Worker 首次无法创建时进入错误态，取消后可重新创建并恢复', () => {
    const worker = new FakeWorker()
    let attempts = 0
    const coordinator = new AiCoordinator(() => {
      attempts += 1
      if (attempts === 1) throw new Error('worker unavailable')
      return worker
    })
    expect(() =>
      coordinator.begin(createInitialState(), 'normal', 1),
    ).not.toThrow()
    expect(coordinator.getSnapshot('normal')).toMatchObject({
      phase: 'error',
      pending: false,
      error: 'worker unavailable',
    })

    coordinator.cancel(true)
    coordinator.begin(createInitialState(), 'normal', 2)
    expect(coordinator.getSnapshot('normal')).toMatchObject({
      phase: 'thinking',
      pending: true,
      error: null,
    })
    worker.emitResult(decision(worker.posted!))
    const recovered = coordinator.advance(AI_THINK_DELAY_MS.normal, 2)
    expect(recovered).toEqual(decision(worker.posted!).result)
    coordinator.markCommitted(recovered!)
    expect(coordinator.getSnapshot('normal').phase).toBe('animating')
  })
})

class FakeWorker implements AiWorkerLike {
  onmessage: ((event: MessageEvent<AiWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  posted: AiWorkerRequest | null = null
  terminated = false

  postMessage(message: AiWorkerRequest): void {
    this.posted = message
  }

  terminate(): void {
    this.terminated = true
  }

  emitResult(response: AiWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<AiWorkerResponse>)
  }

  emitError(message: string): void {
    this.onerror?.({ message, preventDefault: () => undefined } as unknown as ErrorEvent)
  }
}

function decision(request: AiWorkerRequest): Extract<AiWorkerResponse, { type: 'result' }> {
  const result: AiSearchResult = {
    move: {
      pieceId: 'p12',
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    },
    score: 10,
    completedDepth: 1,
    nodes: 12,
    principalVariation: [],
  }
  return {
    type: 'result',
    requestId: request.requestId,
    timelineRevision: request.timelineRevision,
    result,
  }
}
