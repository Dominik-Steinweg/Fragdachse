import { toLocalTurretFireSource, type AutomatedTurret, type AutomatedTurretId, type TurretFireSource } from '../TurretFireSource';
import type {
  FireControlActivation, FireControlUtilityPort, ResolvedFireControlPortalConfig, ResolvedFireControlRelayConfig,
} from '../../world/FireControlUtilityPort';
import { planFireControlCopies, type FireControlConstructionFacts } from './FireControlCopyPlan';
import { classifyFireControlSource } from './FireControlEligibility';
import { resolvePortalLandingPoint } from './FireControlPortalThrow';
import {
  createFireControlDeploymentIdSource, fireControlCopySourceId, type FireControlDeploymentIdSource,
  type FireControlEntryMode, type FireControlEntrySnapshot, type FireControlSnapshot,
} from './FireControlSnapshot';

interface Copy {
  readonly slot: number; readonly originalId: number;
  readonly x: number; readonly y: number;
  readonly materializedAt: number;
  angle: number;
}
interface DeploymentBase {
  readonly id: number; readonly ownerId: string; readonly ownerColor: number;
  readonly x: number; readonly y: number;
  readonly startedAt: number; readonly expiresAt: number;
}
interface CopiesDeployment extends DeploymentBase {
  readonly kind: 'copies';
  readonly config: ResolvedFireControlRelayConfig;
  copies: Copy[];
}
interface Entry {
  readonly identityId: number;
  mode: FireControlEntryMode;
  x: number; y: number; angle: number;
  lastTransportAt?: number;
}
interface PortalDeployment extends DeploymentBase {
  readonly kind: 'portal';
  readonly config: ResolvedFireControlPortalConfig;
  /** Tick-derived participants; pose and mode are reported by the TurretSystem. */
  readonly entries: Map<AutomatedTurretId, Entry>;
}
type Deployment = CopiesDeployment | PortalDeployment;

/** Feedback of the TurretSystem; the runtime never recomputes target choice or entry poses. */
export interface FireControlPortalFeedback {
  reportEntry(deploymentId: number, sourceId: AutomatedTurretId, identityId: AutomatedTurretId,
    mode: FireControlEntryMode, x: number, y: number, angle: number): void;
  /** Confirmed shot through the entry (bursts: every shot). */
  noteTransport(deploymentId: number, sourceId: AutomatedTurretId, at: number): void;
  /** Bound portal bursts end with their deployment (D12), also before `expiresAt`. */
  isDeploymentActive(deploymentId: number): boolean;
}

/** World-local deployment facts. Weapon sequences remain exclusively in TurretSystem. */
export class FireControlRuntime implements FireControlUtilityPort, FireControlPortalFeedback {
  private readonly ids: FireControlDeploymentIdSource;
  private readonly deployments = new Map<number, Deployment>();

  constructor(private readonly deps: {
    readonly ids?: FireControlDeploymentIdSource;
    readConstructions(): readonly FireControlConstructionFacts[];
    readSlotOrder(ownerId: string): readonly string[];
    isPointFree(x: number, y: number, radius: number): boolean;
    onDeploymentEnded(deploymentId: number, ownerId: string, endedAt: number): void;
    discardProjectile?(projectileId: number): void;
  }) { this.ids = deps.ids ?? createFireControlDeploymentIdSource(); }

  activateCopies(request: Parameters<FireControlUtilityPort['activateCopies']>[0]): FireControlActivation {
    if (this.find('copies', request.ownerId)) return { ok: false, reason: 'blocked' };
    const { config, nowMs } = request;
    if (![nowMs, request.ownerColor, config.durationMs, config.cooldownMs, config.materializeMs,
      nowMs + config.durationMs, nowMs + config.materializeMs].every(Number.isFinite)
      || nowMs < 0 || config.durationMs <= 0 || config.cooldownMs < 0 || config.materializeMs < 0) {
      return { ok: false, reason: 'invalid' };
    }
    const constructions = this.deps.readConstructions();
    const plan = planFireControlCopies({ ...request, constructions,
      slotOrder: this.deps.readSlotOrder(request.ownerId), pausedOriginalIds: this.getPausedOriginalIds(),
      isPointFree: this.deps.isPointFree });
    if (!plan.ok) return { ok: false, reason: plan.reason === 'range' ? 'placement' : plan.reason };
    const id = this.ids.next();
    const expiresAt = nowMs + config.durationMs;
    this.deployments.set(id, { kind: 'copies', id, ownerId: request.ownerId, ownerColor: request.ownerColor,
      x: request.pointX, y: request.pointY, startedAt: nowMs, expiresAt, config: { ...config },
      copies: plan.copies.map((copy, slot) => ({ ...copy, slot,
        angle: constructions.find(source => source.id === copy.originalId)?.angle ?? 0,
        materializedAt: nowMs + config.materializeMs })) });
    return { ok: true, deploymentId: id, expiresAt };
  }

  hasPortalSources(ownerId: string, nowMs: number): boolean {
    const facts = this.deps.readConstructions();
    const paused = this.getPausedOriginalIds();
    const byId = new Map(facts.map(source => [source.id, source]));
    if (facts.some(source => this.isPortalOriginal(ownerId, source, paused))) return true;
    for (const deployment of this.deployments.values()) if (deployment.kind === 'copies') {
      for (const copy of deployment.copies) {
        const original = byId.get(copy.originalId);
        if (original && this.isPortalCopy(ownerId, original, copy, nowMs)) return true;
      }
    }
    return false;
  }

  activatePortal(request: Parameters<FireControlUtilityPort['activatePortal']>[0]): FireControlActivation {
    if (this.find('portal', request.ownerId)) return { ok: false, reason: 'blocked' };
    const { config, nowMs } = request;
    if (![nowMs, request.ownerColor, request.originX, request.originY, request.restX, request.restY,
      config.durationMs, config.cooldownMs, config.damageBonus, config.exitClearanceRadiusPx,
      nowMs + config.durationMs].every(Number.isFinite)
      || nowMs < 0 || config.durationMs <= 0 || config.cooldownMs < 0 || config.damageBonus < 0
      || config.exitClearanceRadiusPx < 0) {
      return { ok: false, reason: 'invalid' };
    }
    const exit = resolvePortalLandingPoint(request.originX, request.originY, request.restX, request.restY,
      (x, y) => this.deps.isPointFree(x, y, config.exitClearanceRadiusPx));
    const id = this.ids.next();
    const expiresAt = nowMs + config.durationMs;
    this.deployments.set(id, { kind: 'portal', id, ownerId: request.ownerId, ownerColor: request.ownerColor,
      x: exit.x, y: exit.y, startedAt: nowMs, expiresAt, config: { ...config }, entries: new Map() });
    return { ok: true, deploymentId: id, expiresAt };
  }

  discardPortalProjectile(projectileId: number): void {
    this.deps.discardProjectile?.(projectileId);
  }

  update(nowMs: number, readConstructions = this.deps.readConstructions): void {
    for (const deployment of this.deployments.values()) {
      if (nowMs >= deployment.expiresAt) this.end(deployment, deployment.expiresAt);
    }
    if (![...this.deployments.values()].some(d => d.kind === 'copies')) return;
    const facts = new Map(readConstructions().map(source => [source.id, source]));
    for (const deployment of this.deployments.values()) {
      if (deployment.kind !== 'copies') continue;
      deployment.copies = deployment.copies.filter(copy => {
        const source = facts.get(copy.originalId);
        return source && source.combatReady && !source.baseOwned && source.ownerId === deployment.ownerId
          && (deployment.config.parallel || !source.manned);
      });
      // D28 applies to copies only; a portal stays open without participants (D38).
      if (!deployment.copies.length) this.end(deployment, nowMs);
    }
  }

  private end(deployment: Deployment, endedAt: number): void {
    if (!this.deployments.delete(deployment.id)) return;
    this.deps.onDeploymentEnded(deployment.id, deployment.ownerId, endedAt);
  }

  deriveFireSources(definitions: readonly AutomatedTurret[], nowMs: number,
    readConstructions = this.deps.readConstructions): readonly TurretFireSource[] {
    const paused = this.getPausedOriginalIds();
    const sources: TurretFireSource[] = definitions.map(def => ({ ...toLocalTurretFireSource(def),
      fireState: typeof def.id === 'number' && paused.has(def.id) ? 'paused' as const : 'active' as const }));
    const originals = new Map(definitions.map(def => [def.id, def]));
    const copyFacts = new Map<AutomatedTurretId, { originalId: number; copy: Copy }>();
    for (const deployment of this.deployments.values()) {
      if (deployment.kind !== 'copies') continue;
      for (const copy of deployment.copies) {
        const original = originals.get(copy.originalId);
        if (!original) continue;
        const id = fireControlCopySourceId(deployment.id, copy.slot);
        copyFacts.set(id, { originalId: copy.originalId, copy });
        sources.push({ ...original, id, x: copy.x, y: copy.y, angle: copy.angle,
          identityId: original.id, visualId: id,
          sequenceKey: deployment.config.parallel ? id : original.id,
          ...(deployment.config.parallel ? { sequenceSeedKey: original.id } : {}),
          fireState: nowMs < copy.materializedAt ? 'paused' : 'active',
          footprint: undefined, sourceCarrierBaseId: undefined, skipRockIndex: undefined });
      }
    }
    const portals = [...this.deployments.values()].filter((d): d is PortalDeployment => d.kind === 'portal');
    if (!portals.length) return sources;
    // Portal participation is one more derivation step on the complete source list (§4.2).
    const facts = new Map(readConstructions().map(source => [source.id, source]));
    const assigned = sources.map(source => {
      const portal = portals.find(d => d.ownerId === source.ownerId);
      if (!portal) return source;
      const copy = copyFacts.get(source.id);
      const original = facts.get(copy ? copy.originalId : source.id as number);
      const eligible = !!original && (copy ? this.isPortalCopy(portal.ownerId, original, copy.copy, nowMs)
        : typeof source.id === 'number' && this.isPortalOriginal(portal.ownerId, original, paused));
      if (!eligible) return source;
      return { ...source, portal: { deploymentId: portal.id, exitX: portal.x, exitY: portal.y,
        damageBonus: portal.config.damageBonus, localFireRelease: portal.config.localFireRelease,
        expiresAt: portal.expiresAt } };
    });
    this.syncPortalEntries(portals, assigned);
    return assigned;
  }

  /** Drops entries of former participants; new participants start as `waiting` at their source. */
  private syncPortalEntries(portals: readonly PortalDeployment[], sources: readonly TurretFireSource[]): void {
    for (const portal of portals) {
      const participants = sources.filter(source => source.portal?.deploymentId === portal.id);
      const ids = new Set(participants.map(source => source.id));
      for (const id of portal.entries.keys()) if (!ids.has(id)) portal.entries.delete(id);
      for (const source of participants) if (!portal.entries.has(source.id) && typeof source.identityId === 'number') {
        portal.entries.set(source.id, { identityId: source.identityId, mode: 'waiting',
          x: source.x, y: source.y, angle: source.angle ?? 0 });
      }
    }
  }

  reportEntry(deploymentId: number, sourceId: AutomatedTurretId, identityId: AutomatedTurretId,
    mode: FireControlEntryMode, x: number, y: number, angle: number): void {
    const portal = this.deployments.get(deploymentId);
    if (portal?.kind !== 'portal' || typeof identityId !== 'number'
      || ![x, y, angle].every(Number.isFinite)) return;
    const entry = portal.entries.get(sourceId);
    if (entry) Object.assign(entry, { mode, x, y, angle });
    // D36: a bound burst of a meanwhile paused original keeps its entry visible until it ends.
    else portal.entries.set(sourceId, { identityId, mode, x, y, angle });
  }

  isDeploymentActive(deploymentId: number): boolean {
    return this.deployments.has(deploymentId);
  }

  noteTransport(deploymentId: number, sourceId: AutomatedTurretId, at: number): void {
    const portal = this.deployments.get(deploymentId);
    const entry = portal?.kind === 'portal' ? portal.entries.get(sourceId) : undefined;
    if (entry && Number.isFinite(at)) entry.lastTransportAt = at;
  }

  private isPortalOriginal(ownerId: string, source: FireControlConstructionFacts, paused: ReadonlySet<number>): boolean {
    // D37: manned turrets keep manual priority and do not take part.
    return !source.manned && classifyFireControlSource({ requesterId: ownerId, ownerId: source.ownerId,
      baseOwned: source.baseOwned, constructionId: source.constructionId, weaponFireType: source.weaponFireType,
      combatReady: source.combatReady, isCopy: false, pausedByCopies: paused.has(source.id) }).portalSource;
  }

  private isPortalCopy(ownerId: string, original: FireControlConstructionFacts, copy: Copy, nowMs: number): boolean {
    return classifyFireControlSource({ requesterId: ownerId, ownerId: original.ownerId,
      baseOwned: original.baseOwned, constructionId: original.constructionId, weaponFireType: original.weaponFireType,
      combatReady: original.combatReady, isCopy: true, copyMaterialized: nowMs >= copy.materializedAt }).portalSource;
  }

  setCopyAngle(sourceId: string, angle: number): void {
    if (!Number.isFinite(angle)) return;
    for (const deployment of this.deployments.values()) {
      if (deployment.kind !== 'copies') continue;
      for (const copy of deployment.copies) {
        if (fireControlCopySourceId(deployment.id, copy.slot) === sourceId) { copy.angle = angle; return; }
      }
    }
  }

  getSnapshot(nowMs: number): FireControlSnapshot {
    if (!this.deployments.size) return { deployments: [] };
    const facts = new Map(this.deps.readConstructions().map(source => [source.id, source]));
    return { deployments: [...this.deployments.values()].map(deployment => {
      const base = { id: deployment.id, ownerId: deployment.ownerId, ownerColor: deployment.ownerColor,
        x: deployment.x, y: deployment.y, startedAt: deployment.startedAt, expiresAt: deployment.expiresAt };
      if (deployment.kind === 'portal') {
        return { ...base, kind: 'portal' as const, localFireRelease: deployment.config.localFireRelease,
          entries: [...deployment.entries].map(([sourceId, entry]): FireControlEntrySnapshot => ({
            sourceId, identityId: entry.identityId, mode: entry.mode, x: entry.x, y: entry.y, angle: entry.angle,
            ...(entry.lastTransportAt === undefined ? {} : { lastTransportAt: entry.lastTransportAt }) })) };
      }
      return { ...base, kind: 'copies' as const, parallel: deployment.config.parallel,
        copies: deployment.copies.map(copy => ({ sourceId: fireControlCopySourceId(deployment.id, copy.slot),
          originalId: copy.originalId, constructionId: facts.get(copy.originalId)?.constructionId ?? '',
          weaponId: facts.get(copy.originalId)?.weaponId ?? 'SPORES',
          x: copy.x, y: copy.y, angle: copy.angle, materializedAt: copy.materializedAt,
          status: nowMs < copy.materializedAt ? 'materializing' as const : 'active' as const,
          originalPaused: !deployment.config.parallel })) };
    }) };
  }

  getPausedOriginalIds(): ReadonlySet<number> {
    const paused = new Set<number>();
    for (const deployment of this.deployments.values()) if (deployment.kind === 'copies' && !deployment.config.parallel) {
      for (const copy of deployment.copies) paused.add(copy.originalId);
    }
    return paused;
  }

  private find(kind: Deployment['kind'], ownerId: string): Deployment | undefined {
    return [...this.deployments.values()].find(d => d.kind === kind && d.ownerId === ownerId);
  }

  removeOwner(ownerId: string): void {
    for (const deployment of this.deployments.values()) if (deployment.ownerId === ownerId) this.deployments.delete(deployment.id);
  }

  clear(): void { this.deployments.clear(); }
}
