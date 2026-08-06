export const BOARD_TAP_MOVE_THRESHOLD_PX = 10

export interface PointerSample {
  pointerId: number
  clientX: number
  clientY: number
  button: number
  isPrimary: boolean
}

export interface BoardTap {
  clientX: number
  clientY: number
}

export interface BoardDrag {
  deltaXCss: number
  deltaYCss: number
  justStarted: boolean
}

export interface BoardPointerMove {
  tracked: boolean
  drag: BoardDrag | null
}

interface ActivePointer {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  moved: boolean
}

/**
 * 将浏览器 PointerEvent 归并成一次可靠 tap。规则提交只发生在 pointerup；
 * 多指、非主指针、右键、拖动和 pointercancel 都不会产生棋盘点击。
 */
export class BoardTapGesture {
  private active: ActivePointer | null = null

  constructor(
    private readonly moveThresholdPx = BOARD_TAP_MOVE_THRESHOLD_PX,
  ) {}

  get activePointerId(): number | null {
    return this.active?.pointerId ?? null
  }

  get isDragging(): boolean {
    return this.active?.moved ?? false
  }

  begin(sample: PointerSample): boolean {
    if (this.active) {
      // 任意额外 pointerdown 都把当前手势升级为多指/异常手势；首指随后抬起也不得提交。
      this.active = null
      return false
    }
    if (
      !sample.isPrimary ||
      sample.button !== 0 ||
      !Number.isFinite(sample.clientX) ||
      !Number.isFinite(sample.clientY)
    ) {
      return false
    }
    this.active = {
      pointerId: sample.pointerId,
      startX: sample.clientX,
      startY: sample.clientY,
      lastX: sample.clientX,
      lastY: sample.clientY,
      moved: false,
    }
    return true
  }

  move(sample: PointerSample): boolean {
    return this.trackMove(sample).tracked
  }

  /**
   * 10px 死区内只跟踪 tap；越过死区后输出逐事件增量，由相机消费。
   * 这样轻触不会先轻微转镜头，拖动也永远不会在 pointerup 误走棋。
   */
  trackMove(sample: PointerSample): BoardPointerMove {
    const active = this.active
    if (
      !active ||
      sample.pointerId !== active.pointerId ||
      !Number.isFinite(sample.clientX) ||
      !Number.isFinite(sample.clientY)
    ) {
      return { tracked: false, drag: null }
    }
    const incrementalDeltaXCss = sample.clientX - active.lastX
    const incrementalDeltaYCss = sample.clientY - active.lastY
    const totalDeltaXCss = sample.clientX - active.startX
    const totalDeltaYCss = sample.clientY - active.startY
    const distance = Math.hypot(totalDeltaXCss, totalDeltaYCss)
    const wasDragging = active.moved
    if (distance > this.moveThresholdPx) active.moved = true
    const justStarted = active.moved && !wasDragging
    const deltaXCss = justStarted
      ? totalDeltaXCss
      : incrementalDeltaXCss
    const deltaYCss = justStarted
      ? totalDeltaYCss
      : incrementalDeltaYCss
    active.lastX = sample.clientX
    active.lastY = sample.clientY
    return {
      tracked: true,
      drag:
        active.moved && (deltaXCss !== 0 || deltaYCss !== 0)
          ? {
              deltaXCss,
              deltaYCss,
              justStarted,
            }
          : null,
    }
  }

  end(sample: PointerSample): BoardTap | null {
    const active = this.active
    if (!active || sample.pointerId !== active.pointerId) return null
    this.move(sample)
    this.active = null
    if (active.moved) return null
    return { clientX: sample.clientX, clientY: sample.clientY }
  }

  cancel(pointerId?: number): boolean {
    if (!this.active) return false
    if (pointerId !== undefined && pointerId !== this.active.pointerId) {
      return false
    }
    this.active = null
    return true
  }
}
