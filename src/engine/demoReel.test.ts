import { describe, expect, it } from 'vitest'
import { createInitialState, pieceAt } from './board'
import { applyMove } from './moves'
import type { GameState, Move } from '../types/xiangqi'

/**
 * 录屏脚本用的那条对局线必须始终合法。
 *
 * `scripts/demo_reel.js` 靠合成 PointerEvent 逐手点出这条线；只要有一手因为
 * 规则改动而失效，脚本会卡在中途——而这种事只有等到真去录片子时才会发现。
 * 因此把它接进测试，并且**直接读脚本源文件**取着法，而不是在这里抄一份：
 * 抄一份就会漂移，漂移了这条测试反而变成噪音。
 */
const DEMO_SOURCE = Object.values(
  import.meta.glob('/scripts/demo_reel.js', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0] as string | undefined

function extractLine(source: string): string[] {
  return [...source.matchAll(/uci:\s*'([a-i]\d[a-i]\d)'/g)].map(
    (match) => match[1]!,
  )
}

function parseUcci(state: GameState, notation: string): Move {
  const fromFile = notation.charCodeAt(0) - 97
  const fromRank = Number(notation[1])
  const toFile = notation.charCodeAt(2) - 97
  const toRank = Number(notation[3])
  const moving = pieceAt(state.pieces, fromFile, fromRank)
  if (!moving) throw new Error(`起点没有棋子：${notation}`)
  const captured = pieceAt(state.pieces, toFile, toRank)
  return {
    pieceId: moving.id,
    from: { file: fromFile, rank: fromRank },
    to: { file: toFile, rank: toRank },
    ...(captured ? { capturedId: captured.id } : {}),
  }
}

describe('录屏演示对局线', () => {
  it('能从脚本里读到着法', () => {
    expect(DEMO_SOURCE).toBeTypeOf('string')
    expect(extractLine(DEMO_SOURCE!)).toHaveLength(14)
  })

  it('逐手合法，并以将死收尾', () => {
    let state = createInitialState()
    extractLine(DEMO_SOURCE!).forEach((notation, index) => {
      expect(
        state.status,
        `第 ${index + 1} 手 ${notation} 之前对局已结束`,
      ).toBe('playing')
      // applyMove 会重新走一遍权威校验，非法着直接抛错。
      state = applyMove(state, parseUcci(state, notation))
    })

    expect(state.status).toBe('checkmate')
    expect(state.winner).toBe('black')
  })

  it('拍得到炮的弹道、车的拖尾与马的腾跃', () => {
    // 这条线是为了展示演出而选的：三种最有辨识度的出手形态都得真的出现，
    // 否则片子就只剩「棋子平移」。炮与车必须是**吃子**才有弹道和冲击。
    let state = createInitialState()
    const capturingKinds = new Set<string>()
    let checks = 0

    for (const notation of extractLine(DEMO_SOURCE!)) {
      const move = parseUcci(state, notation)
      const mover = state.pieces.find((piece) => piece.id === move.pieceId)!
      if (move.capturedId) capturingKinds.add(mover.kind)
      state = applyMove(state, move)
      if (state.history.at(-1)!.givesCheck) checks += 1
    }

    expect(capturingKinds).toContain('cannon')
    expect(capturingKinds).toContain('chariot')
    expect(capturingKinds).toContain('horse')
    expect(checks).toBeGreaterThanOrEqual(2)
  })
})
