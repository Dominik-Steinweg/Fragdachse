import rawElites from './elites.json';
import { DAWN_ELITE_AFFIX_IDS } from '../../dawn/contracts/DawnContentIds';
import { DAWN_MAX_THREAT } from '../../dawn/contracts/DawnPlans';

export interface DawnEliteConfig {
  readonly chanceByThreat: readonly number[];
  readonly affixes: {
    readonly swift: { readonly weight: number; readonly speedMultiplier: number };
    readonly armored: { readonly weight: number; readonly damageReduction: number };
    readonly volatile: { readonly weight: number; readonly radiusPx: number; readonly damage: number; readonly minDamage: number; readonly knockback: number };
    readonly regenerating: { readonly weight: number; readonly maxHpFractionPerSecond: number };
    readonly shielding: { readonly weight: number; readonly radiusPx: number; readonly damageReduction: number };
  };
}

export function validateDawnEliteConfig(value: unknown): asserts value is DawnEliteConfig {
  const fail = (field: string): never => { throw new Error(`[dawn/elites] Invalid ${field}`); };
  const record = (v: unknown, label: string): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(label);
    return v as Record<string, unknown>;
  };
  const number = (v: unknown, min: number, max = Infinity): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const config = record(value, 'config');
  const chances = config.chanceByThreat;
  if (!Array.isArray(chances) || chances.length !== DAWN_MAX_THREAT
    || chances.some((v, i) => !number(v, 0, 1) || (i > 0 && v < chances[i - 1]))) fail('chanceByThreat');
  const affixes = record(config.affixes, 'affixes');
  if (Object.keys(affixes).length !== DAWN_ELITE_AFFIX_IDS.length) fail('affix IDs');
  let weight = 0;
  for (const id of DAWN_ELITE_AFFIX_IDS) {
    const affix = record(affixes[id], id);
    if (!number(affix.weight, 0)) fail(`${id}.weight`);
    weight += affix.weight as number;
    const fields: Record<string, readonly [number, number]> = id === 'swift'
      ? { speedMultiplier: [1, Infinity] }
      : id === 'armored' ? { damageReduction: [0, 1 - Number.EPSILON] }
      : id === 'volatile' ? { radiusPx: [Number.EPSILON, Infinity], damage: [Number.EPSILON, Infinity], minDamage: [0, Infinity], knockback: [0, Infinity] }
      : id === 'regenerating' ? { maxHpFractionPerSecond: [Number.EPSILON, 1] }
      : { radiusPx: [Number.EPSILON, Infinity], damageReduction: [0, 1 - Number.EPSILON] };
    for (const [key, [min, max]] of Object.entries(fields)) {
      if (!number(affix[key], min, max)) fail(`${id}.${key}`);
    }
    if (Object.keys(affix).some(key => key !== 'weight' && !(key in fields))) fail(`${id} fields`);
    if (id === 'volatile' && (affix.minDamage as number) > (affix.damage as number)) fail('volatile.minDamage');
  }
  if (!Number.isFinite(weight) || weight <= 0) fail('total weight');
}

validateDawnEliteConfig(rawElites);
Object.freeze(rawElites.chanceByThreat);
for (const affix of Object.values(rawElites.affixes)) Object.freeze(affix);
Object.freeze(rawElites.affixes);
export const DAWN_ELITE_CONFIG: DawnEliteConfig = Object.freeze(rawElites);
