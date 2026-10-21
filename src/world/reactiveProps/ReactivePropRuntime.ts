import { BURN_TICK_INTERVAL_MS, ROCK_NET_FULL_SNAPSHOT_INTERVAL_TICKS } from '../../config';
import type { ReactivePropNetSnapshot } from '../../network/ReactivePropSnapshotCodec';
import {
  getReactivePropKind,
  isExplosiveReactivePropKind,
  type ExplosiveReactivePropKind,
  type ReactivePropDotZoneEffect,
  type ReactivePropKindConfig,
  type ReactivePropSwarmEffect,
  type RechargingReactivePropKind,
} from '../../config/reactiveProps/reactivePropKinds';
import type { CombatSource } from '../../combat/CombatScope';
import type { ProjectileExplosionRequest } from '../../projectile/ProjectileExplosionPort';
import { combatSourceForFollowUpEffect, provenanceFromCombatSource } from '../../projectile/ProjectileSpawnRequest';
import type { CombatDamageKind, ReactivePropCell } from '../../types';
import { integrityState, type WorldIntegrityMutationResult, type WorldIntegrityState } from '../WorldIntegrityMutation';
import { worldCellCenter, type WorldMetrics } from '../WorldMetrics';
import {
  isReactivePropObstacleId,
  reactivePropIndexOf,
  type ObstacleIdPartition,
} from './ReactivePropObstacleIds';

/**
 * Phasen eines reaktiven Map-Objekts. Explosive Kinds durchlaufen idle → primed → triggered →
 * destroyed; Lade-Kinds (Riesenbovist, Strohkorb) idle → triggered → recharging → idle.
 */
export type ReactivePropPhase = 'idle' | 'primed' | 'triggered' | 'recharging' | 'destroyed';

/** Wire-Codes der Phasen; die Reihenfolge ist Teil des Protokolls. */
export const REACTIVE_PROP_PHASE_CODES: Readonly<Record<ReactivePropPhase, number>> = Object.freeze({
  idle: 0, primed: 1, triggered: 2, recharging: 3, destroyed: 4,
});
const PHASE_BY_CODE: readonly ReactivePropPhase[] = ['idle', 'primed', 'triggered', 'recharging', 'destroyed'];
export const REACTIVE_PROP_PROGRESS_MAX = 255;

export function reactivePropPhaseFromCode(code: number): ReactivePropPhase | null {
  return PHASE_BY_CODE[code] ?? null;
}

/**
 * Folgewirkung, die der Host-Koordinator an ihren kanonischen Owner weiterreicht. Die Quelle von
 * Sporen und Schwarm ist bereits auf die Wirkung umgemarkt (Ursprung, authored Quelle, ohne Slot).
 */
export type ReactivePropEffect =
  | { readonly kind: 'explosion'; readonly request: ProjectileExplosionRequest }
  | ReactivePropFollowUp<'dot_zone', ReactivePropDotZoneEffect>
  | ReactivePropFollowUp<'swarm', ReactivePropSwarmEffect>;

export interface ReactivePropFollowUp<K extends string, C> {
  readonly kind: K;
  readonly index: number;
  readonly obstacleId: number;
  readonly x: number;
  readonly y: number;
  /** Geplanter Auslösezeitpunkt (Host-Zeit), unabhängig von der Framegrenze. */
  readonly at: number;
  readonly source: CombatSource;
  readonly config: C;
}

/** Lesbare Projektion je Objekt für Darstellung und Dev-Status. */
export interface ReactivePropPresentationState {
  readonly index: number;
  readonly obstacleId: number;
  readonly cell: ReactivePropCell;
  readonly kind: ReactivePropKindConfig;
  readonly phase: ReactivePropPhase;
  /** 0..1: HP-Anteil (idle/primed), Zündschnur-Fortschritt (triggered), Ladefortschritt (recharging). */
  readonly progress: number;
}

type HostState =
  | { phase: 'idle'; hp: number }
  | { phase: 'primed'; hp: number; nextTickAt: number | null; lastSource: CombatSource }
  | { phase: 'triggered'; detonateAt: number | null; armedAt: number | null; chain: boolean; source: CombatSource }
  | { phase: 'recharging'; startedAt: number; endsAt: number }
  | { phase: 'destroyed' };

export interface ReactivePropRuntimeOptions {
  readonly cells: readonly ReactivePropCell[];
  readonly partition: ObstacleIdPartition;
  readonly metrics: WorldMetrics;
  /** Entfernt Körper, Rasterzelle und meldet die Rasteränderung; auf Host und Client identisch. */
  readonly removeObstacle: (obstacleId: number, cell: ReactivePropCell) => void;
  readonly random?: () => number;
}

/**
 * Kanonischer World-Owner reaktiver Map-Objekte.
 *
 * Der Host entscheidet Schaden, Brand, Zündung und Folgewirkung; Clients spiegeln die
 * replizierten Phasen und entfernen dieselben Hindernisse. `commitDamage` ändert nur Zustand –
 * Entfernen und Explosion geschehen ausschließlich in `hostAdvance`, nie während eines
 * laufenden Radial-Commits.
 */
export class ReactivePropRuntime {
  private readonly kinds: readonly ReactivePropKindConfig[];
  private readonly host: HostState[];
  /** Replizierte bzw. zuletzt gesendete Projektion je Objekt: [code, progress]. */
  private readonly codes: Uint8Array;
  private readonly progress: Uint8Array;
  private readonly sentCodes: Uint8Array;
  private readonly sentProgress: Uint8Array;
  private readonly removed: Uint8Array;
  /** Auslösungen je Lade-Objekt; benennt die Lineage jeder Folgewirkung eindeutig. */
  private readonly fired: Uint32Array;
  private lastNow = 0;
  private ticksSinceFullSnapshot = 0;
  private destroyed = false;

  constructor(private readonly options: ReactivePropRuntimeOptions) {
    if (options.cells.length !== options.partition.reactivePropCount) {
      throw new Error('[ReactivePropRuntime] Layout and obstacle partition disagree');
    }
    this.kinds = options.cells.map(cell => getReactivePropKind(cell.kind));
    this.host = this.kinds.map(kind => ({ phase: 'idle' as const, hp: isExplosiveReactivePropKind(kind) ? kind.integrity.maxHp : 1 }));
    const count = options.cells.length;
    this.codes = new Uint8Array(count);
    this.progress = new Uint8Array(count).fill(REACTIVE_PROP_PROGRESS_MAX);
    this.sentCodes = new Uint8Array(count);
    this.sentProgress = new Uint8Array(count).fill(REACTIVE_PROP_PROGRESS_MAX);
    this.removed = new Uint8Array(count);
    this.fired = new Uint32Array(count);
  }

  get count(): number { return this.options.cells.length; }
  get partition(): ObstacleIdPartition { return this.options.partition; }

  isPropId(obstacleId: number): boolean {
    return isReactivePropObstacleId(this.options.partition, obstacleId);
  }

  /** Lebend heißt: noch als Hindernis materialisiert und treffbar. */
  isAlive(obstacleId: number): boolean {
    const index = reactivePropIndexOf(this.options.partition, obstacleId);
    return index >= 0 && this.removed[index] === 0;
  }

  /** Volle Treffer unabhängig vom `rockDamageMult`: nur lebende Objekte zählen. */
  isFullDamageTarget(obstacleId: number): boolean { return this.isAlive(obstacleId); }
  hasFullDamageTargets(): boolean { return this.count > 0; }
  forEachFullDamageTarget(visit: (obstacleId: number) => void): void {
    for (let index = 0; index < this.removed.length; index++) {
      if (!this.removed[index]) visit(this.options.partition.firstReactivePropId + index);
    }
  }

  readIntegrity(obstacleId: number): WorldIntegrityState | null {
    const index = reactivePropIndexOf(this.options.partition, obstacleId);
    if (index < 0) return null;
    const kind = this.kinds[index];
    // Lade-Kinds sind unzerstörbar: `destroyed` hieße downstream „Ziel tot“.
    if (!isExplosiveReactivePropKind(kind)) return integrityState(1, 1);
    const max = kind.integrity.maxHp;
    const state = this.host[index];
    const hp = state.phase === 'idle' || state.phase === 'primed' ? state.hp : 0;
    return integrityState(hp, max);
  }

  getPosition(obstacleId: number): { x: number; y: number } | null {
    const index = reactivePropIndexOf(this.options.partition, obstacleId);
    if (index < 0) return null;
    const cell = this.options.cells[index];
    return worldCellCenter(this.options.metrics, cell.gridX, cell.gridY);
  }

  getKind(obstacleId: number): ReactivePropKindConfig | null {
    const index = reactivePropIndexOf(this.options.partition, obstacleId);
    return index < 0 ? null : this.kinds[index];
  }

  /**
   * Host: verbucht einen Treffer. Fässer: Jeder Schaden zündet; der Treffer bestimmt den Eigentümer
   * der späteren Explosion. Bei erschöpften HP wird das Objekt scharf, explodiert aber erst in
   * `hostAdvance`. Lade-Kinds: siehe `commitTrigger`.
   */
  commitDamage(obstacleId: number, amount: number, source: CombatSource, damageKind: CombatDamageKind = 'direct'): WorldIntegrityMutationResult {
    const index = reactivePropIndexOf(this.options.partition, obstacleId);
    if (index < 0 || this.destroyed) return { kind: 'missing' };
    const kind = this.kinds[index];
    if (!isExplosiveReactivePropKind(kind)) return this.commitTrigger(index, kind, amount, source);
    const state = this.host[index];
    const max = kind.integrity.maxHp;
    if (state.phase === 'triggered' || state.phase === 'destroyed' || state.phase === 'recharging') {
      return { kind: 'inert', state: integrityState(0, max) };
    }
    const damage = Math.max(0, amount) * kind.damage.factor;
    if (damage <= 0) return { kind: 'immune', state: integrityState(state.hp, max) };
    const hp = Math.max(0, state.hp - damage);
    const actualAmount = state.hp - hp;
    if (hp <= 0) {
      const chain = damageKind === 'explosion' || damageKind === 'ground' || damageKind === 'burn';
      this.host[index] = { phase: 'triggered', detonateAt: null, armedAt: null, chain, source };
    } else if (state.phase === 'primed') {
      state.hp = hp;
      state.lastSource = source;
    } else {
      this.host[index] = { phase: 'primed', hp, nextTickAt: null, lastSource: source };
    }
    this.project(index);
    return {
      kind: 'applied',
      actualAmount,
      state: integrityState(hp, max),
      transition: hp <= 0 ? 'destroyed' : 'none',
    };
  }

  /**
   * Host: Brand-Ticks, Zündschnur und Folgewirkungen dieses Frames. Läuft vor dem Explosions-
   * Drain, damit die zurückgegebenen Wirkungen noch im selben Frame aufgelöst werden.
   */
  hostAdvance(now: number): readonly ReactivePropEffect[] {
    this.lastNow = now;
    if (this.destroyed) return [];
    let effects: ReactivePropEffect[] | null = null;
    for (let index = 0; index < this.host.length; index++) {
      const kind = this.kinds[index];
      if (!isExplosiveReactivePropKind(kind)) {
        const effect = this.advanceRecharging(index, kind, now);
        if (effect) (effects ??= []).push(effect);
        continue;
      }
      const state = this.host[index];
      if (state.phase === 'primed') this.advanceBurn(index, kind, state, now);
      const current = this.host[index];
      if (current.phase !== 'triggered') continue;
      if (current.detonateAt === null) {
        const effect = kind.effect;
        const [min, max] = effect.chainFuseJitterMs;
        const jitter = current.chain ? min + (max - min) * (this.options.random?.() ?? Math.random()) : 0;
        current.armedAt = now;
        current.detonateAt = now + effect.fuseMs + jitter;
      }
      if (now < current.detonateAt) { this.project(index); continue; }
      (effects ??= []).push(this.detonate(index, kind, current.source));
    }
    return effects ?? [];
  }

  /**
   * Host: Delta seit dem letzten Aufruf oder – erzwungen bzw. periodisch – alle Abweichungen vom
   * Default. `null` heißt unverändert.
   */
  getNetSnapshot(forceFull: boolean): ReactivePropNetSnapshot | null {
    const full = forceFull || ++this.ticksSinceFullSnapshot >= ROCK_NET_FULL_SNAPSHOT_INTERVAL_TICKS;
    if (full) this.ticksSinceFullSnapshot = 0;
    const entries: number[] = [];
    for (let index = 0; index < this.codes.length; index++) {
      const code = this.codes[index];
      const progress = this.progress[index];
      const changed = code !== this.sentCodes[index] || progress !== this.sentProgress[index];
      const nonDefault = code !== REACTIVE_PROP_PHASE_CODES.idle || progress !== REACTIVE_PROP_PROGRESS_MAX;
      if (full ? nonDefault : changed) entries.push(index, code, progress);
      this.sentCodes[index] = code;
      this.sentProgress[index] = progress;
    }
    return full || entries.length > 0 ? { full, entries } : null;
  }

  /**
   * Client: übernimmt replizierte Phasen. Ein Full-Snapshot setzt nicht genannte Objekte auf den
   * Default zurück; ein bereits entferntes Objekt bleibt entfernt (Fässer kennen keinen Respawn).
   * Phasen, die ein Kind nie erreicht, werden verworfen – ein Lade-Kind wird nie entfernt.
   */
  applyReplicated(entries: readonly number[], full: boolean): void {
    if (this.destroyed) return;
    if (full) {
      for (let index = 0; index < this.codes.length; index++) {
        if (this.removed[index]) continue;
        this.codes[index] = REACTIVE_PROP_PHASE_CODES.idle;
        this.progress[index] = REACTIVE_PROP_PROGRESS_MAX;
      }
    }
    for (let i = 0; i + 2 < entries.length; i += 3) {
      const index = entries[i];
      if (!Number.isInteger(index) || index < 0 || index >= this.codes.length || this.removed[index]) continue;
      const phase = reactivePropPhaseFromCode(entries[i + 1]);
      if (!phase || !this.reachesPhase(index, phase)) continue;
      this.codes[index] = REACTIVE_PROP_PHASE_CODES[phase];
      this.progress[index] = Math.max(0, Math.min(REACTIVE_PROP_PROGRESS_MAX, Math.round(entries[i + 2])));
      if (phase === 'destroyed') this.removeObstacle(index);
    }
  }

  /** Darstellung und Dev-Status lesen nur diese Projektion. */
  forEachPresentationState(visit: (state: ReactivePropPresentationState) => void): void {
    for (let index = 0; index < this.codes.length; index++) {
      visit({
        index,
        obstacleId: this.options.partition.firstReactivePropId + index,
        cell: this.options.cells[index],
        kind: this.kinds[index],
        phase: PHASE_BY_CODE[this.codes[index]] ?? 'idle',
        progress: this.progress[index] / REACTIVE_PROP_PROGRESS_MAX,
      });
    }
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** Lade-Kind: Treffer ab `minDamage` lösen im Ruhezustand aus; im Vorlauf übernimmt der letzte Treffer. */
  private commitTrigger(index: number, kind: RechargingReactivePropKind, amount: number, source: CombatSource): WorldIntegrityMutationResult {
    const state = this.host[index];
    const intact = integrityState(1, 1);
    const damage = Math.max(0, amount) * kind.damage.factor;
    if (damage < kind.trigger.minDamage) return { kind: 'immune', state: intact };
    if (state.phase === 'triggered') {
      state.source = source;
      return { kind: 'immune', state: intact };
    }
    if (state.phase !== 'idle') return { kind: 'immune', state: intact };
    this.host[index] = { phase: 'triggered', detonateAt: null, armedAt: null, chain: false, source };
    this.project(index);
    return { kind: 'applied', actualAmount: damage, state: intact, transition: 'none' };
  }

  /** Lade-Kind: Vorlauf, Auslösen der Folgewirkung und Aufladen zurück in den Ruhezustand. */
  private advanceRecharging(index: number, kind: RechargingReactivePropKind, now: number): ReactivePropEffect | null {
    const state = this.host[index];
    if (state.phase === 'recharging') {
      if (now >= state.endsAt) this.host[index] = { phase: 'idle', hp: 1 };
      this.project(index);
      return null;
    }
    if (state.phase !== 'triggered') return null;
    if (state.detonateAt === null) {
      state.armedAt = now;
      state.detonateAt = now + kind.effect.anticipationMs;
    }
    if (now < state.detonateAt) { this.project(index); return null; }
    const at = state.detonateAt;
    this.host[index] = { phase: 'recharging', startedAt: at, endsAt: at + kind.afterEffect.rechargeMs };
    this.project(index);
    const cell = this.options.cells[index];
    const { x, y } = worldCellCenter(this.options.metrics, cell.gridX, cell.gridY);
    const source = combatSourceForFollowUpEffect(state.source, {
      authoredSourceId: kind.effect.sourceId,
      origin: kind.effect.kind === 'dot_zone' ? 'ground' : 'direct',
      parentEffectId: `reactive_prop:${index}:${++this.fired[index]}`,
    });
    const obstacleId = this.options.partition.firstReactivePropId + index;
    return kind.effect.kind === 'dot_zone'
      ? { kind: 'dot_zone', index, obstacleId, x, y, at, source, config: kind.effect }
      : { kind: 'swarm', index, obstacleId, x, y, at, source, config: kind.effect };
  }

  private reachesPhase(index: number, phase: ReactivePropPhase): boolean {
    return isExplosiveReactivePropKind(this.kinds[index])
      ? phase !== 'recharging'
      : phase === 'idle' || phase === 'triggered' || phase === 'recharging';
  }

  private advanceBurn(index: number, kind: ExplosiveReactivePropKind, state: Extract<HostState, { phase: 'primed' }>, now: number): void {
    const priming = kind.priming;
    if (state.nextTickAt === null) { state.nextTickAt = now + BURN_TICK_INTERVAL_MS; return; }
    while (state.nextTickAt <= now && state.phase === 'primed') {
      state.hp = Math.max(0, state.hp - priming.selfDamagePerSecond * BURN_TICK_INTERVAL_MS / 1000);
      state.nextTickAt += BURN_TICK_INTERVAL_MS;
      if (state.hp <= 0) {
        this.host[index] = { phase: 'triggered', detonateAt: null, armedAt: null, chain: false, source: state.lastSource };
        break;
      }
    }
    this.project(index);
  }

  private detonate(index: number, kind: ExplosiveReactivePropKind, source: CombatSource): ReactivePropEffect {
    const cell = this.options.cells[index];
    this.host[index] = { phase: 'destroyed' };
    this.project(index);
    this.removeObstacle(index);
    const { x, y } = worldCellCenter(this.options.metrics, cell.gridX, cell.gridY);
    return {
      kind: 'explosion',
      request: {
        x,
        y,
        provenance: provenanceFromCombatSource(source, kind.effect.sourceId),
        effect: kind.effect.explosion,
      },
    };
  }

  private removeObstacle(index: number): void {
    // Lade-Kinds bleiben stehen; nur explosive Kinds verlassen den Hindernisraum.
    if (this.removed[index] || !isExplosiveReactivePropKind(this.kinds[index])) return;
    this.removed[index] = 1;
    this.options.removeObstacle(this.options.partition.firstReactivePropId + index, this.options.cells[index]);
  }

  /** Host-Zustand → replizierte Projektion. */
  private project(index: number): void {
    const state = this.host[index];
    const kind = this.kinds[index];
    const max = isExplosiveReactivePropKind(kind) ? kind.integrity.maxHp : 1;
    this.codes[index] = REACTIVE_PROP_PHASE_CODES[state.phase];
    let progress: number;
    switch (state.phase) {
      case 'idle': case 'primed': progress = state.hp / max; break;
      case 'recharging': {
        const total = state.endsAt - state.startedAt;
        progress = total > 0 ? (this.lastNow - state.startedAt) / total : 1;
        break;
      }
      case 'triggered': {
        const total = state.detonateAt !== null && state.armedAt !== null ? state.detonateAt - state.armedAt : 0;
        progress = total > 0 ? Math.min(1, (this.lastNow - (state.armedAt ?? this.lastNow)) / total) : 0;
        break;
      }
      case 'destroyed': progress = 0; break;
    }
    this.progress[index] = Math.round(Math.max(0, Math.min(1, progress)) * REACTIVE_PROP_PROGRESS_MAX);
  }
}
