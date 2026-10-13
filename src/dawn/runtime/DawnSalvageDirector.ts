import type { DawnThreatCurve } from '../../config/dawn/dawnContent';
import { toDawnSiteObjectiveId, type ResolvedDawnSite } from '../resolution/DawnScenarioResolution';
import type { DawnScrapLedger } from './DawnScrapLedger';

/** Consumes successful secondary-objective completions, never activation or failure events. */
export class DawnSalvageDirector {
  private readonly completed = new Set<string>();
  private readonly sites: ReadonlyMap<string, ResolvedDawnSite>;

  constructor(
    sites: readonly ResolvedDawnSite[],
    private readonly curve: DawnThreatCurve,
    private readonly ledger: DawnScrapLedger,
    private readonly feedback: (site: ResolvedDawnSite, amount: number) => void,
  ) {
    this.sites = new Map(sites.map(site => [toDawnSiteObjectiveId(site.slotId), site]));
  }

  onObjectiveCompleted(objectiveId: string): void {
    const site = this.sites.get(objectiveId);
    if (!site || this.completed.has(objectiveId)) return;
    this.completed.add(objectiveId);
    const amount = this.ledger.credit(site.tier.scrapReward * this.curve.scrapMultiplier, 'site');
    if (amount > 0) this.feedback(site, amount);
  }
}
