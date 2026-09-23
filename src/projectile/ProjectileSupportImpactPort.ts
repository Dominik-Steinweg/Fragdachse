import type { PlasmaBurnerChargeImpactRequest } from '../combat/plasmaBurner/PlasmaBurnerContracts';
export interface ProjectileSupportImpactPort {
  resolvePlasmaBurnerCharge(request: PlasmaBurnerChargeImpactRequest): { readonly accepted: boolean; readonly effectiveAmount: number };
}
