/**
 * Gemeinsame, kleine Arbeitswarteschlange fuer teure RenderTexture-Bakes.
 *
 * Der Scheduler kennt keine Arena-Schicht. Jede Arbeitseinheit ist genau eine logische Dirty-
 * Region; damit koennen Boden, Fels-Overlays und statische Schatten dasselbe Zeitbudget teilen,
 * ohne dass eine Schicht ihre eigene Vollbake-Schleife vor die anderen stellt.
 */

/**
 * Prefetch is deliberately gentle.  The urgent budget is still shared by Ground, RockOverlay
 * and StaticShadow, so a visible chunk can finish without turning every streaming frame into a
 * long GPU flush.
 */
export const CHUNK_BAKE_PREFETCH_FRAME_BUDGET_MS = 1.5;
export const CHUNK_BAKE_URGENT_FRAME_BUDGET_MS = 4;
/** Startup-only ceiling while the independent black loading screen is active. */
export const CHUNK_BAKE_STARTUP_FRAME_BUDGET_MS = 14;

/** Backwards-compatible name for callers that explicitly want the urgent ceiling. */
export const CHUNK_BAKE_FRAME_BUDGET_MS = CHUNK_BAKE_URGENT_FRAME_BUDGET_MS;

/** Obergrenze zusaetzlich zum Zeitbudget: schnelle Test-/Canvas-Backends sollen nicht alles in
 * einem Aufruf verschlingen, waehrend ein WebGL-Backend meist durch die Zeitgrenze stoppt. */
const MAX_BAKE_OPERATIONS_PER_FRAME = 32;
const MAX_CONSECUTIVE_OPERATIONS_PER_OWNER = 2;
const COMPLETION_PRIORITY_TOLERANCE = 250;

export interface ChunkBakeJob {
  readonly key: string;
  readonly owner: object;
  readonly priority: () => number;
  /** Jobs with the same key are kept together so a chunk does not become visible as patchwork. */
  readonly completionKey?: object;
  /** Raises the frame budget only while visible/inherently urgent work is pending. */
  readonly urgent?: () => boolean;
  readonly run: () => void;
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

/**
 * Kleine priorisierte FIFO-Warteschlange. Die Jobmenge ist absichtlich klein genug, dass eine
 * lineare Auswahl pro Operation billiger und robuster ist als ein Heap mit stale Priority-
 * Eintraegen: Die Prioritaet darf sich mit jeder Kamerabewegung aendern.
 */
export class ChunkBakeScheduler {
  private readonly jobs = new Map<string, ChunkBakeJob>();
  private lastOwner: object | null = null;
  private consecutiveOwnerOperations = 0;
  private activeCompletionKey: object | null = null;

  enqueue(job: ChunkBakeJob): void {
    this.jobs.set(job.key, job);
  }

  cancel(key: string): void {
    this.jobs.delete(key);
  }

  cancelOwner(owner: object): void {
    for (const [key, job] of this.jobs) {
      if (job.owner === owner) this.jobs.delete(key);
    }
    if (this.lastOwner === owner) {
      this.lastOwner = null;
      this.consecutiveOwnerOperations = 0;
    }
    if (this.activeCompletionKey && !this.hasCompletionJobs(this.activeCompletionKey)) {
      this.activeCompletionKey = null;
    }
  }

  get pendingJobs(): number {
    return this.jobs.size;
  }

  /** Verbraucht genau ein gemeinsames Budget fuer alle registrierten Renderflaechen. */
  runFrame(budgetMs?: number): number {
    if (this.jobs.size === 0) return 0;
    if (budgetMs !== undefined && budgetMs <= 0) return 0;

    const effectiveBudget = budgetMs ?? (
      this.hasUrgentJobs()
        ? CHUNK_BAKE_URGENT_FRAME_BUDGET_MS
        : CHUNK_BAKE_PREFETCH_FRAME_BUDGET_MS
    );
    if (effectiveBudget <= 0) return 0;

    const startedAt = now();
    const deadline = startedAt + effectiveBudget;
    let operations = 0;
    while (this.jobs.size > 0 && operations < MAX_BAKE_OPERATIONS_PER_FRAME) {
      const job = this.pickNextJob();
      if (!job) break;
      this.jobs.delete(job.key);
      job.run();
      operations += 1;
      this.recordOperation(job);

      // Mindestens eine Region pro Aufruf wird abgeschlossen. Danach stoppt die Uhr auch dann,
      // wenn ein einzelner GPU-Flush bereits das gesamte Budget verbraucht hat.
      if (operations > 0 && now() >= deadline) break;
    }
    return operations;
  }

  /** Nur fuer kontrollierte Tests/Teardown-Checks; der normale Frame-Pfad nutzt runFrame(). */
  drain(maxOperations = Number.POSITIVE_INFINITY): number {
    let operations = 0;
    while (this.jobs.size > 0 && operations < maxOperations) {
      const job = this.pickNextJob();
      if (!job) break;
      this.jobs.delete(job.key);
      job.run();
      operations += 1;
      this.recordOperation(job);
    }
    this.lastOwner = null;
    this.consecutiveOwnerOperations = 0;
    this.activeCompletionKey = null;
    return operations;
  }

  private pickNextJob(): ChunkBakeJob | null {
    if (this.activeCompletionKey && !this.hasCompletionJobs(this.activeCompletionKey)) {
      this.activeCompletionKey = null;
    }

    let best: ChunkBakeJob | null = null;
    let bestPriority = Number.POSITIVE_INFINITY;
    for (const job of this.jobs.values()) {
      const priority = job.priority();
      if (priority < bestPriority) {
        best = job;
        bestPriority = priority;
      }
    }
    if (!best) return null;

    // Once a chunk has started, finish its remaining acquisition/region jobs when they are in
    // the same priority band. A newly visible chunk can still interrupt a prefetch group.
    if (this.activeCompletionKey) {
      let completionBest: ChunkBakeJob | null = null;
      let completionPriority = Number.POSITIVE_INFINITY;
      for (const job of this.jobs.values()) {
        if (job.completionKey !== this.activeCompletionKey) continue;
        const priority = job.priority();
        if (priority < completionPriority) {
          completionBest = job;
          completionPriority = priority;
        }
      }
      if (completionBest && completionPriority <= bestPriority + COMPLETION_PRIORITY_TOLERANCE) {
        return completionBest;
      }
    }

    // Sichtbare Arbeit aller drei Schichten soll vorankommen. Zwei aufeinanderfolgende Regionen
    // derselben Schicht sind genug, um den Scratch-Pool warm zu halten, danach gewinnt die beste
    // andere Schicht, solange sie nicht klar weiter hinten (z. B. reiner Prefetch) liegt.
    if (this.lastOwner && this.consecutiveOwnerOperations >= MAX_CONSECUTIVE_OPERATIONS_PER_OWNER) {
      let alternative: ChunkBakeJob | null = null;
      let alternativePriority = Number.POSITIVE_INFINITY;
      for (const job of this.jobs.values()) {
        if (job.owner === this.lastOwner) continue;
        const priority = job.priority();
        if (priority < alternativePriority) {
          alternative = job;
          alternativePriority = priority;
        }
      }
      if (alternative && alternativePriority <= bestPriority + 250) return alternative;
    }
    return best;
  }

  private hasUrgentJobs(): boolean {
    for (const job of this.jobs.values()) {
      if (job.urgent?.()) return true;
    }
    return false;
  }

  private hasCompletionJobs(completionKey: object): boolean {
    for (const job of this.jobs.values()) {
      if (job.completionKey === completionKey) return true;
    }
    return false;
  }

  private recordOperation(job: ChunkBakeJob): void {
    if (job.completionKey) this.activeCompletionKey = job.completionKey;
    else this.activeCompletionKey = null;

    if (this.lastOwner === job.owner) this.consecutiveOwnerOperations += 1;
    else {
      this.lastOwner = job.owner;
      this.consecutiveOwnerOperations = 1;
    }
  }
}

const schedulers = new WeakMap<object, ChunkBakeScheduler>();

export function getChunkBakeScheduler(scene: object): ChunkBakeScheduler {
  let scheduler = schedulers.get(scene);
  if (!scheduler) {
    scheduler = new ChunkBakeScheduler();
    schedulers.set(scene, scheduler);
  }
  return scheduler;
}

/** Zentraler Frame-Ende-Punkt fuer Ground, RockOverlay und Static Shadows. */
export function flushChunkBakeScheduler(scene: object, budgetMs?: number): number {
  return getChunkBakeScheduler(scene).runFrame(budgetMs);
}
