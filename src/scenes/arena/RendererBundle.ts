import * as Phaser from 'phaser';
import { BulletRenderer }      from '../../effects/BulletRenderer';
import { AsmdPrimaryRenderer } from '../../effects/AsmdPrimaryRenderer';
import { PlasmaBurnerRenderer } from '../../effects/PlasmaBurnerRenderer';
import { BiteRenderer } from '../../effects/BiteRenderer';
import { BlackHoleRenderer } from '../../effects/BlackHoleRenderer';
import { ZeusTaserRenderer } from '../../effects/ZeusTaserRenderer';
import { FlameRenderer }       from '../../effects/FlameRenderer';
import { LeafBlowerRenderer }  from '../../effects/LeafBlowerRenderer';
import { BfgRenderer }         from '../../effects/BfgRenderer';
import { EnergyBallRenderer }  from '../../effects/EnergyBallRenderer';
import { GaussRenderer }       from '../../effects/GaussRenderer';
import { HydraRenderer }       from '../../effects/HydraRenderer';
import { EnergyShieldRenderer } from '../../effects/EnergyShieldRenderer';
import { TeslaDomeRenderer }   from '../../effects/TeslaDomeRenderer';
import { TeslaNovaRenderer }   from '../../effects/TeslaNovaRenderer';
import { TeslaBoltRenderer }   from '../../effects/TeslaBoltRenderer';
import { HealingAuraRenderer } from '../../effects/HealingAuraRenderer';
import { GuardianSpiritRenderer } from '../../effects/GuardianSpiritRenderer';
import { RepairDroneRenderer } from '../../effects/RepairDroneRenderer';
import { SlimeTrailRenderer } from '../../effects/SlimeTrailRenderer';
import { CorpseMarkerRenderer } from '../../effects/CorpseMarkerRenderer';
import { FlamethrowerUpgradeRenderer } from '../../effects/FlamethrowerUpgradeRenderer';
import { ProjectileBurnRenderer } from '../../effects/ProjectileBurnRenderer';
import { MiniTeslaDomeRenderer } from '../../effects/MiniTeslaDomeRenderer';
import { TimeBubbleRenderer }  from '../../effects/TimeBubbleRenderer';
import { ReinforcementMatrixRenderer } from '../../effects/ReinforcementMatrixRenderer';
import { EnergyInjectorRenderer } from '../../effects/EnergyInjectorRenderer';
import { RemoteControlRenderer } from '../../effects/RemoteControlRenderer';
import { HolyGrenadeRenderer } from '../../effects/HolyGrenadeRenderer';
import { RocketRenderer }      from '../../effects/RocketRenderer';
import { FireballRenderer }    from '../../effects/FireballRenderer';
import { SporeRenderer }       from '../../effects/SporeRenderer';
import { GrenadeRenderer }     from '../../effects/GrenadeRenderer';
import { MuzzleFlashRenderer } from '../../effects/MuzzleFlashRenderer';
import { TracerRenderer }      from '../../effects/TracerRenderer';
import { TranslocatorPuckRenderer } from '../../effects/TranslocatorPuckRenderer';
import { TranslocatorTeleportRenderer } from '../../effects/TranslocatorTeleportRenderer';
import { CaptureTheBeerRenderer } from '../../effects/CaptureTheBeerRenderer';
import { NukeRenderer }        from '../../powerups/NukeRenderer';
import { PowerUpRenderer }     from '../../powerups/PowerUpRenderer';
import { MeteorRenderer }      from '../../effects/MeteorRenderer';
import { AirstrikeRenderer }   from '../../effects/AirstrikeRenderer';
import { CoopDefenseEncounterTelegraphRenderer } from '../../effects/CoopDefenseEncounterTelegraphRenderer';
import { CoopDefenseObjectiveRepairDroneRenderer } from '../../effects/CoopDefenseObjectiveRepairDroneRenderer';
import { CoopDefenseSecondaryObjectiveMarkerRenderer } from '../../effects/CoopDefenseSecondaryObjectiveMarkerRenderer';
import { CoopDefenseCarryZoneRenderer } from '../../effects/CoopDefenseCarryZoneRenderer';
import { Ak47StrategicTargetRenderer } from '../../effects/Ak47StrategicTargetRenderer';
import { RockDestructionRenderer } from '../../effects/RockDestructionRenderer';
import { ShadowSystem }        from '../../effects/ShadowSystem';
import { LightingSystem }      from '../../effects/LightingSystem';
import { TrainRenderer }       from '../../train/TrainRenderer';
import type { ProjectileManager } from '../../entities/ProjectileManager';
import type { OwnerVisualSource } from '../../entities/OwnerVisualSource';
import type { EffectSystem }      from '../../effects/EffectSystem';
import type { CameraFeedbackController } from '../../effects/camera/CameraFeedbackController';
import type { LocalDistortionComposer } from '../../effects/distortion/LocalDistortionComposer';
import type { GameAudioSystem }   from '../../audio/GameAudioSystem';

/** All visual renderers grouped together. Round-scoped renderers start as null. */
export interface RendererBundle {
  bullet:              BulletRenderer;
  asmdPrimary:         AsmdPrimaryRenderer;
  plasmaBurner:        PlasmaBurnerRenderer;
  bite:                BiteRenderer;
  blackHole:           BlackHoleRenderer;
  zeusTaser:           ZeusTaserRenderer;
  flame:               FlameRenderer;
  leafBlower:          LeafBlowerRenderer;
  bfg:                 BfgRenderer;
  energyBall:          EnergyBallRenderer;
  hydra:               HydraRenderer;
  gauss:               GaussRenderer;
  energyShield:        EnergyShieldRenderer;
  teslaDome:           TeslaDomeRenderer;
  teslaNova:           TeslaNovaRenderer;
  teslaBolt:           TeslaBoltRenderer;
  healingAura:         HealingAuraRenderer;
  guardianSpirit:      GuardianSpiritRenderer;
  repairDrone:         RepairDroneRenderer;
  slimeTrail:          SlimeTrailRenderer;
  corpseMarker:        CorpseMarkerRenderer;
  flamethrowerUpgrades: FlamethrowerUpgradeRenderer;
  projectileBurn:      ProjectileBurnRenderer;
  miniTeslaDome:       MiniTeslaDomeRenderer;
  timeBubble:          TimeBubbleRenderer;
  reinforcementMatrix: ReinforcementMatrixRenderer;
  energyInjector:      EnergyInjectorRenderer;
  remoteControl:       RemoteControlRenderer;
  holyGrenade:         HolyGrenadeRenderer;
  rocket:              RocketRenderer;
  fireball:            FireballRenderer;
  spore:               SporeRenderer;
  grenade:             GrenadeRenderer;
  muzzleFlash:         MuzzleFlashRenderer;
  tracer:              TracerRenderer;
  translocatorPuck:    TranslocatorPuckRenderer;
  beer:                CaptureTheBeerRenderer;
  nuke:                NukeRenderer;
  airstrike:           AirstrikeRenderer;
  encounterTelegraph:  CoopDefenseEncounterTelegraphRenderer;
  secondaryObjectiveMarkers: CoopDefenseSecondaryObjectiveMarkerRenderer;
  carryZones:          CoopDefenseCarryZoneRenderer;
  ak47StrategicTargets: Ak47StrategicTargetRenderer;
  objectiveRepairDrones: CoopDefenseObjectiveRepairDroneRenderer;
  meteor:              MeteorRenderer;
  rockDestruction:     RockDestructionRenderer;
  powerUp:             PowerUpRenderer;
  shadow:              ShadowSystem;
  lighting:            LightingSystem;
  // Round-scoped: created in buildArena(), destroyed in tearDownArena()
  train:               TrainRenderer | null;
  translocatorTeleport: TranslocatorTeleportRenderer | null;
}

/** Create and generate textures for all scene-lifetime renderers. */
export function createRendererBundle(
  scene: Phaser.Scene,
  owners: OwnerVisualSource,
): RendererBundle {
  const bullet = new BulletRenderer(scene);
  bullet.generateTextures();

  const asmdPrimary = new AsmdPrimaryRenderer(scene);
  asmdPrimary.generateTextures();

  const plasmaBurner = new PlasmaBurnerRenderer(scene);
  plasmaBurner.generateTextures();
  plasmaBurner.setOwnerVisualStateProvider((ownerId) => owners.getOwnerVisualState(ownerId));

  const bite = new BiteRenderer(scene);
  bite.generateTextures();

  const blackHole = new BlackHoleRenderer(scene);
  blackHole.generateTextures();

  const zeusTaser = new ZeusTaserRenderer(scene);
  zeusTaser.generateTextures();

  const flame = new FlameRenderer(scene);
  flame.generateTextures();

  const leafBlower = new LeafBlowerRenderer(scene);
  leafBlower.generateTextures();

  const bfg = new BfgRenderer(scene);
  bfg.generateTextures();

  const energyBall = new EnergyBallRenderer(scene);
  energyBall.generateTextures();

  const hydra = new HydraRenderer(scene);
  hydra.generateTextures();

  const gauss = new GaussRenderer(scene);
  gauss.generateTextures();

  const energyShield = new EnergyShieldRenderer(scene);
  energyShield.generateTextures();

  const teslaDome = new TeslaDomeRenderer(scene);
  teslaDome.generateTextures();

  // Blitznova und Gewitterprojektile sind eigene Effektfamilien, haengen aber am selben Feldpuls.
  const teslaNova = new TeslaNovaRenderer(scene);
  teslaNova.generateTextures();
  teslaDome.setNovaRenderer(teslaNova);

  const teslaBolt = new TeslaBoltRenderer(scene);
  teslaBolt.generateTextures();

  const healingAura = new HealingAuraRenderer(scene);
  healingAura.generateTextures();

  const guardianSpirit = new GuardianSpiritRenderer(scene);
  guardianSpirit.generateTextures();
  const repairDrone = new RepairDroneRenderer(scene);
  repairDrone.generateTextures();

  const slimeTrail = new SlimeTrailRenderer(scene);
  const corpseMarker = new CorpseMarkerRenderer(scene);
  const flamethrowerUpgrades = new FlamethrowerUpgradeRenderer(scene, owners);
  const projectileBurn = new ProjectileBurnRenderer(scene);

  const miniTeslaDome = new MiniTeslaDomeRenderer(scene);
  miniTeslaDome.generateTextures();

  const timeBubble = new TimeBubbleRenderer(scene);
  timeBubble.generateTextures();

  const reinforcementMatrix = new ReinforcementMatrixRenderer(scene);
  reinforcementMatrix.generateTextures();

  const energyInjector = new EnergyInjectorRenderer(scene);
  energyInjector.generateTextures();

  const remoteControl = new RemoteControlRenderer(scene);
  remoteControl.generateTextures();

  const holyGrenade = new HolyGrenadeRenderer(scene);
  holyGrenade.generateTextures();

  const rocket = new RocketRenderer(scene);
  rocket.generateTextures();
  const fireball = new FireballRenderer(scene);

  const spore = new SporeRenderer(scene);
  spore.generateTextures();

  const grenade = new GrenadeRenderer(scene);
  grenade.generateTextures();

  const translocatorPuck = new TranslocatorPuckRenderer(scene);
  translocatorPuck.generateTextures();

  const beer = new CaptureTheBeerRenderer(scene);
  beer.generateTextures();

  const tracer = new TracerRenderer(scene);

  const muzzleFlash = new MuzzleFlashRenderer(scene);
  muzzleFlash.generateTextures();

  const nuke = new NukeRenderer(scene);
  nuke.generateTextures();

  const airstrike = new AirstrikeRenderer(scene);
  airstrike.generateTextures();
  // Genau zwei geteilte GPU-Layer fuer alle Strikes, szenenlebenslang wie die Texturen.
  airstrike.initGpuLayers();

  const encounterTelegraph = new CoopDefenseEncounterTelegraphRenderer(scene);
  encounterTelegraph.generateTextures();

  const secondaryObjectiveMarkers = new CoopDefenseSecondaryObjectiveMarkerRenderer(scene);
  secondaryObjectiveMarkers.build();
  const carryZones = new CoopDefenseCarryZoneRenderer(scene);
  const ak47StrategicTargets = new Ak47StrategicTargetRenderer(scene);
  ak47StrategicTargets.build();
  const objectiveRepairDrones = new CoopDefenseObjectiveRepairDroneRenderer(scene);
  objectiveRepairDrones.build();

  const meteor = new MeteorRenderer(scene);
  meteor.generateTextures();

  const rockDestruction = new RockDestructionRenderer(scene);
  rockDestruction.generateTextures();

  const powerUp = new PowerUpRenderer(scene);
  const shadow = new ShadowSystem(scene);

  // Dynamische Beleuchtung: scene-lifetime wie der Schatten. Die Lichtquellen melden
  // sich selbst an, deshalb kennen die einzelnen Renderer das System direkt.
  const lighting = new LightingSystem(scene);
  muzzleFlash.setLightingSystem(lighting);
  flame.setLightingSystem(lighting);
  projectileBurn.setLightingSystem(lighting);
  flamethrowerUpgrades.setLightingSystem(lighting);
  asmdPrimary.setLightingSystem(lighting);
  plasmaBurner.setLightingSystem(lighting);
  teslaDome.setLightingSystem(lighting);
  teslaNova.setLightingSystem(lighting);
  miniTeslaDome.setLightingSystem(lighting);
  energyShield.setLightingSystem(lighting);
  timeBubble.setLightingSystem(lighting);
  reinforcementMatrix.setLightingSystem(lighting);
  energyInjector.setLightingSystem(lighting);
  remoteControl.setLightingSystem(lighting);
  healingAura.setLightingSystem(lighting);
  guardianSpirit.setLightingSystem(lighting);
  slimeTrail.setLightingSystem(lighting);
  powerUp.setLightingSystem(lighting);
  beer.setLightingSystem(lighting);
  // Projektil-Eigenleuchten läuft nicht hier, sondern zentral über
  // `ProjectileManager.getLightSamples()` in `ArenaScene.syncProjectileLights()`.

  return {
    bullet, asmdPrimary, plasmaBurner, bite, blackHole, zeusTaser, flame, leafBlower, bfg, energyBall, hydra, gauss, energyShield, teslaDome, teslaNova, teslaBolt, healingAura, guardianSpirit, repairDrone, slimeTrail, corpseMarker, flamethrowerUpgrades, projectileBurn, miniTeslaDome, timeBubble, reinforcementMatrix, energyInjector, holyGrenade,
    rocket, fireball, spore, grenade, muzzleFlash, tracer, translocatorPuck, beer,
    nuke, airstrike, encounterTelegraph, secondaryObjectiveMarkers, carryZones, ak47StrategicTargets, objectiveRepairDrones, meteor, rockDestruction, powerUp, shadow, lighting,
    remoteControl,
    train: null,
    translocatorTeleport: null,
  };
}

/**
 * Verbindet einen ProjectileManager mit allen Projektil-Renderern.
 *
 * Bewusst getrennt von {@link wireRenderersToProjManager}: Diese Funktion berührt
 * ausschliesslich den übergebenen Manager. Der lokale Ambient-Manager der Lobby benutzt
 * dieselben Renderer, darf aber die *bundle-weiten* Provider des Gameplays nicht
 * überschreiben – sonst zeigte das Energieschild der Arena auf Lobby-Actors.
 */
export function wireProjectileRenderers(
  bundle: RendererBundle,
  pm: ProjectileManager,
  owners: OwnerVisualSource,
): void {
  pm.setBulletRenderer(bundle.bullet);
  pm.setProjectileBurnRenderer(bundle.projectileBurn);
  pm.setFlameRenderer(bundle.flame);
  pm.setLeafBlowerRenderer(bundle.leafBlower);
  pm.setBfgRenderer(bundle.bfg);
  pm.setEnergyBallRenderer(bundle.energyBall);
  pm.setHydraRenderer(bundle.hydra);
  pm.setGaussRenderer(bundle.gauss);
  pm.setHolyGrenadeRenderer(bundle.holyGrenade);
  pm.setRocketRenderer(bundle.rocket);
  pm.setFireballRenderer(bundle.fireball);
  pm.setSporeRenderer(bundle.spore);
  pm.setGrenadeRenderer(bundle.grenade);
  pm.setTranslocatorPuckRenderer(bundle.translocatorPuck);
  pm.setTeslaBoltRenderer(bundle.teslaBolt);
  pm.setTracerRenderer(bundle.tracer);
  pm.setMuzzleFlashRenderer(bundle.muzzleFlash);
  pm.setOwnerPositionProvider((ownerId) => owners.getOwnerVisualState(ownerId));
}

/** Wire all renderers to the ProjectileManager and register the owner-position provider. */
export function wireRenderersToProjManager(
  bundle: RendererBundle,
  pm: ProjectileManager,
  owners: OwnerVisualSource,
): void {
  pm.setBulletRenderer(bundle.bullet);
  pm.setProjectileBurnRenderer(bundle.projectileBurn);
  pm.setFlameRenderer(bundle.flame);
  pm.setLeafBlowerRenderer(bundle.leafBlower);
  pm.setBfgRenderer(bundle.bfg);
  pm.setEnergyBallRenderer(bundle.energyBall);
  pm.setHydraRenderer(bundle.hydra);
  pm.setGaussRenderer(bundle.gauss);
  pm.setHolyGrenadeRenderer(bundle.holyGrenade);
  pm.setRocketRenderer(bundle.rocket);
  pm.setFireballRenderer(bundle.fireball);
  pm.setSporeRenderer(bundle.spore);
  pm.setGrenadeRenderer(bundle.grenade);
  pm.setTranslocatorPuckRenderer(bundle.translocatorPuck);
  pm.setTeslaBoltRenderer(bundle.teslaBolt);
  pm.setTracerRenderer(bundle.tracer);
  pm.setMuzzleFlashRenderer(bundle.muzzleFlash);
  pm.setOwnerPositionProvider((ownerId) => owners.getOwnerVisualState(ownerId));
  bundle.energyShield.setOwnerPositionProvider((ownerId) => owners.getOwnerVisualState(ownerId));
}

/** Wire the EffectSystem to renderers that need it (muzzle flash, nuke). */
export function wireRenderersToEffectSystem(bundle: RendererBundle, effectSystem: EffectSystem): void {
  effectSystem.setMuzzleFlashRenderer(bundle.muzzleFlash);
  bundle.asmdPrimary.setMuzzleFlashRenderer(bundle.muzzleFlash);
  effectSystem.setAsmdPrimaryRenderer(bundle.asmdPrimary);
  effectSystem.setPlasmaBurnerRenderer(bundle.plasmaBurner);
  effectSystem.setBiteRenderer(bundle.bite);
  effectSystem.setZeusTaserRenderer(bundle.zeusTaser);
  bundle.nuke.setEffectSystem(effectSystem);
  bundle.airstrike.setEffectSystem(effectSystem);
  effectSystem.setLightingSystem(bundle.lighting);
}

/**
 * Verbindet alle Renderer, die Kamerabewegung auslösen, mit dem zentralen Controller.
 * Direkte `cameras.main.shake()`-Aufrufe sind ab hier verboten – der Ownership-Test in
 * `tests/CameraShakeOwnership.test.ts` erzwingt das.
 */
export function wireRenderersToCameraFeedback(
  bundle: RendererBundle,
  controller: CameraFeedbackController,
): void {
  bundle.nuke.setCameraFeedback(controller);
  bundle.airstrike.setCameraFeedback(controller);
  bundle.meteor.setCameraFeedback(controller);
  bundle.beer.setCameraFeedback(controller);
}

/**
 * Verbindet die Renderer, die Weltpixel lokal verzerren, mit der gemeinsamen Karte. Jeder
 * meldet seine Quellen pro Frame an; die Auswahl, Begrenzung und der einzelne Renderpass
 * liegen beim Composer.
 */
export function wireRenderersToDistortion(
  bundle: RendererBundle,
  composer: LocalDistortionComposer,
): void {
  bundle.timeBubble.setDistortionComposer(composer);
  bundle.blackHole.setDistortionComposer(composer);
}

/** Wire GameAudioSystem to renderers that play sounds. */
export function wireRenderersToAudioSystem(bundle: RendererBundle, audioSystem: GameAudioSystem): void {
  bundle.teslaDome.setAudioSystem(audioSystem);
  bundle.energyShield.setAudioSystem(audioSystem);
  bundle.nuke.setAudioSystem(audioSystem);
  bundle.meteor.setAudioSystem(audioSystem);
}
