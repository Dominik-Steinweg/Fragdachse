import { PlasmaBurnerChargeRenderer } from '../../effects/PlasmaBurnerChargeRenderer';
import { onBootSceneTeardown } from '../../ui/BootPreparation';
import { MgAttritionRenderer } from '../../effects/MgAttritionRenderer';
import { TurretAnimationController } from '../../effects/TurretAnimationController';
import { WorldHealthBarRenderer } from '../../effects/health/WorldHealthBarRenderer';
import { MovementEffectsRenderer } from '../../effects/MovementEffectsRenderer';
import { BurrowGpuRenderer } from '../../effects/BurrowGpuRenderer';
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
import { AttackDroneRenderer } from '../../effects/AttackDroneRenderer';
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
import { GpuVfxSystem }        from '../../effects/gpu/GpuVfxSystem';
import { ConstructionOwnershipMoteRenderer } from '../../effects/ConstructionOwnershipMoteRenderer';
import { EntityBurnGpuController } from '../../effects/EntityBurnGpuController';
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
import { CoopDefenseMissionProgressRenderer } from '../../effects/CoopDefenseMissionProgressRenderer';
import { CoopDefenseCarryZoneRenderer } from '../../effects/CoopDefenseCarryZoneRenderer';
import { Ak47StrategicTargetRenderer } from '../../effects/Ak47StrategicTargetRenderer';
import { RockDestructionRenderer } from '../../effects/RockDestructionRenderer';
import { ExplosionGpuRenderer } from '../../effects/ExplosionGpuRenderer';
import { CombatGoreGpuRenderer } from '../../effects/CombatGoreGpuRenderer';
import { ShadowSystem }        from '../../effects/ShadowSystem';
import { LightingSystem }      from '../../effects/LightingSystem';
import { TrainRenderer }       from '../../train/TrainRenderer';
import type { WorldProjectileRuntime } from '../../projectile/WorldProjectileRuntime';
import type { OwnerVisualSource } from '../../entities/OwnerVisualSource';
import type { EffectSystem }      from '../../effects/EffectSystem';
import { WorldInteractionRenderer } from '../../effects/WorldInteractionRenderer';
import type { CameraFeedbackController } from '../../effects/camera/CameraFeedbackController';
import type { LocalDistortionComposer } from '../../effects/distortion/LocalDistortionComposer';
import type { GameAudioSystem }   from '../../audio/GameAudioSystem';

/** All visual renderers grouped together. World-dependent renderers start as null. */
export interface RendererBundle {
  interactions: WorldInteractionRenderer;
  healthBars: WorldHealthBarRenderer;
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
  turretAnimations:   TurretAnimationController;
  teslaDome:           TeslaDomeRenderer;
  teslaNova:           TeslaNovaRenderer;
  teslaBolt:           TeslaBoltRenderer;
  plasmaBurnerCharge: PlasmaBurnerChargeRenderer;
  healingAura:         HealingAuraRenderer;
  guardianSpirit:      GuardianSpiritRenderer;
  repairDrone:         RepairDroneRenderer;
  attackDrone:         AttackDroneRenderer;
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
  /** Gemeinsame Klammer aller SpriteGPULayer-Partikeleffekte: Tick, Ablation, Diagnose. */
  gpuVfx:              GpuVfxSystem;
  constructionOwnershipMotes: ConstructionOwnershipMoteRenderer;
  movement:            MovementEffectsRenderer;
  burrowGpu:           BurrowGpuRenderer;
  combatGoreGpu:      CombatGoreGpuRenderer;
  entityBurnGpu:       EntityBurnGpuController;
  mgAttrition:         MgAttritionRenderer;
  explosionGpu:        ExplosionGpuRenderer;
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
  missionProgress: CoopDefenseMissionProgressRenderer;
  carryZones:          CoopDefenseCarryZoneRenderer;
  ak47StrategicTargets: Ak47StrategicTargetRenderer;
  objectiveRepairDrones: CoopDefenseObjectiveRepairDroneRenderer;
  meteor:              MeteorRenderer;
  rockDestruction:     RockDestructionRenderer;
  powerUp:             PowerUpRenderer;
  shadow:              ShadowSystem;
  lighting:            LightingSystem;
  // World-scoped presentation renderers: created when a World is built and cleared on World teardown.
  train:               TrainRenderer | null;
  translocatorTeleport: TranslocatorTeleportRenderer | null;
}

/** Synchronous entry point for callers that already own their scheduling. */
export function createRendererBundle(scene: Phaser.Scene, owners: OwnerVisualSource): RendererBundle {
  const steps = createRendererBundleSteps(scene, owners);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Create and generate textures for all scene-lifetime renderers. */
export function* createRendererBundleSteps(
  scene: Phaser.Scene,
  owners: OwnerVisualSource,
): Generator<string, RendererBundle> {
  // Register ownership before the first checkpoint, including cancellation of a partial bundle.
  const cleanup: Array<() => void> = [];
  onBootSceneTeardown(scene.events, () => {
    for (const dispose of cleanup.reverse()) dispose();
  });
  // Vor allen Renderern: das Backend baut den geteilten Atlas und alle Render-Lanes. Beides
  // muss stehen, bevor ein Effekt sich anmeldet – Frames, die erst nach dem Layer entstehen,
  // existieren fuer dessen Shader nicht.
  const gpuVfx = new GpuVfxSystem(scene);
  cleanup.push(() => gpuVfx.destroy());
  yield 'renderers/gpu-atlas-and-lanes';
  const burrowGpu = new BurrowGpuRenderer(gpuVfx);
  cleanup.push(() => burrowGpu.destroy());
  // Ein gemeinsamer Emissions-Tick fuer alle brennenden Entities. Die per-Entity-Renderer
  // melden sich hier an, statt je Brand eigene Emitter oder Callbacks zu erzeugen.
  const entityBurnGpu = new EntityBurnGpuController(gpuVfx);
  const mgAttrition = new MgAttritionRenderer(scene, gpuVfx);
  const combatGoreGpu = new CombatGoreGpuRenderer(scene);
  cleanup.push(() => combatGoreGpu.destroy());
  combatGoreGpu.registerGpuVfx(gpuVfx);
  const explosionGpu = new ExplosionGpuRenderer();
  cleanup.push(() => explosionGpu.clearPending());
  explosionGpu.registerGpuVfx(gpuVfx);

  const bullet = new BulletRenderer(scene);
  bullet.generateTextures();
  yield 'renderers/bullet';

  const asmdPrimary = new AsmdPrimaryRenderer(scene);
  asmdPrimary.generateTextures();
  yield 'renderers/asmdPrimary';

  const plasmaBurner = new PlasmaBurnerRenderer(scene);
  plasmaBurner.generateTextures();
  yield 'renderers/plasmaBurner';
  plasmaBurner.setOwnerVisualStateProvider((ownerId) => owners.getOwnerVisualState(ownerId));

  const bite = new BiteRenderer(scene);
  bite.generateTextures();
  yield 'renderers/bite';

  const blackHole = new BlackHoleRenderer(scene);
  blackHole.generateTextures();
  yield 'renderers/blackHole';

  const zeusTaser = new ZeusTaserRenderer(scene);
  zeusTaser.registerGpuVfx(gpuVfx);
  zeusTaser.generateTextures();
  yield 'renderers/zeusTaser';

  const flame = new FlameRenderer(scene);
  flame.generateTextures();
  yield 'renderers/flame';
  flame.registerGpuVfx(gpuVfx);

  const leafBlower = new LeafBlowerRenderer(scene);
  leafBlower.generateTextures();
  yield 'renderers/leafBlower';
  leafBlower.registerGpuVfx(gpuVfx);

  const bfg = new BfgRenderer(scene);
  bfg.generateTextures();
  yield 'renderers/bfg';

  const energyBall = new EnergyBallRenderer(scene);
  energyBall.generateTextures();
  yield 'renderers/energyBall';

  const hydra = new HydraRenderer(scene);
  hydra.generateTextures();
  yield 'renderers/hydra';

  const gauss = new GaussRenderer(scene);
  gauss.generateTextures();
  yield 'renderers/gauss';

  const energyShield = new EnergyShieldRenderer(scene);
  energyShield.generateTextures();
  yield 'renderers/energyShield';

  const turretAnimations = new TurretAnimationController();
  const teslaDome = new TeslaDomeRenderer(scene, turretAnimations);
  teslaDome.generateTextures();
  yield 'renderers/teslaDome';

  // Blitznova und Gewitterprojektile sind eigene Effektfamilien, haengen aber am selben Feldpuls.
  const teslaNova = new TeslaNovaRenderer(scene);
  teslaNova.generateTextures();
  yield 'renderers/teslaNova';
  teslaDome.setNovaRenderer(teslaNova);

  const plasmaBurnerCharge = new PlasmaBurnerChargeRenderer(scene);
  cleanup.push(() => plasmaBurnerCharge.destroyAll());
  const teslaBolt = new TeslaBoltRenderer(scene);
  teslaBolt.generateTextures();
  yield 'renderers/teslaBolt';

  const healingAura = new HealingAuraRenderer(scene);
  healingAura.generateTextures();
  yield 'renderers/healingAura';

  const guardianSpirit = new GuardianSpiritRenderer(scene);
  guardianSpirit.generateTextures();
  yield 'renderers/guardianSpirit';
  const repairDrone = new RepairDroneRenderer(scene);
  repairDrone.generateTextures();
  yield 'renderers/repairDrone';
  const attackDrone = new AttackDroneRenderer(scene);
  cleanup.push(() => attackDrone.destroyAll());
  yield 'renderers/attackDrone';

  const slimeTrail = new SlimeTrailRenderer(scene);
  const corpseMarker = new CorpseMarkerRenderer(scene);
  const flamethrowerUpgrades = new FlamethrowerUpgradeRenderer(scene, owners);
  // Bodenfeuer: geteilte Lanes fuer alle Brandzellen. Der Flammenring bleibt klassisch.
  flamethrowerUpgrades.registerGpuVfx(gpuVfx);
  const projectileBurn = new ProjectileBurnRenderer(scene);
  projectileBurn.registerGpuVfx(gpuVfx);

  const miniTeslaDome = new MiniTeslaDomeRenderer(scene);
  miniTeslaDome.generateTextures();
  yield 'renderers/miniTeslaDome';

  const timeBubble = new TimeBubbleRenderer(scene);
  timeBubble.generateTextures();
  yield 'renderers/timeBubble';

  const reinforcementMatrix = new ReinforcementMatrixRenderer(scene);
  reinforcementMatrix.generateTextures();
  yield 'renderers/reinforcementMatrix';

  const energyInjector = new EnergyInjectorRenderer(scene);
  energyInjector.generateTextures();
  yield 'renderers/energyInjector';

  const remoteControl = new RemoteControlRenderer(scene);
  remoteControl.generateTextures();
  yield 'renderers/remoteControl';

  const holyGrenade = new HolyGrenadeRenderer(scene);
  holyGrenade.generateTextures();
  yield 'renderers/holyGrenade';

  const rocket = new RocketRenderer(scene);
  rocket.generateTextures();
  yield 'renderers/rocket';
  rocket.registerGpuVfx(gpuVfx);
  const fireball = new FireballRenderer(scene);

  const spore = new SporeRenderer(scene);
  spore.generateTextures();
  yield 'renderers/spore';

  const grenade = new GrenadeRenderer(scene);
  grenade.generateTextures();
  yield 'renderers/grenade';

  const translocatorPuck = new TranslocatorPuckRenderer(scene);
  translocatorPuck.generateTextures();
  yield 'renderers/translocatorPuck';

  const beer = new CaptureTheBeerRenderer(scene);
  beer.generateTextures();
  yield 'renderers/beer';

  const tracer = new TracerRenderer(scene);
  tracer.registerGpuVfx(gpuVfx);

  const muzzleFlash = new MuzzleFlashRenderer(scene);
  muzzleFlash.setOwnerVisualSource(owners);
  muzzleFlash.registerGpuVfx(gpuVfx);
  muzzleFlash.generateTextures();
  yield 'renderers/muzzleFlash';

  const nuke = new NukeRenderer(scene);
  nuke.generateTextures();
  yield 'renderers/nuke';

  const airstrike = new AirstrikeRenderer(scene);
  airstrike.generateTextures();
  yield 'renderers/airstrike';
  // Geteilte Render-Lanes fuer alle Strikes, szenenlebenslang wie die Texturen.
  airstrike.registerGpuVfx(gpuVfx);

  const encounterTelegraph = new CoopDefenseEncounterTelegraphRenderer(scene);
  encounterTelegraph.generateTextures();
  yield 'renderers/encounterTelegraph';

  const secondaryObjectiveMarkers = new CoopDefenseSecondaryObjectiveMarkerRenderer(scene);
  secondaryObjectiveMarkers.build();
  yield 'renderers/secondaryObjectiveMarkers';
  const missionProgress = new CoopDefenseMissionProgressRenderer(scene);
  const carryZones = new CoopDefenseCarryZoneRenderer(scene);
  const ak47StrategicTargets = new Ak47StrategicTargetRenderer(scene);
  ak47StrategicTargets.build();
  yield 'renderers/ak47StrategicTargets';
  const objectiveRepairDrones = new CoopDefenseObjectiveRepairDroneRenderer(scene);
  objectiveRepairDrones.build();
  yield 'renderers/objectiveRepairDrones';

  const meteor = new MeteorRenderer(scene);
  meteor.generateTextures();
  yield 'renderers/meteor';

  const rockDestruction = new RockDestructionRenderer(scene);
  rockDestruction.generateTextures();
  yield 'renderers/rockDestruction';

  const powerUp = new PowerUpRenderer(scene);
  powerUp.registerGpuVfx(gpuVfx);
  const shadow = new ShadowSystem(scene);

  // Dynamische Beleuchtung: scene-lifetime wie der Schatten. Die Lichtquellen melden
  // sich selbst an, deshalb kennen die einzelnen Renderer das System direkt.
  yield 'renderers/shadows';
  const lighting = new LightingSystem(scene);
  yield 'renderers/lighting';
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
  // `WorldProjectileRuntime.getLightSamples()` in `ArenaScene.syncProjectileLights()`.

  const healthBars = new WorldHealthBarRenderer(scene);
  const interactions = new WorldInteractionRenderer(scene);
  cleanup.push(() => interactions.clear());
  const constructionOwnershipMotes = new ConstructionOwnershipMoteRenderer(gpuVfx);
  cleanup.push(() => constructionOwnershipMotes.destroy());
  const movement = new MovementEffectsRenderer(gpuVfx, burrowGpu);
  cleanup.push(() => movement.destroy());
  return {
    interactions,
    turretAnimations, bullet, asmdPrimary, plasmaBurner, bite, blackHole, zeusTaser, flame, leafBlower, bfg, energyBall, hydra, gauss, energyShield, teslaDome, teslaNova, teslaBolt, plasmaBurnerCharge, healingAura, guardianSpirit, repairDrone, attackDrone, slimeTrail, corpseMarker, flamethrowerUpgrades, projectileBurn, miniTeslaDome, timeBubble, reinforcementMatrix, energyInjector, holyGrenade,
    rocket, fireball, spore, grenade, muzzleFlash, tracer, translocatorPuck, beer,
    nuke, airstrike, encounterTelegraph, secondaryObjectiveMarkers, missionProgress, carryZones, ak47StrategicTargets, objectiveRepairDrones, meteor, rockDestruction, powerUp, shadow, lighting,
    remoteControl,
    healthBars,
    gpuVfx,
    constructionOwnershipMotes,
    movement,
    burrowGpu,
    combatGoreGpu,
    entityBurnGpu,
    mgAttrition,
    explosionGpu,
    train: null,
    translocatorTeleport: null,
  };
}

/**
 * Verbindet die world-scoped Projectile-Runtime mit allen Projektil-Renderern.
 *
 * Die Funktion berührt ausschließlich die Projectile-Presentation der übergebenen World und
 * darf die bundle-weiten Provider des übrigen Gameplay nicht überschreiben.
 */
export function wireProjectileRenderers(
  bundle: RendererBundle,
  runtime: WorldProjectileRuntime,
  owners: OwnerVisualSource,
): void {
  runtime.getPresentationRuntime().bindRenderers({
    bullet: bundle.bullet,
    projectileBurn: bundle.projectileBurn,
    flame: bundle.flame,
    leafBlower: bundle.leafBlower,
    bfg: bundle.bfg,
    energyBall: bundle.energyBall,
    hydra: bundle.hydra,
    gauss: bundle.gauss,
    holyGrenade: bundle.holyGrenade,
    rocket: bundle.rocket,
    fireball: bundle.fireball,
    spore: bundle.spore,
    grenade: bundle.grenade,
    translocatorPuck: bundle.translocatorPuck,
    teslaBolt: bundle.teslaBolt,
    plasmaBurnerCharge: bundle.plasmaBurnerCharge,
    tracer: bundle.tracer,
    muzzleFlash: bundle.muzzleFlash,
    turretAnimations: bundle.turretAnimations,
  }, (ownerId) => owners.getOwnerVisualState(ownerId));
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
  effectSystem.setMgAttritionRenderer(bundle.mgAttrition);
  bundle.nuke.setEffectSystem(effectSystem);
  bundle.airstrike.setEffectSystem(effectSystem);
  effectSystem.setLightingSystem(bundle.lighting);
  effectSystem.setExplosionGpuRenderer(bundle.explosionGpu);
  effectSystem.setBurrowGpuRenderer(bundle.burrowGpu);
  effectSystem.setCombatGoreGpuRenderer(bundle.combatGoreGpu);
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
  bundle.bfg.setAudioSystem(audioSystem);
  bundle.teslaDome.setAudioSystem(audioSystem);
  bundle.energyShield.setAudioSystem(audioSystem);
  bundle.nuke.setAudioSystem(audioSystem);
}
