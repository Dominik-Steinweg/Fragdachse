import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { OwnerVisualSource } from '../entities/OwnerVisualSource';
import type { FireChunkTarget, GroundFireVisualStyle, PlayerNetState, SyncedBurningGroundSnapshot } from '../types';
import {
  createEmitter,
  destroyEmitter,
  killAllAndResetParticlePositions,
} from './EffectUtils';
import {
  ensureFlameTextures,
  ensureVoidFlameTextures,
  FLAME_COLORS_OUTER,
  FLAME_COLORS_SPARK,
  TEX_FLAME_CORE,
  TEX_FLAME_EMBER,
  TEX_FLAME_SPARK,
  TEX_VOID_FLAME_EMBER,
  VOID_FLAME_COLORS_OUTER,
} from './FlameShared';
import { GroundFireClusterRenderer } from './GroundFireClusterRenderer';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import type { LightingSystem } from './LightingSystem';

const RING_PARTICLE_DEPTH = DEPTH.FIRE + 0.12;
const RING_BAND_THICKNESS = 16;
const RING_CORE_THICKNESS = 7;
const RING_POINT_SPACING = 4;
const RING_BAND_REFRESH_MS = 430;
const RING_CORE_REFRESH_MS = 260;
/**
 * Der Flammenring leuchtet dort, wo das Feuer brennt – am Ring, nicht im Zentrum. Statt
 * eines großen Lichts am Spieler verteilen sich mehrere kleine Lichter auf der
 * Ringlinie; ihr Radius überlappt gerade so, dass die Linie durchgehend glüht.
 */
const RING_LIGHT_COUNT = 12;
const RING_BAND_FREQUENCY_MS = 16;
const RING_ACCENT_RATE_AT_BASE_RADIUS = 88;
const RING_BASE_RADIUS = 64;
const RING_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TWO_PI = Math.PI * 2;

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
 * GroundFire wird als zusammenhaengende Clusterflaeche visualisiert; die
 * sichtbaren Flammen, Glut und Funken stammen aus wenigen gepoolten GPUFX-Flows.
 */
export class FlamethrowerUpgradeRenderer {
  private readonly groundFire: GroundFireClusterRenderer;
  private readonly flyingChunks = new Set<Phaser.GameObjects.Image>();
  private readonly ringRadii = new Map<string, number>();
  private readonly ringVisuals = new Map<string, RingVisual>();
  private readonly ringFlames: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly ringSparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private previousNow = 0;
  private lastUpdateMs = 0;
  private performanceMetricsEnabled = false;
  private lighting: LightingSystem | null = null;
  private nextChunkLightId = 0;
  private readonly activeChunkLightKeys = new Set<string>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly owners: OwnerVisualSource,
  ) {
    ensureFlameTextures(scene);
    ensureVoidFlameTextures(scene);
    this.groundFire = new GroundFireClusterRenderer();
    this.ringFlames = this.createRingFlameEmitter(RING_PARTICLE_DEPTH + 0.04);
    this.ringSparks = this.createRingSparkEmitter(RING_PARTICLE_DEPTH + 0.1);
    this.ringFlames.addParticleProcessor(new RingTurbulenceProcessor(32));
    this.ringSparks.addParticleProcessor(new RingTurbulenceProcessor(54));
  }

  /**
   * Meldet den GroundFire-Clusterrenderer beim szenenweiten GPUFX-Backend an. Der Flammenring
   * bleibt bewusst auf klassischen Emittern: er haengt an eigener Ringgeometrie und am
   * `RingTurbulenceProcessor`, beides hat im GPUFX-Modell keine Entsprechung.
   */
  registerGpuVfx(system: GpuVfxSystem): void {
    this.groundFire.registerGpuVfx(system);
  }

  syncGround(snapshot: SyncedBurningGroundSnapshot, now = Date.now()): void {
    this.groundFire.syncGround(snapshot, now);
  }

  playFireChunkBurst(
    x: number,
    y: number,
    targets: readonly FireChunkTarget[],
    landsAt: number,
    now = Date.now(),
    visualStyle: GroundFireVisualStyle = 'normal',
  ): void {
    const duration = Phaser.Math.Clamp(landsAt - now, 80, 420);
    for (const target of targets) {
      // Ein Follow-Light je fliegendem Brocken; freigegeben beim Aufschlag.
      const lightKey = `firechunk:${this.nextChunkLightId++}`;
      this.activeChunkLightKeys.add(lightKey);
      const isVoid = visualStyle === 'void';
      const chunk = this.scene.add.image(x, y, isVoid ? TEX_VOID_FLAME_EMBER : TEX_FLAME_EMBER)
        .setDepth(DEPTH.PROJECTILES + 0.4)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(Phaser.Utils.Array.GetRandom([
          ...(isVoid ? VOID_FLAME_COLORS_OUTER : FLAME_COLORS_OUTER),
        ]))
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
          this.lighting?.setLight(lightKey, isVoid ? 'voidFireChunk' : 'fireChunk', chunk.x, chunk.y);
        },
        onComplete: () => {
          const shouldLand = chunk.active;
          this.flyingChunks.delete(chunk);
          this.activeChunkLightKeys.delete(lightKey);
          this.lighting?.releaseLight(lightKey);
          chunk.destroy();
          if (!shouldLand) return;
          this.lighting?.pulse(isVoid ? 'voidFireChunkImpact' : 'fireChunkImpact', target.x, target.y);
          // Der Einschlag benutzt dieselben Bodenfeuer-Effekte, entsteht aber ausserhalb des
          // Emissions-Ticks: die Partikeluhr steht noch auf dem Stand des Vorframes.
          this.groundFire.spawnImpact(target.x, target.y, visualStyle);
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
    const updateStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    const delta = this.previousNow > 0 ? Phaser.Math.Clamp(now - this.previousNow, 0, 100) : 16.67;
    this.previousNow = now;
    this.groundFire.update(now);
    this.updateRingVisuals(delta, now);
    if (this.performanceMetricsEnabled) this.lastUpdateMs = performance.now() - updateStartedAt;
  }

  getLastUpdateCostMs(): number { return this.lastUpdateMs; }

  setPerformanceMetricsEnabled(enabled: boolean): void {
    if (this.performanceMetricsEnabled === enabled) return;
    this.performanceMetricsEnabled = enabled;
    if (!enabled) this.lastUpdateMs = 0;
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
    this.groundFire.setLightingSystem(lighting);
  }

  clear(): void {
    this.groundFire.clear();
    this.ringRadii.clear();
    for (const [playerId, visual] of this.ringVisuals) this.destroyRingVisual(playerId, visual);
    this.previousNow = 0;
    this.lastUpdateMs = 0;
    killAllAndResetParticlePositions(this.ringFlames);
    killAllAndResetParticlePositions(this.ringSparks);
    for (const chunk of this.flyingChunks) {
      this.scene.tweens.killTweensOf(chunk);
      chunk.destroy();
    }
    this.flyingChunks.clear();
    // Die Tweens wurden abgebrochen, ihre onComplete-Freigabe läuft also nicht mehr.
    for (const key of this.activeChunkLightKeys) this.lighting?.releaseLight(key);
    this.activeChunkLightKeys.clear();
  }

  destroyAll(): void {
    this.clear();
    this.groundFire.destroyAll();
    destroyEmitter(this.ringFlames);
    destroyEmitter(this.ringSparks);
  }

  private updateRingVisuals(delta: number, now: number): void {
    for (const [playerId, radius] of this.ringRadii) {
      const owner = this.owners.getOwnerVisualState(playerId);
      if (!owner) continue;

      let visual = this.ringVisuals.get(playerId);
      if (!visual) {
        visual = this.createRingVisual(playerId, radius, owner.x, owner.y);
        this.ringVisuals.set(playerId, visual);
      } else if (Math.abs(visual.radius - radius) > 0.01) {
        this.updateRingVisualRadius(visual, radius);
      }

      const visible = owner.visible;
      visual.bandEmitter
        .setPosition(owner.x, owner.y)
        .setVisible(visible);
      visual.coreEmitter
        .setPosition(owner.x, owner.y)
        .setVisible(visible);
      visual.bandEmitter.emitting = visible;
      visual.coreEmitter.emitting = visible;
      if (!visible) {
        this.releaseRingLights(playerId);
        continue;
      }

      this.syncRingLights(playerId, owner.x, owner.y, radius, visual.phase);

      this.emitRingAccents(visual, owner.x, owner.y, delta, now);
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
    }, RING_PARTICLE_DEPTH, undefined, 'flamethrowerRing');

    bandEmitter.onParticleEmit((particle) => {
      const tangentAngle = Math.atan2(particle.y, particle.x) + Math.PI * 0.5;
      particle.rotation = tangentAngle + Phaser.Math.FloatBetween(-0.08, 0.08);
      particle.angle = Phaser.Math.RadToDeg(particle.rotation);
    });
    bandEmitter.addParticleProcessor(new RingTurbulenceProcessor(8));
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
    }, RING_PARTICLE_DEPTH + 0.02, undefined, 'flamethrowerRing');

    coreEmitter.onParticleEmit((particle) => {
      const tangentAngle = Math.atan2(particle.y, particle.x) + Math.PI * 0.5;
      particle.rotation = tangentAngle + Phaser.Math.FloatBetween(-0.06, 0.06);
      particle.angle = Phaser.Math.RadToDeg(particle.rotation);
    });
    coreEmitter.addParticleProcessor(new RingTurbulenceProcessor(6));
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
    killAllAndResetParticlePositions(visual.bandEmitter);
    visual.bandEmitter.reserve(this.getRingBandReserve(radius));
    visual.bandEmitter.fastForward(650, 16.67);
    visual.coreEmitter.clearEmitZones();
    visual.coreEmitter.addEmitZone(this.createRingBandZone(radius, visual.phase, RING_CORE_THICKNESS));
    visual.coreEmitter.setQuantity(this.getRingCoreEmissionQuantity(radius));
    visual.coreEmitter.maxParticles = this.getRingCorePoolSize(radius);
    visual.coreEmitter.maxAliveParticles = this.getRingCorePoolSize(radius);
    killAllAndResetParticlePositions(visual.coreEmitter);
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

  /**
   * Verteilt die Ringbeleuchtung auf `RING_LIGHT_COUNT` Punkte entlang der Ringlinie.
   * Jedes Licht ist klein und deckt nur seinen Bogenabschnitt ab; zusammen glüht die
   * Linie durchgehend, während die Spielermitte weitgehend dunkel bleibt. `phase` dreht
   * die Punkte langsam mit, damit keine festen hellen Stellen entstehen.
   */
  private syncRingLights(playerId: string, cx: number, cy: number, radius: number, phase: number): void {
    const lighting = this.lighting;
    if (!lighting) return;

    // Überlappung: der Abstand zweier Nachbarpunkte ist 2πr/N, der Lichtradius klar
    // darüber, damit die Bögen breit ineinanderlaufen und der Ring durchgehend hell glüht.
    const perLightRadius = Math.max(100, (TWO_PI * radius) / RING_LIGHT_COUNT * 1.15);
    for (let index = 0; index < RING_LIGHT_COUNT; index += 1) {
      const angle = phase + (index / RING_LIGHT_COUNT) * TWO_PI;
      // Intensität knapp unter 1: lässt dem Flackern des `flameRing`-Presets Spielraum
      // nach oben, statt es am Deckel abzuschneiden.
      lighting.setLight(
        `flamering:${playerId}:${index}`,
        'flameRing',
        cx + Math.cos(angle) * radius,
        cy + Math.sin(angle) * radius,
        { radiusPx: perLightRadius, intensity: 0.9 },
      );
    }
  }

  private releaseRingLights(playerId: string): void {
    for (let index = 0; index < RING_LIGHT_COUNT; index += 1) {
      this.lighting?.releaseLight(`flamering:${playerId}:${index}`);
    }
  }

  private destroyRingVisual(playerId: string, visual: RingVisual): void {
    this.releaseRingLights(playerId);
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
      maxAliveParticles: 640,
      reserve: 420,
      emitting: false,
    }, depth, undefined, 'flamethrowerRing');
  }

  /**
   * Funken des Flammenrings. Geschwindigkeit und Gravity stehen auf 0, weil `emitRingAccents()`
   * beide nach dem Emit selbst schreibt.
   */
  private createRingSparkEmitter(depth: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return createEmitter(this.scene, 0, 0, TEX_FLAME_SPARK, {
      lifespan: { min: 260, max: 560 },
      frequency: -1,
      quantity: 1,
      speedX: 0,
      speedY: 0,
      gravityY: 0,
      scale: { start: 0.9, end: 0.04 },
      alpha: { start: 1, end: 0 },
      tint: [...FLAME_COLORS_SPARK],
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: 360,
      maxAliveParticles: 220,
      reserve: 100,
      emitting: false,
    }, depth, undefined, 'flamethrowerRing');
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
