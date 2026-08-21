/**
 * Main-Thread-Seite der Flowfield-Navigation.
 *
 * Aufgaben: feste Nav-Ticks, Erkennung geaenderter Eingaben, genau ein Job in Flight, atomare
 * Aktivierung fertiger Ergebnisse, Verwerfen ueberholter Ergebnisse und Wiederverwendung der
 * grossen Puffer.
 *
 * Eigentumsregeln (tragend, bitte beim Aendern lesen):
 * - Ein Puffer gehoert zu jedem Zeitpunkt genau einer Seite. Eigentum wechselt nur beim Dispatch
 *   (Main -> Worker) und bei der Aktivierung (Worker -> Main).
 * - Der Pool haelt rohe `ArrayBuffer`. Views entstehen erst bei der Aktivierung und werden beim
 *   Recyceln fallen gelassen; ein Puffer, auf den noch ein View zeigt, wird nie gepostet.
 * - Der aktive Snapshot wird nie gepostet. Aktivierung laeuft am Tickanfang vor jedem Leser, es
 *   gibt dort also keine offenen Leser.
 *
 * Die Topologie des Standardprofils bleibt bewusst hier und nicht im Worker: `isTraversableAt`,
 * `isCircleGroundFreeAt` und die Kreis-/Linienpraedikate werden mitten im Frame von Dodge-,
 * Positioning- und Burrow-Systemen gelesen. Ein Roundtrip wuerde deren heutige Latenz verdoppeln.
 * Der Worker leitet dieselbe Topologie aus demselben Patch-Strom noch einmal ab und besitzt
 * zusaetzlich alle Clearance-Profile sowie saemtliche Integrations- und Vektorfelder.
 */
import {
  buildCostByCode,
  buildNeighborLookups,
  classifyTopology,
  computeBaseGoalIndexes,
  createTopology,
  patchTopologyCells,
  totalCellsOf,
  type FlowFieldBaseDescriptor,
  type FlowFieldMetrics,
  type FlowFieldNeighborLookups,
  type FlowFieldTopology,
  type FlowFieldTopologyCounts,
  type FlowFieldTopologySources,
  type FlowFieldTuning,
} from './FlowFieldKernel';
import { FlowFieldEngine } from './FlowFieldEngine';
import {
  FLOW_FIELD_PROTOCOL_VERSION,
  type FlowFieldFieldDescriptor,
  type FlowFieldGoalMode,
  type FlowFieldJobField,
  type FlowFieldJobMessage,
  type FlowFieldPatch,
  type FlowFieldResultMessage,
} from './FlowFieldProtocol';
import { InlineFlowFieldRunner, type FlowFieldRunner, type FlowFieldRunnerKind } from './FlowFieldRunner';

/**
 * Feld-IDs der Runtime-Flowfields. Ally-Felder sind pro Spieler und tragen deshalb einen Praefix
 * statt eines festen Eintrags - der Coordinator fuehrt generische IDs.
 */
export const ENEMY_FLOW_FIELD_IDS = {
  base: 'base',
  player: 'player',
  strategic: 'strategic',
  boss: 'boss',
} as const;

export function allyFlowFieldId(playerId: string): string {
  return `ally:${playerId}`;
}

/** Vollstaendig konsistenter Feldzustand. Wird nur als Ganzes getauscht. */
export interface FlowFieldSnapshot {
  readonly goalVersion: number;
  readonly topologyVersion: number;
  readonly integrationField: Float32Array;
  readonly vectorField: Float32Array;
  readonly goalSourceField: Int32Array;
  readonly goalIndexes: Int32Array;
  /** Nur bei Clearance-Profilen: das erodierte `traversable` zu genau diesem Feld. */
  readonly profileTraversable: Uint8Array | null;
}

/** Lesefenster eines Feldes. Die Fassade haelt genau dieses Objekt und liest immer den aktuellen Stand. */
export interface FlowFieldFieldView {
  readonly fieldId: string;
  readonly metrics: FlowFieldMetrics;
  readonly tuning: FlowFieldTuning;
  readonly lookups: FlowFieldNeighborLookups;
  /**
   * Topologie fuer dieses Feld. Basis sind immer die Spiegelarrays des Standardprofils; ein
   * Clearance-Profil ueberschreibt daraus nur `traversable`. `costs`/`wallAdjacent` weichen im
   * Worker zwar ebenfalls ab, werden fuer Clearance-Profile im Main Thread aber nicht gelesen
   * (Bosse ueberspringen `isWallAdjacentAt`, und der A* laeuft nur auf dem Standardprofil).
   */
  topology(): FlowFieldTopology;
  snapshot(): FlowFieldSnapshot | null;
  counts(): FlowFieldTopologyCounts;
  /** Setzt die Zielmenge dieses Feldes; gerechnet wird erst am naechsten Nav-Tick. */
  setGoals(goalIndexes: ArrayLike<number>, payload?: unknown): void;
  /** Sofort wirksame Sperre entfallener Basisziele, bis das neu gerechnete Feld aktiv wird. */
  isGoalSuppressed(index: number): boolean;
  workspace(): FlowFieldPathWorkspace;
  /**
   * Meldet jede Aktivierung dieses Feldes, zusammen mit der Payload, aus deren Eingaben es
   * gerechnet wurde. Bewusst mehrere Hoerer: Am strategischen Feld haengen Ziel-Mapping und
   * Debug-Overlay gleichzeitig. Der Rueckgabewert meldet den Hoerer wieder ab.
   */
  onActivated(listener: (payload: unknown) => void): () => void;
}

/** Wiederverwendeter A*-Arbeitsbereich fuer seltene zielgebundene Sonderpfade. */
export interface FlowFieldPathWorkspace {
  readonly costs: Float32Array;
  readonly parents: Int32Array;
  readonly generation: Uint32Array;
  generationId: number;
  sequence: number;
}

export interface FlowFieldFieldOptions {
  readonly goalMode: FlowFieldGoalMode;
  readonly clearanceCells?: number;
  /** Nav-Ticks zwischen zwei Dispatches dieses Feldes. 1 = jeder Tick. */
  readonly tickDivisor?: number;
}

export interface FlowFieldCoordinatorOptions {
  readonly metrics: FlowFieldMetrics;
  readonly tuning: FlowFieldTuning;
  readonly staticKind: Uint8Array;
  readonly bases: readonly FlowFieldBaseDescriptor[];
  readonly activeBaseIds: ReadonlySet<string>;
  /** Wird nur beim Initial- und beim koordinatenlosen Full-Resync gelesen. */
  readonly obstacleCellProvider: () => ReadonlyArray<{ gridX: number; gridY: number }>;
  readonly runner?: FlowFieldRunner;
  readonly navTickIntervalMs: number;
  readonly generationId?: number;
}

export interface FlowFieldDiagnostics {
  readonly runnerKind: FlowFieldRunnerKind;
  readonly requestedUpdates: number;
  readonly dispatchedJobs: number;
  readonly startedJobs: number;
  readonly completedJobs: number;
  readonly activatedBatches: number;
  readonly droppedStale: number;
  readonly coalescedJobs: number;
  readonly skippedUnchangedFields: number;
  readonly backlogTicks: number;
  readonly lastWorkerComputeMs: number;
  readonly workerComputeTotalMs: number;
  readonly workerComputeMaxMs: number;
  readonly roundTripTotalMs: number;
  readonly roundTripMaxMs: number;
  readonly lastRoundTripMs: number;
  readonly fields: Readonly<Record<string, FlowFieldFieldDiagnostics>>;
}

export interface FlowFieldFieldDiagnostics {
  readonly fieldId: string;
  readonly goalMode: FlowFieldGoalMode;
  readonly targetCadenceMs: number;
  readonly staleAfterMs: number | null;
  readonly staleEligible: boolean;
  readonly requestedUpdates: number;
  readonly startedJobs: number;
  readonly completedJobs: number;
  readonly coalescedJobs: number;
  readonly skippedUnchangedFields: number;
  readonly activeAgeMs: number | null;
  readonly stale: boolean;
}

interface BufferPool {
  integration: ArrayBuffer[];
  vector: ArrayBuffer[];
  goalSource: ArrayBuffer[];
  traversable: ArrayBuffer[];
}

interface CoordinatorField {
  readonly descriptor: FlowFieldFieldDescriptor;
  readonly clearanceCells: number;
  readonly tickDivisor: number;
  rawGoals: Int32Array;
  goalVersion: number;
  pendingPayload: unknown;
  dispatchedGoals: Int32Array | null;
  dispatchedTopologyVersion: number;
  dispatchedPayload: unknown;
  activeSnapshot: FlowFieldSnapshot | null;
  requestedUpdates: number;
  startedJobs: number;
  completedJobs: number;
  coalescedJobs: number;
  skippedUnchangedFields: number;
  lastActivatedAtMs: number;
  readonly activationListeners: Set<(payload: unknown) => void>;
  readonly pool: BufferPool;
  readonly view: FlowFieldFieldView;
}

const EMPTY_GOALS = new Int32Array(0);
/** Ein Hitch darf Nav-Ticks nicht nachholen; zwei Ticks Puffer halten den Takt trotzdem stabil. */
const MAX_ACCUMULATED_TICKS = 2;
/** Kein Ergebnis ueber so viele Ticks: Der Worker gilt als haengend, der Fallback uebernimmt. */
const WORKER_WATCHDOG_TICKS = 20;

export class FlowFieldCoordinator {
  /** Rastermasse dieser Runde; Verbraucher rechnen Weltpositionen damit in Zellindizes um. */
  readonly metrics: FlowFieldMetrics;
  private readonly tuning: FlowFieldTuning;
  private readonly costByCode: Uint32Array;
  private readonly lookups: FlowFieldNeighborLookups;
  private readonly sources: FlowFieldTopologySources;
  private readonly topology: FlowFieldTopology;
  private counts: FlowFieldTopologyCounts;
  private readonly bases: readonly FlowFieldBaseDescriptor[];
  private activeBaseIds: ReadonlySet<string>;
  private readonly obstacleCellProvider: () => ReadonlyArray<{ gridX: number; gridY: number }>;
  private readonly navTickIntervalMs: number;
  private readonly workspaces = new Map<string, FlowFieldPathWorkspace>();
  private readonly fields = new Map<string, CoordinatorField>();
  private readonly clearanceProfiles = new Set<number>([0]);
  private readonly suppressedGoalIndexes = new Set<number>();

  private runner: FlowFieldRunner;
  private initialized = false;
  private generationId: number;
  private topologyVersion = 0;
  private pendingPatches: FlowFieldPatch[] = [];
  private pendingCellPatchByIndex = new Map<number, number>();
  private pendingFullResync = false;
  private accumulatorMs = 0;
  private tickCounter = 0;
  private inFlightJobId = -1;
  private inFlightSinceTick = -1;
  private inFlightStartedAt = 0;
  private jobSequence = 0;
  private completedBatch: FlowFieldResultMessage | null = null;
  private destroyed = false;

  private dispatchedJobs = 0;
  private requestedUpdates = 0;
  private startedJobs = 0;
  private completedJobs = 0;
  private coalescedJobs = 0;
  private activatedBatches = 0;
  private droppedStale = 0;
  private skippedUnchangedFields = 0;
  private lastWorkerComputeMs = 0;
  private workerComputeTotalMs = 0;
  private workerComputeMaxMs = 0;
  private roundTripTotalMs = 0;
  private roundTripMaxMs = 0;
  private lastRoundTripMs = 0;

  constructor(options: FlowFieldCoordinatorOptions) {
    this.metrics = options.metrics;
    this.tuning = options.tuning;
    this.costByCode = buildCostByCode(options.tuning);
    this.lookups = buildNeighborLookups(options.metrics);
    this.bases = options.bases;
    this.activeBaseIds = new Set(options.activeBaseIds);
    this.obstacleCellProvider = options.obstacleCellProvider;
    this.navTickIntervalMs = options.navTickIntervalMs;
    this.generationId = options.generationId ?? 1;
    this.runner = options.runner ?? new InlineFlowFieldRunner();

    const totalCells = totalCellsOf(options.metrics);
    this.sources = {
      staticKind: options.staticKind,
      rockOccupancy: new Uint8Array(totalCells),
      baseOccupancy: new Uint8Array(totalCells),
    };
    this.refreshRockOccupancyFromProvider();
    this.refreshBaseOccupancy();

    this.topology = createTopology(totalCells);
    this.counts = this.classifyMirror();
    this.attachRunner(this.runner);
  }

  // ---- Felder ----

  registerField(fieldId: string, options: FlowFieldFieldOptions): FlowFieldFieldView {
    const clearanceCells = Math.max(0, Math.floor(options.clearanceCells ?? 0));
    if (this.initialized && !this.clearanceProfiles.has(clearanceCells)) {
      // Profile stehen in der Init-Nachricht. Nachtraegliche Felder (Ally) verwenden deshalb ein
      // bereits bekanntes Profil; alles andere waere ein Verdrahtungsfehler.
      throw new Error(`flowfield profile clearance:${clearanceCells} was not declared before init`);
    }
    this.clearanceProfiles.add(clearanceCells);

    const descriptor: FlowFieldFieldDescriptor = {
      fieldId,
      profileId: profileIdFor(clearanceCells),
      goalMode: options.goalMode,
    };
    const field: CoordinatorField = {
      descriptor,
      clearanceCells,
      tickDivisor: Math.max(1, Math.floor(options.tickDivisor ?? 1)),
      rawGoals: EMPTY_GOALS,
      goalVersion: 0,
      pendingPayload: undefined,
      dispatchedGoals: null,
      dispatchedTopologyVersion: -1,
      dispatchedPayload: undefined,
      activeSnapshot: null,
      requestedUpdates: 0,
      startedJobs: 0,
      completedJobs: 0,
      coalescedJobs: 0,
      skippedUnchangedFields: 0,
      lastActivatedAtMs: 0,
      activationListeners: new Set(),
      pool: { integration: [], vector: [], goalSource: [], traversable: [] },
      view: undefined as unknown as FlowFieldFieldView,
    };
    (field as { view: FlowFieldFieldView }).view = this.createView(field);
    this.fields.set(fieldId, field);
    if (this.initialized) this.pendingPatches.push({ t: 'field-add', field: descriptor });
    return field.view;
  }

  unregisterField(fieldId: string): void {
    const field = this.fields.get(fieldId);
    if (!field) return;
    this.fields.delete(fieldId);
    field.activationListeners.clear();
    field.activeSnapshot = null;
    field.pool.integration.length = 0;
    field.pool.vector.length = 0;
    field.pool.goalSource.length = 0;
    field.pool.traversable.length = 0;
    if (this.initialized) this.pendingPatches.push({ t: 'field-remove', fieldId });
  }

  getFieldView(fieldId: string): FlowFieldFieldView | null {
    return this.fields.get(fieldId)?.view ?? null;
  }

  /**
   * Setzt die Zielzellen eines Feldes. Der optionale Payload wird gemeinsam mit dem daraus
   * gerechneten Feld aktiviert - so bleiben etwa strategische Zielzuordnung und `goalSourceField`
   * garantiert aus derselben Generation.
   */
  setGoalCells(fieldId: string, goalIndexes: ArrayLike<number>, payload?: unknown): void {
    const field = this.fields.get(fieldId);
    if (!field) return;
    const nextGoals = sortedUnique(goalIndexes);
    const changed = !sameIndexes(field.rawGoals, nextGoals) || field.pendingPayload !== payload;
    if (changed) {
      this.requestedUpdates += 1;
      field.requestedUpdates += 1;
      if (this.inFlightJobId >= 0) {
        this.coalescedJobs += 1;
        field.coalescedJobs += 1;
      }
    }
    field.rawGoals = nextGoals;
    field.pendingPayload = payload;
  }

  // ---- Topologie ----

  /** Einzelzellenereignis mit Koordinate: der haeufige Fall, O(9) im Spiegel. */
  patchCell(gridX: number, gridY: number, occupied: boolean): void {
    if (gridX < 0 || gridX >= this.metrics.cols || gridY < 0 || gridY >= this.metrics.rows) return;
    const index = gridY * this.metrics.cols + gridX;
    const next = occupied ? 1 : 0;
    if (this.sources.rockOccupancy[index] === next) return;
    this.sources.rockOccupancy[index] = next;
    patchTopologyCells(
      this.topology, this.sources, this.metrics, this.costByCode, this.tuning,
      this.lookups, [index], this.counts,
    );
    this.topologyVersion += 1;
    if (this.pendingFullResync) return;
    this.pendingCellPatchByIndex.set(index, next);
  }

  /** Koordinatenloses Ereignis: Hindernisbestand neu lesen und komplett neu klassifizieren. */
  requestFullResync(): void {
    this.refreshRockOccupancyFromProvider();
    this.counts = this.classifyMirror();
    this.topologyVersion += 1;
    this.pendingFullResync = true;
    this.pendingCellPatchByIndex.clear();
  }

  /**
   * Aktive Basen. Der frueher synchrone Rebuild aller Felder entfaellt; stattdessen wird der Patch
   * prioritaer verschickt und die entfallenen Basisziele sofort gesperrt. Ohne diese Sperre bliebe
   * ein Gegner - allen voran der Boss - auf der Zielzelle der toten Basis stehen, weil sein
   * Integrationswert dort `0` ist und die Bewegung deshalb als "angekommen" gilt.
   */
  setActiveBaseIds(ids: ReadonlySet<string>): void {
    if (sameIds(ids, this.activeBaseIds)) return;
    const goalsBefore = computeBaseGoalIndexes(this.bases, this.activeBaseIds, 0, this.topology, this.metrics);

    this.activeBaseIds = new Set(ids);
    this.refreshBaseOccupancy();
    this.counts = this.classifyMirror();
    this.topologyVersion += 1;
    this.pendingPatches.push({ t: 'active-bases', ids: [...ids] });

    const goalsAfter = new Set(
      computeBaseGoalIndexes(this.bases, this.activeBaseIds, 0, this.topology, this.metrics),
    );
    for (const index of goalsBefore) {
      if (!goalsAfter.has(index)) this.suppressedGoalIndexes.add(index);
    }

    this.dispatchNow();
  }

  // ---- Takt ----

  /**
   * Ein Host-Frame. Aktiviert hoechstens einen fertigen Batch und verschickt hoechstens einen Job,
   * beides ausschliesslich am Nav-Tick.
   */
  advance(deltaMs: number): void {
    if (this.destroyed) return;
    this.accumulatorMs = Math.min(
      this.accumulatorMs + Math.max(0, deltaMs),
      this.navTickIntervalMs * MAX_ACCUMULATED_TICKS,
    );
    if (this.accumulatorMs < this.navTickIntervalMs) return;
    this.accumulatorMs -= this.navTickIntervalMs;
    this.runNavTick();
  }

  /**
   * Synchroner Erstaufbau waehrend des verborgenen Arena-Ladezustands. Er ersetzt den frueheren
   * `prepareNow()`-Pfad und garantiert vollstaendige Felder vor dem ersten Gameplay-Frame.
   *
   * Der Job wird bewusst lokal gerechnet statt verschickt: Der Worker bekommt mit derselben
   * Init-Nachricht denselben Zustand und rechnet erst wieder, wenn sich eine Eingabe aendert.
   */
  prepareNow(): boolean {
    return this.runSynchronously(true);
  }

  /**
   * Rechnet und aktiviert sofort im Main Thread. Nur fuer den Arena-Erstaufbau und den
   * selbstfahrenden Modus der Lesefassade in Tests - der Laufzeitpfad geht immer ueber Nav-Ticks.
   * Liefert, ob ueberhaupt etwas neu gerechnet wurde.
   */
  runSynchronously(force: boolean): boolean {
    if (this.destroyed) return false;
    // Ein Ergebnis, das ein prioritaerer Dispatch (Base-Aenderung) bereits erzeugt hat, wird hier
    // aktiviert statt liegen zu bleiben.
    let activated = false;
    if (this.completedBatch) {
      const pending = this.completedBatch;
      this.completedBatch = null;
      this.activateBatch(pending);
      this.inFlightJobId = -1;
      activated = true;
    }
    const initMessage = this.buildInitMessage();
    const wasInitialized = this.initialized;
    this.ensureInitialized();
    const job = this.buildJob([...this.fields.values()], force);
    if (!job || job.fields.length === 0) return activated;

    if (this.runner.kind === 'inline') {
      // Der Inline-Runner liefert im Auto-Flush-Modus sofort; ein zweites Rechenwerk waere reine
      // Doppelarbeit.
      this.dispatch(job);
      if (!this.completedBatch) return activated;
      const batch = this.completedBatch;
      this.completedBatch = null;
      this.activateBatch(batch);
      this.inFlightJobId = -1;
      return true;
    }

    // Worker-Pfad: ausschliesslich der Arena-Erstaufbau. Der Worker bekommt mit `initMessage`
    // denselben Zustand; die hier verbrauchten Patches sind darin bereits enthalten. Ein spaeterer
    // synchroner Lauf gegen einen Worker waere ein Verdrahtungsfehler.
    if (wasInitialized) {
      console.warn('[flowfield] synchronous run against a worker runner outside arena startup');
    }
    const engine = new FlowFieldEngine();
    engine.init(initMessage);
    this.activateBatch(engine.runJob(job));
    this.inFlightJobId = -1;
    return true;
  }

  private runNavTick(): void {
    this.tickCounter += 1;

    if (this.completedBatch) {
      const batch = this.completedBatch;
      this.completedBatch = null;
      this.activateBatch(batch);
    }

    if (this.inFlightJobId >= 0) {
      if (this.tickCounter - this.inFlightSinceTick >= WORKER_WATCHDOG_TICKS) {
        this.handleRunnerFailure('watchdog: no result within the expected window');
      }
      // Kein Pending-Job: Beim naechsten freien Tick wird frisch gesampelt. Damit wird A->B->C->D
      // zu A->D, ohne dass B und C je gerechnet werden.
      return;
    }

    this.dispatchDueFields();
  }

  private dispatchDueFields(): void {
    const due: CoordinatorField[] = [];
    for (const field of this.fields.values()) {
      if (this.tickCounter % field.tickDivisor !== 0) continue;
      due.push(field);
    }
    this.dispatch(this.buildJob(due, false));
  }

  /** Base-Aenderungen warten nicht auf den naechsten Tick; ein laufender Job wird ueberholt. */
  private dispatchNow(): void {
    if (!this.initialized) return;
    this.inFlightJobId = -1;
    if (this.completedBatch) {
      // Der Batch beruht auf der alten Basismenge und darf nicht mehr aktiviert werden.
      this.recycleResult(this.completedBatch);
      this.completedBatch = null;
      this.droppedStale += 1;
    }
    this.dispatchDueFieldsForAll();
  }

  private dispatchDueFieldsForAll(): void {
    this.dispatch(this.buildJob([...this.fields.values()], false));
  }

  /**
   * Der Job muss VOR dem Posten als in Flight gelten: Der Inline-Runner antwortet synchron, und ein
   * noch nicht gesetztes `inFlightJobId` wuerde das eigene Ergebnis als ueberholt verwerfen.
   */
  private dispatch(job: FlowFieldJobMessage | null): void {
    if (!job) return;
    this.dispatchedJobs += 1;
    this.startedJobs += 1;
    for (const resultField of job.fields) {
      const field = this.fields.get(resultField.fieldId);
      if (field) field.startedJobs += 1;
    }
    this.inFlightJobId = job.jobId;
    this.inFlightSinceTick = this.tickCounter;
    this.inFlightStartedAt = nowMs();
    this.runner.post(job);
  }

  private buildJob(candidates: readonly CoordinatorField[], force: boolean): FlowFieldJobMessage | null {
    this.ensureInitialized();
    const patches = this.takePendingPatches();
    const jobFields: FlowFieldJobField[] = [];

    for (const field of candidates) {
      if (!force && !this.needsRecompute(field)) {
        this.skippedUnchangedFields += 1;
        field.skippedUnchangedFields += 1;
        continue;
      }
      field.goalVersion += 1;
      field.dispatchedGoals = field.rawGoals;
      field.dispatchedTopologyVersion = this.topologyVersion;
      field.dispatchedPayload = field.pendingPayload;
      jobFields.push({
        fieldId: field.descriptor.fieldId,
        goalVersion: field.goalVersion,
        goals: field.rawGoals.slice(),
        integrationBuffer: field.pool.integration.pop(),
        vectorBuffer: field.pool.vector.pop(),
        goalSourceBuffer: field.pool.goalSource.pop(),
        traversableBuffer: field.clearanceCells > 0 ? field.pool.traversable.pop() : undefined,
      });
    }

    if (jobFields.length === 0 && patches.length === 0) return null;
    this.jobSequence += 1;
    return {
      type: 'job',
      generationId: this.generationId,
      jobId: this.jobSequence,
      inputTick: this.tickCounter,
      topologyVersion: this.topologyVersion,
      patches,
      fields: jobFields,
    };
  }

  private needsRecompute(field: CoordinatorField): boolean {
    if (field.activeSnapshot === null && field.dispatchedGoals === null) return true;
    if (field.dispatchedTopologyVersion !== this.topologyVersion) return true;
    return !sameIndexes(field.dispatchedGoals, field.rawGoals);
  }

  private takePendingPatches(): FlowFieldPatch[] {
    const patches = this.pendingPatches;
    this.pendingPatches = [];
    if (this.pendingFullResync) {
      patches.unshift({ t: 'rock-resync', rockOccupancy: this.sources.rockOccupancy.slice() });
      this.pendingFullResync = false;
    }
    for (const [index, occupied] of this.pendingCellPatchByIndex) {
      patches.push({ t: 'cell', index, occupied: occupied as 0 | 1 });
    }
    this.pendingCellPatchByIndex.clear();
    return patches;
  }

  // ---- Aktivierung ----

  private handleResult(result: FlowFieldResultMessage): void {
    if (this.destroyed) return;
    if (result.generationId !== this.generationId || result.jobId !== this.inFlightJobId) {
      // Alte Runde oder ein durch eine prioritaere Base-Aenderung ueberholter Job.
      this.droppedStale += 1;
      this.recycleResult(result);
      return;
    }
    this.inFlightJobId = -1;
    this.completedJobs += result.fields.length;
    for (const resultField of result.fields) {
      const field = this.fields.get(resultField.fieldId);
      if (field) field.completedJobs += 1;
    }
    this.lastWorkerComputeMs = result.computeMs;
    this.workerComputeTotalMs += Math.max(0, result.computeMs);
    this.workerComputeMaxMs = Math.max(this.workerComputeMaxMs, result.computeMs);
    this.lastRoundTripMs = Math.max(0, nowMs() - this.inFlightStartedAt);
    this.roundTripTotalMs += this.lastRoundTripMs;
    this.roundTripMaxMs = Math.max(this.roundTripMaxMs, this.lastRoundTripMs);
    this.completedBatch = result;
  }

  /**
   * Tauscht Feldzustaende und zugehoerige Payloads gemeinsam. Erst alle Views bauen und zuweisen,
   * danach die Vorgaengerpuffer recyceln - so ist der Snapshot nie halb getauscht.
   */
  private activateBatch(batch: FlowFieldResultMessage): void {
    const retired: Array<{ field: CoordinatorField; snapshot: FlowFieldSnapshot }> = [];
    const activated: CoordinatorField[] = [];

    for (const resultField of batch.fields) {
      const field = this.fields.get(resultField.fieldId);
      if (!field) {
        this.recycleOrphan(resultField);
        continue;
      }
      if (field.activeSnapshot) retired.push({ field, snapshot: field.activeSnapshot });
      field.activeSnapshot = {
        goalVersion: resultField.goalVersion,
        topologyVersion: batch.topologyVersion,
        integrationField: resultField.integrationField,
        vectorField: resultField.vectorField,
        goalSourceField: resultField.goalSourceField,
        goalIndexes: resultField.goalIndexes,
        profileTraversable: resultField.profileTraversable,
      };
      field.lastActivatedAtMs = nowMs();
      activated.push(field);
    }

    for (const { field, snapshot } of retired) {
      field.pool.integration.push(snapshot.integrationField.buffer as ArrayBuffer);
      field.pool.vector.push(snapshot.vectorField.buffer as ArrayBuffer);
      field.pool.goalSource.push(snapshot.goalSourceField.buffer as ArrayBuffer);
      if (snapshot.profileTraversable) {
        field.pool.traversable.push(snapshot.profileTraversable.buffer as ArrayBuffer);
      }
    }

    this.suppressedGoalIndexes.clear();
    this.activatedBatches += 1;
    for (const field of activated) {
      for (const listener of field.activationListeners) listener(field.dispatchedPayload);
    }
  }

  private recycleResult(result: FlowFieldResultMessage): void {
    for (const resultField of result.fields) this.recycleOrphan(resultField);
  }

  private recycleOrphan(resultField: FlowFieldResultMessage['fields'][number]): void {
    const field = this.fields.get(resultField.fieldId);
    if (!field) return;
    field.pool.integration.push(resultField.integrationField.buffer as ArrayBuffer);
    field.pool.vector.push(resultField.vectorField.buffer as ArrayBuffer);
    field.pool.goalSource.push(resultField.goalSourceField.buffer as ArrayBuffer);
    if (resultField.profileTraversable) {
      field.pool.traversable.push(resultField.profileTraversable.buffer as ArrayBuffer);
    }
  }

  // ---- Substrat ----

  private attachRunner(runner: FlowFieldRunner): void {
    runner.onResult((result) => this.handleResult(result));
    runner.onFailure((reason) => this.handleRunnerFailure(reason));
  }

  /** Ein haengender oder fehlerhafter Worker bedeutet eingefrorene KI - der Fallback muss greifen. */
  private handleRunnerFailure(reason: string): void {
    if (this.destroyed || this.runner.kind === 'inline') return;
    console.warn(`[flowfield] switching to the inline runner: ${reason}`);
    this.runner.terminate();
    this.runner = new InlineFlowFieldRunner();
    this.attachRunner(this.runner);
    this.initialized = false;
    this.inFlightJobId = -1;
    this.completedBatch = null;
    this.pendingPatches = [];
    this.pendingCellPatchByIndex.clear();
    this.pendingFullResync = false;
    for (const field of this.fields.values()) {
      field.dispatchedGoals = null;
      field.dispatchedTopologyVersion = -1;
    }
  }

  replaceRunner(runner: FlowFieldRunner): void {
    this.runner.terminate();
    this.runner = runner;
    this.attachRunner(runner);
    this.initialized = false;
    this.inFlightJobId = -1;
    this.completedBatch = null;
    for (const field of this.fields.values()) {
      field.dispatchedGoals = null;
      field.dispatchedTopologyVersion = -1;
    }
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.runner.post(this.buildInitMessage());
  }

  private buildInitMessage() {
    return {
      type: 'init' as const,
      protocolVersion: FLOW_FIELD_PROTOCOL_VERSION,
      generationId: this.generationId,
      metrics: this.metrics,
      tuning: this.tuning,
      // Kopien: Der Spiegel behaelt seine eigenen Raster, die Nachricht gibt ihre weg.
      staticKind: this.sources.staticKind.slice(),
      rockOccupancy: this.sources.rockOccupancy.slice(),
      bases: this.bases,
      activeBaseIds: [...this.activeBaseIds],
      profiles: [...this.clearanceProfiles].map((clearanceCells) => ({
        profileId: profileIdFor(clearanceCells),
        clearanceCells,
      })),
      fields: [...this.fields.values()].map((field) => field.descriptor),
    };
  }

  // ---- Spiegel ----

  private classifyMirror(): FlowFieldTopologyCounts {
    return classifyTopology(
      this.topology, this.sources, this.metrics, this.costByCode, this.tuning, 0,
    );
  }

  private refreshRockOccupancyFromProvider(): void {
    this.sources.rockOccupancy.fill(0);
    for (const cell of this.obstacleCellProvider()) {
      if (cell.gridX < 0 || cell.gridX >= this.metrics.cols) continue;
      if (cell.gridY < 0 || cell.gridY >= this.metrics.rows) continue;
      this.sources.rockOccupancy[cell.gridY * this.metrics.cols + cell.gridX] = 1;
    }
  }

  private refreshBaseOccupancy(): void {
    this.sources.baseOccupancy.fill(0);
    for (const base of this.bases) {
      if (!this.activeBaseIds.has(base.id)) continue;
      for (let cursor = 0; cursor < base.cellCoords.length; cursor += 2) {
        const gridX = base.cellCoords[cursor];
        const gridY = base.cellCoords[cursor + 1];
        if (gridX < 0 || gridX >= this.metrics.cols) continue;
        if (gridY < 0 || gridY >= this.metrics.rows) continue;
        this.sources.baseOccupancy[gridY * this.metrics.cols + gridX] = 1;
      }
    }
  }

  private createView(field: CoordinatorField): FlowFieldFieldView {
    // Das Profilobjekt wird zwischengespeichert: `topology()` liegt im Lesepfad jedes Gegners und
    // jedes Frames und darf dort nichts allokieren.
    let cachedTraversable: Uint8Array | null = null;
    let cachedTopology: FlowFieldTopology = this.topology;
    return {
      fieldId: field.descriptor.fieldId,
      metrics: this.metrics,
      tuning: this.tuning,
      lookups: this.lookups,
      topology: () => {
        const profileTraversable = field.activeSnapshot?.profileTraversable ?? null;
        if (field.clearanceCells === 0 || profileTraversable === null) return this.topology;
        if (profileTraversable !== cachedTraversable) {
          cachedTraversable = profileTraversable;
          cachedTopology = {
            costs: this.topology.costs,
            kindCodes: this.topology.kindCodes,
            destructible: this.topology.destructible,
            wallAdjacent: this.topology.wallAdjacent,
            traversable: profileTraversable,
          };
        }
        return cachedTopology;
      },
      snapshot: () => field.activeSnapshot,
      counts: () => this.counts,
      setGoals: (goalIndexes, payload) => {
        const nextGoals = sortedUnique(goalIndexes);
        const changed = !sameIndexes(field.rawGoals, nextGoals) || field.pendingPayload !== payload;
        if (changed) {
          this.requestedUpdates += 1;
          field.requestedUpdates += 1;
          if (this.inFlightJobId >= 0) {
            this.coalescedJobs += 1;
            field.coalescedJobs += 1;
          }
        }
        field.rawGoals = nextGoals;
        field.pendingPayload = payload;
      },
      isGoalSuppressed: (index) => this.suppressedGoalIndexes.size > 0
        && this.suppressedGoalIndexes.has(index),
      workspace: () => this.workspaceFor(field.clearanceCells),
      onActivated: (listener) => {
        field.activationListeners.add(listener);
        return () => field.activationListeners.delete(listener);
      },
    };
  }

  private workspaceFor(clearanceCells: number): FlowFieldPathWorkspace {
    const key = profileIdFor(clearanceCells);
    let workspace = this.workspaces.get(key);
    if (!workspace) {
      const totalCells = totalCellsOf(this.metrics);
      workspace = {
        costs: new Float32Array(totalCells),
        parents: new Int32Array(totalCells),
        generation: new Uint32Array(totalCells),
        generationId: 0,
        sequence: 0,
      };
      this.workspaces.set(key, workspace);
    }
    return workspace;
  }

  // ---- Diagnose und Lifecycle ----

  getDiagnostics(atMs = nowMs()): FlowFieldDiagnostics {
    const fields: Record<string, FlowFieldFieldDiagnostics> = {};
    for (const [fieldId, field] of this.fields) {
      const targetCadenceMs = this.navTickIntervalMs * field.tickDivisor;
      const staleEligible = field.descriptor.goalMode !== 'bases';
      const staleAfterMs = staleEligible ? targetCadenceMs * 3 : null;
      const activeAgeMs = field.lastActivatedAtMs > 0
        ? Math.max(0, atMs - field.lastActivatedAtMs)
        : null;
      fields[fieldId] = {
        fieldId,
        goalMode: field.descriptor.goalMode,
        targetCadenceMs,
        staleAfterMs,
        staleEligible,
        requestedUpdates: field.requestedUpdates,
        startedJobs: field.startedJobs,
        completedJobs: field.completedJobs,
        coalescedJobs: field.coalescedJobs,
        skippedUnchangedFields: field.skippedUnchangedFields,
        activeAgeMs,
        stale: staleEligible && activeAgeMs !== null && staleAfterMs !== null && activeAgeMs > staleAfterMs,
      };
    }
    return {
      runnerKind: this.runner.kind,
      requestedUpdates: this.requestedUpdates,
      dispatchedJobs: this.dispatchedJobs,
      startedJobs: this.startedJobs,
      completedJobs: this.completedJobs,
      activatedBatches: this.activatedBatches,
      droppedStale: this.droppedStale,
      coalescedJobs: this.coalescedJobs,
      skippedUnchangedFields: this.skippedUnchangedFields,
      backlogTicks: this.inFlightJobId >= 0 ? this.tickCounter - this.inFlightSinceTick : 0,
      lastWorkerComputeMs: this.lastWorkerComputeMs,
      workerComputeTotalMs: this.workerComputeTotalMs,
      workerComputeMaxMs: this.workerComputeMaxMs,
      roundTripTotalMs: this.roundTripTotalMs,
      roundTripMaxMs: this.roundTripMaxMs,
      lastRoundTripMs: this.lastRoundTripMs,
      fields,
    };
  }

  getTopologyVersion(): number {
    return this.topologyVersion;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Die Generation zu erhoehen macht jedes noch unterwegs befindliche Ergebnis unbrauchbar.
    this.generationId += 1;
    this.runner.terminate();
    this.completedBatch = null;
    this.fields.clear();
    this.workspaces.clear();
  }
}

function profileIdFor(clearanceCells: number): string {
  return `clearance:${clearanceCells}`;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function sortedUnique(values: ArrayLike<number>): Int32Array {
  if (values.length === 0) return EMPTY_GOALS;
  const unique = new Set<number>();
  for (let cursor = 0; cursor < values.length; cursor += 1) unique.add(values[cursor]);
  const result = Int32Array.from(unique);
  result.sort();
  return result;
}

function sameIndexes(left: Int32Array | null, right: Int32Array): boolean {
  if (left === null || left.length !== right.length) return false;
  for (let cursor = 0; cursor < left.length; cursor += 1) {
    if (left[cursor] !== right[cursor]) return false;
  }
  return true;
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const id of left) {
    if (!right.has(id)) return false;
  }
  return true;
}
