import { chooseAiMove } from './search'
import type { AiWorkerRequest, AiWorkerResponse } from './types'

interface WorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<AiWorkerRequest>) => void,
  ): void
  postMessage(message: AiWorkerResponse): void
}

const workerScope = self as unknown as WorkerScope

workerScope.addEventListener('message', (event) => {
  const request = event.data
  if (request.type !== 'search') return
  try {
    workerScope.postMessage({
      type: 'result',
      requestId: request.requestId,
      timelineRevision: request.timelineRevision,
      result: chooseAiMove(request.state, request.options),
    })
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      requestId: request.requestId,
      timelineRevision: request.timelineRevision,
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
