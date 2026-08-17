import * as Phaser from 'phaser';

/** A world-space point sampled along a beam path. */
export interface BeamPoint {
  x: number;
  y: number;
}

/** Creates a gently jittered, spline-resampled beam path between two anchors. */
export function createJitteredBeamPath(
  start: BeamPoint,
  end: BeamPoint,
  controlCount: number,
  divisions: number,
  jitter: number,
  phase: number,
  motionTrailX = 0,
  motionTrailY = 0,
): BeamPoint[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return [{ ...start }, { ...end }];

  const normalX = -dy / length;
  const normalY = dx / length;
  const controls: BeamPoint[] = [{ ...start }];
  let filteredNoise = Phaser.Math.FloatBetween(-0.35, 0.35);
  for (let index = 1; index < controlCount - 1; index += 1) {
    const t = index / (controlCount - 1);
    const envelope = Math.pow(Math.sin(Math.PI * t), 0.78);
    filteredNoise = filteredNoise * 0.42 + Phaser.Math.FloatBetween(-1, 1) * 0.58;
    const slowBend = Math.sin(phase * 0.34 + t * Math.PI * 2.3) * 0.24;
    const travelingRipple = Math.sin(phase + t * 11.4 + index * 0.37) * 0.2;
    const offset = (filteredNoise * 0.72 + slowBend + travelingRipple) * jitter * envelope;
    const motionEnvelope = Math.sin(Math.PI * t) * Math.pow(1 - t, 1.45);
    controls.push({
      x: Phaser.Math.Linear(start.x, end.x, t) + normalX * offset + motionTrailX * motionEnvelope,
      y: Phaser.Math.Linear(start.y, end.y, t) + normalY * offset + motionTrailY * motionEnvelope,
    });
  }
  controls.push({ ...end });
  return resampleBeamSpline(controls, divisions);
}

/** Resamples control points along a smooth Phaser spline. */
export function resampleBeamSpline(controls: readonly BeamPoint[], divisions: number): BeamPoint[] {
  if (controls.length < 3) return controls.map(point => ({ ...point }));
  const spline = new Phaser.Curves.Spline(
    controls.map(point => new Phaser.Math.Vector2(point.x, point.y)),
  );
  const sampled = spline.getSpacedPoints(divisions).map(point => ({ x: point.x, y: point.y }));
  if (sampled[0]) sampled[0] = { ...controls[0] };
  if (sampled.length > 1) sampled[sampled.length - 1] = { ...controls[controls.length - 1] };
  return sampled;
}

/** Samples a path by normalized distance along its point array. */
export function sampleBeamPath(points: readonly BeamPoint[], t: number): BeamPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0] };
  const scaled = Phaser.Math.Clamp(t, 0, 1) * (points.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(points.length - 1, lower + 1);
  const fraction = scaled - lower;
  return {
    x: Phaser.Math.Linear(points[lower].x, points[upper].x, fraction),
    y: Phaser.Math.Linear(points[lower].y, points[upper].y, fraction),
  };
}

/** Estimates the normalized tangent at a normalized path position. */
export function sampleBeamTangent(points: readonly BeamPoint[], t: number): BeamPoint {
  const before = sampleBeamPath(points, Math.max(0, t - 0.012));
  const after = sampleBeamPath(points, Math.min(1, t + 0.012));
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

/** Blends a newly sampled path into the previous path while preserving both anchors. */
export function blendBeamPaths(
  previous: readonly BeamPoint[],
  next: readonly BeamPoint[],
  nextWeight: number,
  start: BeamPoint,
  end: BeamPoint,
): BeamPoint[] {
  if (previous.length < 2) return next.map(point => ({ ...point }));
  const blended = next.map((point, index) => {
    const t = index / Math.max(1, next.length - 1);
    const old = sampleBeamPath(previous, t);
    return {
      x: Phaser.Math.Linear(old.x, point.x, nextWeight),
      y: Phaser.Math.Linear(old.y, point.y, nextWeight),
    };
  });
  blended[0] = { ...start };
  blended[blended.length - 1] = { ...end };
  return blended;
}

/** Reanchors the start of a path with a smooth falloff toward its end. */
export function reanchorBeamPathStart(points: BeamPoint[], shiftX: number, shiftY: number): void {
  const last = points.length - 1;
  for (let index = 0; index < points.length; index += 1) {
    const t = last > 0 ? index / last : 0;
    const weight = Math.pow(1 - t, 2.35);
    points[index].x += shiftX * weight;
    points[index].y += shiftY * weight;
  }
}

/** Reanchors the end of a path with a smooth falloff toward its start. */
export function reanchorBeamPathEnd(points: BeamPoint[], shiftX: number, shiftY: number): void {
  const last = points.length - 1;
  for (let index = 0; index < points.length; index += 1) {
    const t = last > 0 ? index / last : 1;
    const weight = Math.pow(t, 2.35);
    points[index].x += shiftX * weight;
    points[index].y += shiftY * weight;
  }
}

/** Strokes a sampled beam path on a Phaser Graphics object. */
export function strokeBeamPolyline(
  graphics: Phaser.GameObjects.Graphics,
  points: readonly BeamPoint[],
  width: number,
  color: number,
  alpha: number,
): void {
  const first = points[0];
  if (!first) return;
  graphics.lineStyle(width, color, alpha);
  graphics.beginPath();
  graphics.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    graphics.lineTo(points[index].x, points[index].y);
  }
  graphics.strokePath();
}
