import type { DawnSchedule, DawnThreatCurve } from '../../config/dawn/dawnContent';
import { POWERUP_DEFS } from '../../powerups/PowerUpConfig';
import type { PowerUpSystem } from '../../powerups/PowerUpSystem';
import type { ResolvedDawnSite } from '../resolution/DawnScenarioResolution';
import { resolveDawnPhase } from '../rules/DawnPhase';
import { DawnSalvageDirector } from './DawnSalvageDirector';
import { DawnScrapLedger } from './DawnScrapLedger';
import { getCoopDefenseEnemyConfig } from '../../config/coopDefenseEnemies';

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
}

/** Exactly one host Activity owns the balance, completion deduplication and unclaimed drops. */
export class DawnActivityRuntime {
  private ledger: DawnScrapLedger | null;
  private director: DawnSalvageDirector | null;
  private readonly pendingDrops = new Set<number>();
  private detachDrops: (() => void) | null;

  constructor(
    sites: readonly ResolvedDawnSite[],
    private readonly curve: DawnThreatCurve,
    private readonly schedule: DawnSchedule,
    private readonly ports: DawnActivityRuntimePorts,
  ) {
    this.ledger = new DawnScrapLedger(ports.publishScrap, ports.initialScrap ?? 0);
    this.director = new DawnSalvageDirector(sites, curve, this.ledger, (site, amount) => {
      const { x, y } = ports.sitePosition(site);
      ports.feedback(x, y, amount);
    });
    this.detachDrops = ports.pickups.bindDawnScrap({
      onEnemyKilled: (x, y, kind) => this.onEnemyKilled(x, y, kind),
      canCollect: uid => this.ledger !== null && ports.isActive() && this.pendingDrops.has(uid),
      onPickupCollected: (_playerId, pickup) => {
        if (!this.pendingDrops.delete(pickup.uid) || !this.ledger) return;
        const amount = this.ledger.credit(POWERUP_DEFS[pickup.defId]?.amount ?? 0, 'drop');
        if (amount > 0) ports.feedback(pickup.x, pickup.y, amount);
      },
    });
  }

  get total(): number { return this.ledger?.total ?? 0; }

  onObjectiveCompleted(objectiveId: string): void {
    if (this.ports.isActive()) this.director?.onObjectiveCompleted(objectiveId);
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
    if (uid !== null) this.pendingDrops.add(uid);
  }

  destroy(): void {
    this.detachDrops?.();
    this.detachDrops = null;
    for (const uid of this.pendingDrops) this.ports.pickups.removePickup(uid);
    this.pendingDrops.clear();
    this.director = null;
    // Results retain the published total; the Bridge resets it at the next round start.
    this.ledger = null;
  }
}
