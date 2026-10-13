export interface FireControlCopyPosition {
  readonly x: number;
  readonly y: number;
}

export interface FireControlCopyLayoutInput {
  readonly pointX: number;
  readonly pointY: number;
  readonly count: number;
  readonly ringRadius: number;
  readonly singleCopyOffsetPx: number;
  readonly directionAngle: number;
  /** Must return the same answer for the same position during a layout calculation. */
  readonly isFree: (x: number, y: number) => boolean;
  readonly minSeparation?: number;
  readonly candidateCount?: number;
}

/**
 * Clockwise formation slots, starting at the top. Tries regular polygons first;
 * fallback maximizes the smallest circular gap, with lexicographic index ties.
 * Invalid geometry/count parameters fail closed instead of producing partial layouts.
 */
export function layoutFireControlCopies(
  input: FireControlCopyLayoutInput,
): readonly FireControlCopyPosition[] | null {
  const { pointX, pointY, count, ringRadius, isFree } = input;
  if (count <= 0) return [];
  if (!Number.isInteger(count) || !Number.isFinite(pointX) || !Number.isFinite(pointY)) return null;
  if (!isFree(pointX, pointY)) return null;
  if (count === 1) {
    if (!Number.isFinite(input.singleCopyOffsetPx) || input.singleCopyOffsetPx < 0
      || !Number.isFinite(input.directionAngle)) return null;
    const point = { x: pointX + Math.cos(input.directionAngle) * input.singleCopyOffsetPx,
      y: pointY + Math.sin(input.directionAngle) * input.singleCopyOffsetPx };
    return isFree(point.x, point.y) ? [point] : null;
  }

  const minSeparation = input.minSeparation ?? ringRadius;
  const candidateCount = input.candidateCount ?? 24;
  if (!Number.isFinite(ringRadius) || ringRadius < 0
    || !Number.isFinite(minSeparation) || minSeparation < 0
    || !Number.isInteger(candidateCount) || candidateCount <= 0) return null;

  const circle = 2 * Math.PI;
  const pointAt = (turn: number): FireControlCopyPosition => {
    const angle = -Math.PI / 2 + circle * turn;
    return { x: pointX + ringRadius * Math.cos(angle), y: pointY + ringRadius * Math.sin(angle) };
  };
  const hasSeparation = (turn: number): boolean => {
    const chord = 2 * ringRadius * Math.sin(Math.PI * turn);
    // A mathematically exact boundary (e.g. a regular hexagon) can round one ULP below it.
    return chord + Number.EPSILON * Math.max(chord, minSeparation) >= minSeparation;
  };

  // No arrangement can have a larger minimum gap than the regular polygon.
  if (!hasSeparation(1 / count)) return null;
  for (let rotation = 0; rotation < candidateCount; rotation++) {
    const positions = Array.from({ length: count }, (_, slot) =>
      pointAt((rotation / candidateCount + slot / count) % 1));
    if (positions.every(point => isFree(point.x, point.y))) return positions;
  }

  const ring = Array.from({ length: candidateCount }, (_, index) => pointAt(index / candidateCount));
  const freeIndices = ring.flatMap((point, index) => isFree(point.x, point.y) ? [index] : []);
  if (freeIndices.length < count) return null;

  // Integer circular gaps avoid floating-point ties between equivalent formations.
  for (let gap = Math.floor(candidateCount / count); gap >= 1; gap--) {
    if (!hasSeparation(gap / candidateCount)) break;
    for (let start = 0; start <= freeIndices.length - count; start++) {
      const chosen = [freeIndices[start]];
      for (let next = start + 1; next < freeIndices.length && chosen.length < count; next++) {
        const index = freeIndices[next];
        if (index - chosen[chosen.length - 1] >= gap) chosen.push(index);
      }
      // For a fixed first index, earliest feasible successors leave the most closing space.
      // Thus greedy feasibility is exact and also resolves ties by the lowest index sequence.
      if (chosen.length === count && chosen[0] + candidateCount - chosen[count - 1] >= gap) {
        return chosen.map(index => ring[index]);
      }
    }
  }
  return null;
}
