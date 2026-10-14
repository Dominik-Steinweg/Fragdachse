import { getVisibleWorldView } from '../graphics/CameraWorldView';
export { getVisibleWorldView, type CameraWorldViewSource } from '../graphics/CameraWorldView';


export interface WorldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WorldViewRect extends WorldRect {
  readonly centerX: number;
  readonly centerY: number;
}

export interface CameraViewportTransform {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** True as soon as a world point enters the camera view. */
export function isWorldPointInsideView(x: number, y: number, view: WorldRect): boolean {
  return x >= view.x
    && x <= view.x + view.width
    && y >= view.y
    && y <= view.y + view.height;
}

/** Returns a point inset from the camera rectangle that lies on the target-facing edge. */
export function getArrowPointOnWorldViewEdge(
  targetX: number,
  targetY: number,
  view: WorldViewRect,
  inset = 10,
): { x: number; y: number } {
  const dx = targetX - view.centerX;
  const dy = targetY - view.centerY;
  const halfWidth = Math.max(1, view.width * 0.5 - inset);
  const halfHeight = Math.max(1, view.height * 0.5 - inset);
  const scaleX = Math.abs(dx) > 0.001 ? halfWidth / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const scaleY = Math.abs(dy) > 0.001 ? halfHeight / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const scale = Math.min(scaleX, scaleY);
  if (!Number.isFinite(scale)) return { x: view.centerX, y: view.centerY };
  return {
    x: view.centerX + dx * scale,
    y: view.centerY + dy * scale,
  };
}

/** Converts the target-facing world-view edge point into coordinates for a scroll-fixed overlay. */
export function getArrowPointOnScreenViewEdge(
  targetX: number,
  targetY: number,
  view: WorldViewRect,
  camera: CameraViewportTransform,
  inset = 10,
): { x: number; y: number } {
  const zoom = Math.max(0.001, camera.zoom);
  const edge = getArrowPointOnWorldViewEdge(targetX, targetY, view, inset / zoom);
  return {
    x: camera.x / zoom + edge.x - view.x,
    y: camera.y / zoom + edge.y - view.y,
  };
}
