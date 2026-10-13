import { DAWN_WRECK_VARIANTS, type DawnWreckVariant } from '../../dawn/contracts/DawnContentIds';
import rawSiteVariants from './siteVariants.json';

export interface DawnSiteVariants {
  readonly wreck: Readonly<Record<DawnWreckVariant, number>>;
}

/** Zero disables a variant; every known variant must declare a finite, non-negative weight. */
export function validateDawnSiteVariants(raw: unknown): DawnSiteVariants {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isRecord(raw) || Object.keys(raw).some(key => key !== 'wreck') || !isRecord(raw.wreck)) {
    throw new Error('[dawnContent] Site variants must declare wreck weights only');
  }
  const weights = raw.wreck;
  if (Object.keys(weights).some(key => !DAWN_WRECK_VARIANTS.some(variant => variant === key))) {
    throw new Error('[dawnContent] Unknown wreck variant');
  }
  const wreck = {} as Record<DawnWreckVariant, number>;
  let total = 0;
  for (const variant of DAWN_WRECK_VARIANTS) {
    const weight = weights[variant];
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      throw new Error(`[dawnContent] Wreck variant ${variant} needs a finite non-negative weight`);
    }
    wreck[variant] = weight;
    total += weight;
  }
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('[dawnContent] Wreck variant weights need a positive finite total');
  }
  return { wreck };
}

export const DAWN_SITE_VARIANTS = validateDawnSiteVariants(rawSiteVariants);
