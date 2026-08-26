import { chooseComputerMove } from './search'
import type { ComputerWorkerRequest, ComputerWorkerResponse } from './types'

interface WorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<ComputerWorkerRequest>) => void,
  ): void
  postMessage(message: ComputerWorkerResponse): void
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
      result: chooseComputerMove(request.state, request.options),
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
