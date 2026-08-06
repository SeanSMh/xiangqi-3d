import { describe, expect, it } from 'vitest'
import { createInitialState } from '../engine/board'
import type { PieceKind, Side } from '../types/xiangqi'
import { createCompactPromptLabel, createSpoilsViewModel } from './hud'
import { resolveHudLayout } from './responsiveHud'

describe('resolveHudLayout', () => {
  it.each([
    [375, 667, 'compact', 150, 142, 8, 8],
    [390, 844, 'compact', 150, 142, 8, 8],
    [768, 1024, 'portrait', 160, 92, 12, 12],
    [1280, 720, 'desktop', 76, 76, 16, 16],
  ] as const)(
    '%d×%d 选择 %s 布局并暴露稳定安全区',
    (
      width,
      height,
      mode,
      topReservedPx,
      bottomReservedPx,
      leftReservedPx,
      rightReservedPx,
    ) => {
      expect(resolveHudLayout(width, height)).toMatchObject({
        mode,
        orientation: height > width ? 'portrait' : 'landscape',
        topReservedPx,
        bottomReservedPx,
        leftReservedPx,
        rightReservedPx,
      })
    },
  )

  it.each([
    [844, 390],
    [667, 375],
    [600, 360],
    [568, 320],
  ] as const)('%d×%d 使用左右 side-rail 并保留中央棋盘', (width, height) => {
    expect(resolveHudLayout(width, height)).toMatchObject({
      mode: 'side-rail',
      orientation: 'landscape',
      topReservedPx: 8,
      bottomReservedPx: 8,
      leftReservedPx: 184,
      rightReservedPx: 124,
      minimumTouchTargetPx: 44,
    })
  })

  it('非法尺寸安全降级', () => {
    expect(resolveHudLayout(Number.NaN, 0)).toMatchObject({
      mode: 'compact',
      orientation: 'landscape',
    })
  })
})

describe('createCompactPromptLabel', () => {
  it.each(['turn-local', 'turn-human'] as const)(
    '%s 用一行短指令替代重复的行棋方标题',
    (code) => {
      expect(
        createCompactPromptLabel({
          code,
          tone: 'info',
          title: code === 'turn-local' ? '红方行棋' : '轮到你（红方）',
          detail: '点选棋子，再点亮起的合法落点',
        }),
      ).toBe('点按走棋 · 拖动旋转视角')
    },
  )

  it('选中棋子时保留棋子与合法落点数量', () => {
    expect(
      createCompactPromptLabel({
        code: 'piece-selected',
        tone: 'info',
        title: '已选红马',
        detail: '2 个合法落点',
        action: '点击亮起的落点行棋',
      }),
    ).toBe('已选红马 · 2 个合法落点')
  })

  it('无合法落点时给出改选动作，异常提示保持权威标题', () => {
    expect(
      createCompactPromptLabel({
        code: 'piece-selected',
        tone: 'warning',
        title: '已选红马',
        detail: '当前没有合法落点',
        action: '请选择其他棋子',
      }),
    ).toBe('已选红马 · 请选择其他棋子')
    expect(
      createCompactPromptLabel({
        code: 'repetition-warning',
        tone: 'warning',
        title: '循环警告',
        detail: '局面已第二次出现；再次重复将触发循环裁决',
        action: '请考虑变着',
      }),
    ).toBe('循环警告')
  })
})

describe('createSpoilsViewModel', () => {
  it('初局按双方所得战果分组且均为空', () => {
    const view = createSpoilsViewModel(createInitialState())

    expect(view.scoreLabel).toBe('均势 EVEN')
    expect(view.total).toBe(0)
    expect(view.red).toMatchObject({
      captor: 'red',
      capturedSide: 'black',
      total: 0,
      badges: [],
      accessibleLabel: '红方已吃黑方 0 子：暂无',
    })
    expect(view.black).toMatchObject({
      captor: 'black',
      capturedSide: 'red',
      total: 0,
      badges: [],
      accessibleLabel: '黑方已吃红方 0 子：暂无',
    })
  })

  it('同类棋子合并计数并按固定棋种顺序展示', () => {
    const state = createInitialState()
    const blackChariot = state.pieces.find(
      (piece) => piece.side === 'black' && piece.kind === 'chariot',
    )
    const blackPawns = state.pieces
      .filter((piece) => piece.side === 'black' && piece.kind === 'pawn')
      .slice(0, 2)
    const redHorse = state.pieces.find(
      (piece) => piece.side === 'red' && piece.kind === 'horse',
    )
    if (!blackChariot || blackPawns.length !== 2 || !redHorse) {
      throw new Error('测试棋子缺失')
    }
    blackChariot.captured = true
    for (const pawn of blackPawns) pawn.captured = true
    redHorse.captured = true

    const view = createSpoilsViewModel(state)

    expect(view.scoreLabel).toBe('红方 +7')
    expect(view.total).toBe(4)
    expect(view.red.badges).toEqual([
      {
        kind: 'chariot',
        side: 'black',
        label: '车',
        count: 1,
        assetUrl: '/assets/badges/badge_black_车.png',
      },
      {
        kind: 'pawn',
        side: 'black',
        label: '卒',
        count: 2,
        assetUrl: '/assets/badges/badge_black_卒.png',
      },
    ])
    expect(view.red.accessibleLabel).toBe('红方已吃黑方 3 子：车 1、卒 2')
    expect(view.black.badges).toEqual([
      {
        kind: 'horse',
        side: 'red',
        label: '马',
        count: 1,
        assetUrl: '/assets/badges/badge_red_马.png',
      },
    ])
    expect(view.black.accessibleLabel).toBe('黑方已吃红方 1 子：马 1')
  })

  it('为红黑双方七种棋子生成 production badge 路径', () => {
    const kinds: PieceKind[] = [
      'king',
      'advisor',
      'elephant',
      'horse',
      'chariot',
      'cannon',
      'pawn',
    ]
    const sides: Side[] = ['red', 'black']
    const pieces = sides.flatMap((side) =>
      kinds.map((kind, index) => ({
        id: `${side}-${kind}`,
        side,
        kind,
        file: index,
        rank: side === 'red' ? 0 : 9,
        captured: true,
      })),
    )

    const view = createSpoilsViewModel({ pieces })
    const badges = [...view.red.badges, ...view.black.badges]

    expect(badges).toHaveLength(14)
    expect(badges.map((badge) => badge.assetUrl)).toEqual(
      expect.arrayContaining([
        '/assets/badges/badge_red_帅.png',
        '/assets/badges/badge_red_仕.png',
        '/assets/badges/badge_red_相.png',
        '/assets/badges/badge_red_马.png',
        '/assets/badges/badge_red_车.png',
        '/assets/badges/badge_red_炮.png',
        '/assets/badges/badge_red_兵.png',
        '/assets/badges/badge_black_将.png',
        '/assets/badges/badge_black_士.png',
        '/assets/badges/badge_black_象.png',
        '/assets/badges/badge_black_马.png',
        '/assets/badges/badge_black_车.png',
        '/assets/badges/badge_black_炮.png',
        '/assets/badges/badge_black_卒.png',
      ]),
    )
  })

  it('当前吃子演出完成前不提前计入战果', () => {
    const state = createInitialState()
    const blackHorse = state.pieces.find(
      (piece) => piece.side === 'black' && piece.kind === 'horse',
    )
    if (!blackHorse) throw new Error('测试黑马缺失')
    blackHorse.captured = true

    const pending = createSpoilsViewModel(state, blackHorse.id)
    expect(pending.total).toBe(0)
    expect(pending.scoreLabel).toBe('均势 EVEN')
    expect(pending.red.badges).toEqual([])

    const settled = createSpoilsViewModel(state)
    expect(settled.total).toBe(1)
    expect(settled.scoreLabel).toBe('红方 +4')
    expect(settled.red.badges[0]).toMatchObject({
      kind: 'horse',
      count: 1,
    })
  })
})
