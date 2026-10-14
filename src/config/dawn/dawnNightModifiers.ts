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
  readonly additionalBlocks?: readonly string[];
  readonly airstrikes?: { readonly intervalMs: number; readonly strikeCount: number; readonly endClearanceMs: number; readonly radiusCells: number };
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
    if (entry.additionalBlocks !== undefined && (!Array.isArray(entry.additionalBlocks) || entry.additionalBlocks.length === 0
      || new Set(entry.additionalBlocks).size !== entry.additionalBlocks.length
      || entry.additionalBlocks.some(id => !blocks.some(block => block.id === id)))) return fail('unknown or duplicate additional block');
    const air = entry.airstrikes;
    if (air && (![air.intervalMs, air.strikeCount, air.endClearanceMs, air.radiusCells].every(n => positive(n) && Number.isSafeInteger(n))
      || air.intervalMs < 10000 || air.strikeCount > 32 || air.endClearanceMs < 15000)) return fail('invalid bounded airstrike timing/count');
    if ((entry.id === 'fog') !== (entry.fogStrength !== undefined)
      || (entry.id === 'bombers') !== (air != null)
      || (entry.id === 'fire') !== (entry.additionalBlocks !== undefined)) return fail(`${entry.id}: missing or misplaced effect parameters`);
  }
  const modifiers = entries as DawnNightModifier[];
  for (let index = 0; index < 10; index++) {
    if (modifiers.reduce((sum, entry) => sum + entry.chanceByThreat[index], 0) > 1) return fail('total chance exceeds 1');
  }
  return modifiers;
}
