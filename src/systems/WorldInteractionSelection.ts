export const WORLD_INTERACTION_RULES = { minimumScore: 0.45, switchMargin: 0.05 } as const;
export interface InteractionActor { readonly x: number; readonly y: number; readonly angle: number }
export interface InteractionCandidate {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}
export function interactionCandidateScore(actor: InteractionActor, candidate: Pick<InteractionCandidate, 'x' | 'y' | 'radius'>): number {
  const distance = Math.hypot(candidate.x - actor.x, candidate.y - actor.y);
  if (!Number.isFinite(distance) || !Number.isFinite(actor.angle) || distance > candidate.radius || candidate.radius <= 0) return -Infinity;
  const angle = distance === 0 ? actor.angle : Math.atan2(candidate.y - actor.y, candidate.x - actor.x);
  return 0.8 * (Math.cos(angle - actor.angle) + 1) / 2 + 0.2 * (1 - distance / candidate.radius);
}
export function selectInteractionCandidate<T extends InteractionCandidate>(actor: InteractionActor, candidates: readonly T[], currentKey: string | null): T | null {
  const scored = candidates.map(candidate => ({ candidate, score: interactionCandidateScore(actor, candidate) }))
    .filter(entry => entry.score >= WORLD_INTERACTION_RULES.minimumScore)
    .sort((a, b) => b.score - a.score || a.candidate.key.localeCompare(b.candidate.key));
  const best = scored[0];
  const current = scored.find(entry => entry.candidate.key === currentKey);
  return current && best && best.score < current.score + WORLD_INTERACTION_RULES.switchMargin ? current.candidate : best?.candidate ?? null;
}
