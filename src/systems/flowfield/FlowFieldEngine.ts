/**
 * Rechenseite der Flowfields. Laeuft im Web Worker und - als Fallback und in Tests - unveraendert
 * im Main Thread. Teil des Worker-Graphen: importiert nur Kernel und Protokoll, kennt weder `self`
 * noch Phaser noch `src/config.ts`.
 *
 * Die Engine haelt die Topologie persistent. Ein Job bringt nur Patches und die aktuellen
 * Zielmengen mit; ein vollstaendiger Resync ist die Ausnahme.
 */
import {
  FlowFieldMinHeap,
  buildCostByCode,
  buildNeighborLookups,
  classifyTopology,
  computeBaseGoalIndexes,
  computeIntegrationField,
  computeVectorField,
  createEmptyCounts,
  createTopology,
  isInBounds,
  normalizeGoalIndexes,
  patchTopologyCells,
  toIndex,
  totalCellsOf,
  type FlowFieldBaseDescriptor,
  type FlowFieldMetrics,
  type FlowFieldNeighborLookups,
  type FlowFieldTopology,
  type FlowFieldTopologyCounts,
  type FlowFieldTopologySources,
  type FlowFieldTuning,
} from './FlowFieldKernel';
import {
  FLOW_FIELD_PROTOCOL_VERSION,
  type FlowFieldFieldDescriptor,
  type FlowFieldInitMessage,
  type FlowFieldJobMessage,
  type FlowFieldPatch,
  type FlowFieldResultField,
  type FlowFieldResultMessage,
} from './FlowFieldProtocol';

interface EngineProfile {
  readonly profileId: string;
  readonly clearanceCells: number;
  readonly topology: FlowFieldTopology;
  counts: FlowFieldTopologyCounts;
  /** Sammelt Einzelzellen bis zum naechsten Job; nur fuer Profile ohne Clearance gueltig. */
  readonly pendingCells: Set<number>;
  needsFullReclassify: boolean;
}

export class FlowFieldEngine {
  private metrics: FlowFieldMetrics | null = null;
  private tuning: FlowFieldTuning | null = null;
  private costByCode = new Uint32Array(8);
  private lookups: FlowFieldNeighborLookups | null = null;
  private sources: FlowFieldTopologySources | null = null;
  private bases: readonly FlowFieldBaseDescriptor[] = [];
  private activeBaseIds: ReadonlySet<string> = new Set();
  private readonly profiles = new Map<string, EngineProfile>();
  private readonly fields = new Map<string, FlowFieldFieldDescriptor>();
  private readonly heap = new FlowFieldMinHeap();
  private generationId = -1;

  init(message: FlowFieldInitMessage): void {
    this.metrics = message.metrics;
    this.tuning = message.tuning;
    this.costByCode = buildCostByCode(message.tuning);
    this.lookups = buildNeighborLookups(message.metrics);
    this.generationId = message.generationId;
    this.bases = message.bases;
    this.activeBaseIds = new Set(message.activeBaseIds);

    const totalCells = totalCellsOf(message.metrics);
    this.sources = {
      staticKind: message.staticKind,
      rockOccupancy: message.rockOccupancy,
      baseOccupancy: new Uint8Array(totalCells),
    };
    this.refreshBaseOccupancy();

    this.profiles.clear();
    for (const descriptor of message.profiles) {
      this.profiles.set(descriptor.profileId, {
        profileId: descriptor.profileId,
        clearanceCells: descriptor.clearanceCells,
        topology: createTopology(totalCells),
        counts: { traversableCells: 0, blockedCells: totalCells, countsByKind: createEmptyCounts() },
        pendingCells: new Set<number>(),
        needsFullReclassify: true,
      });
    }

    this.fields.clear();
    for (const field of message.fields) this.fields.set(field.fieldId, field);

    this.refreshTopologies();
  }

  runJob(message: FlowFieldJobMessage): FlowFieldResultMessage {
    const startedAt = now();
    // Ein Job aus einer alten Runde wird nie gerechnet: Die Generation wechselt beim Arenaaufbau.
    if (message.generationId !== this.generationId || !this.metrics || !this.tuning || !this.lookups) {
      return {
        type: 'result',
        protocolVersion: FLOW_FIELD_PROTOCOL_VERSION,
        generationId: message.generationId,
        jobId: message.jobId,
        inputTick: message.inputTick,
        topologyVersion: message.topologyVersion,
        computeMs: 0,
        fields: [],
      };
    }

    for (const patch of message.patches) this.applyPatch(patch);
    this.refreshTopologies();

    const results: FlowFieldResultField[] = [];
    for (const jobField of message.fields) {
      const descriptor = this.fields.get(jobField.fieldId);
      const profile = descriptor ? this.profiles.get(descriptor.profileId) : undefined;
      if (!descriptor || !profile) continue;
      results.push(this.computeField(descriptor, profile, jobField));
    }

    return {
      type: 'result',
      protocolVersion: FLOW_FIELD_PROTOCOL_VERSION,
      generationId: message.generationId,
      jobId: message.jobId,
      inputTick: message.inputTick,
      topologyVersion: message.topologyVersion,
      computeMs: now() - startedAt,
      fields: results,
    };
  }

  private computeField(
    descriptor: FlowFieldFieldDescriptor,
    profile: EngineProfile,
    jobField: FlowFieldJobMessage['fields'][number],
  ): FlowFieldResultField {
    const metrics = this.metrics!;
    const tuning = this.tuning!;
    const lookups = this.lookups!;
    const totalCells = totalCellsOf(metrics);

    const goalIndexes = this.resolveGoalIndexes(descriptor, profile, jobField.goals);
    const target = {
      integrationField: viewFloat32(jobField.integrationBuffer, totalCells),
      vectorField: viewFloat32(jobField.vectorBuffer, totalCells * 2),
      goalSourceField: viewInt32(jobField.goalSourceBuffer, totalCells),
    };

    computeIntegrationField(target, profile.topology, lookups, tuning, goalIndexes, this.heap);
    computeVectorField(target, profile.topology, lookups, metrics);

    let profileTraversable: Uint8Array | null = null;
    if (profile.clearanceCells > 0) {
      // Der Main Thread spiegelt nur das Standardprofil selbst. Ein Clearance-Profil bekommt sein
      // erodiertes `traversable` deshalb gemeinsam mit dem Feld - beides aus derselben Topologie.
      profileTraversable = viewUint8(jobField.traversableBuffer, totalCells);
      profileTraversable.set(profile.topology.traversable);
    }

    return {
      fieldId: descriptor.fieldId,
      goalVersion: jobField.goalVersion,
      goalIndexes: Int32Array.from(goalIndexes),
      integrationField: target.integrationField,
      vectorField: target.vectorField,
      goalSourceField: target.goalSourceField,
      profileTraversable,
    };
  }

  private resolveGoalIndexes(
    descriptor: FlowFieldFieldDescriptor,
    profile: EngineProfile,
    rawGoals: Int32Array,
  ): number[] {
    const metrics = this.metrics!;
    if (descriptor.goalMode !== 'bases') {
      const dynamicGoals = normalizeGoalIndexes(rawGoals, profile.topology, metrics);
      if (descriptor.goalMode === 'dynamic') return dynamicGoals;
      if (dynamicGoals.length > 0) return dynamicGoals;
    }
    return computeBaseGoalIndexes(
      this.bases,
      this.activeBaseIds,
      profile.clearanceCells,
      profile.topology,
      metrics,
    );
  }

  private applyPatch(patch: FlowFieldPatch): void {
    const metrics = this.metrics!;
    const sources = this.sources!;
    switch (patch.t) {
      case 'cell': {
        if (patch.index < 0 || patch.index >= totalCellsOf(metrics)) return;
        sources.rockOccupancy[patch.index] = patch.occupied;
        for (const profile of this.profiles.values()) {
          // Eine Clearance-Maske kann durch eine einzelne Zelle beliebig weit entfernte Zellen
          // umschalten; dort hilft der Sparse-Pfad nicht.
          if (profile.clearanceCells > 0) profile.needsFullReclassify = true;
          else profile.pendingCells.add(patch.index);
        }
        return;
      }
      case 'rock-resync': {
        sources.rockOccupancy.set(patch.rockOccupancy);
        this.markAllProfilesForFullReclassify();
        return;
      }
      case 'active-bases': {
        this.activeBaseIds = new Set(patch.ids);
        this.refreshBaseOccupancy();
        this.markAllProfilesForFullReclassify();
        return;
      }
      case 'field-add': {
        this.fields.set(patch.field.fieldId, patch.field);
        return;
      }
      case 'field-remove': {
        this.fields.delete(patch.fieldId);
        return;
      }
    }
  }

  private markAllProfilesForFullReclassify(): void {
    for (const profile of this.profiles.values()) {
      profile.needsFullReclassify = true;
      profile.pendingCells.clear();
    }
  }

  private refreshBaseOccupancy(): void {
    const metrics = this.metrics!;
    const sources = this.sources!;
    sources.baseOccupancy.fill(0);
    for (const base of this.bases) {
      if (!this.activeBaseIds.has(base.id)) continue;
      for (let cursor = 0; cursor < base.cellCoords.length; cursor += 2) {
        const gridX = base.cellCoords[cursor];
        const gridY = base.cellCoords[cursor + 1];
        if (!isInBounds(metrics, gridX, gridY)) continue;
        sources.baseOccupancy[toIndex(metrics, gridX, gridY)] = 1;
      }
    }
  }

  private refreshTopologies(): void {
    const metrics = this.metrics!;
    const tuning = this.tuning!;
    const sources = this.sources!;
    const lookups = this.lookups!;
    for (const profile of this.profiles.values()) {
      if (profile.needsFullReclassify) {
        profile.counts = classifyTopology(
          profile.topology,
          sources,
          metrics,
          this.costByCode,
          tuning,
          profile.clearanceCells,
        );
        profile.needsFullReclassify = false;
        profile.pendingCells.clear();
        continue;
      }
      if (profile.pendingCells.size === 0) continue;
      patchTopologyCells(
        profile.topology,
        sources,
        metrics,
        this.costByCode,
        tuning,
        lookups,
        profile.pendingCells,
        profile.counts,
      );
      profile.pendingCells.clear();
    }
  }
}

function viewFloat32(buffer: ArrayBuffer | undefined, length: number): Float32Array {
  if (buffer && buffer.byteLength >= length * 4) return new Float32Array(buffer, 0, length);
  return new Float32Array(length);
}

function viewInt32(buffer: ArrayBuffer | undefined, length: number): Int32Array {
  if (buffer && buffer.byteLength >= length * 4) return new Int32Array(buffer, 0, length);
  return new Int32Array(length);
}

function viewUint8(buffer: ArrayBuffer | undefined, length: number): Uint8Array {
  if (buffer && buffer.byteLength >= length) return new Uint8Array(buffer, 0, length);
  return new Uint8Array(length);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
