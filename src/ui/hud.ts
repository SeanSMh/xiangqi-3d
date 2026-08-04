import { pieceLabel } from '../engine/board'
import type { GameState, Piece, Side } from '../types/xiangqi'

interface HudActions {
  onRestart: () => void
  onToggleFullscreen: () => void
}

/** 左上局面、右上战果、底部操作与终局提示。 */
export class Hud {
  private turnEl: HTMLDivElement
  private checkEl: HTMLSpanElement
  private spoilsEl: HTMLDivElement
  private selectionEl: HTMLDivElement
  private gameStatusEl: HTMLDivElement

  constructor(container: HTMLElement, actions: HudActions) {
    const root = document.createElement('div')
    root.id = 'xiangqi-hud'
    Object.assign(root.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '10',
      userSelect: 'none',
    } as CSSStyleDeclaration)

    this.turnEl = makePanel('turn-panel')
    Object.assign(this.turnEl.style, {
      top: '16px',
      left: '16px',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    } as CSSStyleDeclaration)

    this.checkEl = document.createElement('span')
    this.checkEl.id = 'check-indicator'
    Object.assign(this.checkEl.style, {
      display: 'none',
      padding: '4px 10px',
      borderRadius: '999px',
      background: '#c62828',
      color: '#fff',
      fontWeight: '800',
      fontSize: '12px',
      boxShadow: '0 0 18px rgba(255,50,40,.55)',
    } as CSSStyleDeclaration)
    this.checkEl.textContent = '将军'
    this.turnEl.append(document.createElement('span'), this.checkEl)

    this.spoilsEl = makePanel('spoils-panel')
    Object.assign(this.spoilsEl.style, {
      top: '16px',
      right: '16px',
      minWidth: '150px',
      textAlign: 'right',
    } as CSSStyleDeclaration)

    this.gameStatusEl = document.createElement('div')
    this.gameStatusEl.id = 'game-status'
    Object.assign(this.gameStatusEl.style, {
      position: 'absolute',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      minWidth: '220px',
      padding: '10px 18px',
      borderRadius: '999px',
      background: 'rgba(8,8,15,.76)',
      border: '1px solid rgba(212,175,55,.35)',
      boxShadow: '0 10px 30px rgba(0,0,0,.25)',
      textAlign: 'center',
      fontSize: '13px',
      letterSpacing: '.04em',
    } as CSSStyleDeclaration)

    const controls = document.createElement('div')
    Object.assign(controls.style, {
      position: 'absolute',
      bottom: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px 10px',
      borderRadius: '12px',
      background: 'rgba(8,8,15,.72)',
      border: '1px solid rgba(255,255,255,.12)',
      pointerEvents: 'auto',
    } as CSSStyleDeclaration)

    this.selectionEl = document.createElement('div')
    this.selectionEl.id = 'selection-status'
    Object.assign(this.selectionEl.style, {
      minWidth: '205px',
      padding: '0 8px',
      fontSize: '12px',
      color: 'rgba(255,255,255,.76)',
    } as CSSStyleDeclaration)

    const restartButton = makeButton('restart-btn', '重开 R', actions.onRestart)
    const fullscreenButton = makeButton(
      'fullscreen-btn',
      '全屏 F',
      actions.onToggleFullscreen,
    )
    controls.append(this.selectionEl, restartButton, fullscreenButton)

    root.append(
      this.turnEl,
      this.spoilsEl,
      this.gameStatusEl,
      controls,
    )
    container.appendChild(root)
  }

  update(
    state: GameState,
    selected: Piece | undefined,
    legalCount: number,
  ): void {
    const sideLabel = state.sideToMove === 'red' ? '红方' : '黑方'
    const sideColor = state.sideToMove === 'red' ? '#ff665c' : '#80bfff'
    const turnLabel = this.turnEl.firstChild as HTMLSpanElement
    turnLabel.textContent = `第 ${state.history.length + 1} 手 · ${sideLabel}行棋`
    turnLabel.style.color = sideColor
    turnLabel.style.fontWeight = '700'
    this.checkEl.style.display = state.inCheck ? 'inline-block' : 'none'

    this.spoilsEl.innerHTML = `
      <div style="opacity:.58;font-size:10px;letter-spacing:.14em;margin-bottom:5px">战果 SPOILS</div>
      <div style="font-weight:700;color:#f5d76e">${formatSpoils(state)}</div>
      <div style="opacity:.5;font-size:10px;margin-top:5px">已吃 ${capturedCount(state)} 子</div>
    `

    if (state.status === 'playing') {
      this.gameStatusEl.textContent = state.inCheck
        ? `${sideLabel}正在被将军，请应将`
        : '本地双人对局'
      this.gameStatusEl.style.color = state.inCheck ? '#ff8a80' : '#f4df91'
    } else {
      const winner = state.winner === 'red' ? '红方' : '黑方'
      const reason = state.status === 'checkmate' ? '绝杀' : '困毙'
      this.gameStatusEl.textContent = `${winner}获胜 · ${reason}`
      this.gameStatusEl.style.color = '#ffd45a'
      this.gameStatusEl.style.borderColor = 'rgba(255,188,45,.8)'
    }

    if (state.status !== 'playing') {
      this.selectionEl.textContent = '对局结束，可点击“重开”再来一局'
    } else if (selected) {
      const faction = selected.side === 'red' ? '红' : '黑'
      this.selectionEl.textContent = `已选 ${faction}${pieceLabel(selected.kind, selected.side)} · ${legalCount} 个合法落点`
    } else {
      this.selectionEl.textContent = '点选棋子，再点亮起的合法落点'
    }
  }
}

function makePanel(id: string): HTMLDivElement {
  const panel = document.createElement('div')
  panel.id = id
  Object.assign(panel.style, {
    position: 'absolute',
    padding: '11px 14px',
    borderRadius: '12px',
    background: 'rgba(8,8,15,.74)',
    border: '1px solid rgba(212,175,55,.38)',
    boxShadow: '0 10px 30px rgba(0,0,0,.28)',
    fontSize: '13px',
    letterSpacing: '.03em',
    backdropFilter: 'blur(8px)',
  } as CSSStyleDeclaration)
  return panel
}

function makeButton(
  id: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.id = id
  button.type = 'button'
  button.textContent = label
  button.addEventListener('click', onClick)
  Object.assign(button.style, {
    appearance: 'none',
    border: '1px solid rgba(212,175,55,.46)',
    borderRadius: '8px',
    padding: '7px 10px',
    background: 'rgba(39,30,25,.9)',
    color: '#f7e9b0',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '12px',
  } as CSSStyleDeclaration)
  return button
}

function capturedCount(state: GameState): number {
  return state.pieces.filter((piece) => piece.captured).length
}

function formatSpoils(state: GameState): string {
  const score = (side: Side) =>
    state.pieces
      .filter((piece) => piece.side === side && !piece.captured)
      .reduce((sum, piece) => sum + pieceValue(piece.kind), 0)

  const difference = score('red') - score('black')
  if (difference === 0) return '均势 EVEN'
  return difference > 0 ? `红方 +${difference}` : `黑方 +${-difference}`
}

function pieceValue(kind: Piece['kind']): number {
  switch (kind) {
    case 'chariot':
      return 9
    case 'cannon':
      return 5
    case 'horse':
      return 4
    case 'elephant':
    case 'advisor':
      return 2
    case 'pawn':
      return 1
    case 'king':
      return 0
  }
}
