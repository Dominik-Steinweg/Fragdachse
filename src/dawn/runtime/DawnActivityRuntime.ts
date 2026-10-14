import type { DawnSchedule, DawnThreatCurve } from '../../config/dawn/dawnContent';
import { POWERUP_DEFS } from '../../powerups/PowerUpConfig';
import type { PowerUpSystem } from '../../powerups/PowerUpSystem';
import type { ResolvedDawnSite } from '../resolution/DawnScenarioResolution';
import { resolveDawnPhase } from '../rules/DawnPhase';
import { DawnSalvageDirector } from './DawnSalvageDirector';
import { DawnScrapLedger } from './DawnScrapLedger';
import { getCoopDefenseEnemyConfig } from '../../config/coopDefenseEnemies';
import type { DawnScavengerSpawnRequest } from './DawnScavengerPort';

export interface DawnActivityRuntimePorts {
  /** Bereits veroeffentlichter Rundenschrott dieser Runde (0 direkt nach dem Rundenstart). */
  readonly initialScrap?: number;
  readonly publishScrap: (total: number) => void;
  readonly sitePosition: (site: ResolvedDawnSite) => { readonly x: number; readonly y: number };
  readonly feedback: (x: number, y: number, amount: number) => void;
  readonly elapsedMs: () => number;
  readonly isActive: () => boolean;
  readonly random?: () => number;
  readonly pickups: Pick<PowerUpSystem, 'bindDawnScrap' | 'spawnPickup' | 'removePickup'>;
  /** Scavenger camps release fleeing scavengers when their site activates (host enemy port). */
  readonly scavengers?: { spawn(request: DawnScavengerSpawnRequest): readonly string[] };
  /** Arena-edge point a scavenger from this site runs to. */
  readonly escapeTarget?: (site: ResolvedDawnSite) => { readonly x: number; readonly y: number };
}

/** Finds of a scrap heap lie on a ring around the heap, deterministic per index. */
export function dawnScatterOffsets(count: number, radiusPx: number): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2 + Math.PI / 6;
    const radius = radiusPx * (index % 2 === 0 ? 1 : 0.7);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}
const DAWN_SCATTER_RADIUS_PX = 72;
const DAWN_SCAVENGER_BREAKOUT_PX = 80;

/** Exactly one host Activity owns the balance, completion deduplication and unclaimed drops. */
export class DawnActivityRuntime {
  private ledger: DawnScrapLedger | null;
  private director: DawnSalvageDirector | null;
  /** Unclaimed drops; scattered site finds carry their own share of the site reward. */
  private readonly pendingDrops = new Map<number, number | undefined>();
  private detachDrops: (() => void) | null;

  constructor(
    sites: readonly ResolvedDawnSite[],
    private readonly curve: DawnThreatCurve,
    private readonly schedule: DawnSchedule,
    private readonly ports: DawnActivityRuntimePorts,
  ) {
    this.ledger = new DawnScrapLedger(ports.publishScrap, ports.initialScrap ?? 0);
    this.director = new DawnSalvageDirector(sites, curve, this.ledger, {
      feedback: (site, amount) => {
        const { x, y } = ports.sitePosition(site);
        ports.feedback(x, y, amount);
      },
      scatter: (site, total, count) => this.scatter(site, total, count),
    });
    this.detachDrops = ports.pickups.bindDawnScrap({
      onEnemyKilled: (x, y, kind) => this.onEnemyKilled(x, y, kind),
      canCollect: uid => this.ledger !== null && ports.isActive() && this.pendingDrops.has(uid),
      onPickupCollected: (_playerId, pickup) => {
        if (!this.pendingDrops.has(pickup.uid) || !this.ledger) return;
        const share = this.pendingDrops.get(pickup.uid);
        this.pendingDrops.delete(pickup.uid);
        const amount = this.ledger.credit(share ?? POWERUP_DEFS[pickup.defId]?.amount ?? 0, share === undefined ? 'drop' : 'site');
        if (amount > 0) ports.feedback(pickup.x, pickup.y, amount);
      },
    });
  }

  get total(): number { return this.ledger?.total ?? 0; }

  onObjectiveCompleted(objectiveId: string): void {
    if (this.ports.isActive()) this.director?.onObjectiveCompleted(objectiveId);
  }

  /** Host: a site objective started. Scavenger camps release their fleeing scavengers once. */
  onObjectiveActivated(objectiveId: string): void {
    const site = this.director?.siteOf(objectiveId);
    const count = site?.tier.scavengers;
    if (!site || !count || !this.ports.isActive() || !this.ports.scavengers) return;
    // They break out of the camp on the side they flee to, never inside its blocked footprint.
    const camp = this.ports.sitePosition(site), escapeTarget = this.ports.escapeTarget?.(site);
    const dx = (escapeTarget?.x ?? camp.x) - camp.x, dy = (escapeTarget?.y ?? camp.y + 1) - camp.y;
    const length = Math.hypot(dx, dy) || 1;
    const position = { x: camp.x + dx / length * DAWN_SCAVENGER_BREAKOUT_PX, y: camp.y + dy / length * DAWN_SCAVENGER_BREAKOUT_PX };
    this.ports.scavengers.spawn({ count, position, escapeTarget, originId: objectiveId });
  }

  private scatter(site: ResolvedDawnSite, total: number, count: number): void {
    const center = this.ports.sitePosition(site);
    const share = Math.max(1, Math.round(total / count));
    const defId = `dawn_scrap_${Math.max(1, Math.min(3, site.tier.tier))}`;
    for (const offset of dawnScatterOffsets(count, DAWN_SCATTER_RADIUS_PX)) {
      const uid = this.ports.pickups.spawnPickup(defId, center.x + offset.x, center.y + offset.y);
      if (uid !== null) this.pendingDrops.set(uid, share);
    }
  }

  private onEnemyKilled(x: number, y: number, kind?: string): void {
    if (!this.ledger || !this.ports.isActive()) return;
    const phase = resolveDawnPhase(this.schedule, this.ports.elapsedMs());
    if (phase.finished) return;
    const guaranteedDrop = kind ? getCoopDefenseEnemyConfig(kind).flee?.scrapPickupDefId : undefined;
    const drops = this.curve.scrapDrops;
    const chance = phase.phase === 'night' ? drops.nightChance : drops.dayChance;
    if (!guaranteedDrop && (this.ports.random ?? Math.random)() >= chance) return;
    const uid = this.ports.pickups.spawnPickup(guaranteedDrop ?? drops.pickupDefId, x, y);
    if (uid !== null) this.pendingDrops.set(uid, undefined);
  }

  destroy(): void {
    this.detachDrops?.();
    this.detachDrops = null;
    for (const uid of this.pendingDrops.keys()) this.ports.pickups.removePickup(uid);
    this.pendingDrops.clear();
    this.director = null;
    // Results retain the published total; the Bridge resets it at the next round start.
    this.ledger = null;
  }
}
