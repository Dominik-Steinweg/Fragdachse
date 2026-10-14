import { DAWN_NIGHT_MODIFIER_IDS, type DawnNightModifierId } from '../../dawn/contracts/DawnContentIds';
import { hasCoopDefenseEnemyKind } from '../coopDefenseEnemies';
import type { DawnWaveBlock } from './dawnContent';

export interface DawnNightModifier {
  readonly id: DawnNightModifierId;
  /** Disjoint probabilities: their sum is the chance of any modifier, never four independent rolls. */
  readonly chanceByThreat: readonly number[];
  readonly nightBudgetMultiplier: number;
  readonly enemyWeightMultipliers: Readonly<Record<string, number>>;
  readonly fogStrength?: number;
  /** RGB multiplier for the existing ground fog this night (reddish haze, cool slate); absent = neutral. */
  readonly fogTint?: readonly [number, number, number];
  readonly additionalBlocks?: readonly string[];
  /** Bomber runs: straight lines across the base zone; the formation flies at `runSpeedPxPerSec` (D-47). */
  readonly airstrikes?: { readonly intervalMs: number; readonly strikeCount: number; readonly endClearanceMs: number;
    readonly radiusCells: number; readonly runSpeedPxPerSec: number };
  /** Blood moon: the night ambient keeps its brightness (times `gain`) but takes this hue (D-47). */
  readonly moonlight?: DawnMoonlight;
  /** Fire night: spreading ground fire through the ground-hazard system, never on core or lanes (D-47). */
  readonly groundFire?: DawnNightGroundFire;
}

export interface DawnMoonlight {
  readonly tint: readonly [number, number, number];
  readonly gain: number;
  /** Moonlight through drifting cloud openings: `cover` of the shared cloud field, `light` added in a gap. */
  readonly openings?: { readonly cover: number; readonly light: readonly [number, number, number] };
}

export interface DawnNightGroundFire {
  /** Ignition waves across the night; `startRatio` of the night duration, ascending. */
  readonly ignitions: readonly { readonly startRatio: number; readonly patchCount: number }[];
  readonly minPatchRadiusCells: number;
  readonly maxPatchRadiusCells: number;
  /** Time from ignition at the patch centre to its full radius. */
  readonly spreadMs: number;
  readonly warningLeadMs: number;
  /** Clear disc around the base anchor (beyond the build reservation). */
  readonly coreClearanceCells: number;
  /** Clear lane half-width from every front edge to the base. */
  readonly laneClearanceCells: number;
  /** Clearance around every structure, sites included. */
  readonly siteClearanceCells: number;
  readonly burnDurationMs: number;
  readonly burnDamagePerTick: number;
}

function isValidGroundFire(fire: DawnNightGroundFire): boolean {
  const integer = (n: unknown, min: number, max: number) => Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;
  const ignitions = fire?.ignitions;
  return Array.isArray(ignitions) && ignitions.length > 0 && ignitions.length <= 6
    && ignitions.every((wave, index) => wave && Number.isFinite(wave.startRatio) && wave.startRatio >= 0 && wave.startRatio <= 0.8
      && (index === 0 || wave.startRatio > ignitions[index - 1].startRatio) && integer(wave.patchCount, 1, 8))
    && Number.isFinite(fire.minPatchRadiusCells) && fire.minPatchRadiusCells >= 1
    && Number.isFinite(fire.maxPatchRadiusCells) && fire.maxPatchRadiusCells >= fire.minPatchRadiusCells && fire.maxPatchRadiusCells <= 12
    && integer(fire.warningLeadMs, 0, 10000) && integer(fire.spreadMs, fire.warningLeadMs + 1000, 180000)
    && integer(fire.coreClearanceCells, 0, 30) && integer(fire.laneClearanceCells, 1, 12) && integer(fire.siteClearanceCells, 0, 12)
    && integer(fire.burnDurationMs, 1, 10000) && Number.isFinite(fire.burnDamagePerTick) && fire.burnDamagePerTick >= 0;
}

export function validateDawnNightModifiers(raw: unknown, blocks: readonly DawnWaveBlock[]): readonly DawnNightModifier[] {
  const fail = (detail: string): never => { throw new Error(`[dawnContent] Night modifiers: ${detail}`); };
  const entries = (raw as { modifiers?: unknown[] } | null)?.modifiers;
  if (!Array.isArray(entries) || entries.length !== DAWN_NIGHT_MODIFIER_IDS.length) return fail('all modifier IDs required');
  const ids = new Set<string>();
  const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  for (const source of entries) {
    const entry = source as DawnNightModifier;
    if (!entry || !DAWN_NIGHT_MODIFIER_IDS.includes(entry.id) || ids.has(entry.id)) return fail('invalid or duplicate ID');
    ids.add(entry.id);
    const chances = entry.chanceByThreat;
    if (!Array.isArray(chances) || chances.length !== 10 || chances.some((chance, index) =>
      !Number.isFinite(chance) || chance < 0 || chance > 1 || (index < 2 && chance !== 0)
      || (index > 0 && chance < chances[index - 1]))) return fail(`${entry.id}: ordered chances for threats 1..10 required`);
    if (!positive(entry.nightBudgetMultiplier)) return fail(`${entry.id}: invalid budget multiplier`);
    if (!entry.enemyWeightMultipliers || Array.isArray(entry.enemyWeightMultipliers)
      || typeof entry.enemyWeightMultipliers !== 'object'
      || Object.entries(entry.enemyWeightMultipliers).some(([kind, weight]) => !hasCoopDefenseEnemyKind(kind) || !positive(weight))) {
      return fail(`${entry.id}: invalid enemy weight multipliers`);
    }
    if (entry.fogStrength !== undefined && (!positive(entry.fogStrength) || entry.fogStrength > 2)) return fail('fogStrength must be in (0, 2]');
    if (entry.fogTint !== undefined && (!Array.isArray(entry.fogTint) || entry.fogTint.length !== 3
      || entry.fogTint.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 1.25))) return fail(`${entry.id}: fogTint needs three channels in [0, 1.25]`);
    if (entry.additionalBlocks !== undefined && (!Array.isArray(entry.additionalBlocks) || entry.additionalBlocks.length === 0
      || new Set(entry.additionalBlocks).size !== entry.additionalBlocks.length
      || entry.additionalBlocks.some(id => !blocks.some(block => block.id === id)))) return fail('unknown or duplicate additional block');
    const air = entry.airstrikes;
    if (air && (![air.intervalMs, air.strikeCount, air.endClearanceMs, air.radiusCells, air.runSpeedPxPerSec].every(n => positive(n) && Number.isSafeInteger(n))
      || air.intervalMs < 10000 || air.strikeCount > 32 || air.endClearanceMs < 15000
      || air.runSpeedPxPerSec < 200 || air.runSpeedPxPerSec > 2000)) return fail('invalid bounded airstrike timing/count/run speed');
    const moon = entry.moonlight;
    if (moon !== undefined && (!moon || !Array.isArray(moon.tint) || moon.tint.length !== 3
      || moon.tint.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 1) || Math.max(...moon.tint) <= 0
      || !positive(moon.gain) || moon.gain > 3
      || (moon.openings !== undefined && (!moon.openings || !Number.isFinite(moon.openings.cover)
        || moon.openings.cover <= 0 || moon.openings.cover >= 1 || !Array.isArray(moon.openings.light)
        || moon.openings.light.length !== 3 || moon.openings.light.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 1)))))
      return fail(`${entry.id}: moonlight needs a tint in [0, 1], a gain in (0, 3] and valid openings`);
    if (entry.groundFire !== undefined && !isValidGroundFire(entry.groundFire)) return fail(`${entry.id}: invalid groundFire`);
    if ((entry.id === 'fog') !== (entry.fogStrength !== undefined)
      || (entry.id === 'bombers') !== (air != null)
      || (entry.id === 'blood-moon') !== (moon !== undefined)
      || (entry.id === 'fire') !== (entry.additionalBlocks !== undefined)
      || (entry.id === 'fire') !== (entry.groundFire !== undefined)) return fail(`${entry.id}: missing or misplaced effect parameters`);
  }
  const modifiers = entries as DawnNightModifier[];
  for (let index = 0; index < 10; index++) {
    if (modifiers.reduce((sum, entry) => sum + entry.chanceByThreat[index], 0) > 1) return fail('total chance exceeds 1');
  }
  return modifiers;
}
