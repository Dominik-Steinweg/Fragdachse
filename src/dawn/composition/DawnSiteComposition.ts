import {
  getDawnSiteArchetypes,
  getDawnSlotQuadrant,
  type DawnArenaTemplate,
  type DawnSalvageSlot,
  type DawnThreatCurve,
} from '../../config/dawn/dawnContent';
import type { DawnSitePlan } from '../contracts/DawnPlans';
import type { DawnRandom } from './DawnRandom';

export interface DawnSiteCompositionInput {
  readonly random: DawnRandom;
  readonly template: DawnArenaTemplate;
  readonly curve: DawnThreatCurve;
  /** Host owns the scrap scanner: hidden archetypes keep their navigation markers this round. */
  readonly scrapScanner?: boolean;
}

/**
 * Waehlt die Salvage-Sites einer Runde: Anzahl und Tiers aus der Threat-Kurve, Slots ueber
 * Quadranten und Distanzbaender gestreut, hoehere Tiers weiter draussen.
 *
 * Rein und geseedet; das Ergebnis steht in Slot-Reihenfolge des Templates.
 */
export function composeDawnSites({ random, template, curve, scrapScanner = false }: DawnSiteCompositionInput): DawnSitePlan[] {
  const count = Math.min(curve.siteCount, template.salvageSlots.length);
  const slots = pickSpreadSlots(random, template, count);
  const tiers = Array.from({ length: count }, () => pickTier(random, curve)).sort((left, right) => right - left);
  const base = template.world.persistentBase.anchor;
  const distance = (slot: DawnSalvageSlot) => Math.hypot(slot.anchor.gridX - base.gridX, slot.anchor.gridY - base.gridY);
  // Weiter draussen liegt mehr Risiko; die wertvollsten Tiers gehen deshalb an die fernsten Slots.
  const byDistance = [...slots].sort((left, right) => distance(right) - distance(left)
    || template.salvageSlots.indexOf(left) - template.salvageSlots.indexOf(right));
  const tierBySlot = new Map(byDistance.map((slot, index) => [slot.id, tiers[index]]));
  const archetypes = pickArchetypes(random, count, curve.threat);
  const archetypeBySlot = new Map(slots.map((slot, index) => [slot.id, archetypes[index]]));
  return template.salvageSlots
    .filter((slot) => tierBySlot.has(slot.id))
    .map((slot) => {
      const archetypeId = archetypeBySlot.get(slot.id)!;
      // The plan carries the effective visibility: the host's scanner reveals hidden archetypes.
      const hidden = !scrapScanner && getDawnSiteArchetypes().find(entry => entry.id === archetypeId)?.hidden === true;
      return { slotId: slot.id, archetypeId, tier: tierBySlot.get(slot.id)!, ...(hidden ? { hidden: true as const } : {}) };
    });
}

/** Bevorzugt jeweils den am wenigsten genutzten Quadranten und das am wenigsten genutzte Band. */
function pickSpreadSlots(random: DawnRandom, template: DawnArenaTemplate, count: number): DawnSalvageSlot[] {
  const chosen: DawnSalvageSlot[] = [];
  const quadrantUse = new Map<string, number>();
  const bandUse = new Map<string, number>();
  const score = (slot: DawnSalvageSlot) => (quadrantUse.get(getDawnSlotQuadrant(template, slot)) ?? 0)
    + (bandUse.get(slot.band) ?? 0);
  while (chosen.length < count) {
    const open = template.salvageSlots.filter((slot) => !chosen.includes(slot));
    const best = Math.min(...open.map(score));
    const pool = open.filter((slot) => score(slot) === best);
    const slot = pool[random.int(pool.length)];
    chosen.push(slot);
    const quadrant = getDawnSlotQuadrant(template, slot);
    quadrantUse.set(quadrant, (quadrantUse.get(quadrant) ?? 0) + 1);
    bandUse.set(slot.band, (bandUse.get(slot.band) ?? 0) + 1);
  }
  return chosen;
}

function pickTier(random: DawnRandom, curve: DawnThreatCurve): number {
  const tiers = curve.tierWeights.map((_, index) => index + 1);
  return random.pickWeighted(tiers, (tier) => curve.tierWeights[tier - 1])!;
}

/**
 * Verschiedene Archetypen, solange Sites reichen (gewichtet ohne Zuruecklegen); der Rest folgt den
 * Auswahlgewichten. Archetypen ab einem hoeheren Threat bleiben bis dahin aussen vor; Portal-Generatoren
 * komponiert ihr eigener Schritt.
 */
function pickArchetypes(random: DawnRandom, count: number, threat: number): string[] {
  const eligible = getDawnSiteArchetypes().filter((archetype) => (archetype.minThreat ?? 1) <= threat && !archetype.portal);
  const open = [...eligible];
  const picks: string[] = [];
  while (picks.length < count && open.length > 0) {
    const archetype = random.pickWeighted(open, (entry) => entry.selectionWeight)!;
    open.splice(open.indexOf(archetype), 1);
    picks.push(archetype.id);
  }
  while (picks.length < count) {
    picks.push(random.pickWeighted(eligible, (archetype) => archetype.selectionWeight)!.id);
  }
  return random.shuffle(picks);
}
