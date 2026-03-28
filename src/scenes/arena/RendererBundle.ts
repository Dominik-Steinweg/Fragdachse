import Phaser from 'phaser';
import { BulletRenderer }      from '../../effects/BulletRenderer';
import { FlameRenderer }       from '../../effects/FlameRenderer';
import { BfgRenderer }         from '../../effects/BfgRenderer';
import { EnergyBallRenderer }  from '../../effects/EnergyBallRenderer';
import { GaussRenderer }       from '../../effects/GaussRenderer';
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
import { NukeRenderer }        from '../../powerups/NukeRenderer';
import { PowerUpRenderer }     from '../../powerups/PowerUpRenderer';
import { MeteorRenderer }      from '../../effects/MeteorRenderer';
import { TrainRenderer }       from '../../train/TrainRenderer';
import type { ProjectileManager } from '../../entities/ProjectileManager';
import type { PlayerManager }     from '../../entities/PlayerManager';
import type { EffectSystem }      from '../../effects/EffectSystem';

/** All visual renderers grouped together. Round-scoped renderers start as null. */
export interface RendererBundle {
  bullet:              BulletRenderer;
  flame:               FlameRenderer;
  bfg:                 BfgRenderer;
  energyBall:          EnergyBallRenderer;
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
  nuke:                NukeRenderer;
  meteor:              MeteorRenderer;
  powerUp:             PowerUpRenderer;
  // Round-scoped: created in buildArena(), destroyed in tearDownArena()
  train:               TrainRenderer | null;
  translocatorTeleport: TranslocatorTeleportRenderer | null;
}

/** Create and generate textures for all scene-lifetime renderers. */
export function createRendererBundle(scene: Phaser.Scene): RendererBundle {
  const bullet = new BulletRenderer(scene);
  bullet.generateTextures();

  const flame = new FlameRenderer(scene);
  flame.generateTextures();

  const bfg = new BfgRenderer(scene);
  bfg.generateTextures();

  const energyBall = new EnergyBallRenderer(scene);
  energyBall.generateTextures();

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

  const tracer = new TracerRenderer(scene);

  const muzzleFlash = new MuzzleFlashRenderer(scene);
  muzzleFlash.generateTextures();

  const nuke = new NukeRenderer(scene);
  nuke.generateTextures();

  const meteor = new MeteorRenderer(scene);
  meteor.generateTextures();

  const powerUp = new PowerUpRenderer(scene);

  return {
    bullet, flame, bfg, energyBall, gauss, energyShield, teslaDome, holyGrenade,
    rocket, spore, grenade, muzzleFlash, tracer, translocatorPuck,
    nuke, meteor, powerUp,
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
  bundle.nuke.setEffectSystem(effectSystem);
}
