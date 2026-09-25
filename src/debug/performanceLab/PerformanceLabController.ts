import type { PerformanceCase, PerformanceLabGamePort, PerformanceLabResult, PerformanceRunRequest, PerformanceWindow } from './contracts';
import { PERFORMANCE_MAP_ID, REFERENCE_SEED, SCENARIO_VERSION, registerReferenceMap, resolvePerformanceCases } from './scenarios';

export class PerformanceLabController {
  private readonly cases: PerformanceCase[];
  private index = 0;
  private stage: 'prepare' | 'measure' | 'tail' | 'return' | 'done' = 'prepare';
  private startedAt: number;
  private nextActionAt = 0;
  private actions = 0;
  private hits = 0;
  private sequence = 0;
  private removeHits: (() => void) | null = null;
  private unregister: (() => void) | null;
  private returnReadyAt: number | null = null;
  private preparationStarted = false;

  constructor(private readonly request: PerformanceRunRequest, private readonly port: PerformanceLabGamePort,
    private readonly windows: PerformanceWindow[], private readonly markers: { name: string; atMs: number }[],
    private readonly mark: (name: string) => number, private readonly complete: (result: PerformanceLabResult) => void) {
    this.cases = resolvePerformanceCases(request.caseId);
    if (request.timeOfDayMinutes !== undefined) {
      this.cases = this.cases.map(test => ({ ...test, timeOfDay: request.timeOfDayMinutes }));
    }
    this.unregister = registerReferenceMap();
    this.startedAt = this.mark('arena-requested');
    try { this.port.start(this.cases[0].mapId ?? PERFORMANCE_MAP_ID, REFERENCE_SEED, this.cases[0].commit); }
    catch (error) {
      // Start can fail after changing readiness or requesting a diagnostic World.
      try { this.port.discard(); }
      finally { this.unregister(); this.unregister = null; }
      throw error;
    }
  }

  update(now: number): void {
    if (this.stage === 'done') return;
    const test = this.cases[this.index];
    if (window.__FD_PERF__) window.__FD_PERF__.state = `${test.id}:${this.stage}`;
    if (this.stage === 'prepare') {
      if (!this.port.isReady()) return;
      if (!this.preparationStarted) {
        this.preparationStarted = true;
        this.endWindow(`${test.id}.world-ready`, 'preparation', this.mark(`${test.id}:world-ready`));
      }
      if (this.port.prepareCase) {
        if (this.port.prepareCase(test, name => {
          const at = this.mark(`${test.id}:${name}`);
          this.endWindow(`${test.id}.${name}`, 'preparation', at);
        }) === false) return;
      } else this.port.prepareTargets();
      this.removeHits = this.port.observeHits(() => { this.hits++; });
      now = this.mark(`${test.id}:prepared`);
      this.endWindow(`${test.id}.prepare`, 'preparation', now);
      this.stage = 'measure';
      this.nextActionAt = now;
      this.mark(`${test.id}:start`);
    }
    if (this.stage === 'measure') {
      const duration = Math.max(test.durationMs, this.request.durationMs ?? 0);
      if (this.port.updateCase) this.port.updateCase(test, now - this.startedAt, 'measure', duration); else this.port.maintainTargets();
      // Retry only on subsequent real frames; never synthesize a burst to catch up.
      if (now >= this.nextActionAt && this.actions < (test.maximumActions ?? Infinity)) {
        const result = this.port.performAction
          ? this.port.performAction(test, ++this.sequence, this.actions === 0)
          : this.port.attack(test.slot, ++this.sequence, true);
        if (result?.ok) { this.actions++; this.nextActionAt = now + test.actionIntervalMs; }
        else if (result?.reason && result.reason !== 'cooldown') throw new Error(`Attack failed: ${result.reason}`);
      }
      const minimumActions = test.maximumActions !== undefined ? test.minimumActions : test.continuous ? 1
        : Math.max(Math.ceil(duration / Math.max(1, test.actionIntervalMs)), Math.ceil(test.minimumActions * duration / test.durationMs));
      if (now - this.startedAt < duration || this.actions < minimumActions) return;
      if (this.port.isCaseComplete?.(test, now - this.startedAt, duration) === false) return;
      this.port.finishCase?.(test);
      this.endWindow(test.id, 'measurement', now, { ...this.port.readLoad(), actions: this.actions, hits: this.hits, minimumActions,
        buildSignature: test.buildSignature ?? 'base' });
      this.mark(`${test.id}:end`);
      this.stage = 'tail';
    } else if (this.stage === 'tail') {
      this.port.updateCase?.(test, now - this.startedAt, 'tail');
      if (now - this.startedAt < test.tailMs) return;
      if ((test.requireHits ?? !test.kind) && !this.hits) throw new Error(`${test.id}: no actual hits observed`);
      this.port.verifyCase?.(test, this.port.readLoad());
      this.windows.push(...(this.port.readSubphases?.() ?? []));
      this.endWindow(`${test.id}.tail`, 'recovery', now, this.port.readLoad());
      this.removeHits?.(); this.removeHits = null;
      // The explicit recovery sequence retains the preceding combat World and its effects.
      if (this.cases[this.index + 1]?.kind === 'recovery') {
        this.index++; this.stage = 'prepare'; this.actions = 0; this.hits = 0; this.preparationStarted = false;
        return;
      }
      this.port.discard();
      this.mark('return-start');
      this.stage = 'return';
    } else if (this.stage === 'return') {
      if (!this.port.isLobbyReady()) { this.returnReadyAt = null; return; }
      this.returnReadyAt ??= now;
      if (now - this.returnReadyAt < (this.index === this.cases.length - 1 ? 3000 : 0)) return;
      this.endWindow(`${test.id}.return`, 'recovery', now, this.port.readLoad());
      if (++this.index < this.cases.length) {
        const next = this.cases[this.index];
        this.stage = 'prepare'; this.actions = 0; this.hits = 0; this.returnReadyAt = null; this.preparationStarted = false;
        this.mark(`${next.id}:arena-requested`);
        this.port.start(next.mapId ?? PERFORMANCE_MAP_ID, REFERENCE_SEED, next.commit);
        return;
      }
      this.mark('run-end');
      const game = this.port.stopRecording();
      if (!game?.frameCapture || game.frameCapture.truncated || game.frameCapture.autoStopped
        || game.session.eventsTruncated || game.series.truncated) throw new Error('Incomplete game recording');
      this.stage = 'done';
      this.unregister?.(); this.unregister = null;
      this.complete({ schemaVersion: 1, request: this.request, scenarioVersion: SCENARIO_VERSION,
        windows: this.windows, markers: this.markers, game, environment: this.port.environment() });
    }
  }

  cancel(_reason: string): void {
    if (this.stage === 'done') return;
    this.stage = 'done';
    this.removeHits?.(); this.removeHits = null;
    try { this.port.discard(); } finally {
      try { this.port.stopRecording(); } finally { this.unregister?.(); this.unregister = null; }
    }
  }

  private endWindow(id: string, kind: PerformanceWindow['kind'], now: number, load?: PerformanceWindow['load']): void {
    this.windows.push({ id, kind, fromMs: this.startedAt, toMs: now, load,
      ...(id === this.cases[this.index].id ? { caseVersion: this.cases[this.index].version } : {}) });
    this.startedAt = now;
  }
}
