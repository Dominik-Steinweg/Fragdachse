import { nearestBridgeDeckPoint, getBridgeDeckWorldRect, type BridgeWorldOrigin } from '../arena/BridgeGeometry';
import { BRIDGE_DEMOLITION_RULES } from '../config/bridges';
import { t } from '../i18n';
import type { ArenaBridge } from '../types';
import type { BridgeRuntimeState } from '../world/WorldBridgeRuntime';
import { resolveBridgeChargeDenial } from './BridgeDemolitionRules';
import type { WorldInteractionCandidate } from './WorldInteractionCandidate';

export interface BridgeChargeCandidateInput {
  readonly bridges: readonly ArenaBridge[];
  readonly readState: (id: string) => BridgeRuntimeState | null;
  readonly origin: BridgeWorldOrigin;
  readonly player: { readonly x: number; readonly y: number };
  readonly carryingExplosive: boolean;
  /** Explosive cargo exists this round; without it bridges offer no Shift target at all. */
  readonly explosivesInPlay: boolean;
  readonly worldRevision: number;
}

/**
 * Shift targets for planting charges: standing bridges within reach. Without explosive cargo in
 * the round, bridges are plain floor and leave Shift to burrowing; with cargo but empty hands the
 * plaque names what is missing before Shift is pressed.
 */
export function bridgeChargeCandidates(input: BridgeChargeCandidateInput): WorldInteractionCandidate[] {
  if (!input.explosivesInPlay && !input.carryingExplosive) return [];
  const candidates: WorldInteractionCandidate[] = [];
  for (const bridge of input.bridges) {
    const phase = input.readState(bridge.id)?.phase ?? 'standing';
    if (phase !== 'standing') continue;
    const point = nearestBridgeDeckPoint(bridge, input.origin, input.player.x, input.player.y);
    const distancePx = Math.hypot(point.x - input.player.x, point.y - input.player.y);
    if (distancePx > BRIDGE_DEMOLITION_RULES.interactRangePx) continue;
    const denial = resolveBridgeChargeDenial({ phase, carryingExplosive: input.carryingExplosive, distancePx, allowed: true });
    const rect = getBridgeDeckWorldRect(bridge, input.origin);
    candidates.push({
      kind: 'bridge-charge', bridgeId: bridge.id, key: `bridge:${bridge.id}`,
      x: point.x, y: point.y, radius: BRIDGE_DEMOLITION_RULES.interactRangePx,
      label: t('ui.bridge.plant'), subject: t('ui.bridge.name'),
      ...(denial === 'no-explosive' ? { blocked: t('ui.bridge.blocked.noExplosive') } : {}),
      footprint: { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height },
      worldRevision: input.worldRevision,
    });
  }
  return candidates;
}
