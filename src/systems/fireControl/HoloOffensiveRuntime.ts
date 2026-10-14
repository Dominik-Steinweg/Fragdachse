import type { HoloOffensiveUltimateConfig } from '../../loadout/LoadoutTypes';
import type { EnergyInjectorConstructionEffect } from '../../types';
import type {
  PlayerUltimateDeploymentResult, PlayerUltimateHoloOffensiveCapability, PlayerUltimateHoloOffensiveRequest,
} from '../../world/PlayerUltimateBehaviorRuntime';
import type { AutomatedTurret, TurretFireSource, TurretProjection } from '../TurretFireSource';
import type { FireControlConstructionFacts } from './FireControlCopyPlan';
import {
  fireControlHoloSourceId, type FireControlDeploymentIdSource, type FireControlHoloDeploymentSnapshot,
} from './FireControlSnapshot';
import { HoloSpawnLayout, type HoloCopyPosition } from './HoloSpawnLayout';
import { HoloTemplateSelection, type HoloTemplate } from './HoloTemplateSelection';

export interface HoloOffensiveRuntimeDeps {
  /** Shared with the relay/portal runtime for the entire World lifetime; never reset by clear(). */
  readonly ids: FireControlDeploymentIdSource;
  /** Originals in this World only, with regular combat readiness independent of manning/relay pauses. */
  readConstructions(): readonly FireControlConstructionFacts[];
  readSlotOrder(ownerId: string): readonly string[];
  readOwner(ownerId: string): { x: number; y: number; color: number } | null;
  /** Permanent definition only, before injector, remote-control or other temporary modifiers. */
  readTurretDefinition(id: number): AutomatedTurret | null;
  isPointFree(x: number, y: number, radius: number): boolean;
  /** All live relay copies; this runtime adds Holo copies of every owner itself. */
  readForeignCopyPositions(): Iterable<HoloCopyPosition>;
  isPersonalMg(templateId: number): boolean;
  /** The construction's authored injector effect, independent of a currently active injector. */
  resolveInjectorEffect(constructionId: string): EnergyInjectorConstructionEffect | null;
}

interface Copy {
  readonly seq: number;
  readonly spawnedAt: number;
  readonly definition: AutomatedTurret;
  readonly projection: TurretProjection;
  angle: number;
}

interface Deployment {
  readonly id: number;
  readonly ownerId: string;
  readonly ownerColor: number;
  readonly x: number;
  readonly y: number;
  readonly startedAt: number;
  readonly config: HoloOffensiveUltimateConfig;
  readonly selection: HoloTemplateSelection;
  readonly layout: HoloSpawnLayout;
  spawnUntil: number;
  nextSpawn: number;
  nextSeq: number;
  copies: Copy[];
}

/** Definitions and authored effects are plain data; detach before freezing every nested value. */
function frozenClone<T>(value: T): T {
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== 'object') return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  const clone = structuredClone(value);
  freeze(clone);
  return clone;
}

/** World-local host rules. Call update with monotonic absolute host time before reading live state. */
export class HoloOffensiveRuntime implements PlayerUltimateHoloOffensiveCapability {
  private readonly deployments = new Map<string, Deployment>();

  constructor(private readonly deps: HoloOffensiveRuntimeDeps) {}

  tryActivate(request: PlayerUltimateHoloOffensiveRequest): PlayerUltimateDeploymentResult {
    const { playerId, config, nowMs, consumedRage } = request;
    if (this.isActive(playerId)) return { ok: false, reason: 'blocked' };
    const spawnUntil = nowMs + consumedRage / config.ragePerSpawnSecond * 1000;
    if (![nowMs, spawnUntil, consumedRage, config.ragePerSpawnSecond, config.spawnIntervalMs,
      config.copyLifetimeMs, config.materializeMs, config.clearanceRadiusPx, config.minCopySpacingPx,
      ...config.spawnRingRadiiPx].every(Number.isFinite)
      || nowMs < 0 || consumedRage <= 0 || config.ragePerSpawnSecond <= 0 || spawnUntil <= nowMs
      || config.spawnIntervalMs <= 0 || config.copyLifetimeMs <= 0 || config.materializeMs < 0
      || config.clearanceRadiusPx < 0 || config.minCopySpacingPx < 0 || !config.spawnRingRadiiPx.length
      || config.spawnRingRadiiPx.some(radius => radius < 0)
      || !Number.isSafeInteger(config.spawnRingSlots) || config.spawnRingSlots <= 0) {
      return { ok: false, reason: 'blocked' };
    }
    const owner = this.deps.readOwner(playerId);
    if (!owner) return { ok: false, reason: 'blocked' };
    const selection = new HoloTemplateSelection();
    const template = this.selectTemplate(selection, playerId, owner);
    if (!template) return { ok: false, reason: 'no_fire_sources' };
    const definition = this.deps.readTurretDefinition(template.id);
    if (!definition) return { ok: false, reason: 'no_fire_sources' };
    const layout = new HoloSpawnLayout();
    const position = this.findPosition(layout, owner, config, nowMs);
    if (!position) return { ok: false, reason: 'placement' };
    const deployment: Deployment = {
      id: this.deps.ids.next(), ownerId: playerId, ownerColor: owner.color, x: owner.x, y: owner.y,
      startedAt: nowMs, spawnUntil, config: frozenClone(config), selection, layout,
      nextSpawn: 1, nextSeq: 0, copies: [],
    };
    this.addCopy(deployment, template, definition, position, nowMs);
    this.deployments.set(playerId, deployment);
    return { ok: true };
  }

  update(now: number): void {
    // Chronological across owners, so expired copies never block later scheduled spawns in a long frame.
    for (;;) {
      let due: Deployment | undefined;
      for (const deployment of this.deployments.values()) {
        const at = this.nextSpawnAt(deployment);
        if (at < deployment.spawnUntil && at <= now && (!due || at < this.nextSpawnAt(due))) due = deployment;
      }
      if (!due) break;
      const spawnedAt = this.nextSpawnAt(due);
      due.nextSpawn++;
      this.expireCopies(spawnedAt);
      const owner = this.deps.readOwner(due.ownerId);
      if (!owner) continue;
      const template = this.selectTemplate(due.selection, due.ownerId, owner);
      if (!template) continue;
      const definition = this.deps.readTurretDefinition(template.id);
      if (!definition) continue;
      const position = this.findPosition(due.layout, owner, due.config, spawnedAt);
      if (position) this.addCopy(due, template, definition, position, spawnedAt);
    }
    this.expireCopies(now);
    for (const [ownerId, deployment] of this.deployments) {
      if (!deployment.copies.length && !this.hasPending(deployment)) this.deployments.delete(ownerId);
    }
  }

  private selectTemplate(selection: HoloTemplateSelection, ownerId: string, owner: HoloCopyPosition): HoloTemplate | null {
    return selection.next(ownerId, owner, this.deps.readConstructions(), this.deps.readSlotOrder(ownerId));
  }

  private findPosition(layout: HoloSpawnLayout, owner: HoloCopyPosition, config: HoloOffensiveUltimateConfig,
    at: number): HoloCopyPosition | null {
    const positions: HoloCopyPosition[] = [...this.deps.readForeignCopyPositions()];
    for (const deployment of this.deployments.values()) {
      for (const copy of deployment.copies) {
        if (copy.spawnedAt <= at && at < copy.spawnedAt + deployment.config.copyLifetimeMs) positions.push(copy.definition);
      }
    }
    return layout.find(owner, config, positions, (x, y, radius) => this.deps.isPointFree(x, y, radius));
  }

  private addCopy(deployment: Deployment, template: HoloTemplate, original: AutomatedTurret,
    position: HoloCopyPosition, spawnedAt: number): void {
    const seq = deployment.nextSeq++;
    const id = fireControlHoloSourceId(deployment.id, seq);
    // Accept only the permanent AutomatedTurret contract, never live fire-source assignments or sequences.
    const definition = frozenClone<AutomatedTurret>({
      id, ...position, ownerId: deployment.ownerId, ownerColor: deployment.ownerColor,
      angle: original.angle ?? template.angle ?? 0, weaponId: original.weaponId ?? template.weaponId ?? 'SPORES',
      secondProjectileDamageFactor: original.secondProjectileDamageFactor,
      targetRange: original.targetRange, projectileRange: original.projectileRange,
      cooldownMs: original.cooldownMs, damage: original.damage, muzzleOffset: original.muzzleOffset,
      targetMode: original.targetMode, rotationSpeedDegPerSec: original.rotationSpeedDegPerSec,
      aimToleranceDeg: original.aimToleranceDeg,
    });
    const projection = frozenClone<TurretProjection>({
      deploymentId: deployment.id, templateId: template.id, personalMg: this.deps.isPersonalMg(template.id),
      injectorEffect: deployment.config.injectorProjectionEnabled > 0
        ? this.deps.resolveInjectorEffect(template.constructionId) : null,
    });
    deployment.copies.push({ seq, spawnedAt, definition, projection, angle: definition.angle! });
  }

  deriveFireSources(now: number): TurretFireSource[] {
    const sources: TurretFireSource[] = [];
    for (const deployment of this.deployments.values()) for (const copy of deployment.copies) {
      if (now < copy.spawnedAt + deployment.config.materializeMs
        || now >= copy.spawnedAt + deployment.config.copyLifetimeMs) continue;
      const { id } = copy.definition;
      sources.push({ ...copy.definition, angle: copy.angle, identityId: id, sequenceKey: id, visualId: id,
        fireState: 'active', projection: copy.projection });
    }
    return sources;
  }

  setCopyAngle(sourceId: string, angle: number): boolean {
    if (!Number.isFinite(angle)) return false;
    for (const deployment of this.deployments.values()) for (const copy of deployment.copies) {
      if (copy.definition.id === sourceId) { copy.angle = angle; return true; }
    }
    return false;
  }

  isActive(ownerId: string): boolean {
    const deployment = this.deployments.get(ownerId);
    return !!deployment && (this.hasPending(deployment) || deployment.copies.length > 0);
  }

  stopSpawning(ownerId: string, now: number): void {
    const deployment = this.deployments.get(ownerId);
    if (!deployment) return;
    deployment.spawnUntil = Math.min(deployment.spawnUntil, now);
    // update still processes earlier appointments; none at or after the death timestamp can spawn.
    if (!deployment.copies.length && !this.hasPending(deployment)) this.deployments.delete(ownerId);
  }

  removeOwner(ownerId: string): void { this.deployments.delete(ownerId); }
  clear(): void { this.deployments.clear(); }

  /** Live state after the last update; includes materializing copies and all owners. */
  getCopyPositions(): HoloCopyPosition[] {
    return [...this.deployments.values()].flatMap(deployment =>
      deployment.copies.map(copy => ({ x: copy.definition.x, y: copy.definition.y })));
  }

  getSnapshotDeployments(now: number): FireControlHoloDeploymentSnapshot[] {
    const snapshots: FireControlHoloDeploymentSnapshot[] = [];
    for (const deployment of this.deployments.values()) {
      const { config, startedAt, spawnUntil } = deployment;
      const copies = deployment.copies.filter(copy => now < copy.spawnedAt + config.copyLifetimeMs);
      const pending = this.hasPending(deployment);
      if (!pending && !copies.length) continue;
      const expiresAt = pending
        ? startedAt + (Math.ceil((spawnUntil - startedAt) / config.spawnIntervalMs) - 1) * config.spawnIntervalMs
          + config.copyLifetimeMs
        : Math.max(...copies.map(copy => copy.spawnedAt + config.copyLifetimeMs));
      snapshots.push({ kind: 'holo', id: deployment.id, ownerId: deployment.ownerId, ownerColor: deployment.ownerColor,
        x: deployment.x, y: deployment.y, startedAt, expiresAt, spawnUntil,
        copyLifetimeMs: config.copyLifetimeMs, materializeMs: config.materializeMs,
        copies: copies.map(copy => ({ seq: copy.seq, sourceId: copy.definition.id as string,
          weaponId: copy.definition.weaponId!, x: copy.definition.x, y: copy.definition.y,
          angle: copy.angle, spawnedAt: copy.spawnedAt })) });
    }
    return snapshots;
  }

  private nextSpawnAt(deployment: Deployment): number {
    return deployment.startedAt + deployment.nextSpawn * deployment.config.spawnIntervalMs;
  }
  private hasPending(deployment: Deployment): boolean { return this.nextSpawnAt(deployment) < deployment.spawnUntil; }
  private expireCopies(now: number): void {
    for (const deployment of this.deployments.values()) {
      deployment.copies = deployment.copies.filter(copy => now < copy.spawnedAt + deployment.config.copyLifetimeMs);
    }
  }
}
