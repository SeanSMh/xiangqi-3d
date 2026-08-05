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

interface ActivePointer {
  pointerId: number
  startX: number
  startY: number
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
      moved: false,
    }
    return true
  }

  move(sample: PointerSample): boolean {
    const active = this.active
    if (!active || sample.pointerId !== active.pointerId) return false
    const distance = Math.hypot(
      sample.clientX - active.startX,
      sample.clientY - active.startY,
    )
    if (distance > this.moveThresholdPx) active.moved = true
    return true
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
