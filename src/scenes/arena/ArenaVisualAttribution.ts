import type * as Phaser from 'phaser';

export type AttributionBackend = 'classic' | 'graphics';

export interface AttributionCatalogEntry {
  readonly sources: readonly string[];
  readonly backend: AttributionBackend;
}

/**
 * Statische Bestandsaufnahme der klassischen Renderer. GPU-VFX stehen bewusst nicht in dieser
 * Liste; deren Granularitaet kommt ausschliesslich aus GPU_VFX_EFFECTS.
 */
export const CLASSIC_PARTICLE_FAMILIES = {
  asmdPrimary: ['AsmdPrimaryRenderer'],
  bfg: ['BfgRenderer'],
  bite: ['BiteRenderer'],
  blackHole: ['BlackHoleRenderer'],
  bullet: ['BulletRenderer'],
  captureTheBeer: ['CaptureTheBeerRenderer'],
  coopDefenseTelegraph: ['CoopDefenseEncounterTelegraphRenderer'],
  effectSystem: ['EffectSystem'],
  energyBall: ['EnergyBallRenderer'],
  energyInjector: ['EnergyInjectorRenderer'],
  energyShield: ['EnergyShieldRenderer'],
  fireball: ['FireballRenderer'],
  flamethrowerRing: ['FlamethrowerUpgradeRenderer'],
  gauss: ['GaussRenderer'],
  grenade: ['GrenadeRenderer'],
  guardianSpirit: ['GuardianSpiritRenderer'],
  holyGrenade: ['HolyGrenadeRenderer'],
  honeyBadgerRage: ['HoneyBadgerRageRenderer'],
  hydra: ['HydraRenderer'],
  meteor: ['MeteorRenderer'],
  muzzleFlash: ['MuzzleFlashRenderer'],
  nuke: ['NukeRenderer'],
  plasmaBurner: ['PlasmaBurnerRenderer'],
  plasmaCharge: ['PlasmaChargeRenderer'],
  powerUp: ['PowerUpRenderer'],
  reinforcementMatrix: ['ReinforcementMatrixRenderer'],
  remoteControl: ['RemoteControlRenderer'],
  rockDestruction: ['RockDestructionRenderer'],
  rocketLifecycleBurst: ['RocketRenderer'],
  slimeTrail: ['SlimeTrailRenderer'],
  smoke: ['SmokeSystem'],
  spawnEffect: ['SpawnEffectRenderer'],
  spore: ['SporeRenderer'],
  stinkCloudBurst: ['StinkCloudSystem'],
  teslaBolt: ['TeslaBoltRenderer'],
  teslaDome: ['TeslaDomeRenderer'],
  teslaNova: ['TeslaNovaRenderer'],
  timebombFuse: ['TimebombFuseRenderer'],
  tunnelEndpoint: ['TunnelEndpointVisual'],
  rockVisual: ['RockVisualHelper'],
  zeusTaser: ['ZeusTaserRenderer'],
  playerStealth: ['PlayerEntity'],
  arenaHud: ['ArenaHUD'],
} as const;

export const GRAPHICS_FAMILIES = {
  lightingOcclusion: ['LightingSystem'],
  dynamicShadows: ['ShadowSystem'],
  treeTrunks: ['ArenaVisualFactory'],
  spawnRings: ['SpawnEffectRenderer'],
  playerStatus: ['PlayerStatusRing', 'PlayerEntity', 'DecoyEntity'],
  enemyStatus: ['EnemyEntity'],
  bossDecoration: ['EnemyEntity'],
  smokeStorm: ['SmokeSystem'],
  asmdEffects: ['AsmdPrimaryRenderer'],
  bfgEffects: ['BfgRenderer'],
  teslaBoltEffects: ['TeslaBoltRenderer'],
  teslaDomeEffects: ['TeslaDomeRenderer'],
  teslaNovaEffects: ['TeslaNovaRenderer'],
  miniTeslaDomeEffects: ['MiniTeslaDomeRenderer'],
  plasmaBurnerEffects: ['PlasmaBurnerRenderer'],
  energyShieldEffects: ['EnergyShieldRenderer'],
  weaponTelegraphs: ['Ak47StrategicTargetRenderer'],
  gaussWarning: ['GaussWarningRenderer'],
  airstrikeWarning: ['AirstrikeRenderer'],
  meteorEffects: ['MeteorRenderer'],
  nukeTelegraphs: ['NukeRenderer', 'EffectSystem'],
  effectSystemGraphics: ['EffectSystem'],
  objectiveMarkers: ['CoopDefenseSecondaryObjectiveMarkerRenderer', 'CoopDefenseObjectiveRepairDroneRenderer', 'RepairDroneRenderer'],
  encounterTelegraphs: ['CoopDefenseEncounterTelegraphRenderer'],
  powerUpEffects: ['PowerUpRenderer'],
  projectileShapes: ['ProjectileManager'],
  captureObjectiveEffects: ['CaptureTheBeerRenderer'],
  healingAura: ['HealingAuraRenderer'],
  teleportEffects: ['TranslocatorTeleportRenderer'],
  rocketLifecycleGraphics: ['RocketRenderer'],
  stinkCloudGraphics: ['StinkCloudSystem'],
  weaponTrails: ['TracerRenderer'],
  biteEffects: ['BiteRenderer'],
  zeusTaserEffects: ['ZeusTaserRenderer'],
  baseMarkers: ['BaseEntity', 'ArenaBuilder', 'HostileBaseIndicator'],
  placementPreview: ['PlacementPreviewRenderer'],
  rockTools: ['RockVisualHelper'],
  gameplayHud: ['ArenaHUD', 'CenterHUD', 'CoopDefenseSecondaryObjectiveHud'],
} as const;

export type ClassicParticleFamily = keyof typeof CLASSIC_PARTICLE_FAMILIES;
export type GraphicsFamily = keyof typeof GRAPHICS_FAMILIES;

export const MAX_ATTRIBUTION_FAMILIES = 100;

const classicFamilyCount = Object.keys(CLASSIC_PARTICLE_FAMILIES).length;
const graphicsFamilyCount = Object.keys(GRAPHICS_FAMILIES).length;
if (classicFamilyCount + graphicsFamilyCount > MAX_ATTRIBUTION_FAMILIES) {
  throw new Error(`Attribution family catalog exceeds ${MAX_ATTRIBUTION_FAMILIES} families`);
}

export interface ArenaVisualAttributionCatalog {
  particleFamilies: Record<string, AttributionCatalogEntry>;
  graphicsFamilies: Record<string, AttributionCatalogEntry>;
  /** GPU_VFX_EFFECTS remains the only GPU-VFX catalog. */
  gpuVfxCatalogRef: 'GPU_VFX_EFFECTS';
}

export interface ParticleAttributionGauge {
  emitterCount: number;
  activeEmitterCount: number;
  aliveParticles: number;
}

export interface GraphicsAttributionGauge {
  objectCount?: number;
  activeObjects?: number;
  activeLights?: number;
  renderedLights?: number;
  occludingLights?: number;
  dynamicCasterCount?: number;
  primitiveCount?: number;
  commandCount?: number;
  shadowQuads?: number;
  falloffQuads?: number;
}

export interface GraphicsWorkCounters {
  createdObjects?: number;
  destroyedObjects?: number;
  redraws?: number;
  primitivesBuilt?: number;
  commandsBuilt?: number;
  shadowQuadsBuilt?: number;
  falloffQuadsBuilt?: number;
  maxCommandsPerFrame?: number;
  maxShadowQuadsPerFrame?: number;
  maxFalloffQuadsPerFrame?: number;
  maxDynamicPrimitivesPerFrame?: number;
  dynamicOccluderTests?: number;
  dynamicOccluderHits?: number;
}

export interface ArenaVisualAttributionSample {
  particleFamilies: Record<string, ParticleAttributionGauge>;
  graphicsFamilies: Record<string, GraphicsAttributionGauge>;
  interval?: {
    particleSpawns?: Record<string, number>;
    graphicsWork?: Record<string, GraphicsWorkCounters>;
  };
}

export interface ArenaVisualAttributionSummary {
  particleSpawns: Record<string, number>;
  graphicsWork: Record<string, GraphicsWorkCounters>;
  peakEmitters: Record<string, number>;
  peakActiveEmitters: Record<string, number>;
  peakAliveParticles: Record<string, number>;
  peakGraphicsObjects: Record<string, number>;
  peakGraphicsWork: Record<string, GraphicsWorkCounters>;
}

export interface ArenaVisualAttributionSource {
  setActive(active: boolean): void;
  setRecording(recording: boolean): void;
  resetRecording(): void;
  sampleAndReset(): ArenaVisualAttributionSample;
  getRecordingSummary(): ArenaVisualAttributionSummary;
  getCatalog(): ArenaVisualAttributionCatalog;
}

interface ParticleRegistration {
  readonly emitter: Phaser.GameObjects.Particles.ParticleEmitter;
  readonly unregister: () => void;
}

interface GraphicsRegistration {
  readonly object: Phaser.GameObjects.GameObject;
  readonly isActive?: () => boolean;
  readonly countedCreation: boolean;
  visibilityBeforeSuppression?: boolean;
  readonly unregister: () => void;
}

const sceneCollectors = new WeakMap<Phaser.Scene, ArenaVisualAttributionCollector>();

function increment(target: Record<string, number>, key: string, value: number): void {
  if (!Number.isFinite(value) || value === 0) return;
  target[key] = (target[key] ?? 0) + value;
}

function maxInto(target: Record<string, number>, key: string, value: number): void {
  if (!Number.isFinite(value)) return;
  target[key] = Math.max(target[key] ?? 0, value);
}

function copyWork(work: GraphicsWorkCounters): GraphicsWorkCounters {
  return { ...work };
}

export class ArenaVisualAttributionCollector implements ArenaVisualAttributionSource {
  private active = false;
  private recording = false;
  private readonly particleRegistrations = new Map<string, Map<object, ParticleRegistration>>();
  private readonly graphicsRegistrations = new Map<string, Map<object, GraphicsRegistration>>();
  private readonly particleOwners = new WeakMap<object, string>();
  private readonly graphicsOwners = new WeakMap<object, string>();
  private readonly suppressedGraphicsFamilies = new Set<GraphicsFamily>();
  private readonly latestGraphicsGauges = new Map<string, GraphicsAttributionGauge>();
  private readonly intervalParticleSpawns: Record<string, number> = {};
  private readonly intervalGraphicsWork: Record<string, GraphicsWorkCounters> = {};
  private readonly summary: ArenaVisualAttributionSummary = {
    particleSpawns: {},
    graphicsWork: {},
    peakEmitters: {},
    peakActiveEmitters: {},
    peakAliveParticles: {},
    peakGraphicsObjects: {},
    peakGraphicsWork: {},
  };

  setActive(active: boolean): void {
    if (!active && this.active) {
      for (const family of [...this.suppressedGraphicsFamilies]) this.setGraphicsFamilySuppressed(family, false);
    }
    this.active = active;
    if (!active) this.suppressedGraphicsFamilies.clear();
  }

  isActive(): boolean {
    return this.active;
  }

  setRecording(recording: boolean): void {
    this.recording = recording;
  }

  resetRecording(): void {
    for (const key of Object.keys(this.intervalParticleSpawns)) delete this.intervalParticleSpawns[key];
    for (const key of Object.keys(this.intervalGraphicsWork)) delete this.intervalGraphicsWork[key];
    for (const key of Object.keys(this.summary.particleSpawns)) delete this.summary.particleSpawns[key];
    for (const key of Object.keys(this.summary.graphicsWork)) delete this.summary.graphicsWork[key];
    for (const key of Object.keys(this.summary.peakEmitters)) delete this.summary.peakEmitters[key];
    for (const key of Object.keys(this.summary.peakActiveEmitters)) delete this.summary.peakActiveEmitters[key];
    for (const key of Object.keys(this.summary.peakAliveParticles)) delete this.summary.peakAliveParticles[key];
    for (const key of Object.keys(this.summary.peakGraphicsObjects)) delete this.summary.peakGraphicsObjects[key];
    for (const key of Object.keys(this.summary.peakGraphicsWork)) delete this.summary.peakGraphicsWork[key];
  }

  registerParticleEmitter(family: ClassicParticleFamily, emitter: Phaser.GameObjects.Particles.ParticleEmitter): () => void {
    const object = emitter as unknown as object;
    const owner = this.particleOwners.get(object);
    if (owner) {
      if (owner !== family) throw new Error(`Particle emitter already belongs to ${owner}, not ${family}`);
      return this.particleRegistrations.get(family)?.get(object)?.unregister ?? (() => undefined);
    }
    const registrations = this.particleRegistrations.get(family) ?? new Map<object, ParticleRegistration>();
    this.particleRegistrations.set(family, registrations);
    let registered = true;
    const unregister = (): void => {
      if (!registered) return;
      registered = false;
      registrations.delete(object);
      this.particleOwners.delete(object);
    };
    registrations.set(object, { emitter, unregister });
    this.particleOwners.set(object, family);
    (emitter as unknown as { once?: (event: string, listener: () => void) => void }).once?.('destroy', unregister);
    return unregister;
  }

  registerGraphicsObject(
    family: GraphicsFamily,
    object: Phaser.GameObjects.GameObject,
    isActive?: () => boolean,
  ): () => void {
    const resource = object as unknown as object;
    const owner = this.graphicsOwners.get(resource);
    if (owner) {
      if (owner !== family) throw new Error(`Graphics object already belongs to ${owner}, not ${family}`);
      return this.graphicsRegistrations.get(family)?.get(resource)?.unregister ?? (() => undefined);
    }
    const registrations = this.graphicsRegistrations.get(family) ?? new Map<object, GraphicsRegistration>();
    this.graphicsRegistrations.set(family, registrations);
    let registered = true;
    const countedCreation = this.active;
    const unregister = (): void => {
      if (!registered) return;
      registered = false;
      registrations.delete(resource);
      this.graphicsOwners.delete(resource);
      if (countedCreation && this.active) this.recordGraphicsWork(family, { destroyedObjects: 1 });
    };
    registrations.set(resource, { object, isActive, countedCreation, unregister });
    this.graphicsOwners.set(resource, family);
    if (countedCreation) this.recordGraphicsWork(family, { createdObjects: 1 });
    if (this.suppressedGraphicsFamilies.has(family)) {
      const target = object as Phaser.GameObjects.GameObject & { visible?: boolean; setVisible?: (visible: boolean) => unknown };
      registrations.get(resource)!.visibilityBeforeSuppression = target.visible !== false;
      target.setVisible?.(false);
    }
    (object as unknown as { once?: (event: string, listener: () => void) => void }).once?.('destroy', unregister);
    return unregister;
  }

  /**
   * Hides only already-attributed members of one family for a targeted diagnostic ablation.
   * This deliberately reuses the registration registry; it never traverses a Scene display list.
   */
  setGraphicsFamilySuppressed(family: GraphicsFamily, suppressed: boolean): void {
    if (!this.active) return;
    const registrations = this.graphicsRegistrations.get(family);
    if (suppressed) {
      if (this.suppressedGraphicsFamilies.has(family)) return;
      this.suppressedGraphicsFamilies.add(family);
      for (const registration of registrations?.values() ?? []) {
        const target = registration.object as Phaser.GameObjects.GameObject & { visible?: boolean; setVisible?: (visible: boolean) => unknown };
        registration.visibilityBeforeSuppression = target.visible !== false;
        target.setVisible?.(false);
      }
      return;
    }
    if (!this.suppressedGraphicsFamilies.delete(family)) return;
    for (const registration of registrations?.values() ?? []) {
      const target = registration.object as Phaser.GameObjects.GameObject & { setVisible?: (visible: boolean) => unknown };
      if (registration.visibilityBeforeSuppression !== undefined) {
        target.setVisible?.(registration.visibilityBeforeSuppression);
        registration.visibilityBeforeSuppression = undefined;
      }
    }
  }

  recordParticleSpawn(family: ClassicParticleFamily, count: number): void {
    if (!this.active || !Number.isFinite(count) || count <= 0) return;
    increment(this.intervalParticleSpawns, family, count);
    if (this.recording) increment(this.summary.particleSpawns, family, count);
  }

  setGraphicsGauge(family: GraphicsFamily, gauge: GraphicsAttributionGauge): void {
    if (!this.active) return;
    this.latestGraphicsGauges.set(family, { ...gauge });
  }

  recordGraphicsWork(family: GraphicsFamily, work: GraphicsWorkCounters): void {
    if (!this.active) return;
    const interval = this.intervalGraphicsWork[family] ?? {};
    for (const [key, value] of Object.entries(work) as Array<[keyof GraphicsWorkCounters, number | undefined]>) {
      if (value === undefined || !Number.isFinite(value)) continue;
      if (key.startsWith('max')) maxInto(interval as Record<string, number>, key, value);
      else increment(interval as Record<string, number>, key, value);
    }
    this.intervalGraphicsWork[family] = interval;
    if (this.recording) {
      const total = this.summary.graphicsWork[family] ?? {};
      for (const [key, value] of Object.entries(work) as Array<[keyof GraphicsWorkCounters, number | undefined]>) {
        if (value === undefined || !Number.isFinite(value)) continue;
        if (key.startsWith('max')) maxInto(total as Record<string, number>, key, value);
        else increment(total as Record<string, number>, key, value);
      }
      this.summary.graphicsWork[family] = total;
    }
  }

  sampleAndReset(): ArenaVisualAttributionSample {
    if (!this.active) return { particleFamilies: {}, graphicsFamilies: {} };
    const particleFamilies: Record<string, ParticleAttributionGauge> = {};
    for (const [family, registrations] of this.particleRegistrations) {
      if (registrations.size === 0) continue;
      let activeEmitterCount = 0;
      let aliveParticles = 0;
      for (const registration of registrations.values()) {
        if (registration.emitter.active === true) activeEmitterCount += 1;
        aliveParticles += Math.max(0, registration.emitter.getAliveParticleCount());
      }
      particleFamilies[family] = {
        emitterCount: registrations.size,
        activeEmitterCount,
        aliveParticles,
      };
      if (this.recording) {
        maxInto(this.summary.peakEmitters, family, registrations.size);
        maxInto(this.summary.peakActiveEmitters, family, activeEmitterCount);
        maxInto(this.summary.peakAliveParticles, family, aliveParticles);
      }
    }

    const graphicsFamilies: Record<string, GraphicsAttributionGauge> = {};
    const graphicsKeys = new Set<string>([
      ...this.graphicsRegistrations.keys(),
      ...this.latestGraphicsGauges.keys(),
      ...Object.keys(this.intervalGraphicsWork),
    ]);
    for (const family of graphicsKeys) {
      const registrations = this.graphicsRegistrations.get(family);
      const objectCount = registrations?.size ?? 0;
      let activeObjects = 0;
      if (registrations) {
        for (const registration of registrations.values()) {
          const objectState = registration.object as unknown as { active?: boolean; visible?: boolean };
          const active = registration.isActive
            ? registration.isActive()
            : objectState.active === true && objectState.visible !== false;
          if (active) activeObjects += 1;
        }
      }
      const gauge = { ...(this.latestGraphicsGauges.get(family) ?? {}) };
      if (objectCount > 0) gauge.objectCount = objectCount;
      if (activeObjects > 0) gauge.activeObjects = activeObjects;
      const work = this.intervalGraphicsWork[family];
      if (Object.keys(gauge).length > 0 || work && Object.keys(work).length > 0) {
        graphicsFamilies[family] = gauge;
        if (this.recording) {
          maxInto(this.summary.peakGraphicsObjects, family, objectCount);
          const peak = this.summary.peakGraphicsWork[family] ?? {};
          if (work) {
            for (const [key, value] of Object.entries(work) as Array<[keyof GraphicsWorkCounters, number | undefined]>) {
              if (value === undefined || !Number.isFinite(value)) continue;
              if (key.startsWith('max')) maxInto(peak as Record<string, number>, key, value);
              else maxInto(peak as Record<string, number>, key, value);
            }
          }
          this.summary.peakGraphicsWork[family] = peak;
        }
      }
    }

    const particleSpawns = Object.keys(this.intervalParticleSpawns).length > 0
      ? { ...this.intervalParticleSpawns }
      : undefined;
    const graphicsWork = Object.keys(this.intervalGraphicsWork).length > 0
      ? Object.fromEntries(Object.entries(this.intervalGraphicsWork).map(([family, work]) => [family, copyWork(work)]))
      : undefined;
    for (const key of Object.keys(this.intervalParticleSpawns)) delete this.intervalParticleSpawns[key];
    for (const key of Object.keys(this.intervalGraphicsWork)) delete this.intervalGraphicsWork[key];
    return {
      particleFamilies,
      graphicsFamilies,
      ...(particleSpawns || graphicsWork ? { interval: { particleSpawns, graphicsWork } } : {}),
    };
  }

  getRecordingSummary(): ArenaVisualAttributionSummary {
    return {
      particleSpawns: { ...this.summary.particleSpawns },
      graphicsWork: Object.fromEntries(Object.entries(this.summary.graphicsWork).map(([family, work]) => [family, copyWork(work)])),
      peakEmitters: { ...this.summary.peakEmitters },
      peakActiveEmitters: { ...this.summary.peakActiveEmitters },
      peakAliveParticles: { ...this.summary.peakAliveParticles },
      peakGraphicsObjects: { ...this.summary.peakGraphicsObjects },
      peakGraphicsWork: Object.fromEntries(Object.entries(this.summary.peakGraphicsWork).map(([family, work]) => [family, copyWork(work)])),
    };
  }

  getCatalog(): ArenaVisualAttributionCatalog {
    const particleFamilies: Record<string, AttributionCatalogEntry> = {};
    for (const [family, sources] of Object.entries(CLASSIC_PARTICLE_FAMILIES)) {
      particleFamilies[family] = { sources, backend: 'classic' };
    }
    const graphicsFamilies: Record<string, AttributionCatalogEntry> = {};
    for (const [family, sources] of Object.entries(GRAPHICS_FAMILIES)) {
      graphicsFamilies[family] = { sources, backend: 'graphics' };
    }
    return { particleFamilies, graphicsFamilies, gpuVfxCatalogRef: 'GPU_VFX_EFFECTS' };
  }
}

export function getArenaVisualAttribution(scene: Phaser.Scene): ArenaVisualAttributionCollector {
  let collector = sceneCollectors.get(scene);
  if (!collector) {
    collector = new ArenaVisualAttributionCollector();
    sceneCollectors.set(scene, collector);
  }
  return collector;
}
