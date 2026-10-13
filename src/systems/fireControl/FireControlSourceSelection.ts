import type { FireControlCopySnapshot } from './FireControlSnapshot';

export interface FireControlCopyCandidate {
  readonly id: FireControlCopySnapshot['originalId'];
  readonly constructionId: string;
  readonly x: number;
  readonly y: number;
}

export interface FireControlCopySelectionInput {
  /** Already filtered by copyable eligibility. Duplicate IDs use their first occurrence. */
  readonly candidates: readonly FireControlCopyCandidate[];
  readonly slotOrder: readonly string[];
  readonly pointX: number;
  readonly pointY: number;
  readonly maxCopies: number;
}

/** Round-robin by construction type; distance and ID rank originals within each type. */
export function selectFireControlCopySources(
  input: FireControlCopySelectionInput,
): readonly FireControlCopyCandidate[] {
  const limit = Math.floor(input.maxCopies);
  if (!(limit > 0) || input.candidates.length === 0) return [];

  const seen = new Set<number>();
  const byType = new Map<string, FireControlCopyCandidate[]>();
  for (const candidate of input.candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const group = byType.get(candidate.constructionId) ?? [];
    group.push(candidate);
    byType.set(candidate.constructionId, group);
  }

  const distanceSquared = (candidate: FireControlCopyCandidate): number =>
    (candidate.x - input.pointX) ** 2 + (candidate.y - input.pointY) ** 2;
  for (const group of byType.values()) {
    group.sort((a, b) => distanceSquared(a) - distanceSquared(b) || a.id - b.id);
  }

  const slotTypes = new Set(input.slotOrder);
  const order = [
    ...slotTypes,
    // Default string sort is locale-independent for construction IDs.
    ...[...byType.keys()].filter(type => !slotTypes.has(type)).sort(),
  ];
  const result: FireControlCopyCandidate[] = [];
  for (let round = 0; result.length < limit; round++) {
    const previousLength = result.length;
    for (const type of order) {
      const candidate = byType.get(type)?.[round];
      if (candidate) result.push(candidate);
      if (result.length === limit) return result;
    }
    if (result.length === previousLength) break;
  }
  return result;
}
