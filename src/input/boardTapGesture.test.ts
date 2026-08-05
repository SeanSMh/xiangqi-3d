import { describe, expect, it } from 'vitest'
import {
  BOARD_TAP_MOVE_THRESHOLD_PX,
  BoardTapGesture,
  type PointerSample,
} from './boardTapGesture'

const sample = (
  overrides: Partial<PointerSample> = {},
): PointerSample => ({
  pointerId: 1,
  clientX: 120,
  clientY: 240,
  button: 0,
  isPrimary: true,
  ...overrides,
})

describe('BoardTapGesture', () => {
  it('同一主指针轻微移动后在 pointerup 提交一次 tap', () => {
    const gesture = new BoardTapGesture()
    expect(gesture.begin(sample())).toBe(true)
    expect(
      gesture.move(
        sample({
          clientX: 120 + BOARD_TAP_MOVE_THRESHOLD_PX,
          clientY: 240,
        }),
      ),
    ).toBe(true)
    expect(gesture.end(sample({ clientX: 126, clientY: 244 }))).toEqual({
      clientX: 126,
      clientY: 244,
    })
    expect(gesture.activePointerId).toBeNull()
  })

  it('超过阈值的拖动不会误走棋', () => {
    const gesture = new BoardTapGesture()
    gesture.begin(sample())
    gesture.move(
      sample({ clientX: 120 + BOARD_TAP_MOVE_THRESHOLD_PX + 0.1 }),
    )
    expect(gesture.end(sample({ clientX: 132 }))).toBeNull()
  })

  it('忽略右键与非主触点，并在第二指按下时取消首指提交', () => {
    const gesture = new BoardTapGesture()
    expect(gesture.begin(sample({ button: 2 }))).toBe(false)
    expect(gesture.begin(sample({ isPrimary: false }))).toBe(false)
    expect(gesture.begin(sample())).toBe(true)
    expect(gesture.begin(sample({ pointerId: 2 }))).toBe(false)
    expect(gesture.end(sample({ pointerId: 2 }))).toBeNull()
    expect(gesture.activePointerId).toBeNull()
    expect(gesture.end(sample())).toBeNull()
  })

  it('pointercancel 只清理匹配指针且不会产生 tap', () => {
    const gesture = new BoardTapGesture()
    gesture.begin(sample())
    expect(gesture.cancel(2)).toBe(false)
    expect(gesture.cancel(1)).toBe(true)
    expect(gesture.end(sample())).toBeNull()
  })
})
