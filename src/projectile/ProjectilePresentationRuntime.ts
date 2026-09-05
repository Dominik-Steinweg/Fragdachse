import * as Phaser from 'phaser';
import { DEPTH, MUZZLE_PROJECTILE_FALLBACK_BACKTRACK, getTopDownMuzzleOrigin, getTopDownMuzzleOriginFromVector } from '../config';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { ShadowProjectileSample } from '../effects/ShadowConfig';
import type { ProjectileLightSample } from '../effects/LightingConfig';
import type { BulletRenderer } from '../effects/BulletRenderer';
import type { FlameRenderer } from '../effects/FlameRenderer';
import type { ProjectileBurnRenderer } from '../effects/ProjectileBurnRenderer';
import type { LeafBlowerRenderer } from '../effects/LeafBlowerRenderer';
import type { BfgRenderer } from '../effects/BfgRenderer';
import type { EnergyBallRenderer } from '../effects/EnergyBallRenderer';
import type { GaussRenderer } from '../effects/GaussRenderer';
import type { GrenadeRenderer } from '../effects/GrenadeRenderer';
import type { HydraRenderer } from '../effects/HydraRenderer';
import type { HolyGrenadeRenderer } from '../effects/HolyGrenadeRenderer';
import type { MuzzleFlashRenderer } from '../effects/MuzzleFlashRenderer';
import type { RocketRenderer } from '../effects/RocketRenderer';
import type { FireballRenderer } from '../effects/FireballRenderer';
import type { SporeRenderer } from '../effects/SporeRenderer';
import type { TracerRenderer } from '../effects/TracerRenderer';
import type { TranslocatorPuckRenderer } from '../effects/TranslocatorPuckRenderer';
import type { TeslaBoltRenderer } from '../effects/TeslaBoltRenderer';
import { registerGraphicsObject } from '../effects/EffectUtils';
import type {
  BulletVisualPreset,
  GrenadeVisualPreset,
  GroundFireVisualStyle,
  ProjectileSpawnConfig,
  ProjectileStyle,
  SyncedProjectile,
} from '../types';
import {
  ProjectileClientReplica,
  type ProjectileClientReplicaFrame,
  type ProjectileClientReplicaState,
} from './ProjectileClientReplica';

export type ProjectilePresentationState = Readonly<Pick<SyncedProjectile,
  'id'
  | 'ownerId'
  | 'x'
  | 'y'
  | 'vx'
  | 'vy'
  | 'size'
  | 'color'
  | 'ownerColor'
  | 'projectileVisualScale'
  | 'smokeTrailColor'
  | 'style'
  | 'sporeVisualVariant'
  | 'bulletVisualPreset'
  | 'grenadeVisualPreset'
  | 'energyBallVariant'
  | 'tracer'
  | 'shotAudioKey'
  | 'suppressSpawnFx'
  | 'miniRocketPhase'
  | 'miniRocketCascadeStage'
  | 'projectileBurnVisualStyle'
  | 'burning'>> & {
  readonly sourceTurretId?: string;
};

export interface ProjectilePresentationDespawnState extends ProjectilePresentationState {
  readonly pendingHydraSplit?: { readonly angles: number[] };
  readonly destroyX?: number;
  readonly destroyY?: number;
  readonly destroyScale?: number;
}

export interface ProjectilePresentationRenderers {
  readonly bullet: BulletRenderer;
  readonly projectileBurn: ProjectileBurnRenderer;
  readonly flame: FlameRenderer;
  readonly leafBlower: LeafBlowerRenderer;
  readonly bfg: BfgRenderer;
  readonly energyBall: EnergyBallRenderer;
  readonly hydra: HydraRenderer;
  readonly gauss: GaussRenderer;
  readonly holyGrenade: HolyGrenadeRenderer;
  readonly rocket: RocketRenderer;
  readonly fireball: FireballRenderer;
  readonly spore: SporeRenderer;
  readonly grenade: GrenadeRenderer;
  readonly translocatorPuck: TranslocatorPuckRenderer;
  readonly teslaBolt: TeslaBoltRenderer;
  readonly tracer: TracerRenderer;
  readonly muzzleFlash: MuzzleFlashRenderer;
}

/**
 * Presentation-Owner für Host- und Client-Projektile.
 *
 * Die Klasse liest entweder den autoritativen Host-Record oder die rendererfreie Client-Replica,
 * erzeugt aber selbst keine Gameplay-Entscheidung und schreibt keinen Runtime-State zurück.
 */
export class ProjectilePresentationRuntime {
  private readonly clientVisuals = new Map<number, Phaser.GameObjects.Shape>();
  private readonly shadowSamples: ShadowProjectileSample[] = [];
  private readonly lightSamples: ProjectileLightSample[] = [];
  private readonly activeBurningProjectileIds = new Set<number>();
  private ownerPositionProvider: ((ownerId: string) => { x: number; y: number } | null) | null = null;
  private audioSystem: GameAudioSystem | null = null;

  private bulletRenderer: BulletRenderer | null = null;
  private projectileBurnRenderer: ProjectileBurnRenderer | null = null;
  private flameRenderer: FlameRenderer | null = null;
  private leafBlowerRenderer: LeafBlowerRenderer | null = null;
  private bfgRenderer: BfgRenderer | null = null;
  private energyBallRenderer: EnergyBallRenderer | null = null;
  private hydraRenderer: HydraRenderer | null = null;
  private gaussRenderer: GaussRenderer | null = null;
  private holyGrenadeRenderer: HolyGrenadeRenderer | null = null;
  private rocketRenderer: RocketRenderer | null = null;
  private fireballRenderer: FireballRenderer | null = null;
  private sporeRenderer: SporeRenderer | null = null;
  private grenadeRenderer: GrenadeRenderer | null = null;
  private translocatorPuckRenderer: TranslocatorPuckRenderer | null = null;
  private teslaBoltRenderer: TeslaBoltRenderer | null = null;
  private tracerRenderer: TracerRenderer | null = null;
  private muzzleFlashRenderer: MuzzleFlashRenderer | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  bindRenderers(
    renderers: ProjectilePresentationRenderers,
    ownerPositionProvider: ((ownerId: string) => { x: number; y: number } | null) | null,
  ): void {
    this.bulletRenderer = renderers.bullet;
    this.projectileBurnRenderer = renderers.projectileBurn;
    this.flameRenderer = renderers.flame;
    this.leafBlowerRenderer = renderers.leafBlower;
    this.bfgRenderer = renderers.bfg;
    this.energyBallRenderer = renderers.energyBall;
    this.hydraRenderer = renderers.hydra;
    this.gaussRenderer = renderers.gauss;
    this.holyGrenadeRenderer = renderers.holyGrenade;
    this.rocketRenderer = renderers.rocket;
    this.fireballRenderer = renderers.fireball;
    this.sporeRenderer = renderers.spore;
    this.grenadeRenderer = renderers.grenade;
    this.translocatorPuckRenderer = renderers.translocatorPuck;
    this.teslaBoltRenderer = renderers.teslaBolt;
    this.tracerRenderer = renderers.tracer;
    this.muzzleFlashRenderer = renderers.muzzleFlash;
    this.ownerPositionProvider = ownerPositionProvider;
  }

  setAudioSystem(system: GameAudioSystem | null): void {
    this.audioSystem = system;
  }

  get clientVisualCount(): number {
    return this.clientVisuals.size;
  }

  registerFallbackShape(sprite: Phaser.GameObjects.Shape): void {
    if (sprite.visible !== false && sprite.alpha !== 0) {
      registerGraphicsObject(this.scene, 'projectileShapes', sprite);
    }
  }

  createSpawnRendererVisuals(
    id: number,
    sprite: Phaser.GameObjects.Shape,
    x: number,
    y: number,
    cfg: ProjectileSpawnConfig,
  ): void {
    const style = cfg.projectileStyle;
    if (style === 'bullet' && this.bulletRenderer) {
      sprite.setVisible(false); sprite.setAlpha(0);
      this.bulletRenderer.createVisual(id, x, y, cfg.size, cfg.color, resolveBulletVisualPreset(style, cfg.bulletVisualPreset), cfg.ownerColor ?? cfg.color);
    }
    if ((style === 'awp' || style === 'gauss') && this.bulletRenderer) {
      sprite.setVisible(false); sprite.setAlpha(0);
      this.bulletRenderer.createVisual(id, x, y, cfg.size, cfg.color, resolveBulletVisualPreset(style, cfg.bulletVisualPreset), cfg.ownerColor ?? cfg.color);
    }
    if (style === 'gauss' && this.gaussRenderer) this.gaussRenderer.createVisual(id, x, y, cfg.size, cfg.color);
    if (style === 'rocket' && this.rocketRenderer) {
      sprite.setVisible(false); sprite.setAlpha(0);
      this.rocketRenderer.createVisual(id, x, y, cfg.size, cfg.color, cfg.ownerColor ?? cfg.color, cfg.smokeTrailColor ?? cfg.color, cfg.projectileVisualScale);
    }
    if (style === 'fireball' && this.fireballRenderer) {
      sprite.setVisible(false); sprite.setAlpha(0); this.fireballRenderer.createVisual(id, x, y, cfg.size);
    }
    if (style === 'spore' && this.sporeRenderer) {
      sprite.setVisible(false); sprite.setAlpha(0); this.sporeRenderer.createVisual(id, x, y, cfg.size, cfg.color, cfg.sporeVisualVariant);
    }
    if (style === 'energy_ball' && this.energyBallRenderer) {
      sprite.setVisible(false); sprite.setAlpha(0); this.energyBallRenderer.createVisual(id, x, y, cfg.size, cfg.color, cfg.energyBallVariant);
    }
    if (style === 'hydra' && this.hydraRenderer) {
      sprite.setVisible(false); sprite.setAlpha(0); this.hydraRenderer.createVisual(id, x, y, cfg.size, cfg.color);
    }
    if (style === 'grenade' && this.grenadeRenderer) {
      sprite.setVisible(false); sprite.setAlpha(0); this.grenadeRenderer.createVisual(id, x, y, cfg.size, cfg.grenadeVisualPreset ?? 'he', cfg.ownerColor ?? cfg.color);
    }
    if (style === 'holy_grenade' && this.holyGrenadeRenderer) {
      sprite.setVisible(false); sprite.setAlpha(0); this.holyGrenadeRenderer.createVisual(id, x, y, cfg.size);
    }
    if (style === 'translocator_puck' && this.translocatorPuckRenderer) {
      sprite.setVisible(false); sprite.setAlpha(0); this.translocatorPuckRenderer.createVisual(id, x, y, cfg.ownerColor ?? cfg.color);
    }
    if (style === 'tesla_bolt' && this.teslaBoltRenderer) {
      sprite.setVisible(false); sprite.setAlpha(0); this.teslaBoltRenderer.createVisual(id, x, y, cfg.size, cfg.color);
    }
    if (style === 'flame' || style === 'leaf_blower' || style === 'bfg') {
      sprite.setVisible(false); sprite.setAlpha(0);
    }
  }

  createBfgVisual(id: number, x: number, y: number, size: number): void {
    this.bfgRenderer?.createVisual(id, x, y, size);
  }

  createSpawnFeedback(
    id: number,
    tracerX: number,
    tracerY: number,
    muzzleX: number,
    muzzleY: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
  ): void {
    if (cfg.tracerConfig) {
      this.tracerRenderer?.createTracer(id, tracerX, tracerY, cfg.tracerConfig, cfg.ownerColor ?? cfg.color);
    }
    if (cfg.suppressSpawnFx) return;
    const muzzleOrigin = cfg.visualMuzzleOrigin ?? getTopDownMuzzleOrigin(muzzleX, muzzleY, angle);
    this.muzzleFlashRenderer?.playProjectileFlash(
      muzzleOrigin.x,
      muzzleOrigin.y,
      Math.cos(angle) * cfg.speed,
      Math.sin(angle) * cfg.speed,
      cfg.projectileStyle,
      cfg.bulletVisualPreset,
      cfg.energyBallVariant,
      cfg.ownerColor ?? cfg.color,
    );
    this.audioSystem?.playSound(cfg.shotAudioKey, muzzleOrigin.x, muzzleOrigin.y, ownerId);
  }

  playBounceImpact(id: number, x: number, y: number, vx: number, vy: number, color: number, style?: ProjectileStyle): void {
    if (style === 'bullet' || style === 'awp' || style === 'gauss') {
      this.bulletRenderer?.playImpactSparks(id, x, y, vx, vy, color);
    }
  }

  destroyProjectileVisuals(projectile: ProjectilePresentationDespawnState): void {
    const destroyX = projectile.destroyX ?? projectile.x;
    const destroyY = projectile.destroyY ?? projectile.y;
    const destroyScale = projectile.destroyScale ?? projectile.size / 16;
    this.bulletRenderer?.destroyVisual(projectile.id);
    this.tracerRenderer?.destroyTracer(projectile.id);
    this.flameRenderer?.destroyVisual(projectile.id);
    this.projectileBurnRenderer?.destroyVisual(projectile.id);
    this.leafBlowerRenderer?.destroyVisual(projectile.id);
    this.bfgRenderer?.destroyVisual(projectile.id);
    this.gaussRenderer?.destroyVisual(projectile.id);
    if (projectile.style === 'energy_ball') {
      this.energyBallRenderer?.playImpact(destroyX, destroyY, projectile.color, projectile.energyBallVariant, destroyScale);
    }
    if (projectile.style === 'hydra') {
      if (projectile.pendingHydraSplit) {
        this.hydraRenderer?.playSplitImpact(destroyX, destroyY, projectile.color, projectile.pendingHydraSplit.angles, destroyScale);
      } else {
        this.hydraRenderer?.playImpact(destroyX, destroyY, projectile.color, Math.max(destroyScale, 0.95));
      }
    }
    if (projectile.style === 'spore') {
      this.sporeRenderer?.playImpact(destroyX, destroyY, projectile.color, Math.max(destroyScale, 0.9), projectile.sporeVisualVariant);
    }
    if (projectile.style === 'tesla_bolt') {
      this.teslaBoltRenderer?.playImpact(destroyX, destroyY, projectile.size, projectile.color);
    }
    this.hydraRenderer?.destroyVisual(projectile.id);
    this.energyBallRenderer?.destroyVisual(projectile.id);
    this.grenadeRenderer?.destroyVisual(projectile.id);
    this.holyGrenadeRenderer?.destroyVisual(projectile.id);
    this.rocketRenderer?.destroyVisual(projectile.id);
    this.fireballRenderer?.destroyVisual(projectile.id);
    this.sporeRenderer?.destroyVisual(projectile.id);
    this.translocatorPuckRenderer?.destroyVisual(projectile.id);
    this.teslaBoltRenderer?.destroyVisual(projectile.id);
  }

  syncHostRenderers(projectiles: readonly ProjectilePresentationState[]): void {
    const burningProjectiles = this.activeBurningProjectileIds;
    burningProjectiles.clear();
    for (const projectile of projectiles) {
      const id = projectile.id;
      const x = projectile.x;
      const y = projectile.y;
      const size = projectile.size;
      const vx = projectile.vx;
      const vy = projectile.vy;
      const style = projectile.style;
      const burning = projectile.burning === true;
      this.projectileBurnRenderer?.sync(id, x, y, size, burning, true, projectile.projectileBurnVisualStyle);
      if (burning) burningProjectiles.add(id);
      if (projectile.tracer) this.tracerRenderer?.updateTracer(id, x, y, vx, vy);
      if (style === 'bullet' || style === 'awp' || style === 'gauss') this.bulletRenderer?.syncToBody(id, x, y, vx, vy);
      switch (style) {
        case 'flame':
          if (this.flameRenderer) {
            if (!this.flameRenderer.has(id)) this.flameRenderer.createVisual(id, x, y, size, projectile.color, projectile.sourceTurretId ?? projectile.ownerId);
            this.flameRenderer.updateVisual(id, x, y, size, vx, vy);
          }
          break;
        case 'leaf_blower':
          if (this.leafBlowerRenderer) {
            if (!this.leafBlowerRenderer.has(id)) this.leafBlowerRenderer.createVisual(id, x, y, size);
            this.leafBlowerRenderer.updateVisual(id, x, y, size, vx, vy);
          }
          break;
        case 'bfg':
          if (this.bfgRenderer) {
            if (!this.bfgRenderer.has(id)) this.bfgRenderer.createVisual(id, x, y, size);
            this.bfgRenderer.updateVisual(id, x, y, size);
          }
          break;
        case 'gauss':
          if (this.gaussRenderer) {
            if (!this.gaussRenderer.has(id)) this.gaussRenderer.createVisual(id, x, y, size, projectile.color);
            this.gaussRenderer.updateVisual(id, x, y, size, vx, vy, projectile.color);
          }
          break;
        case 'energy_ball':
          if (this.energyBallRenderer) {
            if (!this.energyBallRenderer.has(id)) this.energyBallRenderer.createVisual(id, x, y, size, projectile.color, projectile.energyBallVariant);
            this.energyBallRenderer.updateVisual(id, x, y, size, vx, vy, projectile.color, projectile.energyBallVariant);
          }
          break;
        case 'hydra':
          if (this.hydraRenderer) {
            if (!this.hydraRenderer.has(id)) this.hydraRenderer.createVisual(id, x, y, size, projectile.color);
            this.hydraRenderer.updateVisual(id, x, y, size, vx, vy, projectile.color);
          }
          break;
        case 'holy_grenade':
          if (this.holyGrenadeRenderer) {
            if (!this.holyGrenadeRenderer.has(id)) this.holyGrenadeRenderer.createVisual(id, x, y, size);
            this.holyGrenadeRenderer.updateVisual(id, x, y, size, vx, vy);
          }
          break;
        case 'rocket':
          if (this.rocketRenderer) {
            if (!this.rocketRenderer.has(id)) this.rocketRenderer.createVisual(id, x, y, size, projectile.color, projectile.ownerColor ?? projectile.color, projectile.smokeTrailColor ?? projectile.color);
            this.rocketRenderer.updateVisual(id, x, y, size, vx, vy, projectile.miniRocketPhase, projectile.miniRocketCascadeStage);
          }
          break;
        case 'fireball':
          if (this.fireballRenderer) {
            if (!this.fireballRenderer.has(id)) this.fireballRenderer.createVisual(id, x, y, size);
            this.fireballRenderer.updateVisual(id, x, y, size, vx, vy);
          }
          break;
        case 'spore':
          if (this.sporeRenderer) {
            if (!this.sporeRenderer.has(id)) this.sporeRenderer.createVisual(id, x, y, size, projectile.color, projectile.sporeVisualVariant);
            this.sporeRenderer.updateVisual(id, x, y, size, vx, vy, projectile.color, projectile.sporeVisualVariant);
          }
          break;
        case 'grenade':
          if (this.grenadeRenderer) {
            if (!this.grenadeRenderer.has(id)) this.grenadeRenderer.createVisual(id, x, y, size, projectile.grenadeVisualPreset ?? 'he', projectile.ownerColor ?? projectile.color);
            this.grenadeRenderer.updateVisual(id, x, y, size, vx, vy);
          }
          break;
        case 'translocator_puck':
          if (this.translocatorPuckRenderer) {
            if (!this.translocatorPuckRenderer.has(id)) this.translocatorPuckRenderer.createVisual(id, x, y, projectile.ownerColor ?? projectile.color);
            this.translocatorPuckRenderer.updateVisual(id, x, y, projectile.ownerColor ?? projectile.color);
          }
          break;
        case 'tesla_bolt':
          if (this.teslaBoltRenderer) {
            if (!this.teslaBoltRenderer.has(id)) this.teslaBoltRenderer.createVisual(id, x, y, size, projectile.color);
            this.teslaBoltRenderer.updateVisual(id, x, y, size, vx, vy, projectile.color);
          }
          break;
        default:
          break;
      }
    }
    this.projectileBurnRenderer?.retain(burningProjectiles);
  }

  getShadowSamples(hostProjectiles: readonly ProjectilePresentationState[], replica: ProjectileClientReplica): readonly ShadowProjectileSample[] {
    const samples = this.shadowSamples;
    samples.length = 0;
    if (hostProjectiles.length > 0) {
      for (const projectile of hostProjectiles) {
        samples.push({ id: projectile.id, x: projectile.x, y: projectile.y, size: projectile.size, style: projectile.style });
      }
      return samples;
    }
    replica.readExtrapolated(performance.now(), ({ id, state, x, y }) => {
      samples.push({ id, x, y, size: state.size, style: state.style });
    });
    return samples;
  }

  getLightSamples(hostProjectiles: readonly ProjectilePresentationState[], replica: ProjectileClientReplica): readonly ProjectileLightSample[] {
    const samples = this.lightSamples;
    samples.length = 0;
    if (hostProjectiles.length > 0) {
      for (const projectile of hostProjectiles) {
        samples.push({ id: projectile.id, x: projectile.x, y: projectile.y, size: projectile.size, color: projectile.color, style: projectile.style, energyBallVariant: projectile.energyBallVariant, grenadeVisualPreset: projectile.grenadeVisualPreset });
      }
      return samples;
    }
    replica.readExtrapolated(performance.now(), ({ id, state, x, y }) => {
      samples.push({ id, x, y, size: state.size, color: state.color, style: state.style, energyBallVariant: state.energyBallVariant, grenadeVisualPreset: state.grenadeVisualPreset });
    });
    return samples;
  }

  presentClientFrame(frame: ProjectileClientReplicaFrame, localPlayerId?: string): void {
    const { projectiles: data, activeIds } = frame;
    this.cleanupOrphanedClientVisuals(data, activeIds, frame.removed, frame.newIds);
    const burningIds = new Set<number>();
    for (const update of frame.updates) {
      const { projectile: proj, velocityFlipped } = update;
      const bulletPreset = resolveBulletVisualPreset(proj.style, proj.bulletVisualPreset);
      if (velocityFlipped && this.tracerRenderer?.has(proj.id)) this.tracerRenderer.notifyBounce(proj.id, proj.x, proj.y);
      if (update.isNew && !proj.suppressSpawnFx) {
        const ownerPos = this.ownerPositionProvider?.(proj.ownerId) ?? null;
        const speed = Math.hypot(proj.vx, proj.vy);
        const flashOrigin = proj.visualMuzzleOrigin ?? (ownerPos
          ? getTopDownMuzzleOriginFromVector(ownerPos.x, ownerPos.y, proj.vx, proj.vy)
          : getTopDownMuzzleOriginFromVector(
              proj.x - (speed > 0.0001 ? (proj.vx / speed) * MUZZLE_PROJECTILE_FALLBACK_BACKTRACK : 0),
              proj.y - (speed > 0.0001 ? (proj.vy / speed) * MUZZLE_PROJECTILE_FALLBACK_BACKTRACK : 0),
              proj.vx,
              proj.vy,
            ));
        this.muzzleFlashRenderer?.playProjectileFlash(flashOrigin.x, flashOrigin.y, proj.vx, proj.vy, proj.style as ProjectileStyle | undefined, proj.bulletVisualPreset, proj.energyBallVariant, proj.ownerColor ?? proj.color);
        const isUtilityProjectile = proj.style === 'grenade' || proj.style === 'holy_grenade' || proj.style === 'bfg';
        if (proj.ownerId !== localPlayerId || isUtilityProjectile) this.audioSystem?.playSound(proj.shotAudioKey, flashOrigin.x, flashOrigin.y, proj.ownerId);
      }
      const id = proj.id;
      if (proj.style === 'bfg' && this.bfgRenderer) {
        if (!this.bfgRenderer.has(id)) this.bfgRenderer.createVisual(id, proj.x, proj.y, proj.size);
        this.bfgRenderer.updateVisual(id, proj.x, proj.y, proj.size);
      } else if (proj.style === 'holy_grenade' && this.holyGrenadeRenderer) {
        if (!this.holyGrenadeRenderer.has(id)) this.holyGrenadeRenderer.createVisual(id, proj.x, proj.y, proj.size);
        this.holyGrenadeRenderer.updateVisual(id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if (proj.style === 'energy_ball' && this.energyBallRenderer) {
        if (!this.energyBallRenderer.has(id)) this.energyBallRenderer.createVisual(id, proj.x, proj.y, proj.size, proj.color, proj.energyBallVariant);
        this.energyBallRenderer.updateVisual(id, proj.x, proj.y, proj.size, proj.vx, proj.vy, proj.color, proj.energyBallVariant);
      } else if (proj.style === 'hydra' && this.hydraRenderer) {
        if (!this.hydraRenderer.has(id)) this.hydraRenderer.createVisual(id, proj.x, proj.y, proj.size, proj.color);
        this.hydraRenderer.updateVisual(id, proj.x, proj.y, proj.size, proj.vx, proj.vy, proj.color);
      } else if (proj.style === 'spore' && this.sporeRenderer) {
        if (!this.sporeRenderer.has(id)) this.sporeRenderer.createVisual(id, proj.x, proj.y, proj.size, proj.color, proj.sporeVisualVariant);
        this.sporeRenderer.updateVisual(id, proj.x, proj.y, proj.size, proj.vx, proj.vy, proj.color, proj.sporeVisualVariant);
      } else if (proj.style === 'grenade' && this.grenadeRenderer) {
        if (!this.grenadeRenderer.has(id)) this.grenadeRenderer.createVisual(id, proj.x, proj.y, proj.size, proj.grenadeVisualPreset ?? 'he', proj.ownerColor ?? proj.color);
        this.grenadeRenderer.updateVisual(id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if (proj.style === 'translocator_puck' && this.translocatorPuckRenderer) {
        if (!this.translocatorPuckRenderer.has(id)) this.translocatorPuckRenderer.createVisual(id, proj.x, proj.y, proj.ownerColor ?? proj.color);
        this.translocatorPuckRenderer.updateVisual(id, proj.x, proj.y, proj.ownerColor ?? proj.color);
      } else if (proj.style === 'tesla_bolt' && this.teslaBoltRenderer) {
        if (!this.teslaBoltRenderer.has(id)) this.teslaBoltRenderer.createVisual(id, proj.x, proj.y, proj.size, proj.color);
        this.teslaBoltRenderer.updateVisual(id, proj.x, proj.y, proj.size, proj.vx, proj.vy, proj.color);
      } else if (proj.style === 'fireball' && this.fireballRenderer) {
        if (!this.fireballRenderer.has(id)) this.fireballRenderer.createVisual(id, proj.x, proj.y, proj.size);
        this.fireballRenderer.updateVisual(id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if (proj.style === 'rocket' && this.rocketRenderer) {
        if (!this.rocketRenderer.has(id)) this.rocketRenderer.createVisual(id, proj.x, proj.y, proj.size, proj.color, proj.ownerColor ?? proj.color, proj.smokeTrailColor ?? proj.color, proj.projectileVisualScale);
        this.rocketRenderer.updateVisual(id, proj.x, proj.y, proj.size, proj.vx, proj.vy, proj.miniRocketPhase, proj.miniRocketCascadeStage);
      } else if (proj.style === 'leaf_blower' && this.leafBlowerRenderer) {
        if (!this.leafBlowerRenderer.has(id)) this.leafBlowerRenderer.createVisual(id, proj.x, proj.y, proj.size);
        this.leafBlowerRenderer.updateVisual(id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if (proj.style === 'flame' && this.flameRenderer) {
        if (!this.flameRenderer.has(id)) this.flameRenderer.createVisual(id, proj.x, proj.y, proj.size, proj.color, proj.ownerId);
        this.flameRenderer.updateVisual(id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if ((proj.style === 'awp' || proj.style === 'gauss') && this.bulletRenderer) {
        if (!this.bulletRenderer.has(id)) this.bulletRenderer.createVisual(id, proj.x, proj.y, proj.size, proj.color, bulletPreset, proj.ownerColor ?? proj.color);
        this.bulletRenderer.syncToBody(id, proj.x, proj.y, proj.vx, proj.vy);
        if (velocityFlipped) this.bulletRenderer.playImpactSparks(id, proj.x, proj.y, proj.vx, proj.vy, proj.color);
      } else if (proj.style === 'bullet' && this.bulletRenderer) {
        if (!this.bulletRenderer.has(id)) this.bulletRenderer.createVisual(id, proj.x, proj.y, proj.size, proj.color, bulletPreset, proj.ownerColor ?? proj.color);
        this.bulletRenderer.updatePosition(id, proj.x, proj.y, proj.vx, proj.vy);
        if (velocityFlipped) this.bulletRenderer.playImpactSparks(id, proj.x, proj.y, proj.vx, proj.vy, proj.color);
      } else {
        let sprite = this.clientVisuals.get(id);
        if (!sprite) {
          const isBall = proj.style === 'ball' || proj.style === 'hydra';
          sprite = isBall ? this.scene.add.circle(proj.x, proj.y, proj.size / 2, proj.color) : this.scene.add.rectangle(proj.x, proj.y, proj.size, proj.size, proj.color);
          sprite.setDepth(DEPTH.PROJECTILES);
          registerGraphicsObject(this.scene, 'projectileShapes', sprite);
          this.clientVisuals.set(id, sprite);
        } else sprite.setPosition(proj.x, proj.y);
      }
      if (proj.tracer && this.tracerRenderer) {
        if (!this.tracerRenderer.has(id)) this.tracerRenderer.createTracer(id, proj.x, proj.y, proj.tracer, proj.ownerColor ?? proj.color);
        this.tracerRenderer.updateTracer(id, proj.x, proj.y, proj.vx, proj.vy);
      }
      this.projectileBurnRenderer?.sync(id, proj.x, proj.y, proj.size, proj.burning === true, false, proj.projectileBurnVisualStyle);
      if (proj.burning) burningIds.add(id);
    }
    this.projectileBurnRenderer?.retain(burningIds);
  }

  private cleanupOrphanedClientVisuals(
    data: readonly SyncedProjectile[],
    activeIds: ReadonlySet<number>,
    removedStates: ReadonlyMap<number, ProjectileClientReplicaState>,
    newProjectileIds: ReadonlySet<number>,
  ): void {
    const incomingHydras = data.filter((projectile) => projectile.style === 'hydra');
    const newIncomingHydraIds = new Set(incomingHydras.filter((projectile) => newProjectileIds.has(projectile.id)).map((projectile) => projectile.id));
    for (const [id, sprite] of this.clientVisuals) {
      if (!activeIds.has(id)) { sprite.destroy(); this.clientVisuals.delete(id); }
    }
    const destroyMissing = <T extends { getActiveIds(): Iterable<number>; destroyVisual(id: number): void }>(renderer: T | null): void => {
      if (!renderer) return;
      for (const id of renderer.getActiveIds()) if (!activeIds.has(id)) renderer.destroyVisual(id);
    };
    destroyMissing(this.bulletRenderer);
    destroyMissing(this.flameRenderer);
    destroyMissing(this.leafBlowerRenderer);
    destroyMissing(this.rocketRenderer);
    destroyMissing(this.fireballRenderer);
    destroyMissing(this.grenadeRenderer);
    destroyMissing(this.holyGrenadeRenderer);
    destroyMissing(this.translocatorPuckRenderer);
    destroyMissing(this.bfgRenderer);
    if (this.sporeRenderer) for (const id of this.sporeRenderer.getActiveIds()) if (!activeIds.has(id)) {
      const state = removedStates.get(id);
      if (state?.style === 'spore') this.sporeRenderer.playImpact(state.serverX, state.serverY, state.color, Math.max(state.size / 16, 0.9));
      this.sporeRenderer.destroyVisual(id);
    }
    if (this.energyBallRenderer) for (const id of this.energyBallRenderer.getActiveIds()) if (!activeIds.has(id)) {
      const state = removedStates.get(id);
      if (state?.style === 'energy_ball') this.energyBallRenderer.playImpact(state.serverX, state.serverY, state.color, state.energyBallVariant, state.size / 16);
      this.energyBallRenderer.destroyVisual(id);
    }
    if (this.hydraRenderer) for (const id of this.hydraRenderer.getActiveIds()) if (!activeIds.has(id)) {
      const state = removedStates.get(id);
      if (state?.style === 'hydra') {
        const splitChildren = incomingHydras.filter((projectile) => newIncomingHydraIds.has(projectile.id) && projectile.suppressSpawnFx).filter((projectile) => projectile.color === state.color).filter((projectile) => Phaser.Math.Distance.Between(state.serverX, state.serverY, projectile.x, projectile.y) <= Math.max(state.size * 1.5, 22)).map((projectile) => Math.atan2(projectile.vy, projectile.vx));
        if (splitChildren.length > 0) this.hydraRenderer.playSplitImpact(state.serverX, state.serverY, state.color, splitChildren, Math.max(state.size / 16, 0.95));
        else this.hydraRenderer.playImpact(state.serverX, state.serverY, state.color, Math.max(state.size / 16, 0.95));
      }
      this.hydraRenderer.destroyVisual(id);
    }
    if (this.teslaBoltRenderer) for (const id of this.teslaBoltRenderer.getActiveIds()) if (!activeIds.has(id)) {
      const state = removedStates.get(id);
      if (state?.style === 'tesla_bolt') this.teslaBoltRenderer.playImpact(state.serverX, state.serverY, state.size, state.color);
      this.teslaBoltRenderer.destroyVisual(id);
    }
    if (this.tracerRenderer) for (const id of this.tracerRenderer.getActiveIds()) if (!activeIds.has(id)) this.tracerRenderer.destroyTracer(id);
  }

  extrapolateClient(replica: ProjectileClientReplica, now = performance.now()): void {
    replica.readExtrapolated(now, ({ id, state, x, y, velocityX, velocityY }) => {
      if (state.style === 'bfg' && this.bfgRenderer?.has(id)) this.bfgRenderer.updateVisual(id, x, y, state.size);
      else if (state.style === 'gauss' && this.gaussRenderer?.has(id)) this.gaussRenderer.updateVisual(id, x, y, state.size, velocityX, velocityY, state.color);
      else if (state.style === 'grenade' && this.grenadeRenderer?.has(id)) this.grenadeRenderer.updateVisual(id, x, y, state.size, velocityX, velocityY);
      else if (state.style === 'holy_grenade' && this.holyGrenadeRenderer?.has(id)) this.holyGrenadeRenderer.updateVisual(id, x, y, state.size, velocityX, velocityY);
      else if (state.style === 'energy_ball' && this.energyBallRenderer?.has(id)) this.energyBallRenderer.updateVisual(id, x, y, state.size, velocityX, velocityY, state.color, state.energyBallVariant);
      else if (state.style === 'hydra' && this.hydraRenderer?.has(id)) this.hydraRenderer.updateVisual(id, x, y, state.size, velocityX, velocityY, state.color);
      else if (state.style === 'spore' && this.sporeRenderer?.has(id)) this.sporeRenderer.updateVisual(id, x, y, state.size, velocityX, velocityY, state.color, state.sporeVisualVariant);
      else if (state.style === 'translocator_puck' && this.translocatorPuckRenderer?.has(id)) this.translocatorPuckRenderer.updateVisual(id, x, y, state.ownerColor ?? state.color);
      else if (state.style === 'tesla_bolt' && this.teslaBoltRenderer?.has(id)) this.teslaBoltRenderer.updateVisual(id, x, y, state.size, velocityX, velocityY, state.color);
      else if (state.style === 'rocket' && this.rocketRenderer?.has(id)) this.rocketRenderer.updateVisual(id, x, y, state.size, velocityX, velocityY, state.miniRocketPhase, state.miniRocketCascadeStage);
      else if (state.style === 'fireball' && this.fireballRenderer?.has(id)) this.fireballRenderer.updateVisual(id, x, y, state.size, velocityX, velocityY);
      else if (state.style === 'leaf_blower' && this.leafBlowerRenderer?.has(id)) this.leafBlowerRenderer.updateVisual(id, x, y, state.size, velocityX, velocityY);
      else if (state.style === 'flame' && this.flameRenderer?.has(id)) this.flameRenderer.updateVisual(id, x, y, state.size, velocityX, velocityY);
      else if ((state.style === 'awp' || state.style === 'gauss') && this.bulletRenderer?.has(id)) this.bulletRenderer.syncToBody(id, x, y, velocityX, velocityY);
      else if (state.style === 'bullet' && this.bulletRenderer?.has(id)) this.bulletRenderer.updatePosition(id, x, y, velocityX, velocityY);
      else this.clientVisuals.get(id)?.setPosition(x, y);
      if (this.tracerRenderer?.has(id)) this.tracerRenderer.updateTracer(id, x, y, velocityX, velocityY);
      this.projectileBurnRenderer?.sync(id, x, y, state.size, state.burning, true, state.projectileBurnVisualStyle);
    });
  }

  releaseWorldPresentation(): void {
    this.activeBurningProjectileIds.clear();
    this.shadowSamples.length = 0;
    this.lightSamples.length = 0;
    this.bulletRenderer?.destroyAll();
    this.tracerRenderer?.destroyAll();
    this.flameRenderer?.destroyAll();
    this.projectileBurnRenderer?.destroyAll();
    this.leafBlowerRenderer?.destroyAll();
    this.bfgRenderer?.destroyAll();
    this.gaussRenderer?.destroyAll();
    this.energyBallRenderer?.destroyAll();
    this.hydraRenderer?.destroyAll();
    this.grenadeRenderer?.destroyAll();
    this.holyGrenadeRenderer?.destroyAll();
    this.rocketRenderer?.destroyAll();
    this.fireballRenderer?.destroyAll();
    this.sporeRenderer?.destroyAll();
    this.translocatorPuckRenderer?.destroyAll();
    this.teslaBoltRenderer?.destroyAll();
    for (const sprite of this.clientVisuals.values()) sprite.destroy();
    this.clientVisuals.clear();
  }
}

function resolveBulletVisualPreset(style?: string, preset?: BulletVisualPreset): BulletVisualPreset {
  if (preset) return preset;
  if (style === 'gauss') return 'gauss';
  return style === 'awp' ? 'awp' : 'default';
}
