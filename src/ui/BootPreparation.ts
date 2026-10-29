import { loadingTimeline } from '../diagnostics/LoadingTimeline';
/** Acquire cleanup at construction time, including a direct destroy during preparation. */
export function onBootSceneTeardown(
  events: { once(event: string, callback: () => void): unknown; off(event: string, callback: () => void): unknown },
  cleanup: () => void,
): void {
  const stop = () => {
    events.off('shutdown', stop);
    events.off('destroy', stop);
    cleanup();
  };
  events.once('shutdown', stop);
  events.once('destroy', stop);
}

const WAIT_PREFIX = 'wait:';

/**
 * A step that waits for work outside the main thread (driver links, network) yields this
 * instead of its own name: the slice ends at once and the next one runs after a paint, so the
 * wait neither spins through the budget nor blocks the browser.
 */
export function waitStep(name: string): string { return `${WAIT_PREFIX}${name}`; }

/** Cooperative startup only: checkpoints describe completed work, not estimated percentages. */
export class BootPreparation {
  private frame: number | null = null;
  private task: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly steps: Generator<string, void>,
    private readonly onStep: (name: string, durationMs: number) => void,
    private readonly onReady: () => void,
    private readonly onError: (error: unknown) => void,
    private readonly budgetMs = 8,
  ) {}

  start(): void { this.afterPaint(); }

  cancel(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.task !== null) clearTimeout(this.task);
    this.steps.return();
  }

  private afterPaint(): void {
    // rAF alone resumes before paint. A task posted from rAF lets that frame be painted
    // before the next CPU slice. No minimum loading duration or per-step delay.
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (!this.stopped) this.task = setTimeout(() => this.runSlice(), 0);
    });
  }

  private runSlice(): void {
    this.task = null;
    if (this.stopped) return;
    const sliceStart = performance.now();
    try {
      do {
        const start = performance.now();
        const step = this.steps.next();
        if (this.stopped) return;
        const waiting = !step.done && step.value.startsWith(WAIT_PREFIX);
        this.onStep(step.done ? 'commit' : waiting ? step.value.slice(WAIT_PREFIX.length) : step.value,
          performance.now() - start);
        if (step.done) {
          this.stopped = true;
          this.onReady();
          return;
        }
        if (waiting) break;
      } while (performance.now() - sliceStart < this.budgetMs);
      this.afterPaint();
    } catch (error) {
      this.stopped = true;
      this.onError(error);
    } finally {
      loadingTimeline.get('boot')?.add('preparation/slice', performance.now() - sliceStart);
    }
  }
}
