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
    const firstDrag = gesture.trackMove(
      sample({
        clientX: 120 + BOARD_TAP_MOVE_THRESHOLD_PX + 0.1,
        clientY: 244,
      }),
    )
    expect(firstDrag.tracked).toBe(true)
    expect(firstDrag.drag).toMatchObject({
      deltaYCss: 4,
      justStarted: true,
    })
    expect(firstDrag.drag?.deltaXCss).toBeCloseTo(
      BOARD_TAP_MOVE_THRESHOLD_PX + 0.1,
    )
    expect(gesture.isDragging).toBe(true)

    expect(
      gesture.trackMove(sample({ clientX: 142, clientY: 248 })),
    ).toEqual({
      tracked: true,
      drag: {
        deltaXCss: 142 - (120 + BOARD_TAP_MOVE_THRESHOLD_PX + 0.1),
        deltaYCss: 4,
        justStarted: false,
      },
    })
    expect(gesture.end(sample({ clientX: 132 }))).toBeNull()
  })

  it('只在 pointerup 出现的最终位移仍可先交给旋转层消费', () => {
    const gesture = new BoardTapGesture()
    gesture.begin(sample())
    const finalMove = gesture.trackMove(sample({ clientX: 150 }))

    expect(finalMove.drag).toEqual({
      deltaXCss: 30,
      deltaYCss: 0,
      justStarted: true,
    })
    expect(gesture.end(sample({ clientX: 150 }))).toBeNull()
    expect(gesture.activePointerId).toBeNull()
  })

  it('分段越过死区时一次补齐起点位移，旋转量不受事件频率影响', () => {
    const gesture = new BoardTapGesture()
    gesture.begin(sample())

    expect(gesture.trackMove(sample({ clientX: 126 })).drag).toBeNull()
    expect(gesture.trackMove(sample({ clientX: 132 })).drag).toEqual({
      deltaXCss: 12,
      deltaYCss: 0,
      justStarted: true,
    })
    expect(gesture.trackMove(sample({ clientX: 140 })).drag).toEqual({
      deltaXCss: 8,
      deltaYCss: 0,
      justStarted: false,
    })
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
