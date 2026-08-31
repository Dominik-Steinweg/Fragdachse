import type { RendererBundle } from './RendererBundle';

/**
 * Raeumt die Effektdarstellung der endenden World ab.
 *
 * Der Bundle besitzt diese Renderer und damit auch ihren world-scoped Bestand; der Flow sagt nur,
 * dass eine World endet. Hier stehen ausschliesslich Gameplay-Effekte - die World-Darstellung
 * selbst folgt getrennt ihrem Handoff.
 */
export function resetRenderersForWorldGameplayTeardown(bundle: RendererBundle): void {
  bundle.timeBubble.destroyAll();
  bundle.blackHole.destroyAll();
  bundle.reinforcementMatrix.destroyAll();
  bundle.energyInjector.destroyAll();
  bundle.plasmaBurner.clear();
  bundle.remoteControl.destroyAll();
  bundle.teslaDome.destroyAll();
  bundle.teslaNova.destroyAll();
  bundle.teslaBolt.destroyAll();
  bundle.healingAura.destroyAll();
  bundle.miniTeslaDome.destroyAll();
  bundle.energyShield.destroyAll();
  bundle.guardianSpirit.destroyAll();
  bundle.repairDrone.destroyAll();
  bundle.objectiveRepairDrones.destroyAll();
  bundle.slimeTrail.clear();
  bundle.corpseMarker.clearAll();
  bundle.flamethrowerUpgrades.clear();
  // Die Entities geben ihre Brand-Handles beim Zerstoeren selbst frei; das hier raeumt die
  // Partikel derer ab, die den Teardown noch als brennend erleben.
  bundle.entityBurnGpu.clearAll();
  bundle.explosionGpu.clearPending();
  bundle.gpuVfx.releaseAll();
}

/**
 * Raeumt die World-Darstellung nach dem Ende ihrer Runtime ab.
 *
 * `preserveAuthoredPresentation` bedeutet: Der naechste Aufbau uebernimmt die gebaute
 * Darstellung. Dann bleiben Terrainfarben und statische Schatten stehen, und nur die dynamischen
 * Anteile fallen.
 */
export function resetRenderersForWorldPresentationTeardown(
  bundle: RendererBundle,
  preserveAuthoredPresentation: boolean,
): void {
  bundle.powerUp.clear();
  bundle.nuke.clear();
  bundle.airstrike.clear();
  bundle.encounterTelegraph.clear();
  bundle.meteor.clear();
  bundle.rockDestruction.clear();
  bundle.carryZones.clear();
  bundle.beer.syncCoopDefenseCarry([]);
  if (!preserveAuthoredPresentation) bundle.leafBlower.setTerrainColorSnapshot(null);
  bundle.beer.clear();
  if (preserveAuthoredPresentation) bundle.shadow.clearDynamicShadows();
  else bundle.shadow.clear();
  bundle.lighting.setActive(false);
  bundle.translocatorTeleport = null;
}
