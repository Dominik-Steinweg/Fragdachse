import type { DawnThreatCurve } from '../../config/dawn/dawnContent';
import { toDawnSiteObjectiveId, type ResolvedDawnSite } from '../resolution/DawnScenarioResolution';
import type { DawnScrapLedger } from './DawnScrapLedger';

/** Where a completed site's reward goes: straight to the ledger, or scattered as finds to collect. */
export interface DawnSalvageRewardPorts {
  readonly feedback: (site: ResolvedDawnSite, amount: number) => void;
  /** Schrotthaufen: the reward falls as `count` finds around the site; collection credits it. */
  readonly scatter: (site: ResolvedDawnSite, total: number, count: number) => void;
}

/** Consumes successful secondary-objective completions, never activation or failure events. */
export class DawnSalvageDirector {
  private readonly completed = new Set<string>();
  private readonly sites: ReadonlyMap<string, ResolvedDawnSite>;

  constructor(
    sites: readonly ResolvedDawnSite[],
    private readonly curve: DawnThreatCurve,
    private readonly ledger: DawnScrapLedger,
    private readonly rewards: DawnSalvageRewardPorts,
  ) {
    this.sites = new Map(sites.map(site => [toDawnSiteObjectiveId(site.slotId), site]));
  }

  onObjectiveCompleted(objectiveId: string): void {
    const site = this.sites.get(objectiveId);
    if (!site || this.completed.has(objectiveId)) return;
    this.completed.add(objectiveId);
    const total = site.tier.scrapReward * this.curve.scrapMultiplier;
    if (site.tier.scatterPickups) { this.rewards.scatter(site, total, site.tier.scatterPickups); return; }
    const amount = this.ledger.credit(total, 'site');
    if (amount > 0) this.rewards.feedback(site, amount);
  }

  /** Site of an objective, for activation-time behaviour (fleeing scavengers). */
  siteOf(objectiveId: string): ResolvedDawnSite | undefined { return this.sites.get(objectiveId); }
}
