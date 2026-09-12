/** One non-stacking shield per player life. Combat remains the authoritative writer. */
export class PressureShieldSystem {
  private readonly states = new Map<string, { until: number; reduction: number }>();

  apply(playerId: string, reduction: number, durationMs: number, now: number): void {
    if (!(reduction > 0 && durationMs > 0)) return;
    const previous = this.states.get(playerId);
    this.states.set(playerId, { until: Math.max(previous?.until ?? 0, now + durationMs),
      reduction: Math.max(previous && previous.until > now ? previous.reduction : 0, reduction) });
  }

  getUntil(playerId: string, now: number): number {
    const state = this.states.get(playerId);
    if (!state || state.until <= now) { this.states.delete(playerId); return 0; }
    return state.until;
  }

  getReduction(playerId: string, now: number): number {
    return this.getUntil(playerId, now) > 0 ? this.states.get(playerId)!.reduction : 0;
  }

  clearPlayer(playerId: string): void { this.states.delete(playerId); }
  clear(): void { this.states.clear(); }
}
