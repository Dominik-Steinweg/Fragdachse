/** Host-owned round total. Source subtotals are diagnostics, never separate balances. */
export class DawnScrapLedger {
  private totalValue = 0;
  private sources = { site: 0, drop: 0 };

  constructor(private readonly publish: (total: number) => void) {}

  get total(): number { return this.totalValue; }
  getDiagnostics(): Readonly<{ site: number; drop: number }> { return { ...this.sources }; }

  /** Fractional rewards round down once, at the ledger boundary. Invalid grants are ignored. */
  credit(amount: number, source: 'site' | 'drop'): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const granted = Math.min(Math.floor(amount), Number.MAX_SAFE_INTEGER - this.totalValue);
    if (granted <= 0) return 0;
    this.totalValue += granted;
    this.sources[source] += granted;
    this.publish(this.totalValue);
    return granted;
  }

  reset(): void {
    this.totalValue = 0;
    this.sources = { site: 0, drop: 0 };
    this.publish(0);
  }
}
