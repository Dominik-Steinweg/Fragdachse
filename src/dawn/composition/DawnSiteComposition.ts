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
  /** Own stream for the demolition cache; templates without bridges never draw from it. */
  readonly demolitionRandom?: DawnRandom;
}

/**
 * Waehlt die Salvage-Sites einer Runde: Anzahl und Tiers aus der Threat-Kurve, Slots ueber
 * Quadranten und Distanzbaender gestreut, hoehere Tiers weiter draussen.
 *
 * Rein und geseedet; das Ergebnis steht in Slot-Reihenfolge des Templates.
 */
export function composeDawnSites({ random, template, curve, scrapScanner = false, demolitionRandom }: DawnSiteCompositionInput): DawnSitePlan[] {
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
  const cache = (template.world.bridges?.length ?? 0) > 0 && demolitionRandom
    ? planDemolitionCache(demolitionRandom, template, curve, new Set(slots.map((slot) => slot.id))) : null;
  if (cache) {
    archetypeBySlot.set(cache.slotId, cache.archetypeId);
    tierBySlot.set(cache.slotId, cache.tier);
  }
  return template.salvageSlots
    .filter((slot) => tierBySlot.has(slot.id))
    .map((slot) => {
      const archetypeId = archetypeBySlot.get(slot.id)!;
      // The plan carries the effective visibility: the host's scanner reveals hidden archetypes.
      const hidden = !scrapScanner && getDawnSiteArchetypes().find(entry => entry.id === archetypeId)?.hidden === true;
      return { slotId: slot.id, archetypeId, tier: tierBySlot.get(slot.id)!, ...(hidden ? { hidden: true as const } : {}) };
    });
}

/**
 * Exactly one demolition cache per arena with bridges, on a free near or mid slot: the dynamite has to
 * be fetched by day, while the bridges still carry the team to the other sites.
 */
function planDemolitionCache(
  random: DawnRandom,
  template: DawnArenaTemplate,
  curve: DawnThreatCurve,
  used: ReadonlySet<string>,
): { slotId: string; archetypeId: string; tier: number } | null {
  const archetype = getDawnSiteArchetypes().find((entry) => entry.carryItem === 'explosive');
  if (!archetype) return null;
  const free = template.salvageSlots.filter((slot) => !used.has(slot.id));
  const preferred = free.filter((slot) => slot.band !== 'far');
  const pool = preferred.length > 0 ? preferred : free;
  if (pool.length === 0) return null;
  return { slotId: pool[random.int(pool.length)]!.id, archetypeId: archetype.id, tier: pickTier(random, curve) };
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
  // Portal generators and explosive caches have their own composition steps; they are never drawn.
  const eligible = getDawnSiteArchetypes().filter((archetype) => (archetype.minThreat ?? 1) <= threat
    && !archetype.portal && archetype.carryItem === undefined);
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
