export type CoopProgram = { readonly kind: 'campaign' } | { readonly kind: 'dawn' };

export const DEFAULT_COOP_PROGRAM: CoopProgram = Object.freeze({ kind: 'campaign' });

export function parseCoopProgram(raw: unknown): CoopProgram | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('kind' in raw)) return null;
  return raw.kind === 'campaign' || raw.kind === 'dawn' ? { kind: raw.kind } : null;
}

export function isSameCoopProgram(a: CoopProgram, b: CoopProgram): boolean {
  return a.kind === b.kind;
}
