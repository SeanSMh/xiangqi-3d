export {}

declare global {
  interface Window {
    render_game_to_text: () => string
    advanceTime: (milliseconds: number) => number
    /** 交点 (file, rank) 在屏幕上的 CSS 坐标，供自动化验收精确点击。 */
    projectSquare: (
      file: number,
      rank: number,
    ) => { x: number; y: number } | null
  }
}
