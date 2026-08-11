import type { PlaceablePedestalUtilityConfig } from './LoadoutTypes';

/**
 * Erzeugt den kurzlebigen Utility-Override fuer einen konfigurierten Missionsreward.
 * Der Override ist absichtlich kein Katalogeintrag: Er darf weder als Loadout-Auswahl noch als
 * Inspector-Werkzeug oder persistenter Fortschritt auftauchen.
 */
export function createCoopDefensePlaceablePedestalUtility(
  objectiveId: string,
  powerUpDefId: string,
): PlaceablePedestalUtilityConfig {
  return {
    id: `COOP_DEFENSE_MISSION_PEDESTAL:${objectiveId}`,
    displayName: 'MISSIONS-PODEST PLATZIEREN',
    type: 'placeable_pedestal',
    cooldown: 0,
    activation: { type: 'placement_mode' },
    projectileSpeed: 0,
    projectileSize: 0,
    fuseTime: 0,
    maxBounces: 0,
    allowedSlots: ['utility'],
    skipCooldownPublish: true,
    rewardObjectiveId: objectiveId,
    powerUpDefId,
    placeable: {
      kind: 'pedestal',
      range: 240,
      footprint: [{ dx: 0, dy: 0 }],
      maxHp: 1,
      lifetimeMs: 0,
      previewAlpha: 0.58,
      ownerTintStrength: 0.7,
      warningPulseMs: 0,
      spawnShakeDuration: 180,
      spawnShakeIntensity: 0.8,
      indestructible: true,
    },
  };
}
