/**
 * Rechenseite der Flowfields. Laeuft im Web Worker und - als Fallback und in Tests - unveraendert
 * im Main Thread. Teil des Worker-Graphen: importiert nur Kernel und Protokoll, kennt weder `self`
 * noch Phaser noch `src/config.ts`.
 *
 * Die Engine haelt die Topologie persistent. Ein Job bringt nur Patches und die aktuellen
 * Zielmengen mit; ein vollstaendiger Resync ist die Ausnahme.
 */
import {
  CELL_CODE,
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
  PORTAL_LINK_STRIDE,
  SWIM_COST_SCALE,
  type FlowFieldFieldDescriptor,
  type FlowFieldInitMessage,
  type FlowFieldJobMessage,
  type FlowFieldPatch,
  type FlowFieldPortalLink,
  type FlowFieldResultField,
  type FlowFieldResultMessage,
} from './FlowFieldProtocol';
import { NavigationGeometry } from '../navigation/NavigationGeometry';
import { buildNavigationGraph, navigationPoint, type NavigationGraph } from '../navigation/NavigationGraph';
import { segmentObstacleDistanceSq } from '../navigation/NavigationGeometry';

interface EngineProfile {
  readonly profileId: string;
  readonly clearanceCells: number;
  readonly bodyRadius?: number;
  readonly swimCostRatio?: number;
  graph?: NavigationGraph;
  readonly topology: FlowFieldTopology;
  counts: FlowFieldTopologyCounts;
  /** Sammelt Einzelzellen bis zum naechsten Job; nur fuer Profile ohne Clearance gueltig. */
  readonly pendingCells: Set<number>;
  needsFullReclassify: boolean;
  /** Graph regions joined across this profile's links; the graph's own regions without links. */
  regions?: Int32Array;
  /** Resolved jumps, {@link PORTAL_LINK_STRIDE} entries each. */
  portalLinks: Int32Array;
  linksDirty: boolean;
}

const NO_PORTAL_LINKS = new Int32Array(0);

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
  private geometry: NavigationGeometry | null = null;
  private swimGeometry: { source: NavigationGeometry; geometry: NavigationGeometry } | null = null;
  private density: Float32Array | undefined;
  private portalLinks: readonly FlowFieldPortalLink[] = [];

  init(message: FlowFieldInitMessage): void {
    this.metrics = message.metrics;
    this.geometry = message.geometry ? new NavigationGeometry(message.geometry) : null;
    this.density = undefined;
    this.tuning = message.tuning;
    this.costByCode = buildCostByCode(message.tuning);
    this.lookups = buildNeighborLookups(message.metrics);
    this.generationId = message.generationId;
    this.bases = message.bases;
    this.activeBaseIds = new Set(message.activeBaseIds);
    this.portalLinks = message.portalLinks;

    const totalCells = totalCellsOf(message.metrics);
    this.sources = {
      staticKind: message.staticKind,
      rockOccupancy: message.rockOccupancy,
      baseOccupancy: new Uint8Array(totalCells),
      barrierOccupancy: message.barrierOccupancy,
    };
    this.refreshBaseOccupancy();

    this.profiles.clear();
    for (const descriptor of message.profiles) {
      this.profiles.set(descriptor.profileId, {
        profileId: descriptor.profileId,
        clearanceCells: descriptor.clearanceCells,
        bodyRadius: descriptor.bodyRadius,
        ...(descriptor.swimCostRatio ? { swimCostRatio: descriptor.swimCostRatio } : {}),
        topology: createTopology(totalCells),
        counts: { traversableCells: 0, blockedCells: totalCells, countsByKind: createEmptyCounts() },
        pendingCells: new Set<number>(),
        needsFullReclassify: true,
        portalLinks: NO_PORTAL_LINKS,
        linksDirty: true,
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
    profile.topology.density = this.density;
    const target = {
      integrationField: viewFloat32(jobField.integrationBuffer, totalCells),
      vectorField: viewFloat32(jobField.vectorBuffer, totalCells * 2),
      goalSourceField: viewInt32(jobField.goalSourceBuffer, totalCells),
    };

    computeIntegrationField(target, profile.topology, lookups, tuning, goalIndexes, this.heap);
    computeVectorField(target, profile.topology, lookups, metrics);

    let profileTraversable: Uint8Array | null = null;
    if (profile.clearanceCells > 0 || profile.graph) {
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
      edges: profile.graph ? copyUint8(profile.graph.edges, jobField.edgeBuffer) : undefined,
      regions: profile.graph ? copyInt32(profile.regions ?? profile.graph.regions, jobField.regionBuffer) : undefined,
      // Fresh per result: the buffer is transferred with it.
      portalLinks: profile.portalLinks.slice(),
    };
  }

  private resolveGoalIndexes(
    descriptor: FlowFieldFieldDescriptor,
    profile: EngineProfile,
    rawGoals: Int32Array,
  ): number[] {
    const metrics = this.metrics!;
    if (descriptor.goalMode !== 'bases') {
      const dynamicGoals = this.geometry ? [...new Set(rawGoals)].filter(index => index >= 0
        && index < totalCellsOf(metrics) && profile.topology.traversable[index] === 1).sort((a, b) => a - b)
        : normalizeGoalIndexes(rawGoals, profile.topology, metrics);
      if (descriptor.goalMode === 'dynamic') return dynamicGoals;
      if (dynamicGoals.length > 0) return dynamicGoals;
    }
    if (this.geometry && profile.graph) {
      const goals = new Set<number>(), radius = profile.graph.radius;
      const ids = new Set(this.bases.filter(base => base.isGoalSource && this.activeBaseIds.has(base.id)).map(base => `base:${base.id}`));
      for (const obstacle of this.geometry.snapshot.obstacles) {
        if (!ids.has(obstacle.id) || obstacle.shape !== 'rect') continue;
        const distance = radius + metrics.cellSize;
        const left = Math.max(0, Math.floor((obstacle.left - distance - metrics.arenaOffsetX) / metrics.cellSize));
        const right = Math.min(metrics.cols - 1, Math.ceil((obstacle.right + distance - metrics.arenaOffsetX) / metrics.cellSize));
        const top = Math.max(0, Math.floor((obstacle.top - distance - metrics.arenaOffsetY) / metrics.cellSize));
        const bottom = Math.min(metrics.rows - 1, Math.ceil((obstacle.bottom + distance - metrics.arenaOffsetY) / metrics.cellSize));
        for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
          const index = y * metrics.cols + x, p = navigationPoint(metrics, index);
          if (profile.graph.traversable[index] && segmentObstacleDistanceSq(p.x, p.y, p.x, p.y, obstacle) <= distance ** 2) goals.add(index);
        }
      }
      return [...goals].sort((a, b) => a - b);
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
      case 'density': this.density = patch.costs; return;
      case 'geometry': {
        this.geometry = new NavigationGeometry(patch.geometry);
        this.markAllProfilesForFullReclassify();
        return;
      }
      case 'profile-add': {
        const descriptor = patch.profile;
        this.profiles.set(descriptor.profileId, { ...descriptor,
          topology: createTopology(totalCellsOf(metrics)),
          counts: { traversableCells: 0, blockedCells: totalCellsOf(metrics), countsByKind: createEmptyCounts() },
          pendingCells: new Set(), needsFullReclassify: true, portalLinks: NO_PORTAL_LINKS, linksDirty: true });
        return;
      }
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
      case 'barrier-resync': {
        sources.barrierOccupancy.set(patch.barrierOccupancy);
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
      case 'portal-links': {
        // Links only add jumps on top of the unchanged body graph; nothing is reclassified.
        this.portalLinks = patch.links;
        for (const profile of this.profiles.values()) profile.linksDirty = true;
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

  private waterFreeGeometry(geometry: NavigationGeometry): NavigationGeometry {
    if (this.swimGeometry?.source !== geometry) this.swimGeometry = { source: geometry, geometry: new NavigationGeometry({ ...geometry.snapshot,
      obstacles: geometry.snapshot.obstacles.filter(obstacle => obstacle.kind !== 'water') }) };
    return this.swimGeometry.geometry;
  }

  /**
   * Projects the link set onto one profile without touching its graph: one node per endpoint (the
   * body-free node closest to the portal center, within the crossing radius), jump arrays on the
   * topology and graph regions joined across every resolved link.
   */
  private resolvePortalLinks(profile: EngineProfile): void {
    if (!profile.linksDirty) return;
    profile.linksDirty = false;
    const topology = profile.topology, graph = profile.graph;
    topology.jumpTo = topology.jumpFrom = topology.jumpCost = undefined;
    profile.regions = graph?.regions;
    profile.portalLinks = NO_PORTAL_LINKS;
    if (!graph || !this.portalLinks.length) return;
    const metrics = this.metrics!, bodyRadius = profile.bodyRadius ?? 15;
    const scale = this.tuning!.groundCost * (profile.swimCostRatio ? SWIM_COST_SCALE : 1);
    const jumps: number[] = [], used = new Set<number>();
    for (const link of this.portalLinks) {
      if (bodyRadius > link.maxBodyRadiusPx) continue;
      const a = nearestPortalNode(metrics, graph, link.ax, link.ay, link.radiusPx - 1);
      const b = nearestPortalNode(metrics, graph, link.bx, link.by, link.radiusPx - 1);
      // A node carries at most one jump; an overlapping later link is skipped for this profile.
      if (a < 0 || b < 0 || a === b || used.has(a) || used.has(b)) continue;
      used.add(a); used.add(b);
      const cost = link.costPx * scale;
      jumps.push(a, b, cost, b, a, cost);
    }
    if (!jumps.length) return;
    const total = totalCellsOf(metrics);
    const jumpTo = new Int32Array(total).fill(-1), jumpFrom = new Int32Array(total).fill(-1);
    const jumpCost = new Float32Array(total);
    let maxRegion = 0;
    for (const region of graph.regions) if (region > maxRegion) maxRegion = region;
    const parents = Int32Array.from({ length: maxRegion + 1 }, (_, region) => region);
    let joined = false;
    for (let cursor = 0; cursor < jumps.length; cursor += PORTAL_LINK_STRIDE) {
      const entry = jumps[cursor], exit = jumps[cursor + 1];
      jumpTo[entry] = exit; jumpFrom[exit] = entry; jumpCost[entry] = jumps[cursor + 2];
      const left = findRegionRoot(parents, graph.regions[entry]);
      const right = findRegionRoot(parents, graph.regions[exit]);
      if (left === right) continue;
      // The smaller id represents the union, so joined ids do not depend on link order.
      if (left < right) parents[right] = left; else parents[left] = right;
      joined = true;
    }
    topology.jumpTo = jumpTo; topology.jumpFrom = jumpFrom; topology.jumpCost = jumpCost;
    profile.portalLinks = Int32Array.from(jumps);
    if (!joined) return;
    const regions = new Int32Array(total);
    for (let index = 0; index < total; index++) {
      const region = graph.regions[index];
      regions[index] = region ? findRegionRoot(parents, region) : 0;
    }
    profile.regions = regions;
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
          this.geometry ? 0 : profile.clearanceCells,
        );
        if (this.geometry) {
          profile.graph = buildNavigationGraph(metrics, profile.swimCostRatio ? this.waterFreeGeometry(this.geometry) : this.geometry,
            profile.bodyRadius ?? 15, lookups, profile.topology);
          let traversableCells = 0;
          for (const free of profile.graph.traversable) traversableCells += free;
          profile.counts = { ...profile.counts, traversableCells, blockedCells: totalCellsOf(metrics) - traversableCells };
          // Blocked sample locations may lie in terrain cells; exact geometry alone decides connectivity.
          for (let i = 0; i < profile.topology.costs.length; i++) {
            if (profile.graph.traversable[i] && profile.topology.costs[i] > tuning.trackCost + tuning.wallAdjacentCost) {
              profile.topology.costs[i] = tuning.groundCost;
            }
          }
          // Amphibious bodies: scale land so water (traversable in this graph) can cost less than a ground step.
          if (profile.swimCostRatio) {
            const water = Math.max(1, Math.round(SWIM_COST_SCALE * tuning.groundCost / profile.swimCostRatio));
            for (let i = 0; i < profile.topology.costs.length; i++) {
              if (!profile.graph.traversable[i]) continue;
              profile.topology.costs[i] = profile.topology.kindCodes[i] === CELL_CODE.water ? water
                : profile.topology.costs[i] * SWIM_COST_SCALE;
            }
          }
        }
        profile.needsFullReclassify = false;
        profile.pendingCells.clear();
        // A rebuilt graph moves nodes and regions; links resolve against it again.
        profile.linksDirty = true;
        this.resolvePortalLinks(profile);
        continue;
      }
      this.resolvePortalLinks(profile);
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

/** Nearest body-free node to an endpoint within `maxDistance`; ties go to the lower index. */
function nearestPortalNode(metrics: FlowFieldMetrics, graph: NavigationGraph, x: number, y: number,
  maxDistance: number): number {
  if (!(maxDistance >= 0) || !Number.isFinite(x + y)) return -1;
  const pointOffset = metrics.pointOffset ?? 0.5;
  const left = Math.max(0, Math.floor((x - maxDistance - metrics.arenaOffsetX) / metrics.cellSize - pointOffset));
  const right = Math.min(metrics.cols - 1, Math.ceil((x + maxDistance - metrics.arenaOffsetX) / metrics.cellSize - pointOffset));
  const top = Math.max(0, Math.floor((y - maxDistance - metrics.arenaOffsetY) / metrics.cellSize - pointOffset));
  const bottom = Math.min(metrics.rows - 1, Math.ceil((y + maxDistance - metrics.arenaOffsetY) / metrics.cellSize - pointOffset));
  let best = -1, bestDistanceSq = maxDistance * maxDistance;
  for (let gridY = top; gridY <= bottom; gridY++) for (let gridX = left; gridX <= right; gridX++) {
    const index = gridY * metrics.cols + gridX;
    if (graph.traversable[index] !== 1) continue;
    const point = navigationPoint(metrics, index), distanceSq = (point.x - x) ** 2 + (point.y - y) ** 2;
    // Row-major order visits lower indexes first, so only a strictly closer node replaces the best.
    if (distanceSq < bestDistanceSq || (best < 0 && distanceSq === bestDistanceSq)) {
      best = index; bestDistanceSq = distanceSq;
    }
  }
  return best;
}

function findRegionRoot(parents: Int32Array, region: number): number {
  while (parents[region] !== region) region = parents[region] = parents[parents[region]];
  return region;
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

function copyUint8(source: Uint8Array, buffer?: ArrayBuffer): Uint8Array {
  const result = viewUint8(buffer, source.length); result.set(source); return result;
}
function copyInt32(source: Int32Array, buffer?: ArrayBuffer): Int32Array {
  const result = viewInt32(buffer, source.length); result.set(source); return result;
}
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
