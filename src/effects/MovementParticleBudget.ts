/** Fixed storage for expiry times. A min-heap handles varied lifetimes without frame allocations. */
export class MovementParticleBudget {
  private readonly expiry: Float64Array;
  private count = 0;

  constructor(readonly capacity: number, private readonly playerReserve: number) {
    this.expiry = new Float64Array(capacity);
  }

  get liveCount(): number { return this.count; }
  clear(): void { this.count = 0; }

  retire(now: number): void {
    while (this.count > 0 && this.expiry[0] <= now) {
      const tail = this.expiry[--this.count];
      let i = 0;
      while (i * 2 + 1 < this.count) {
        let child = i * 2 + 1;
        if (child + 1 < this.count && this.expiry[child + 1] < this.expiry[child]) child++;
        if (this.expiry[child] >= tail) break;
        this.expiry[i] = this.expiry[child]; i = child;
      }
      this.expiry[i] = tail;
    }
  }

  canSpawn(player: boolean): boolean {
    return this.count < this.capacity - (player ? 0 : this.playerReserve);
  }

  /** Called only after the GPU accepted the particle. */
  record(expiresAt: number): void {
    if (this.count >= this.capacity) return;
    let i = this.count++;
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (this.expiry[parent] <= expiresAt) break;
      this.expiry[i] = this.expiry[parent]; i = parent;
    }
    this.expiry[i] = expiresAt;
  }
}
