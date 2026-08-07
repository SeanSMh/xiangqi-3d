import * as THREE from 'three'

/** 格距：交点间距 */
export const CELL = 1.0
/** 棋盘：9 竖线 × 10 横线 → 宽 8 格距，高 9 格距 */
export const BOARD_W = 8 * CELL
export const BOARD_H = 9 * CELL
/** 待机占位：直径不超过 0.85 格（交点周围） */
export const OCCUPANCY_DIAMETER = 0.85 * CELL
/** 取景与投影测量所用的棋盘外沿留白。 */
export const BOARD_EDGE_MARGIN = 0.47

/**
 * 棋盘内部坐标固定：rank 0 为红方底线、rank 9 为黑方底线。
 * 屏幕左右由相机方位决定，规则层永远不参与视角换算。
 */
export function fileRankToWorld(file: number, rank: number): THREE.Vector3 {
  const x = (file - 4) * CELL
  const z = (rank - 4.5) * CELL
  return new THREE.Vector3(x, 0, z)
}
