import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { PlayerManager } from '../entities/PlayerManager';
import type { FireChunkTarget, PlayerNetState, SyncedBurningGroundCell, SyncedBurningGroundSnapshot } from '../types';
import { createEmitter, destroyEmitter, ensureCanvasTexture } from './EffectUtils';
import { addInternalBlur, addInternalGlow, setInternalFxPadding } from '../utils/phaserFx';
import {
  ensureFlameTextures,
  FLAME_COLORS_CORE,
  FLAME_COLORS_OUTER,
  FLAME_COLORS_SPARK,
  TEX_FLAME_CORE,
  TEX_FLAME_EMBER,
  TEX_FLAME_SPARK,
} from './FlameShared';
import { GROUND_FIRE_CELL_SIZE } from './FireSystem';

const TEX_GROUND_HEAT = '__ground_fire_heat_haze';
const TEX_GROUND_SMOKE = '__ground_fire_smoke';
const GROUND_DEPTH = DEPTH.ROCKS - 0.24;
const GROUND_PARTICLE_DEPTH = DEPTH.FIRE - 0.18;
const RING_PARTICLE_DEPTH = DEPTH.FIRE + 0.12;
const MAX_GROUND_EMISSIONS_PER_SECOND = 720;
const RING_BAND_THICKNESS = 16;
const RING_CORE_THICKNESS = 7;
const RING_POINT_SPACING = 4;
const RING_BAND_REFRESH_MS = 430;
const RING_CORE_REFRESH_MS = 260;
const RING_BAND_FREQUENCY_MS = 16;
const RING_ACCENT_RATE_AT_BASE_RADIUS = 88;
const RING_BASE_RADIUS = 64;
const RING_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TWO_PI = Math.PI * 2;

interface GroundVisual {
  image: Phaser.GameObjects.Image;
  expiresAt: number;
  intensity: number;
  phase: number;
}

interface RingVisual {
  radius: number;
  phase: number;
  bandEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  coreEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  accentAccumulator: number;
  accentCursor: number;
}

interface RingParticleProfile {
  size: number;
  intensity: number;
  heat: number;
}

/**
 * Phaser EdgeZone source for a dense annulus. Points are deliberately returned in
 * a low-discrepancy order, so even a short emission window covers the full ring
 * instead of drawing a visible clockwise or counter-clockwise sweep.
 */
class RingBandEdgeSource implements Phaser.Types.GameObjects.Particles.EdgeZoneSource {
  constructor(
    private readonly radius: number,
    private readonly thickness: number,
    private readonly phase: number,
  ) {}

  getPoints(quantity: number): Phaser.Types.Math.Vector2Like[] {
    const count = Math.max(8, Math.floor(quantity));
    const points: Phaser.Types.Math.Vector2Like[] = [];
    const halfBand = this.thickness * 0.5;

    for (let index = 0; index < count; index += 1) {
      const angle = this.phase + index * RING_GOLDEN_ANGLE;
      const layer = (index & 1) === 0 ? -0.46 : 0.46;
      const fineJitter = Math.sin(index * 1.713 + this.phase * 3.1) * halfBand * 0.08;
      const pointRadius = this.radius + layer * halfBand + fineJitter;
      points.push({
        x: Math.cos(angle) * pointRadius,
        y: Math.sin(angle) * pointRadius,
      });
    }

    return points;
  }
}

/** Zero-mean curl-like acceleration. It breaks straight particle paths without a global orbit. */
class RingTurbulenceProcessor extends Phaser.GameObjects.Particles.ParticleProcessor {
  constructor(private readonly strength: number) {
    super();
  }

  update(
    particle: Phaser.GameObjects.Particles.Particle,
    _delta: number,
    step: number,
    t: number,
  ): void {
    const phase = particle.x * 0.071 + particle.y * 0.053 + particle.life * 0.0017 + t * 10.4;
    particle.velocityX += Math.cos(phase * 1.37) * this.strength * step;
    particle.velocityY += Math.sin(phase * 1.11) * this.strength * step;
  }
}

/**
 * Gemeinsamer Partikelrenderer fuer das 16-Pixel-Brandraster und Flammenringe.
 * Weit ueberlappende, weiche Heat-Haze-Decals verbinden Nachbarzellen; die
 * sichtbaren Flammen, Glut und Funken stammen aus wenigen gepoolten Emittern.
 */
export class FlamethrowerUpgradeRenderer {
  private readonly ground = new Map<string, GroundVisual>();
  private readonly groundImagePool: Phaser.GameObjects.Image[] = [];
  private readonly flyingChunks = new Set<Phaser.GameObjects.Image>();
  private readonly ringRadii = new Map<string, number>();
  private readonly ringVisuals = new Map<string, RingVisual>();
  private readonly groundCore: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly groundOuter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly groundSparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly groundSmoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly ringFlames: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly ringSparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private cells: readonly SyncedBurningGroundCell[] = [];
  private groundAccumulator = 0;
  private previousNow = 0;
  private lastUpdateMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly playerManager: PlayerManager,
  ) {
    ensureFlameTextures(scene);
    this.ensureHeatTexture();
    this.ensureSmokeTexture();
    this.groundCore = this.createCoreEmitter(GROUND_PARTICLE_DEPTH + 0.05);
    this.groundOuter = this.createOuterEmitter(GROUND_PARTICLE_DEPTH);
    this.groundSparks = this.createSparkEmitter(GROUND_PARTICLE_DEPTH + 0.1, false);
    this.groundSmoke = this.createSmokeEmitter(GROUND_PARTICLE_DEPTH - 0.08);
    this.ringFlames = this.createRingFlameEmitter(RING_PARTICLE_DEPTH + 0.04);
    this.ringSparks = this.createSparkEmitter(RING_PARTICLE_DEPTH + 0.1, true);
    this.ringFlames.addParticleProcessor(new RingTurbulenceProcessor(32));
    this.ringSparks.addParticleProcessor(new RingTurbulenceProcessor(54));
    setInternalFxPadding(this.ringFlames, 10);
    addInternalGlow(this.ringFlames, 0xff7b21, 1.45, 0.2, false, 0.1, 5);
  }

  syncGround(snapshot: SyncedBurningGroundSnapshot): void {
    this.cells = snapshot.cells;
    const blocks = new Map<string, { x: number; y: number; expiresAt: number; intensity: number; seed: number }>();
    for (const cell of snapshot.cells) {
      const blockX = Math.floor(cell.gridX / 2);
      const blockY = Math.floor(cell.gridY / 2);
      const key = `${blockX}:${blockY}`;
      const current = blocks.get(key);
      if (current) {
        current.expiresAt = Math.max(current.expiresAt, cell.expiresAt);
        current.intensity += Math.max(1, cell.intensity);
      } else {
        blocks.set(key, {
          x: (blockX * 2 + 1) * GROUND_FIRE_CELL_SIZE,
          y: (blockY * 2 + 1) * GROUND_FIRE_CELL_SIZE,
          expiresAt: cell.expiresAt,
          intensity: Math.max(1, cell.intensity),
          seed: (blockX * 73856093) ^ (blockY * 19349663),
        });
      }
    }
    for (const [key, visual] of this.ground) {
      if (!blocks.has(key)) this.releaseGroundVisual(key, visual);
    }

    for (const [key, block] of blocks) {
      let visual = this.ground.get(key);
      if (!visual) {
        const image = this.groundImagePool.pop()
          ?? this.scene.add.image(0, 0, TEX_GROUND_HEAT);
        const phase = this.seededUnit(block.seed, 17) * Math.PI * 2;
        image
          .setPosition(
            block.x + (this.seededUnit(block.seed, 31) - 0.5) * GROUND_FIRE_CELL_SIZE * 0.65,
            block.y + (this.seededUnit(block.seed, 47) - 0.5) * GROUND_FIRE_CELL_SIZE * 0.6,
          )
          .setDepth(GROUND_DEPTH)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setRotation(phase)
          .setVisible(true)
          .setActive(true);
        visual = { image, expiresAt: block.expiresAt, intensity: block.intensity, phase };
        this.ground.set(key, visual);
      }
      visual.expiresAt = block.expiresAt;
      visual.intensity = block.intensity;
    }
  }

  playFireChunkBurst(x: number, y: number, targets: readonly FireChunkTarget[], landsAt: number, now = Date.now()): void {
    const duration = Phaser.Math.Clamp(landsAt - now, 80, 420);
    for (const target of targets) {
      const chunk = this.scene.add.image(x, y, TEX_FLAME_EMBER)
        .setDepth(DEPTH.PROJECTILES + 0.4)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(Phaser.Utils.Array.GetRandom([...FLAME_COLORS_OUTER]))
        .setScale(0.72);
      this.flyingChunks.add(chunk);
      const arc = Phaser.Math.Between(22, 46);
      this.scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration,
        ease: 'Sine.easeInOut',
        onUpdate: tween => {
          if (!chunk.active) return;
          const t = tween.getValue() ?? 0;
          chunk.setPosition(
            Phaser.Math.Linear(x, target.x, t),
            Phaser.Math.Linear(y, target.y, t) - Math.sin(t * Math.PI) * arc,
          );
          chunk.setRotation(t * Math.PI * 4);
          chunk.setScale(0.72 + Math.sin(t * Math.PI) * 0.28);
        },
        onComplete: () => {
          const shouldLand = chunk.active;
          this.flyingChunks.delete(chunk);
          chunk.destroy();
          if (!shouldLand) return;
          this.groundOuter.emitParticleAt(target.x, target.y, 3);
          this.groundCore.emitParticleAt(target.x, target.y, 2);
          this.groundSparks.emitParticleAt(target.x, target.y, 3);
        },
      });
    }
  }

  syncRings(players: Readonly<Record<string, PlayerNetState>>): void {
    this.ringRadii.clear();
    for (const [playerId, state] of Object.entries(players)) {
      if ((state.flameRingRadius ?? 0) > 0 && state.alive && !state.isBurrowed) {
        this.ringRadii.set(playerId, state.flameRingRadius ?? 0);
      }
    }

    for (const [playerId, visual] of this.ringVisuals) {
      if (!this.ringRadii.has(playerId)) this.destroyRingVisual(playerId, visual);
    }
  }

  update(now: number): void {
    const updateStartedAt = performance.now();
    const delta = this.previousNow > 0 ? Phaser.Math.Clamp(now - this.previousNow, 0, 100) : 16.67;
    this.previousNow = now;

    for (const [id, visual] of this.ground) {
      const remaining = visual.expiresAt - now;
      if (remaining <= 0) {
        this.releaseGroundVisual(id, visual);
        continue;
      }
      const intensity = Phaser.Math.Clamp(Math.log2(visual.intensity + 1) / 3, 0.28, 1);
      const fade = Phaser.Math.Clamp(remaining / 420, 0, 1);
      const breathe = 1 + Math.sin(now * 0.0022 + visual.phase) * 0.055;
      const baseScale = (GROUND_FIRE_CELL_SIZE * (3.7 + intensity * 0.52)) / 96;
      visual.image
        .setScale(baseScale * breathe, baseScale * (0.88 + Math.cos(now * 0.0017 + visual.phase) * 0.045))
        .setRotation(visual.phase + Math.sin(now * 0.00045 + visual.phase) * 0.08)
        .setAlpha((0.12 + intensity * 0.24) * fade)
        .setTint(intensity > 0.72 ? 0xff9a32 : 0xd94a1f);
    }

    this.emitGroundParticles(delta);
    this.updateRingVisuals(delta, now);
    this.lastUpdateMs = performance.now() - updateStartedAt;
  }

  getLastUpdateCostMs(): number { return this.lastUpdateMs; }

  clear(): void {
    this.cells = [];
    for (const [id, visual] of this.ground) this.releaseGroundVisual(id, visual);
    this.ringRadii.clear();
    for (const [playerId, visual] of this.ringVisuals) this.destroyRingVisual(playerId, visual);
    this.groundAccumulator = 0;
    this.previousNow = 0;
    this.lastUpdateMs = 0;
    this.groundCore.killAll();
    this.groundOuter.killAll();
    this.groundSparks.killAll();
    this.groundSmoke.killAll();
    this.ringFlames.killAll();
    this.ringSparks.killAll();
    for (const chunk of this.flyingChunks) {
      this.scene.tweens.killTweensOf(chunk);
      chunk.destroy();
    }
    this.flyingChunks.clear();
  }

  destroyAll(): void {
    this.clear();
    for (const image of this.groundImagePool) image.destroy();
    this.groundImagePool.length = 0;
    destroyEmitter(this.groundCore);
    destroyEmitter(this.groundOuter);
    destroyEmitter(this.groundSparks);
    destroyEmitter(this.groundSmoke);
    destroyEmitter(this.ringFlames);
    destroyEmitter(this.ringSparks);
  }

  private emitGroundParticles(delta: number): void {
    if (this.cells.length === 0) return;
    const intensitySum = this.cells.reduce((sum, cell) => sum + Math.min(4, Math.max(1, cell.intensity)), 0);
    const rate = Math.min(MAX_GROUND_EMISSIONS_PER_SECOND, 30 + intensitySum * 1.8);
    this.groundAccumulator += delta * rate / 1000;
    let emissions = Math.min(32, Math.floor(this.groundAccumulator));
    this.groundAccumulator -= emissions;

    while (emissions-- > 0 && this.cells.length > 0) {
      let cell = Phaser.Utils.Array.GetRandom(this.cells as SyncedBurningGroundCell[]);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const candidate = Phaser.Utils.Array.GetRandom(this.cells as SyncedBurningGroundCell[]);
        if (candidate.intensity > cell.intensity && Math.random() < 0.7) cell = candidate;
      }
      const intensity = Math.max(1, cell.intensity);
      const x = (cell.gridX + 0.5) * GROUND_FIRE_CELL_SIZE
        + Phaser.Math.FloatBetween(-GROUND_FIRE_CELL_SIZE * 0.72, GROUND_FIRE_CELL_SIZE * 0.72);
      const y = (cell.gridY + 0.5) * GROUND_FIRE_CELL_SIZE
        + Phaser.Math.FloatBetween(-GROUND_FIRE_CELL_SIZE * 0.58, GROUND_FIRE_CELL_SIZE * 0.58);
      this.groundOuter.emitParticleAt(x, y, intensity >= 3 ? 2 : 1);
      if (Math.random() < 0.55 || intensity >= 2) this.groundCore.emitParticleAt(x, y + 2, 1);
      if (Math.random() < Math.min(0.42, 0.08 + intensity * 0.07)) {
        this.groundSparks.emitParticleAt(x, y, 1);
      }
      if (Math.random() < 0.12) this.groundSmoke.emitParticleAt(x, y - 3, 1);
    }
  }

  private updateRingVisuals(delta: number, now: number): void {
    for (const [playerId, radius] of this.ringRadii) {
      const player = this.playerManager.getPlayer(playerId);
      if (!player) continue;

      let visual = this.ringVisuals.get(playerId);
      if (!visual) {
        visual = this.createRingVisual(playerId, radius, player.sprite.x, player.sprite.y);
        this.ringVisuals.set(playerId, visual);
      } else if (Math.abs(visual.radius - radius) > 0.01) {
        this.updateRingVisualRadius(visual, radius);
      }

      const visible = player.sprite.visible;
      visual.bandEmitter
        .setPosition(player.sprite.x, player.sprite.y)
        .setVisible(visible);
      visual.coreEmitter
        .setPosition(player.sprite.x, player.sprite.y)
        .setVisible(visible);
      visual.bandEmitter.emitting = visible;
      visual.coreEmitter.emitting = visible;
      if (!visible) continue;

      this.emitRingAccents(visual, player.sprite.x, player.sprite.y, delta, now);
    }
  }

  private createRingVisual(playerId: string, radius: number, x: number, y: number): RingVisual {
    const phase = this.seededUnit(this.hashString(playerId), 83) * TWO_PI;
    const bandProfiles = new WeakMap<Phaser.GameObjects.Particles.Particle, RingParticleProfile>();
    const getBandProfile = (
      particle: Phaser.GameObjects.Particles.Particle,
      refresh = false,
    ): RingParticleProfile => {
      let profile = bandProfiles.get(particle);
      if (!profile || refresh) {
        profile = this.sampleRingParticleProfile(particle, phase, 0.37);
        bandProfiles.set(particle, profile);
      }
      return profile;
    };
    const bandEmitter = createEmitter(this.scene, x, y, TEX_FLAME_EMBER, {
      lifespan: { min: 420, max: 650 },
      frequency: RING_BAND_FREQUENCY_MS,
      quantity: this.getRingBandEmissionQuantity(radius),
      speedX: { min: -5, max: 5 },
      speedY: { min: -5, max: 5 },
      scaleX: {
        onEmit: particle => particle ? 1.02 * getBandProfile(particle, true).size : 1.02,
        onUpdate: (particle, _key, t) => Phaser.Math.Linear(1.02, 0.62, Phaser.Math.Easing.Sine.Out(t))
          * getBandProfile(particle).size,
      },
      scaleY: {
        onEmit: particle => particle ? 0.88 * getBandProfile(particle).size : 0.88,
        onUpdate: (particle, _key, t) => Phaser.Math.Linear(0.88, 0.52, Phaser.Math.Easing.Sine.Out(t))
          * getBandProfile(particle).size,
      },
      alpha: {
        onEmit: particle => particle ? 0.7 * getBandProfile(particle).intensity : 0.7,
        onUpdate: (particle, _key, t) => 0.7 * getBandProfile(particle).intensity
          * (1 - Phaser.Math.Easing.Quadratic.In(t)),
      },
      tint: (particle?: Phaser.GameObjects.Particles.Particle) => particle
        ? this.getRingOuterTint(getBandProfile(particle).heat)
        : 0xff7b21,
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: this.getRingBandPoolSize(radius),
      maxAliveParticles: this.getRingBandPoolSize(radius),
      reserve: this.getRingBandReserve(radius),
      emitting: true,
      emitZone: this.createRingBandZone(radius, phase),
    }, RING_PARTICLE_DEPTH);

    bandEmitter.onParticleEmit((particle) => {
      const tangentAngle = Math.atan2(particle.y, particle.x) + Math.PI * 0.5;
      particle.rotation = tangentAngle + Phaser.Math.FloatBetween(-0.08, 0.08);
      particle.angle = Phaser.Math.RadToDeg(particle.rotation);
    });
    bandEmitter.addParticleProcessor(new RingTurbulenceProcessor(8));
    setInternalFxPadding(bandEmitter, 14);
    addInternalBlur(bandEmitter, 1, 1.15, 1.15, 1, 0xff5b18, 1);
    addInternalGlow(bandEmitter, 0xff4d18, 1.9, 0.2, false, 0.1, 7);
    bandEmitter.fastForward(650, 16.67);

    const coreProfiles = new WeakMap<Phaser.GameObjects.Particles.Particle, RingParticleProfile>();
    const getCoreProfile = (
      particle: Phaser.GameObjects.Particles.Particle,
      refresh = false,
    ): RingParticleProfile => {
      let profile = coreProfiles.get(particle);
      if (!profile || refresh) {
        profile = this.sampleRingParticleProfile(particle, phase, 0.52);
        coreProfiles.set(particle, profile);
      }
      return profile;
    };
    const coreEmitter = createEmitter(this.scene, x, y, TEX_FLAME_CORE, {
      lifespan: { min: 220, max: 380 },
      frequency: RING_BAND_FREQUENCY_MS,
      quantity: this.getRingCoreEmissionQuantity(radius),
      speedX: { min: -4, max: 4 },
      speedY: { min: -4, max: 4 },
      scaleX: {
        onEmit: particle => particle ? 0.62 * getCoreProfile(particle, true).size : 0.62,
        onUpdate: (particle, _key, t) => Phaser.Math.Linear(0.62, 0.36, Phaser.Math.Easing.Sine.Out(t))
          * getCoreProfile(particle).size,
      },
      scaleY: {
        onEmit: particle => particle ? 0.3 * getCoreProfile(particle).size : 0.3,
        onUpdate: (particle, _key, t) => Phaser.Math.Linear(0.3, 0.15, Phaser.Math.Easing.Sine.Out(t))
          * getCoreProfile(particle).size,
      },
      alpha: {
        onEmit: particle => particle ? 0.82 * getCoreProfile(particle).intensity : 0.82,
        onUpdate: (particle, _key, t) => 0.82 * getCoreProfile(particle).intensity
          * (1 - Phaser.Math.Easing.Quadratic.In(t)),
      },
      tint: (particle?: Phaser.GameObjects.Particles.Particle) => particle
        ? this.getRingCoreTint(getCoreProfile(particle).heat)
        : 0xffe36b,
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: this.getRingCorePoolSize(radius),
      maxAliveParticles: this.getRingCorePoolSize(radius),
      reserve: this.getRingCoreReserve(radius),
      emitting: true,
      emitZone: this.createRingBandZone(radius, phase, RING_CORE_THICKNESS),
    }, RING_PARTICLE_DEPTH + 0.02);

    coreEmitter.onParticleEmit((particle) => {
      const tangentAngle = Math.atan2(particle.y, particle.x) + Math.PI * 0.5;
      particle.rotation = tangentAngle + Phaser.Math.FloatBetween(-0.06, 0.06);
      particle.angle = Phaser.Math.RadToDeg(particle.rotation);
    });
    coreEmitter.addParticleProcessor(new RingTurbulenceProcessor(6));
    setInternalFxPadding(coreEmitter, 10);
    addInternalBlur(coreEmitter, 0, 0.45, 0.45, 1, 0xffd34f, 1);
    addInternalGlow(coreEmitter, 0xffb12e, 1.15, 0.28, false, 0.1, 5);
    coreEmitter.fastForward(380, 16.67);

    return {
      radius,
      phase,
      bandEmitter,
      coreEmitter,
      accentAccumulator: 0,
      accentCursor: 0,
    };
  }

  private updateRingVisualRadius(visual: RingVisual, radius: number): void {
    visual.radius = radius;
    visual.bandEmitter.clearEmitZones();
    visual.bandEmitter.addEmitZone(this.createRingBandZone(radius, visual.phase));
    visual.bandEmitter.setQuantity(this.getRingBandEmissionQuantity(radius));
    visual.bandEmitter.maxParticles = this.getRingBandPoolSize(radius);
    visual.bandEmitter.maxAliveParticles = this.getRingBandPoolSize(radius);
    visual.bandEmitter.killAll();
    visual.bandEmitter.reserve(this.getRingBandReserve(radius));
    visual.bandEmitter.fastForward(650, 16.67);
    visual.coreEmitter.clearEmitZones();
    visual.coreEmitter.addEmitZone(this.createRingBandZone(radius, visual.phase, RING_CORE_THICKNESS));
    visual.coreEmitter.setQuantity(this.getRingCoreEmissionQuantity(radius));
    visual.coreEmitter.maxParticles = this.getRingCorePoolSize(radius);
    visual.coreEmitter.maxAliveParticles = this.getRingCorePoolSize(radius);
    visual.coreEmitter.killAll();
    visual.coreEmitter.reserve(this.getRingCoreReserve(radius));
    visual.coreEmitter.fastForward(380, 16.67);
  }

  private createRingBandZone(
    radius: number,
    phase: number,
    thickness = RING_BAND_THICKNESS,
  ): Phaser.Types.GameObjects.Particles.EmitZoneData {
    return {
      type: 'edge',
      source: new RingBandEdgeSource(radius, thickness, phase),
      quantity: this.getRingBandPointCount(radius),
      yoyo: false,
      seamless: false,
    } as Phaser.Types.GameObjects.Particles.EmitZoneData;
  }

  private emitRingAccents(visual: RingVisual, centerX: number, centerY: number, delta: number, now: number): void {
    const radiusScale = Phaser.Math.Clamp(visual.radius / RING_BASE_RADIUS, 1, 1.7);
    visual.accentAccumulator += delta * RING_ACCENT_RATE_AT_BASE_RADIUS * radiusScale / 1000;
    let emissions = Math.min(8, Math.floor(visual.accentAccumulator));
    visual.accentAccumulator -= emissions;

    while (emissions-- > 0) {
      const cursor = visual.accentCursor++;
      const angle = visual.phase + cursor * RING_GOLDEN_ANGLE;
      const radialWobble = Math.sin(now * 0.0034 + cursor * 1.91 + visual.phase) * 2.1
        + Math.sin(now * 0.0051 + cursor * 0.73) * 0.9;
      const emissionRadius = visual.radius + radialWobble + Phaser.Math.FloatBetween(-3.2, 3.2);
      const radialX = Math.cos(angle);
      const radialY = Math.sin(angle);
      const tangentX = -radialY;
      const tangentY = radialX;
      const x = centerX + radialX * emissionRadius;
      const y = centerY + radialY * emissionRadius;
      const radialSpeed = Phaser.Math.FloatBetween(18, 38);
      const tangentialSpeed = Phaser.Math.FloatBetween(-8, 8);

      const flame = this.ringFlames.emitParticleAt(x, y, 1);
      if (flame) {
        flame.velocityX = radialX * radialSpeed + tangentX * tangentialSpeed;
        flame.velocityY = radialY * radialSpeed + tangentY * tangentialSpeed;
        flame.rotation = angle + Phaser.Math.FloatBetween(-0.24, 0.24);
      }

      if ((cursor + Math.floor(visual.phase * 10)) % 4 !== 0) continue;
      const spark = this.ringSparks.emitParticleAt(x, y, 1);
      if (!spark) continue;
      const sparkRadialSpeed = Phaser.Math.FloatBetween(42, 76);
      const sparkTangentialSpeed = Phaser.Math.FloatBetween(-24, 24);
      spark.velocityX = radialX * sparkRadialSpeed + tangentX * sparkTangentialSpeed;
      spark.velocityY = radialY * sparkRadialSpeed + tangentY * sparkTangentialSpeed;
    }
  }

  private destroyRingVisual(playerId: string, visual: RingVisual): void {
    this.ringVisuals.delete(playerId);
    destroyEmitter(visual.bandEmitter);
    destroyEmitter(visual.coreEmitter);
  }

  private getRingBandPointCount(radius: number): number {
    const angularPoints = Math.ceil(TWO_PI * radius / RING_POINT_SPACING);
    return Phaser.Math.Clamp(angularPoints * 2, 140, 360);
  }

  private getRingBandEmissionQuantity(radius: number): number {
    const pointsPerRefresh = this.getRingBandPointCount(radius);
    return Math.max(4, Math.ceil(pointsPerRefresh * RING_BAND_FREQUENCY_MS / RING_BAND_REFRESH_MS));
  }

  private getRingCoreEmissionQuantity(radius: number): number {
    const pointsPerRefresh = this.getRingBandPointCount(radius);
    return Math.max(6, Math.ceil(pointsPerRefresh * RING_BAND_FREQUENCY_MS / RING_CORE_REFRESH_MS));
  }

  private getRingBandReserve(radius: number): number {
    return Math.ceil(this.getRingBandPointCount(radius) * 1.45);
  }

  private getRingBandPoolSize(radius: number): number {
    return Math.ceil(this.getRingBandPointCount(radius) * 2.1);
  }

  private getRingCoreReserve(radius: number): number {
    return Math.ceil(this.getRingBandPointCount(radius) * 1.35);
  }

  private getRingCorePoolSize(radius: number): number {
    return Math.ceil(this.getRingBandPointCount(radius) * 1.8);
  }

  private createCoreEmitter(depth: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return createEmitter(this.scene, 0, 0, TEX_FLAME_CORE, {
      lifespan: { min: 250, max: 520 },
      frequency: -1,
      quantity: 1,
      speedX: { min: -13, max: 13 },
      speedY: { min: -48, max: -14 },
      gravityY: -18,
      scale: { start: 0.52, end: 0.035 },
      alpha: { start: 0.96, end: 0 },
      tint: [...FLAME_COLORS_CORE],
      rotate: { min: -35, max: 35 },
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: 920,
      reserve: 260,
      emitting: false,
    }, depth);
  }

  private createOuterEmitter(depth: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return createEmitter(this.scene, 0, 0, TEX_FLAME_EMBER, {
      lifespan: { min: 390, max: 780 },
      frequency: -1,
      quantity: 1,
      speedX: { min: -20, max: 20 },
      speedY: { min: -46, max: -7 },
      gravityY: -10,
      scale: { start: 0.67, end: 0.055 },
      alpha: { start: 0.82, end: 0 },
      tint: [...FLAME_COLORS_OUTER],
      rotate: { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: 1300,
      reserve: 380,
      emitting: false,
    }, depth);
  }

  private createRingFlameEmitter(depth: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return createEmitter(this.scene, 0, 0, TEX_FLAME_EMBER, {
      lifespan: { min: 420, max: 760 },
      frequency: -1,
      quantity: 1,
      speedX: 0,
      speedY: 0,
      gravityY: 0,
      scale: { start: 0.82, end: 0.06, ease: 'Quad.easeIn' },
      alpha: { start: 0.96, end: 0, ease: 'Quad.easeIn' },
      color: [0xffffdf, 0xffd34f, 0xff7b21, 0xd93411],
      colorEase: 'Quad.easeOut',
      rotate: { min: -22, max: 22 },
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: 1200,
      maxAliveParticles: 1050,
      reserve: 420,
      emitting: false,
    }, depth);
  }

  private createSparkEmitter(depth: number, ring: boolean): Phaser.GameObjects.Particles.ParticleEmitter {
    return createEmitter(this.scene, 0, 0, TEX_FLAME_SPARK, {
      lifespan: ring ? { min: 260, max: 560 } : { min: 300, max: 680 },
      frequency: -1,
      quantity: 1,
      speedX: ring ? 0 : { min: -34, max: 34 },
      speedY: ring ? 0 : { min: -98, max: -38 },
      gravityY: ring ? 0 : -36,
      scale: { start: ring ? 0.9 : 0.75, end: 0.04 },
      alpha: { start: 1, end: 0 },
      tint: [...FLAME_COLORS_SPARK],
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: ring ? 360 : 520,
      reserve: ring ? 100 : 150,
      emitting: false,
    }, depth);
  }

  private createSmokeEmitter(depth: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return createEmitter(this.scene, 0, 0, TEX_GROUND_SMOKE, {
      lifespan: { min: 950, max: 1650 }, frequency: -1, quantity: 1,
      speedX: { min: -9, max: 9 }, speedY: { min: -24, max: -10 },
      scale: { start: 0.34, end: 0.78 }, alpha: { start: 0.16, end: 0 },
      tint: [0x72675d, 0x857468, 0x5c5651], rotate: { min: 0, max: 360 },
      maxParticles: 260, reserve: 80, emitting: false,
    }, depth);
  }

  private releaseGroundVisual(id: string, visual: GroundVisual): void {
    this.ground.delete(id);
    visual.image.setVisible(false).setActive(false).clearTint();
    this.groundImagePool.push(visual.image);
  }

  private ensureHeatTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_GROUND_HEAT, 96, 96, (ctx) => {
      const size = 96;
      const center = size * 0.5;
      const pixels = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const nx = (x + 0.5 - center) / center;
          const ny = (y + 0.5 - center) / center;
          const radius = Math.hypot(nx, ny);
          const angle = Math.atan2(ny, nx);
          const contour = 0.73
            + Math.sin(angle * 3 + 0.8) * 0.09
            + Math.sin(angle * 7 - 1.5) * 0.045;
          const edge = Phaser.Math.Clamp((contour - radius) / 0.56, 0, 1);
          const turbulence = 0.78
            + Math.sin(nx * 8.1 + ny * 5.7) * 0.09
            + Math.sin(nx * 17.3 - ny * 11.2) * 0.05;
          const alpha = Math.pow(edge, 1.28) * turbulence;
          if (alpha <= 0.002) continue;
          const offset = (y * size + x) * 4;
          pixels.data[offset] = 255;
          pixels.data[offset + 1] = 116;
          pixels.data[offset + 2] = 24;
          pixels.data[offset + 3] = Math.round(Phaser.Math.Clamp(alpha * 82, 0, 82));
        }
      }
      ctx.putImageData(pixels, 0, 0);
    });
  }

  private ensureSmokeTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_GROUND_SMOKE, 48, 48, (ctx) => {
      const gradient = ctx.createRadialGradient(24, 24, 2, 24, 24, 24);
      gradient.addColorStop(0, 'rgba(255,255,255,0.5)');
      gradient.addColorStop(0.45, 'rgba(230,230,230,0.23)');
      gradient.addColorStop(1, 'rgba(200,200,200,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 48, 48);
    });
  }

  private sampleRingParticleProfile(
    particle: Phaser.GameObjects.Particles.Particle,
    phase: number,
    layerSeed: number,
  ): RingParticleProfile {
    const angle = Math.atan2(particle.y, particle.x);
    const slowBlend = 0.5 + Math.sin(this.scene.time.now * 0.00022 + phase * 0.71 + layerSeed) * 0.5;
    const broadA = Math.sin(angle * 3 + phase * 1.37 + layerSeed);
    const broadB = Math.sin(angle * 5 - phase * 0.83 + layerSeed * 2.1);
    const broad = Phaser.Math.Linear(broadA, broadB, slowBlend);
    const detail = Math.sin(angle * 9 + phase * 2.43 - layerSeed) * 0.32;
    const grain = Phaser.Math.FloatBetween(-0.055, 0.055);
    const shape = broad + detail;

    return {
      size: Phaser.Math.Clamp(1 + shape * 0.17 + grain, 0.76, 1.28),
      intensity: Phaser.Math.Clamp(0.86 + shape * 0.18 + grain * 0.7, 0.56, 1.1),
      heat: Phaser.Math.Clamp(broad * 0.78 + detail + grain, -1, 1),
    };
  }

  private getRingOuterTint(heat: number): number {
    if (heat > 0.42) return 0xffad2f;
    if (heat > -0.08) return 0xff7b21;
    if (heat > -0.52) return 0xff5419;
    return 0xe52611;
  }

  private getRingCoreTint(heat: number): number {
    if (heat > 0.56) return 0xffffff;
    if (heat > 0.12) return 0xffffbd;
    if (heat > -0.38) return 0xffe36b;
    return 0xffa526;
  }

  private seededUnit(id: number, salt: number): number {
    const value = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  private hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
}
