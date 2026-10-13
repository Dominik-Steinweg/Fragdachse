import { toLocalTurretFireSource, type AutomatedTurret, type TurretFireSource } from '../TurretFireSource';
import type { FireControlActivation, FireControlUtilityPort, ResolvedFireControlRelayConfig } from '../../world/FireControlUtilityPort';
import { planFireControlCopies, type FireControlConstructionFacts } from './FireControlCopyPlan';
import { fireControlCopySourceId, type FireControlSnapshot } from './FireControlSnapshot';

interface Copy {
  readonly slot: number; readonly originalId: number;
  readonly x: number; readonly y: number;
  readonly materializedAt: number;
  angle: number;
}
interface Deployment {
  readonly id: number; readonly ownerId: string; readonly ownerColor: number;
  readonly x: number; readonly y: number;
  readonly startedAt: number; readonly expiresAt: number;
  readonly config: ResolvedFireControlRelayConfig;
  copies: Copy[];
}

/** World-local deployment facts. Weapon sequences remain exclusively in TurretSystem. */
export class FireControlRuntime implements FireControlUtilityPort {
  private nextId = 1;
  private readonly deployments = new Map<number, Deployment>();

  constructor(private readonly deps: {
    readConstructions(): readonly FireControlConstructionFacts[];
    readSlotOrder(ownerId: string): readonly string[];
    isPointFree(x: number, y: number, radius: number): boolean;
    onDeploymentEnded(deploymentId: number, ownerId: string, endedAt: number): void;
  }) {}

  activateCopies(request: Parameters<FireControlUtilityPort['activateCopies']>[0]): FireControlActivation {
    if ([...this.deployments.values()].some(d => d.ownerId === request.ownerId)) return { ok: false, reason: 'blocked' };
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
    const id = this.nextId++;
    const expiresAt = nowMs + config.durationMs;
    this.deployments.set(id, { id, ownerId: request.ownerId, ownerColor: request.ownerColor,
      x: request.pointX, y: request.pointY, startedAt: nowMs, expiresAt, config: { ...config },
      copies: plan.copies.map((copy, slot) => ({ ...copy, slot,
        angle: constructions.find(source => source.id === copy.originalId)?.angle ?? 0,
        materializedAt: nowMs + config.materializeMs })) });
    return { ok: true, deploymentId: id, expiresAt };
  }

  update(nowMs: number, readConstructions = this.deps.readConstructions): void {
    for (const deployment of this.deployments.values()) {
      if (nowMs >= deployment.expiresAt) this.end(deployment, deployment.expiresAt);
    }
    if (!this.deployments.size) return;
    const facts = new Map(readConstructions().map(source => [source.id, source]));
    for (const deployment of this.deployments.values()) {
      deployment.copies = deployment.copies.filter(copy => {
        const source = facts.get(copy.originalId);
        return source && source.combatReady && !source.baseOwned && source.ownerId === deployment.ownerId
          && (deployment.config.parallel || !source.manned);
      });
      if (!deployment.copies.length) this.end(deployment, nowMs);
    }
  }

  private end(deployment: Deployment, endedAt: number): void {
    if (!this.deployments.delete(deployment.id)) return;
    this.deps.onDeploymentEnded(deployment.id, deployment.ownerId, endedAt);
  }

  deriveFireSources(definitions: readonly AutomatedTurret[], nowMs: number): readonly TurretFireSource[] {
    const paused = this.getPausedOriginalIds();
    const sources = definitions.map(def => ({ ...toLocalTurretFireSource(def),
      fireState: typeof def.id === 'number' && paused.has(def.id) ? 'paused' as const : 'active' as const }));
    const originals = new Map(definitions.map(def => [def.id, def]));
    for (const deployment of this.deployments.values()) for (const copy of deployment.copies) {
      const original = originals.get(copy.originalId);
      if (!original) continue;
      const id = fireControlCopySourceId(deployment.id, copy.slot);
      sources.push({ ...original, id, x: copy.x, y: copy.y, angle: copy.angle,
        identityId: original.id, visualId: id,
        sequenceKey: deployment.config.parallel ? id : original.id,
        ...(deployment.config.parallel ? { sequenceSeedKey: original.id } : {}),
        fireState: nowMs < copy.materializedAt ? 'paused' : 'active',
        footprint: undefined, sourceCarrierBaseId: undefined, skipRockIndex: undefined });
    }
    return sources;
  }

  setCopyAngle(sourceId: string, angle: number): void {
    if (!Number.isFinite(angle)) return;
    for (const deployment of this.deployments.values()) for (const copy of deployment.copies) {
      if (fireControlCopySourceId(deployment.id, copy.slot) === sourceId) { copy.angle = angle; return; }
    }
  }

  getSnapshot(nowMs: number): FireControlSnapshot {
    if (!this.deployments.size) return { deployments: [] };
    const facts = new Map(this.deps.readConstructions().map(source => [source.id, source]));
    return { deployments: [...this.deployments.values()].map(deployment => ({
      kind: 'copies', id: deployment.id, ownerId: deployment.ownerId, ownerColor: deployment.ownerColor,
      x: deployment.x, y: deployment.y, startedAt: deployment.startedAt, expiresAt: deployment.expiresAt,
      parallel: deployment.config.parallel,
      copies: deployment.copies.map(copy => ({ sourceId: fireControlCopySourceId(deployment.id, copy.slot),
        originalId: copy.originalId, constructionId: facts.get(copy.originalId)?.constructionId ?? '',
        weaponId: facts.get(copy.originalId)?.weaponId ?? 'SPORES',
        x: copy.x, y: copy.y, angle: copy.angle, materializedAt: copy.materializedAt,
        status: nowMs < copy.materializedAt ? 'materializing' : 'active', originalPaused: !deployment.config.parallel })),
    })) };
  }

  getPausedOriginalIds(): ReadonlySet<number> {
    const paused = new Set<number>();
    for (const deployment of this.deployments.values()) if (!deployment.config.parallel) {
      for (const copy of deployment.copies) paused.add(copy.originalId);
    }
    return paused;
  }

  removeOwner(ownerId: string): void {
    for (const deployment of this.deployments.values()) if (deployment.ownerId === ownerId) this.deployments.delete(deployment.id);
  }

  clear(): void { this.deployments.clear(); }
}
