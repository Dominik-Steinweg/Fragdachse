/** Small, opt-in wall-time scopes. No per-object scans or PerformanceEntry per frame. */
export interface RuntimeCpuSpan { scope: string; fromMs: number; toMs: number }
export interface RuntimeFrameWork {
  frameId: number;
  fromMs: number;
  toMs: number;
  complete: boolean;
  spans: RuntimeCpuSpan[];
  drawCalls: number | null;
  offscreenDrawCalls: number | null;
}
type Callable = (...args: any[]) => any;
const SCENE_EVENT_SCOPES: Record<string, string> = { preupdate: 'scenePreUpdate', update: 'sceneSystems', postupdate: 'scenePostUpdate' };

export class RuntimeFrameProbe {
  private restores: (() => void)[] = [];
  private current: RuntimeFrameWork | null = null;
  private visualStart: number | null = null;
  private active = true;

  constructor(private readonly origin: number, loop: { callback: Callable },
    private readonly begin: () => number, private readonly finish: (work: RuntimeFrameWork) => void) {
    this.patch(loop, 'callback', original => (...args: unknown[]) => {
      const work: RuntimeFrameWork = { frameId: this.begin(), fromMs: this.now(), toMs: 0,
        complete: false, spans: [], drawCalls: null, offscreenDrawCalls: null };
      this.current = work;
      try { return original.apply(loop, args); }
      finally {
        if (this.current === work) {
          work.toMs = this.now(); work.complete = true;
          this.finish(work); this.current = null;
        }
      }
    });
  }

  get frameId(): number | null { return this.current?.frameId ?? null; }

  addSpan(scope: string, fromMs: number, toMs: number): void {
    if (this.current) this.current.spans.push({ scope, fromMs: fromMs - this.origin, toMs: toMs - this.origin });
  }

  private now(): number { return performance.now() - this.origin; }

  private patch(target: object, key: string, wrap: (original: Callable) => Callable): void {
    const object = target as Record<string, Callable>, original = object[key];
    if (typeof original !== 'function') return;
    const own = Object.prototype.hasOwnProperty.call(object, key), wrapped = wrap(original);
    object[key] = wrapped;
    this.restores.push(() => { if (object[key] === wrapped) { if (own) object[key] = original; else delete object[key]; } });
  }

  scope(target: object, method: string, scope: string): void {
    const probe = this;
    this.patch(target, method, original => function (this: unknown, ...args: unknown[]) {
      const work = probe.current, fromMs = probe.now();
      try { return original.apply(this, args); }
      finally { if (work && probe.active) work.spans.push({ scope, fromMs, toMs: probe.now() }); }
    });
  }

  scene(scene: { sys: { events: { emit: Callable } } }): void {
    this.scope(scene.sys, 'sceneUpdate', 'sceneUpdate');
    const events = scene.sys.events;
    this.patch(events, 'emit', original => (event: string, ...args: unknown[]) => {
      // SceneManager installs sceneUpdate AFTER create() returns, immediately before CREATE.
      if (event === 'create') this.scope(scene.sys, 'sceneUpdate', 'sceneUpdate');
      const scope = SCENE_EVENT_SCOPES[event];
      if (!scope) return original.call(events, event, ...args);
      const work = this.current, fromMs = this.now();
      try { return original.call(events, event, ...args); }
      finally { if (work && this.active) work.spans.push({ scope, fromMs, toMs: this.now() }); }
    });
  }

  markVisualStart(): void { if (this.current) this.visualStart = this.now(); }
  markVisualEnd(): void {
    if (this.current && this.visualStart !== null) this.current.spans.push({ scope: 'visualTail', fromMs: this.visualStart, toMs: this.now() });
    this.visualStart = null;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.current) {
      this.current.toMs = this.now(); // Explicit partial callback, never a completed CPU frame.
      this.finish(this.current); this.current = null;
    }
    for (const restore of this.restores.reverse()) restore();
    this.restores = [];
  }
}
