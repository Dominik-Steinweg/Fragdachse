import type { CoopDefenseMapSiteClearingConfig } from '../config/coopDefenseMapAuthoring';
import { CELL_SIZE } from '../config';
import { worldCellCenter, type WorldMetrics } from '../world/WorldMetrics';
import type { CoopDefenseMissionPlayerSample } from './CoopDefenseMissionProgressSystem';

/**
 * Host-autoritative Aktivierung von Salvage-Sites.
 *
 * Eine Site wird aktiviert, sobald ein berechtigter, lebender Teilnehmer ihre Lichtung betritt;
 * die Aktivierung ist dauerhaft fuer die Activity. Nebenziele lesen sie ueber den Trigger
 * `site-activated`; der replizierte Nebenziel-Snapshot traegt die Folgen zu den Clients.
 */
export class CoopDefenseSiteActivationSystem {
  private readonly activatedSiteIds = new Set<string>();
  private readonly sites: readonly { readonly id: string; readonly x: number; readonly y: number; readonly radiusPx: number }[];

  constructor(clearings: readonly CoopDefenseMapSiteClearingConfig[], metrics: WorldMetrics) {
    this.sites = clearings.map((clearing) => {
      const center = worldCellCenter(metrics, clearing.gridX, clearing.gridY);
      return { id: clearing.id, x: center.x, y: center.y, radiusPx: clearing.radiusCells * CELL_SIZE };
    });
  }

  hostUpdate(countdownActive: boolean, samples: readonly CoopDefenseMissionPlayerSample[]): void {
    if (countdownActive) return;
    for (const site of this.sites) {
      if (this.activatedSiteIds.has(site.id)) continue;
      const entered = samples.some((sample) => sample.eligible
        && Math.hypot(sample.x - site.x, sample.y - site.y) <= site.radiusPx);
      if (entered) this.activatedSiteIds.add(site.id);
    }
  }

  isSiteActivated(siteId: string): boolean {
    return this.activatedSiteIds.has(siteId);
  }
}
