import { VOID_PALETTE } from '../../config';
import type { ResolvedCoopDefensePortalLinkConfig } from '../../config/coopDefensePortalLinks';
import type { PortalPair, PortalPoint } from '../PortalTraversal';
import type { PortalActor, PortalPairSource, PortalSourcePort, PortalTransferFlash } from './WorldPortalTransport';

export type PortalLinkPhase = 'waiting' | 'charging' | 'open' | 'collapsed';

/** Replicated lifecycle of one link. Times are mission time; geometry stays authored. */
export interface PortalLinkStateEntry {
  readonly id: string;
  readonly phase: PortalLinkPhase;
  readonly chargeStartedAtMs?: number;
  readonly openedAtMs?: number;
  readonly collapsedAtMs?: number;
}

/** Navigation view of one open link (the shape of the flow-field link contract). */
export interface PortalNavigationLink {
  readonly id: string;
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly radiusPx: number;
  readonly maxBodyRadiusPx: number;
  readonly costPx: number;
}

export interface PortalLinkEndpoints { readonly a: PortalPoint; readonly b: PortalPoint }

export interface PortalLinkSystemOptions {
  readonly links: readonly ResolvedCoopDefensePortalLinkConfig[];
  readonly endpoints: ReadonlyMap<string, PortalLinkEndpoints>;
  readonly transport: PortalSourcePort;
  readonly isGeneratorStanding: (baseId: string) => boolean;
  readonly isHostileEnemy: (actorId: string) => boolean;
  readonly setNavigationLinks?: (links: readonly PortalNavigationLink[]) => void;
  readonly publish: (entries: readonly PortalLinkStateEntry[] | null) => void;
}

export const PORTAL_LINK_FLASH: PortalTransferFlash = { start: VOID_PALETTE.bright, end: VOID_PALETTE.primary, throttleMs: 200 };
export const portalLinkOwnerId = (linkId: string): string => `portal-link:${linkId}`;

interface LinkRuntime {
  readonly config: ResolvedCoopDefensePortalLinkConfig;
  readonly pair: PortalPair;
  state: PortalLinkStateEntry;
}

/**
 * Host owner of the generator-fed portal links of one Activity.
 *
 * A link waits, charges and then stays open while its generator stands. When the generator falls
 * the link collapses for good; nobody, players included, can use it afterwards. Open links are a
 * pair source of the World transport and a navigation projection; this system is the only writer
 * of both.
 */
export class PortalLinkSystem implements PortalPairSource {
  readonly transferFlash = PORTAL_LINK_FLASH;
  private readonly links: LinkRuntime[];
  private readonly byPairId = new Map<string, LinkRuntime>();
  private pairView: readonly PortalPair[] = [];
  private elapsedMs = 0;
  private unregister: (() => void) | null;
  private destroyed = false;

  constructor(private readonly options: PortalLinkSystemOptions) {
    this.links = options.links.map((config) => {
      const endpoints = options.endpoints.get(config.id);
      if (!endpoints) throw new Error(`[PortalLinkSystem] Link ${config.id} has no resolved endpoints`);
      const pair: PortalPair = { id: portalLinkOwnerId(config.id), ownerId: portalLinkOwnerId(config.id),
        a: endpoints.a, b: endpoints.b, radius: config.radiusPx, reentryDistance: config.reentryDistancePx,
        damageBonus: 0, createdAt: 0, expiresAt: Number.POSITIVE_INFINITY };
      return { config, pair, state: { id: config.id, phase: 'waiting' } };
    });
    for (const link of this.links) this.byPairId.set(link.pair.id, link);
    this.unregister = options.transport.register(this);
    options.publish(this.getState());
  }

  getPortalPairs(): readonly PortalPair[] { return this.pairView; }
  /** Generator portals belong to nobody's team; no damage bonus and no friendly passage. */
  isPortalFriendly(): boolean { return false; }
  admitsActor(pair: PortalPair, actor: PortalActor): boolean {
    const link = this.byPairId.get(pair.id);
    return !!link && !actor.boss && !actor.fixed && actor.radius <= link.config.maxBodyRadiusPx;
  }
  gateReleaseMsFor(pair: PortalPair): number | undefined { return this.byPairId.get(pair.id)?.config.gateReleaseMs; }

  getState(): readonly PortalLinkStateEntry[] { return this.links.map((link) => link.state); }

  /**
   * Runs after the objective snapshot activated mission structures, before flow fields and
   * movement; a generator destroyed earlier in the frame therefore closes its link here.
   */
  hostUpdate(deltaMs: number, countdownActive: boolean, nowMs: number): void {
    if (this.destroyed || countdownActive) return;
    this.elapsedMs += Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    let changed = false, pairsChanged = false;
    for (const link of this.links) {
      const { config, state } = link;
      if (state.phase === 'collapsed') continue;
      if (!this.options.isGeneratorStanding(config.generatorBaseId)) {
        const wasOpen = state.phase === 'open';
        link.state = { ...state, phase: 'collapsed', collapsedAtMs: this.elapsedMs };
        changed = true;
        if (wasOpen) { pairsChanged = true; this.collapse(link, nowMs); }
        continue;
      }
      if (state.phase === 'waiting' && this.elapsedMs >= config.chargeStartMs) {
        link.state = { id: state.id, phase: 'charging', chargeStartedAtMs: config.chargeStartMs };
        changed = true;
      }
      if (link.state.phase === 'charging' && this.elapsedMs >= config.chargeStartMs + config.chargeDurationMs) {
        link.state = { ...link.state, phase: 'open', openedAtMs: config.chargeStartMs + config.chargeDurationMs };
        changed = true; pairsChanged = true;
      }
    }
    if (pairsChanged) this.refreshPairs();
    if (changed) this.options.publish(this.getState());
  }

  /** Activity teardown: silent, without a collapse or a lingering navigation link. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unregister?.(); this.unregister = null;
    this.pairView = [];
    this.options.setNavigationLinks?.([]);
    this.options.publish(null);
  }

  private collapse(link: LinkRuntime, nowMs: number): void {
    const { collapse } = link.config;
    if (collapse.radiusPx <= 0 || (collapse.slowFraction <= 0 && collapse.pullSpeedPx <= 0)) return;
    this.options.transport.collapse(link.pair, {
      collapseRadius: collapse.radiusPx, collapseSlowFraction: collapse.slowFraction,
      collapseSlowDurationMs: collapse.slowDurationMs, collapsePullSpeed: collapse.pullSpeedPx,
      collapsePullDurationMs: collapse.pullDurationMs,
    }, link.pair.ownerId, (actor) => this.options.isHostileEnemy(actor.id), nowMs);
  }

  private refreshPairs(): void {
    const open = this.links.filter((link) => link.state.phase === 'open');
    this.pairView = open.map((link) => link.pair);
    this.options.setNavigationLinks?.(open.map(({ config, pair }) => ({
      id: config.id, ax: pair.a.x, ay: pair.a.y, bx: pair.b.x, by: pair.b.y, radiusPx: config.radiusPx,
      maxBodyRadiusPx: config.maxBodyRadiusPx, costPx: config.linkCostPx,
    })));
  }
}
