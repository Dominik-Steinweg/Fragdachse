export type AfterRoundStep = 'items' | 'upgrades' | 'base';

/** Local presentation lifetime only; earned rewards remain in their existing persistent owners. */
export class AfterRoundFlow {
  private round: number | null = null;
  private pending: AfterRoundStep[] = [];
  private current: AfterRoundStep | null = null;
  private started = false;
  private readonly completed = new Set<AfterRoundStep>();
  private readonly seen = new Set<number>();
  get active(): boolean { return this.round !== null; }
  get step(): AfterRoundStep | null { return this.current; }
  prepare(round: number, steps: readonly AfterRoundStep[]): void {
    this.cancel();
    if (this.seen.has(round)) return;
    this.seen.add(round);
    this.round = round;
    for (const step of steps) this.add(step);
  }
  add(step: AfterRoundStep): void {
    if (!this.active || this.completed.has(step) || this.current === step || this.pending.includes(step)) return;
    this.pending.push(step);
    const order: AfterRoundStep[] = ['items', 'upgrades', 'base'];
    this.pending.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }
  start(): AfterRoundStep | null {
    if (!this.active || this.started) return null;
    this.started = true;
    return this.advance();
  }
  finish(step: AfterRoundStep): AfterRoundStep | null {
    if (this.current !== step) return null;
    this.completed.add(step);
    return this.advance();
  }
  cancel(): void { this.round = null; this.pending = []; this.current = null; this.started = false; this.completed.clear(); }
  private advance(): AfterRoundStep | null {
    this.current = this.pending.shift() ?? null;
    if (!this.current) this.cancel();
    return this.current;
  }
}
