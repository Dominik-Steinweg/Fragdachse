import { MIN_COOP_DEFENSE_PORTAL_ANCHOR_SEPARATION_CELLS } from '../../config/coopDefensePortalLinks';
import {
  getDawnSiteArchetypes,
  resolveDawnPortalGeneratorChance,
  type DawnArenaTemplate,
  type DawnSalvageSlot,
  type DawnThreatCurve,
} from '../../config/dawn/dawnContent';
import type { SpawnFront } from '../../types';
import type { DawnSitePlan } from '../contracts/DawnPlans';
import type { DawnRandom } from './DawnRandom';
import { collectDawnTemplateWetCells, isDawnPortalClearingDry, resolveDawnPortalEntryAnchor } from '../rules/DawnPortalPlacement';
import type { DawnAssignedFront } from './DawnWaveComposition';

export interface DawnPortalCompositionInput {
  readonly random: DawnRandom;
  readonly template: DawnArenaTemplate;
  readonly curve: DawnThreatCurve;
  readonly fronts: readonly DawnAssignedFront[];
  /** Ordinary sites of the round; their slots stay untouched. */
  readonly sites: readonly DawnSitePlan[];
  /** Dev and debug only: the generator appears whenever a placement exists. */
  readonly force?: boolean;
}

/** Side of a slot relative to the base core, by its dominant axis. */
export function resolveDawnSlotSide(template: DawnArenaTemplate, slot: DawnSalvageSlot): SpawnFront {
  const base = template.world.persistentBase.anchor;
  const dx = slot.anchor.gridX - base.gridX, dy = slot.anchor.gridY - base.gridY;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

/**
 * At most one portal generator per round: out on the primary front, its portal exits at a free near
 * slot on a side this round attacks from nowhere else, so the flank is real. Draws a fixed number
 * of values from its own stream, so ordinary rounds never shift.
 */
export function composeDawnPortalSite(input: DawnPortalCompositionInput): DawnSitePlan | null {
  const { random, template, curve, fronts, sites } = input;
  const archetype = getDawnSiteArchetypes().find((entry) => entry.portal);
  const roll = random.next();
  const tierRoll = random.next();
  if (!archetype || fronts.length === 0) return null;
  const chance = input.force ? 1 : resolveDawnPortalGeneratorChance(archetype, curve.threat);
  if (roll >= chance) return null;

  const used = new Set(sites.map((site) => site.slotId));
  const order = (slot: DawnSalvageSlot) => template.salvageSlots.indexOf(slot);
  const free = template.salvageSlots.filter((slot) => !used.has(slot.id));
  const primary = fronts[0].front;
  const attacked = new Set(fronts.map((front) => front.front));
  const base = template.world.persistentBase.anchor;
  const distance = (slot: DawnSalvageSlot) => Math.hypot(slot.anchor.gridX - base.gridX, slot.anchor.gridY - base.gridY);
  const separation = (a: DawnSalvageSlot, b: DawnSalvageSlot) =>
    Math.hypot(a.anchor.gridX - b.anchor.gridX, a.anchor.gridY - b.anchor.gridY);
  const wet = collectDawnTemplateWetCells(template);

  // The generator stands out on the primary front: the farthest open slot on that side first.
  const generators = free.filter((slot) => slot.band !== 'near' && resolveDawnPortalEntryAnchor(template, slot, archetype.portal!, wet))
    .sort((left, right) => Number(resolveDawnSlotSide(template, right) === primary)
      - Number(resolveDawnSlotSide(template, left) === primary)
      || distance(right) - distance(left) || order(left) - order(right));
  for (const generator of generators) {
    // The exit prefers a near slot on an unattacked side, then any side but the generator's own.
    const exits = free.filter((slot) => slot !== generator && isDawnPortalClearingDry(slot.anchor, wet)
      && separation(slot, generator) >= MIN_COOP_DEFENSE_PORTAL_ANCHOR_SEPARATION_CELLS
      && resolveDawnSlotSide(template, slot) !== resolveDawnSlotSide(template, generator))
      .sort((left, right) => Number(attacked.has(resolveDawnSlotSide(template, left)))
        - Number(attacked.has(resolveDawnSlotSide(template, right)))
        || Number(left.band !== 'near') - Number(right.band !== 'near')
        || separation(right, generator) - separation(left, generator) || order(left) - order(right));
    const exit = exits[0];
    if (!exit) continue;
    return { slotId: generator.id, archetypeId: archetype.id, tier: pickTier(tierRoll, curve), portalExitSlotId: exit.id };
  }
  return null;
}

function pickTier(roll: number, curve: DawnThreatCurve): number {
  const total = curve.tierWeights.reduce((sum, weight) => sum + weight, 0);
  let cursor = roll * total;
  for (let index = 0; index < curve.tierWeights.length; index += 1) {
    cursor -= curve.tierWeights[index];
    if (cursor < 0) return index + 1;
  }
  return curve.tierWeights.length;
}
