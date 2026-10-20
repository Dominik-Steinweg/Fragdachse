import { resolveCoopDefensePortalLink } from '../config/coopDefensePortalLinks';
import { PortalLinkSystem, type PortalLinkEndpoints, type PortalLinkStateEntry } from '../systems/portal/PortalLinkSystem';
import type { PortalSourcePort } from '../systems/portal/WorldPortalTransport';
import { worldCellCenter, type WorldMetrics } from '../world/WorldMetrics';
import type { CoopMissionActivityConfiguration } from './CoopMissionActivityConfig';
import type { CoopMissionRuntime } from './CoopMissionRuntime';

export interface CoopMissionPortalCompositionOptions {
  readonly activity: CoopMissionActivityConfiguration;
  readonly worldMetrics: WorldMetrics;
  readonly isHost: boolean;
  readonly transport: PortalSourcePort | null;
  readonly isGeneratorStanding: (baseId: string) => boolean;
  readonly publish: (entries: readonly PortalLinkStateEntry[] | null) => void;
}

/** Endpoint centers of every authored link; host and clients resolve the same geometry. */
export function resolveCoopMissionPortalEndpoints(
  activity: CoopMissionActivityConfiguration,
  metrics: WorldMetrics,
): ReadonlyMap<string, PortalLinkEndpoints> {
  const anchors = new Map((activity.mapConfig.portalAnchors ?? []).map((anchor) => [anchor.id, anchor]));
  const endpoints = new Map<string, PortalLinkEndpoints>();
  for (const link of activity.mapConfig.portalLinks ?? []) {
    const entry = anchors.get(link.entryAnchorId), exit = anchors.get(link.exitAnchorId);
    if (!entry || !exit) throw new Error(`[CoopMissionPortalComposition] Link ${link.id} lost its anchors`);
    endpoints.set(link.id, { a: worldCellCenter(metrics, entry.gridX, entry.gridY),
      b: worldCellCenter(metrics, exit.gridX, exit.gridY) });
  }
  return endpoints;
}

/** Materializes the host owner of generator portal links after the objectives exist. */
export class CoopMissionPortalComposition {
  constructor(private readonly options: CoopMissionPortalCompositionOptions) {}

  materialize(runtime: CoopMissionRuntime): void {
    const { activity, transport } = this.options;
    const links = activity.mapConfig.portalLinks ?? [];
    if (!this.options.isHost || links.length === 0) return;
    if (!transport) throw new Error('[CoopMissionPortalComposition] Portal links need the World portal transport');
    runtime.setPortalLinks(new PortalLinkSystem({
      links: links.map(resolveCoopDefensePortalLink),
      endpoints: resolveCoopMissionPortalEndpoints(activity, this.options.worldMetrics),
      transport,
      isGeneratorStanding: this.options.isGeneratorStanding,
      isHostileEnemy: (actorId) => runtime.enemyManager?.getEnemy(actorId)?.faction === 'hostile',
      publish: this.options.publish,
    }));
  }
}
