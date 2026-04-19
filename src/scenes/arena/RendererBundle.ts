import * as Phaser from 'phaser';
import { BulletRenderer }      from '../../effects/BulletRenderer';
import { AsmdPrimaryRenderer } from '../../effects/AsmdPrimaryRenderer';
import { BiteRenderer } from '../../effects/BiteRenderer';
import { ZeusTaserRenderer } from '../../effects/ZeusTaserRenderer';
import { FlameRenderer }       from '../../effects/FlameRenderer';
import { BfgRenderer }         from '../../effects/BfgRenderer';
import { EnergyBallRenderer }  from '../../effects/EnergyBallRenderer';
import { GaussRenderer }       from '../../effects/GaussRenderer';
import { HydraRenderer }       from '../../effects/HydraRenderer';
import { EnergyShieldRenderer } from '../../effects/EnergyShieldRenderer';
import { TeslaDomeRenderer }   from '../../effects/TeslaDomeRenderer';
import { HolyGrenadeRenderer } from '../../effects/HolyGrenadeRenderer';
import { RocketRenderer }      from '../../effects/RocketRenderer';
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
import { RockDestructionRenderer } from '../../effects/RockDestructionRenderer';
import { ShadowSystem }        from '../../effects/ShadowSystem';
import { TrainRenderer }       from '../../train/TrainRenderer';
import type { ProjectileManager } from '../../entities/ProjectileManager';
import type { PlayerManager }     from '../../entities/PlayerManager';
import type { EffectSystem }      from '../../effects/EffectSystem';
import type { GameAudioSystem }   from '../../audio/GameAudioSystem';

/** All visual renderers grouped together. Round-scoped renderers start as null. */
export interface RendererBundle {
  bullet:              BulletRenderer;
  asmdPrimary:         AsmdPrimaryRenderer;
  bite:                BiteRenderer;
  zeusTaser:           ZeusTaserRenderer;
  flame:               FlameRenderer;
  bfg:                 BfgRenderer;
  energyBall:          EnergyBallRenderer;
  hydra:               HydraRenderer;
  gauss:               GaussRenderer;
  energyShield:        EnergyShieldRenderer;
  teslaDome:           TeslaDomeRenderer;
  holyGrenade:         HolyGrenadeRenderer;
  rocket:              RocketRenderer;
  spore:               SporeRenderer;
  grenade:             GrenadeRenderer;
  muzzleFlash:         MuzzleFlashRenderer;
  tracer:              TracerRenderer;
  translocatorPuck:    TranslocatorPuckRenderer;
  beer:                CaptureTheBeerRenderer;
  nuke:                NukeRenderer;
  airstrike:           AirstrikeRenderer;
  meteor:              MeteorRenderer;
  rockDestruction:     RockDestructionRenderer;
  powerUp:             PowerUpRenderer;
  shadow:              ShadowSystem;
  // Round-scoped: created in buildArena(), destroyed in tearDownArena()
  train:               TrainRenderer | null;
  translocatorTeleport: TranslocatorTeleportRenderer | null;
}

/** Create and generate textures for all scene-lifetime renderers. */
export function createRendererBundle(
  scene: Phaser.Scene,
  arenaMask: Phaser.Display.Masks.GeometryMask | null = null,
): RendererBundle {
  const bullet = new BulletRenderer(scene);
  bullet.generateTextures();

  const asmdPrimary = new AsmdPrimaryRenderer(scene);
  asmdPrimary.generateTextures();

  const bite = new BiteRenderer(scene);
  bite.generateTextures();

  const zeusTaser = new ZeusTaserRenderer(scene);
  zeusTaser.generateTextures();

  const flame = new FlameRenderer(scene);
  flame.generateTextures();

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

  const holyGrenade = new HolyGrenadeRenderer(scene);
  holyGrenade.generateTextures();

  const rocket = new RocketRenderer(scene);
  rocket.generateTextures();

  const spore = new SporeRenderer(scene);
  spore.generateTextures();

  const grenade = new GrenadeRenderer(scene);
  grenade.generateTextures();

  const translocatorPuck = new TranslocatorPuckRenderer(scene);
  translocatorPuck.generateTextures();

  const beer = new CaptureTheBeerRenderer(scene, arenaMask);
  beer.generateTextures();

  const tracer = new TracerRenderer(scene);

  const muzzleFlash = new MuzzleFlashRenderer(scene);
  muzzleFlash.generateTextures();

  const nuke = new NukeRenderer(scene);
  nuke.generateTextures();

  const airstrike = new AirstrikeRenderer(scene);
  airstrike.generateTextures();

  const meteor = new MeteorRenderer(scene);
  meteor.generateTextures();

  const rockDestruction = new RockDestructionRenderer(scene);
  rockDestruction.generateTextures();

  const powerUp = new PowerUpRenderer(scene);
  const shadow = new ShadowSystem(scene, arenaMask);

  return {
    bullet, asmdPrimary, bite, zeusTaser, flame, bfg, energyBall, hydra, gauss, energyShield, teslaDome, holyGrenade,
    rocket, spore, grenade, muzzleFlash, tracer, translocatorPuck, beer,
    nuke, airstrike, meteor, rockDestruction, powerUp, shadow,
    train: null,
    translocatorTeleport: null,
  };
}

/** Wire all renderers to the ProjectileManager and register the owner-position provider. */
export function wireRenderersToProjManager(
  bundle: RendererBundle,
  pm: ProjectileManager,
  playerManager: PlayerManager,
): void {
  pm.setBulletRenderer(bundle.bullet);
  pm.setFlameRenderer(bundle.flame);
  pm.setBfgRenderer(bundle.bfg);
  pm.setEnergyBallRenderer(bundle.energyBall);
  pm.setHydraRenderer(bundle.hydra);
  pm.setGaussRenderer(bundle.gauss);
  pm.setHolyGrenadeRenderer(bundle.holyGrenade);
  pm.setRocketRenderer(bundle.rocket);
  pm.setSporeRenderer(bundle.spore);
  pm.setGrenadeRenderer(bundle.grenade);
  pm.setTranslocatorPuckRenderer(bundle.translocatorPuck);
  pm.setTracerRenderer(bundle.tracer);
  pm.setMuzzleFlashRenderer(bundle.muzzleFlash);
  pm.setOwnerPositionProvider((ownerId) => {
    const player = playerManager.getPlayer(ownerId);
    return player ? { x: player.sprite.x, y: player.sprite.y } : null;
  });
  bundle.energyShield.setOwnerPositionProvider((ownerId) => {
    const player = playerManager.getPlayer(ownerId);
    return player ? { x: player.sprite.x, y: player.sprite.y } : null;
  });
}

/** Wire the EffectSystem to renderers that need it (muzzle flash, nuke). */
export function wireRenderersToEffectSystem(bundle: RendererBundle, effectSystem: EffectSystem): void {
  effectSystem.setMuzzleFlashRenderer(bundle.muzzleFlash);
  bundle.asmdPrimary.setMuzzleFlashRenderer(bundle.muzzleFlash);
  effectSystem.setAsmdPrimaryRenderer(bundle.asmdPrimary);
  effectSystem.setBiteRenderer(bundle.bite);
  effectSystem.setZeusTaserRenderer(bundle.zeusTaser);
  bundle.nuke.setEffectSystem(effectSystem);
  bundle.airstrike.setEffectSystem(effectSystem);
}

/** Wire GameAudioSystem to renderers that play sounds. */
export function wireRenderersToAudioSystem(bundle: RendererBundle, audioSystem: GameAudioSystem): void {
  bundle.teslaDome.setAudioSystem(audioSystem);
  bundle.energyShield.setAudioSystem(audioSystem);
  bundle.nuke.setAudioSystem(audioSystem);
  bundle.meteor.setAudioSystem(audioSystem);
}
