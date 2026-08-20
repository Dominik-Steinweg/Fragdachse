import type { ProjectileSpawnConfig } from '../../types';
import type { HitscanShotRequest, MeleeSwingRequest } from '../../loadout/WeaponFireExecutor';
import type { WeaponBalanceScenario } from './scenarioTypes';
import {
  classifyHeadlessPayload,
  findUnknownActivePayloadFields,
} from './weaponBalanceCapabilities';
import { UnsupportedWeaponMechanicError } from './weaponCapabilityValidator';

function validatePayload(
  payload: ProjectileSpawnConfig | HitscanShotRequest | MeleeSwingRequest,
  kind: 'projectile' | 'hitscan' | 'melee',
  sourceId: string,
  scenario: WeaponBalanceScenario,
): void {
  const record = payload as unknown as Record<string, unknown>;
  const reasons = [
    ...findUnknownActivePayloadFields(record, kind),
    ...classifyHeadlessPayload(payload, kind, scenario)
      .filter((classification) => classification.status === 'unsupported_relevant')
      .map((classification) => classification.rationale),
  ];

  if (reasons.length > 0) {
    throw new UnsupportedWeaponMechanicError(sourceId, reasons, scenario);
  }
}

/** Zweite fail-closed Sicherheitsgrenze fuer Projektil-Auftraege. */
export function validateProjectileSpawnPayload(
  cfg: ProjectileSpawnConfig,
  scenario: WeaponBalanceScenario = 'single_target_static',
): void {
  validatePayload(cfg, 'projectile', cfg.sourceId ?? 'projectile', scenario);
}

/** Zweite fail-closed Sicherheitsgrenze fuer Hitscan-Auftraege. */
export function validateHitscanShotRequest(
  request: HitscanShotRequest,
  scenario: WeaponBalanceScenario = 'single_target_static',
): void {
  validatePayload(request, 'hitscan', request.sourceId ?? 'hitscan', scenario);
}

/** Historischer Name bleibt fuer bestehende Tests und Importe erhalten. */
export const validateHitscanShotPayload = validateHitscanShotRequest;

/** Zweite fail-closed Sicherheitsgrenze fuer Melee-Auftraege. */
export function validateMeleeSwingPayload(
  request: MeleeSwingRequest,
  scenario: WeaponBalanceScenario = 'single_target_static',
): void {
  validatePayload(request, 'melee', request.sourceId ?? 'melee', scenario);
}
