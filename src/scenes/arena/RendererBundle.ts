import { MortarStrikeRenderer } from '../../effects/MortarStrikeRenderer';
import { PortalPresentation } from '../../effects/portal/PortalPresentation';
import { FirestarterRenderer } from '../../effects/FirestarterRenderer';
import { ShieldChargerRenderer } from '../../effects/ShieldChargerRenderer';
import { AlienConeRenderer } from '../../effects/AlienConeRenderer';
import { WatchtowerDestructionFx } from '../../effects/watchtower/WatchtowerDestructionFx';
import { PlasmaBurnerChargeRenderer } from '../../effects/PlasmaBurnerChargeRenderer';
import { onBootSceneTeardown } from '../../ui/BootPreparation';
import { MgAttritionRenderer } from '../../effects/MgAttritionRenderer';
import { TurretAnimationController } from '../../effects/TurretAnimationController';
import { WorldHealthBarRenderer } from '../../effects/health/WorldHealthBarRenderer';
import { EnemyEyeGlowRenderer } from '../../effects/EnemyEyeGlowRenderer';
import { DroneNavLightRenderer } from '../../effects/droneNavLights/DroneNavLightRenderer';
import { EliteMarkerRenderer } from '../../effects/dawn/EliteMarkerRenderer';
import { EnemyVulnerabilityRenderer } from '../../effects/EnemyVulnerabilityRenderer';
import { EnemyHopPresentation } from '../../effects/EnemyHopPresentation';
import { KaboomtulaPresentation } from '../../effects/KaboomtulaPresentation';
import { EnemyPouncePresentation } from '../../effects/EnemyPouncePresentation';
import { EnemyHeatBurstPresentation } from '../../effects/EnemyHeatBurstPresentation';
import { TurretWebRenderer } from '../../effects/TurretWebRenderer';
import { AmphibiousEnemyPresentation } from '../../effects/AmphibiousEnemyPresentation';
import { EnemyReadabilityRenderer } from '../../effects/EnemyReadabilityRenderer';
import { createCombatShaderWarmupProbes } from '../../effects/CombatShaderWarmup';
import { MovementEffectsRenderer } from '../../effects/MovementEffectsRenderer';
import { BurrowGpuRenderer } from '../../effects/BurrowGpuRenderer';
import { PounceImpactGpuRenderer } from '../../effects/PounceImpactGpuRenderer';
import { GraveTitanImpactRenderer } from '../../effects/graveTitan/GraveTitanImpactRenderer';
import { GraveTitanGlowPresentation } from '../../effects/graveTitan/GraveTitanGlowPresentation';
import { PounceAuraGpuRenderer } from '../../effects/PounceAuraGpuRenderer';
import { BossIntroGraveyardRenderer } from '../../effects/BossIntroGraveyardRenderer';
import { BossPresenceRenderer } from '../../effects/BossPresenceRenderer';
import { VoidMeteorIntroRenderer } from '../../effects/VoidMeteorIntroRenderer';
import { VoidRiftIntroRenderer } from '../../effects/VoidRiftIntroRenderer';
import { VoidHunterSparksRenderer } from '../../effects/VoidHunterSparksRenderer';
import { createEarthbreakFissureLayers } from '../../effects/earthbreak/EarthbreakFissureGpuLayer';
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
import { BloodFieldSystem }    from '../../effects/blood/BloodFieldSystem';
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
import { ArenaMarkerPresentation } from './ArenaMarkerPresentation';
import { MarkerGpuRenderer } from '../../effects/markers/MarkerGpuRenderer';
import { CoopDefenseMissionProgressRenderer } from '../../effects/CoopDefenseMissionProgressRenderer';
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
import { ProjectileVisualOverrides } from '../../projectile/ProjectileVisualOverrides';
import { createFireControlPortalFlightFactory } from '../../effects/fireControl/FireControlPortalFlightView';

/** All visual renderers grouped together. World-dependent renderers start as null. */
export interface RendererBundle {
  interactions: WorldInteractionRenderer;
  healthBars: WorldHealthBarRenderer;
  enemyEyes: EnemyEyeGlowRenderer;
  droneNavLights: DroneNavLightRenderer;
  enemyVulnerability: EnemyVulnerabilityRenderer;
  amphibiousEnemies: AmphibiousEnemyPresentation;
  enemyHops: EnemyHopPresentation;
  kaboomtula: KaboomtulaPresentation;
  enemyPounces: EnemyPouncePresentation;
  enemyHeatBursts: EnemyHeatBurstPresentation;
  graveTitanGlow: GraveTitanGlowPresentation;
  turretWeb: TurretWebRenderer;
  eliteMarkers: EliteMarkerRenderer;
  enemyReadability: EnemyReadabilityRenderer;
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
  pounceImpact:        PounceImpactGpuRenderer;
  graveTitanImpact:    GraveTitanImpactRenderer;
  pounceAura:          PounceAuraGpuRenderer;
  bossIntro:           BossIntroGraveyardRenderer;
  bossPresence:        BossPresenceRenderer;
  voidHunterSparks:    VoidHunterSparksRenderer;
  voidRift:            VoidRiftIntroRenderer;
  voidMeteorIntro:     VoidMeteorIntroRenderer;
  combatGoreGpu:      CombatGoreGpuRenderer;
  /** Persistent hit blood: merging pools, rock and water marks. */
  bloodField:          BloodFieldSystem;
  entityBurnGpu:       EntityBurnGpuController;
  mgAttrition:         MgAttritionRenderer;
  explosionGpu:        ExplosionGpuRenderer;
  fireball:            FireballRenderer;
  spore:               SporeRenderer;
  grenade:             GrenadeRenderer;
  projectileVisualOverrides: ProjectileVisualOverrides;
  muzzleFlash:         MuzzleFlashRenderer;
  tracer:              TracerRenderer;
  translocatorPuck:    TranslocatorPuckRenderer;
  beer:                CaptureTheBeerRenderer;
  nuke:                NukeRenderer;
  airstrike:           AirstrikeRenderer;
  encounterTelegraph:  CoopDefenseEncounterTelegraphRenderer;
  markers: ArenaMarkerPresentation;
  missionProgress: CoopDefenseMissionProgressRenderer;
  ak47StrategicTargets: Ak47StrategicTargetRenderer;
  objectiveRepairDrones: CoopDefenseObjectiveRepairDroneRenderer;
  meteor:              MeteorRenderer;
  rockDestruction:     RockDestructionRenderer;
  watchtowerDestruction: WatchtowerDestructionFx;
  powerUp:             PowerUpRenderer;
  shadow:              ShadowSystem;
  lighting:            LightingSystem;
  // World-scoped presentation renderers: created when a World is built and cleared on World teardown.
  train:               TrainRenderer | null;
  translocatorTeleport: TranslocatorTeleportRenderer | null;
  /** One portal look for translocator, fire-control and generator portals; cleared per World. */
  portals: PortalPresentation;
  mortarStrike: MortarStrikeRenderer;
  firestarter: FirestarterRenderer;
  shieldCharger: ShieldChargerRenderer;
  alienCone: AlienConeRenderer;
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
  const gpuVfx = new GpuVfxSystem(scene, createCombatShaderWarmupProbes(scene));
  cleanup.push(() => gpuVfx.destroy());
  yield 'renderers/gpu-atlas-and-lanes';
  const burrowGpu = new BurrowGpuRenderer(gpuVfx);
  cleanup.push(() => burrowGpu.destroy());
  const pounceImpact = new PounceImpactGpuRenderer(gpuVfx);
  cleanup.push(() => pounceImpact.destroy());
  const graveTitanImpact = new GraveTitanImpactRenderer(gpuVfx);
  cleanup.push(() => graveTitanImpact.destroy());
  const pounceAura = new PounceAuraGpuRenderer(gpuVfx);
  cleanup.push(() => pounceAura.destroy());
  const earthbreakFissures = createEarthbreakFissureLayers(scene, burrowGpu.earthbreakFissures, () => gpuVfx.now());
  cleanup.push(() => earthbreakFissures.destroy());
  // Ein gemeinsamer Emissions-Tick fuer alle brennenden Entities. Die per-Entity-Renderer
  // melden sich hier an, statt je Brand eigene Emitter oder Callbacks zu erzeugen.
  const entityBurnGpu = new EntityBurnGpuController(gpuVfx);
  const mgAttrition = new MgAttritionRenderer(scene, gpuVfx);
  const combatGoreGpu = new CombatGoreGpuRenderer(scene);
  cleanup.push(() => combatGoreGpu.destroy());
  combatGoreGpu.registerGpuVfx(gpuVfx);
  const bloodField = new BloodFieldSystem(scene);
  cleanup.push(() => bloodField.destroy());
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
  yield 'renderers/energyShield';

  const turretAnimations = new TurretAnimationController();
  const teslaDome = new TeslaDomeRenderer(scene, turretAnimations);
  yield 'renderers/teslaDome';

  // Blitznova und Gewitterprojektile sind eigene Effektfamilien, haengen aber am selben Feldpuls.
  const teslaNova = new TeslaNovaRenderer(scene);
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

  const markers = new ArenaMarkerPresentation(new MarkerGpuRenderer(scene));
  cleanup.push(() => markers.destroy());
  yield 'renderers/markers';
  const missionProgress = new CoopDefenseMissionProgressRenderer(scene);
  const ak47StrategicTargets = new Ak47StrategicTargetRenderer(scene);
  ak47StrategicTargets.build();
  yield 'renderers/ak47StrategicTargets';
  const objectiveRepairDrones = new CoopDefenseObjectiveRepairDroneRenderer(scene);
  objectiveRepairDrones.build();
  yield 'renderers/objectiveRepairDrones';

  const meteor = new MeteorRenderer(scene);
  meteor.registerGpuVfx(gpuVfx);
  cleanup.push(() => meteor.destroy());
  yield 'renderers/meteor';

  const watchtowerDestruction = new WatchtowerDestructionFx(scene);
  cleanup.push(() => watchtowerDestruction.destroy());
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
  turretAnimations.setLightingSystem(lighting);
  teslaNova.setLightingSystem(lighting);
  miniTeslaDome.setLightingSystem(lighting);
  energyShield.setLightingSystem(lighting);
  timeBubble.setLightingSystem(lighting);
  reinforcementMatrix.setLightingSystem(lighting);
  energyInjector.setLightingSystem(lighting);
  remoteControl.setLightingSystem(lighting);
  repairDrone.setLightingSystem(lighting);
  objectiveRepairDrones.setLightingSystem(lighting);
  guardianSpirit.setLightingSystem(lighting);
  slimeTrail.setLightingSystem(lighting);
  powerUp.setLightingSystem(lighting);
  beer.setLightingSystem(lighting);
  // Projektil-Eigenleuchten läuft nicht hier, sondern zentral über
  // `WorldProjectileRuntime.getLightSamples()` in `ArenaScene.syncProjectileLights()`.

  const healthBars = new WorldHealthBarRenderer(scene);
  const enemyEyes = new EnemyEyeGlowRenderer(scene, lighting);
  // Shared night lights of every flying drone; drone renderers only submit anchors.
  const droneNavLights = new DroneNavLightRenderer(scene, lighting);
  cleanup.push(() => droneNavLights.destroy());
  attackDrone.setNavLights(droneNavLights);
  repairDrone.setNavLights(droneNavLights);
  objectiveRepairDrones.setNavLights(droneNavLights);
  cleanup.push(() => enemyEyes.destroy());
  const eliteMarkers = new EliteMarkerRenderer(scene);
  cleanup.push(() => eliteMarkers.destroy());
  const enemyVulnerability = new EnemyVulnerabilityRenderer(scene);
  cleanup.push(() => enemyVulnerability.destroy());
  const amphibiousEnemies = new AmphibiousEnemyPresentation(scene);
  cleanup.push(() => amphibiousEnemies.destroy());
  const enemyHops = new EnemyHopPresentation(scene);
  cleanup.push(() => enemyHops.destroy());
  enemyHops.setLightingSystem(lighting);
  enemyHops.setGpuVfx(gpuVfx);
  const kaboomtula = new KaboomtulaPresentation(scene);
  cleanup.push(() => kaboomtula.destroy());
  const enemyPounces = new EnemyPouncePresentation(scene);
  cleanup.push(() => enemyPounces.destroy());
  const enemyHeatBursts = new EnemyHeatBurstPresentation(scene);
  const graveTitanGlow = new GraveTitanGlowPresentation(scene);
  cleanup.push(() => graveTitanGlow.destroy());
  cleanup.push(() => enemyHeatBursts.destroy());
  enemyHeatBursts.setLightingSystem(lighting);
  const turretWeb = new TurretWebRenderer(scene);
  cleanup.push(() => turretWeb.destroy());
  const enemyReadability = new EnemyReadabilityRenderer(scene);
  cleanup.push(() => enemyReadability.destroy());
  const interactions = new WorldInteractionRenderer(scene);
  cleanup.push(() => interactions.clear());
  const constructionOwnershipMotes = new ConstructionOwnershipMoteRenderer(gpuVfx);
  cleanup.push(() => constructionOwnershipMotes.destroy());
  const movement = new MovementEffectsRenderer(gpuVfx, burrowGpu);
  movement.setLightingSystem(lighting);
  cleanup.push(() => movement.destroy());
  const bossIntro = new BossIntroGraveyardRenderer(scene, lighting, burrowGpu);
  cleanup.push(() => bossIntro.destroy());
  const bossPresence = new BossPresenceRenderer(scene, lighting, graveTitanImpact);
  cleanup.push(() => bossPresence.destroy());
  const voidHunterSparks = new VoidHunterSparksRenderer(scene, gpuVfx, lighting);
  cleanup.push(() => voidHunterSparks.destroy());
  const voidRift = new VoidRiftIntroRenderer(scene, lighting);
  cleanup.push(() => voidRift.destroy());
  const mortarStrike = new MortarStrikeRenderer(scene);
  mortarStrike.registerGpuVfx(gpuVfx);
  cleanup.push(() => mortarStrike.destroy());
  yield 'renderers/mortarStrike';
  const portals = new PortalPresentation(scene, lighting);
  cleanup.push(() => portals.destroy());
  const voidMeteorIntro = new VoidMeteorIntroRenderer(scene, lighting);
  voidMeteorIntro.registerGpuVfx(gpuVfx);
  cleanup.push(() => voidMeteorIntro.destroy());
  const firestarter = new FirestarterRenderer(scene);
  firestarter.registerGpuVfx(gpuVfx);
  firestarter.setLightingSystem(lighting);
  cleanup.push(() => firestarter.destroy());
  yield 'renderers/firestarter';
  const shieldCharger = new ShieldChargerRenderer(scene);
  shieldCharger.registerGpuVfx(gpuVfx);
  shieldCharger.setLightingSystem(lighting);
  cleanup.push(() => shieldCharger.destroy());
  yield 'renderers/shieldCharger';
  const alienCone = new AlienConeRenderer(scene);
  alienCone.registerGpuVfx(gpuVfx);
  alienCone.setLightingSystem(lighting);
  cleanup.push(() => alienCone.destroy());
  yield 'renderers/alienCone';
  const projectileVisualOverrides = new ProjectileVisualOverrides();
  // Scene lifetime: the thrown fire-control portal device draws with its own HQ art.
  projectileVisualOverrides.register(createFireControlPortalFlightFactory(scene));
  // A boss's announced salvo flies as its grave lights instead of generic energy balls.
  cleanup.push(projectileVisualOverrides.register(bossPresence.plasmaFactory, bossPresence.ownsSalvoSpawnFx));
  return {
    interactions,
    turretAnimations, bullet, asmdPrimary, plasmaBurner, bite, blackHole, zeusTaser, flame, leafBlower, bfg, energyBall, hydra, gauss, energyShield, teslaDome, teslaNova, teslaBolt, plasmaBurnerCharge, healingAura, guardianSpirit, repairDrone, attackDrone, slimeTrail, corpseMarker, flamethrowerUpgrades, projectileBurn, miniTeslaDome, timeBubble, reinforcementMatrix, energyInjector, holyGrenade,
    rocket, fireball, spore, grenade, projectileVisualOverrides, muzzleFlash, tracer, translocatorPuck, beer,
    nuke, airstrike, encounterTelegraph, markers, missionProgress, ak47StrategicTargets, objectiveRepairDrones, meteor, rockDestruction, watchtowerDestruction, powerUp, shadow, lighting,
    remoteControl,
    healthBars,
    enemyEyes,
    droneNavLights,
    enemyVulnerability,
    amphibiousEnemies,
    enemyHops,
    kaboomtula,
    enemyPounces,
    enemyHeatBursts,
    graveTitanGlow,
    turretWeb,
    eliteMarkers,
    enemyReadability,
    gpuVfx,
    constructionOwnershipMotes,
    movement,
    burrowGpu,
    pounceImpact,
    graveTitanImpact,
    pounceAura,
    bossIntro,
    bossPresence,
    voidHunterSparks,
    voidRift,
    voidMeteorIntro,
    combatGoreGpu,
    bloodField,
    entityBurnGpu,
    mgAttrition,
    explosionGpu,
    train: null,
    translocatorTeleport: null,
    portals,
    mortarStrike,
    firestarter,
    shieldCharger,
    alienCone,
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
  /** Enemy bodies carrying a replicated frontal shield; null while the World has no Activity. */
  enemyPositions: ((enemyId: string) => { x: number; y: number } | null) | null = null,
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
    firestarterOrb: bundle.firestarter,
    flameShots: bundle.enemyHeatBursts,
    spore: bundle.spore,
    grenade: bundle.grenade,
    translocatorPuck: bundle.translocatorPuck,
    teslaBolt: bundle.teslaBolt,
    plasmaBurnerCharge: bundle.plasmaBurnerCharge,
    tracer: bundle.tracer,
    muzzleFlash: bundle.muzzleFlash,
    turretAnimations: bundle.turretAnimations,
    visualOverrides: bundle.projectileVisualOverrides,
  }, (ownerId) => owners.getOwnerVisualState(ownerId));
  bundle.energyShield.setOwnerPositionProvider((ownerId) => owners.getOwnerVisualState(ownerId));
  bundle.energyShield.setEnemyPositionProvider(enemyPositions);
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
  bundle.meteor.setImpactSystems(bundle.explosionGpu,bundle.lighting);
  effectSystem.setMeteorExplosionRenderer((x,y,radius,variant,includeCrater)=>bundle.meteor.playImpact(x,y,radius,variant,includeCrater));
  bundle.voidMeteorIntro.setImpactCallback((x, y, radius) => {
    effectSystem.playExplosionEffect(x, y, radius, undefined, 'void_nuke', undefined, 'void', { meteorCrater: false });
  });
  effectSystem.setBurrowGpuRenderer(bundle.burrowGpu);
  effectSystem.setPounceImpactRenderer(bundle.pounceImpact);
  effectSystem.setGraveTitanImpactRenderer(bundle.graveTitanImpact);
  effectSystem.setCombatGoreGpuRenderer(bundle.combatGoreGpu);
  effectSystem.setBloodField(bundle.bloodField);
  bundle.mortarStrike.setImpactSystems(bundle.explosionGpu, bundle.lighting);
  effectSystem.setMortarImpactRenderer((x, y, radius, color) => bundle.mortarStrike.playImpact(x, y, radius, color));
  effectSystem.setFirestarterRenderer(bundle.firestarter);
  bundle.shieldCharger.setLaneSink((id, attack, now, visible) => effectSystem.syncEnemyLane(`shield-charge:${id}`, attack, now, visible));
  bundle.alienCone.setSectorSink((id, attack, now, visible) => effectSystem.syncEnemySector(`energy-cone:${id}`, attack, now, visible));
  bundle.enemyHops.setZoneSink((id, attack, now, visible) => effectSystem.syncEnemyZone(`hop-landing:${id}`, attack, now, visible));
  bundle.kaboomtula.setSinks(
    (id, attack, now, visible) => effectSystem.syncEnemyLane(`kaboomtula-lane:${id}`, attack, now, visible, undefined, true),
    (id, attack, now, visible) => effectSystem.syncEnemyZone(`kaboomtula-ring:${id}`, attack, now, visible, undefined, true));
  bundle.enemyPounces.setMarkSink((id, mark, now, visible) => effectSystem.syncEnemyLandingMark(`pounce-mark:${id}`, mark, now, visible));
  bundle.enemyPounces.setAuraSink((x, y, size, strength, color, turn) => bundle.pounceAura.emit(x, y, size, strength, color, turn));
  // The heat warning travels with its running body: a tracking zone in the shared danger family.
  bundle.enemyHeatBursts.setZoneSink((id, attack, now, visible) =>
    effectSystem.syncEnemyZone(`heat-zone:${id}`, attack, now, visible, undefined, true));
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
  bundle.bossIntro.setCameraFeedback(controller);
  bundle.voidRift.setCameraFeedback(controller);
  bundle.mortarStrike.setCameraFeedback(controller);
  bundle.voidMeteorIntro.setCameraFeedback(controller);
  bundle.firestarter.setCameraFeedback(controller);
  bundle.shieldCharger.setCameraFeedback(controller);
  bundle.alienCone.setCameraFeedback(controller);
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
  bundle.voidRift.setDistortionComposer(composer);
  bundle.voidMeteorIntro.setDistortionComposer(composer);
}

/** Wire GameAudioSystem to renderers that play sounds. */
export function wireRenderersToAudioSystem(bundle: RendererBundle, audioSystem: GameAudioSystem): void {
  bundle.bfg.setAudioSystem(audioSystem);
  bundle.teslaDome.setAudioSystem(audioSystem);
  bundle.energyShield.setAudioSystem(audioSystem);
  bundle.alienCone.setAudioSystem(audioSystem);
  bundle.enemyHeatBursts.setAudioSystem(audioSystem);
  bundle.nuke.setAudioSystem(audioSystem);
  bundle.bossIntro.setAudioSystem(audioSystem);
  bundle.voidRift.setAudioSystem(audioSystem);
  bundle.voidMeteorIntro.setAudioSystem(audioSystem);
}
