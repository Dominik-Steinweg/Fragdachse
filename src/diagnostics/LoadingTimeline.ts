/** Bounded attribution for the existing boot/world diagnostics. No polling, observers,
 * GPU fences or reports on the frame path. Times use performance.now(), never game time. */
type Scope = 'boot' | 'world' | 'scenario' | 'deferred';
type WorkKind = 'cpu-submit' | 'elapsed' | 'worker';
interface Work { name: string; kind: WorkKind; calls: number; totalMs: number; maxMs: number; firstAt: number; lastAt: number }
interface Gate { name: string; ready: boolean; firstObservedAt: number; fulfilledAt: number | null; changedAt: number; waitingMs: number }
export class LoadingRun {
  readonly startedAt = performance.now();
  endedAt: number | null = null;
  outcome = 'loading';
  private readonly work = new Map<string, Work>();
  private readonly gates = new Map<string, Gate>();
  private readonly transitions: Array<{ at: number; gate: string; ready: boolean }> = [];
  constructor(readonly scope: Scope, readonly id: string, private readonly onFinish?: () => void) {}
  add(name: string, durationMs: number, kind: WorkKind = 'cpu-submit', endedAt = performance.now()): void {
    if (this.endedAt !== null || !Number.isFinite(durationMs) || durationMs < 0) return;
    const key = kind + ':' + name;
    let row = this.work.get(key);
    if (!row) { if (this.work.size >= 256) return;
      row = { name, kind, calls: 0, totalMs: 0, maxMs: 0, firstAt: endedAt - durationMs, lastAt: endedAt }; this.work.set(key, row); }
    row.calls++; row.totalMs += durationMs; row.maxMs = Math.max(row.maxMs, durationMs); row.lastAt = endedAt;
  }
  gate(name: string, ready: boolean): void {
    if (this.endedAt !== null) return;
    let row = this.gates.get(name);
    if (row?.ready === ready) return;
    const now = performance.now();
    if (!row) { row = { name, ready, firstObservedAt: now, fulfilledAt: ready ? now : null, changedAt: now, waitingMs: 0 }; this.gates.set(name, row); }
    else {
      if (!row.ready) row.waitingMs += now - row.changedAt;
      row.ready = ready; row.changedAt = now; row.fulfilledAt = ready ? now : null;
    }
    if (this.transitions.length < 512) this.transitions.push({ at: now, gate: name, ready });
  }
  finish(outcome = 'ready'): void { if (this.endedAt === null) { this.endedAt = performance.now(); this.outcome = outcome; this.onFinish?.(); } }
  report() {
    const end = this.endedAt ?? performance.now(), relative = (v: number) => v - this.startedAt;
    const gates = [...this.gates.values()].map(g => ({ ...g, firstObservedAt: relative(g.firstObservedAt),
      fulfilledAt: g.fulfilledAt === null ? null : relative(g.fulfilledAt), changedAt: relative(g.changedAt),
      waitingMs: g.waitingMs + (g.ready ? 0 : end - g.changedAt) }));
    return { scope: this.scope, id: this.id, startedAt: this.startedAt, durationMs: end - this.startedAt, outcome: this.outcome,
      topSections: [...this.work.values()].map(w => ({ ...w, firstAt: relative(w.firstAt), lastAt: relative(w.lastAt) })).sort((a,b) => b.totalMs-a.totalMs),
      barriers: gates, criticalPath: { interpretation: 'Observed barrier transitions, not additive CPU time or a dependency DAG',
        waitingOn: gates.filter(g => !g.ready).map(g => g.name),
        lastFulfilled: gates.filter(g => g.ready).sort((a,b) => b.fulfilledAt!-a.fulfilledAt!)[0]?.name ?? null,
        transitions: this.transitions.map(t => ({ ...t, at: relative(t.at) })) } };
  }
}

export function resourceGroup(url: string): string {
  const path = url.split('?')[0];
  const woodland = path.match(/\/assets\/environment\/woodland\/([^/]+)/);
  if (woodland) return 'woodland/' + woodland[1];
  if (/worker/i.test(path)) return 'worker-modules';
  if (/\.(?:[cm]?js|ts)$/.test(path) || path.includes('/@')) return 'modules';
  const asset = path.match(/\/assets\/([^/]+)/);
  if (asset) return 'assets/' + asset[1];
  return 'other';
}
export function summarizeResources(entries: readonly PerformanceResourceTiming[]) {
  const groups = new Map<string, { group: string; requests: number; transferBytes: number; encodedBytes: number; decodedBytes: number; requestMs: number; firstAt: number; lastAt: number; zeroTransfer: number }>();
  for (const e of entries) {
    const key = resourceGroup(e.name);
    let g = groups.get(key);
    if (!g) { g = { group: key, requests: 0, transferBytes: 0, encodedBytes: 0, decodedBytes: 0, requestMs: 0, firstAt: e.startTime, lastAt: e.responseEnd, zeroTransfer: 0 }; groups.set(key,g); }
    g.requests++; g.transferBytes += e.transferSize; g.encodedBytes += e.encodedBodySize; g.decodedBytes += e.decodedBodySize;
    g.requestMs += e.duration; g.firstAt = Math.min(g.firstAt,e.startTime); g.lastAt = Math.max(g.lastAt,e.responseEnd);
    if (!e.transferSize) g.zeroTransfer++;
  }
  return { entries: entries.length, groups: [...groups.values()].map(g => ({ ...g, wallSpanMs: g.lastAt-g.firstAt })).sort((a,b) => b.transferBytes-a.transferBytes),
    largest: [...entries].sort((a,b) => b.encodedBodySize-a.encodedBodySize).slice(0,20).map(e => ({ url: e.name, group: resourceGroup(e.name),
      transferBytes: e.transferSize, encodedBytes: e.encodedBodySize, durationMs: e.duration, startAt: e.startTime })),
    note: 'Request durations overlap. decodedBytes is HTTP decompression, not image RGBA. Zero transfer can mean cache or unavailable timing. Worker child imports have a separate performance timeline.' };
}

class LoadingTimeline {
  private runs: LoadingRun[] = [];
  private firstBootAt: number | null = null;
  private readonly latest = new Map<Scope, LoadingRun>();
  private current: LoadingRun | undefined;
  private refresh(): void {
    this.current = undefined;
    const world = this.get('world');
    if (world?.endedAt === null) { this.current = world; return; }
    for (let i=this.runs.length-1;i>=0;i--) if (this.runs[i].endedAt === null) { this.current = this.runs[i]; return; }
  }
  begin(scope: Scope, id: string, restart = false): LoadingRun {
    const previous = this.get(scope);
    if (previous?.id === id && !restart) return previous;
    previous?.finish('superseded');
    const run = new LoadingRun(scope,id, () => this.refresh()); this.runs.push(run); this.latest.set(scope,run);
    if (scope === 'boot') this.firstBootAt ??= run.startedAt;
    if (this.runs.length > 12) this.runs.shift();
    this.refresh();
    return run;
  }
  get(scope: Scope): LoadingRun | undefined { return this.latest.get(scope); }
  capture(): LoadingRun | undefined { return this.current; }
  start(): number { return this.capture() ? performance.now() : -1; }
  end(name: string, start: number, kind: WorkKind = 'cpu-submit'): void {
    if (start >= 0) this.capture()?.add(name,performance.now()-start,kind);
  }
  report() {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return { version: 1, timeOrigin: performance.timeOrigin, capturedAt: performance.now(),
      beforeFirstBootMs: this.firstBootAt,
      runs: this.runs.map(r => ({ ...r.report(), resources: summarizeResources(resources.filter(e => e.startTime >= r.startedAt && e.startTime <= (r.endedAt ?? Infinity))) })), resources: summarizeResources(resources),
      limitations: 'CPU-submit includes synchronous driver work, not GPU execution. Loader processing includes decode/cache/upload and scheduling. Sections can nest; do not sum. Resource buffer capped at 10000; export before navigation.' };
  }
}
export const loadingTimeline = new LoadingTimeline();
