/**
 * Gemeinsame, kleine Arbeitswarteschlange fuer teure RenderTexture-Bakes.
 *
 * Der Scheduler kennt keine Arena-Schicht. Jede Arbeitseinheit ist genau eine logische Dirty-
 * Region; damit koennen Boden, Fels-Overlays und statische Schatten dasselbe Zeitbudget teilen,
 * ohne dass eine Schicht ihre eigene Vollbake-Schleife vor die anderen stellt.
 */

export const CHUNK_BAKE_FRAME_BUDGET_MS = 4;

/** Obergrenze zusaetzlich zum Zeitbudget: schnelle Test-/Canvas-Backends sollen nicht alles in
 * einem Aufruf verschlingen, waehrend ein WebGL-Backend meist durch die Zeitgrenze stoppt. */
const MAX_BAKE_OPERATIONS_PER_FRAME = 8;
const MAX_CONSECUTIVE_OPERATIONS_PER_OWNER = 2;

export interface ChunkBakeJob {
  readonly key: string;
  readonly owner: object;
  readonly priority: () => number;
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
  }

  get pendingJobs(): number {
    return this.jobs.size;
  }

  /** Verbraucht genau ein gemeinsames Budget fuer alle registrierten Renderflaechen. */
  runFrame(budgetMs = CHUNK_BAKE_FRAME_BUDGET_MS): number {
    if (this.jobs.size === 0 || budgetMs <= 0) return 0;

    const startedAt = now();
    const deadline = startedAt + budgetMs;
    let operations = 0;
    while (this.jobs.size > 0 && operations < MAX_BAKE_OPERATIONS_PER_FRAME) {
      const job = this.pickNextJob();
      if (!job) break;
      this.jobs.delete(job.key);
      job.run();
      operations += 1;

      if (this.lastOwner === job.owner) this.consecutiveOwnerOperations += 1;
      else {
        this.lastOwner = job.owner;
        this.consecutiveOwnerOperations = 1;
      }

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
    }
    this.lastOwner = null;
    this.consecutiveOwnerOperations = 0;
    return operations;
  }

  private pickNextJob(): ChunkBakeJob | null {
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
export function flushChunkBakeScheduler(scene: object): number {
  return getChunkBakeScheduler(scene).runFrame();
}
