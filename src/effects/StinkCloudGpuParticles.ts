import * as Phaser from 'phaser';
import type { DamageZoneVisualStyle } from '../types';
import { GPU_VFX_NO_SLOT } from './gpu/GpuVfxPool';
import {
  GPU_VFX_DEPTH_EPSILON,
  pickGpuVfxTint,
  setGpuVfxTint,
  type GpuVfxEmitter,
  type GpuVfxMember,
  type GpuVfxMemberAnimation,
  type GpuVfxRegistry,
} from './gpu/GpuVfxRegistry';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';
import { getGraphicsQualityController, type GraphicsQualityController } from '../graphics/GraphicsQuality';

/**
 * Die vier kontinuierlichen Wolkenpartikel-Familien auf geteilten `SpriteGPULayer`n.
 *
 * Ersetzt die bisherigen vier `ParticleEmitter` *pro Wolke*. Die Wolkenbilder selbst (Haze,
 * Blobs, Ground/Glow/Pulse, Fairness-Kreis, Bolts, Licht) bleiben unveraendert auf der CPU.
 *
 * ## Warum die Emission an der Framerate haengt
 *
 * `StinkCloudSystem.updateVisual()` ruft pro Frame `setFrequency()` auf jeden Emitter, und
 * Phasers `setFrequency()` setzt `flowCounter = frequency` zurueck. Die `UpdateList` laeuft auf
 * `SceneEvents.UPDATE` vor `scene.update()`, der Zaehler wird also je Frame um genau ein Delta
 * verringert und danach wieder hochgesetzt. Bei Frequenzen von 18–92 ms erreicht er auf 60 fps
 * nie null: die vier Familien emittieren dort heute **gar nichts** und melden sich erst, wenn
 * ein Frame laenger dauert als die Frequenz.
 *
 * Diese Migration bildet genau das nach – `resetCountdown()` pro Frame – damit der Umstieg
 * eine reine Performance-Aenderung bleibt und nicht nebenbei die Wolkendichte umwirft. Der
 * Flow-Reset ist eine eigene, bewusste Entscheidung und gehoert in einen eigenen Commit; er
 * haengt an genau dieser einen Zeile.
 *
 * Ebenfalls Ist-Zustand: die `setParticleScale()`-Aufrufe pro Frame sind wirkungslos
 * (`scale: {start,end}` laedt Op-Methode 5, deren `onChange()` nur das Bookkeeping-Feld
 * schreibt), der Scale-Verlauf steht damit fest auf den Config-Werten und ist nicht
 * radiusabhaengig.
 */

/** Familien in ihrer Tiefenreihenfolge. */
export type StinkParticleFamily = 'inner' | 'plume' | 'accent' | 'edge';

/** Je Familie eine Tint-Auswahl; von der Wolke aus ihrer Variante aufgeloest. */
export interface StinkCloudParticleTints {
  readonly inner:  readonly number[];
  readonly accent: readonly number[];
  readonly plume:  readonly number[];
  readonly edge:   readonly number[];
}

interface StinkFamilySpec {
  readonly lifeMin: number;
  readonly lifeMax: number;
  /** `speedX: { min: -x, max: x }` – nicht-radial, beide Achsen unabhaengig gezogen. */
  readonly speedXAbs: number;
  readonly speedYMin: number;
  readonly speedYMax: number;
  readonly scaleStart: number;
  readonly scaleEnd: number;
  /** `alpha: { start, end: 0 }` des Partikels, vor der Emitter-Alpha. */
  readonly alphaStart: number;
  /** `frequency` bei Wolken-Alpha 0 bzw. 1; dazwischen linear. */
  readonly freqIdle: number;
  readonly freqActive: number;
  readonly quantity: number;
}

const FAMILY_SPECS: Readonly<Record<StinkParticleFamily, StinkFamilySpec>> = {
  inner: {
    lifeMin: 900, lifeMax: 1800, speedXAbs: 18, speedYMin: -16, speedYMax: 10,
    scaleStart: 0.34, scaleEnd: 1.0, alphaStart: 0.2, freqIdle: 74, freqActive: 34, quantity: 2,
  },
  plume: {
    lifeMin: 1400, lifeMax: 2600, speedXAbs: 10, speedYMin: -34, speedYMax: -12,
    scaleStart: 0.3, scaleEnd: 1.26, alphaStart: 0.16, freqIdle: 92, freqActive: 42, quantity: 2,
  },
  accent: {
    lifeMin: 900, lifeMax: 1600, speedXAbs: 14, speedYMin: -20, speedYMax: 6,
    scaleStart: 0.12, scaleEnd: 0.42, alphaStart: 0.34, freqIdle: 54, freqActive: 18, quantity: 1,
  },
  edge: {
    lifeMin: 1300, lifeMax: 2400, speedXAbs: 18, speedYMin: -18, speedYMax: 18,
    scaleStart: 0.22, scaleEnd: 1.36, alphaStart: 0.22, freqIdle: 54, freqActive: 24, quantity: 3,
  },
};

/**
 * Feste Kapazitaeten. Bemessen am ungueltigsten realistischen Fall: dauerhaft 50-ms-Frames
 * (20 fps), bei denen die framerate-gekoppelte Emission ueberhaupt erst anspringt, mit rund
 * sechs gleichzeitigen Wolken. Daraus folgen je Wolke ~222 (edge), ~54 (inner), ~50 (accent)
 * und ~80 (plume) gleichzeitig lebende Member. Auf 60 fps bleiben alle Pools leer.
 * Kein Resize im Hotpath; bei Saettigung wird der Spawn verworfen und als Overrun gezaehlt.
 */
const FAMILY_CAPACITY: Readonly<Record<StinkParticleFamily, number>> = {
  inner: 512,
  plume: 768,
  accent: 512,
  edge: 1536,
};

/**
 * Tiefen wie bisher. `inner` lag auf `STINK_DEPTH` und damit exakt auf dem Container mit Haze
 * und Blobs – weil der Emitter je Wolke zur Laufzeit *nach* dem Container entstand, lag er
 * darueber. Der geteilte Layer entsteht beim Szenenaufbau und braucht dafuer den Epsilon-
 * Versatz; die anderen drei liegen ohnehin schon ueber dem Container.
 */
const FAMILY_DEPTH_OFFSET: Readonly<Record<StinkParticleFamily, number>> = {
  inner:  GPU_VFX_DEPTH_EPSILON,
  plume:  0.02,
  accent: 0.03,
  edge:   0.04,
};

/** Punkte der `edgeZone(radius, 56)`; die Emission laeuft sie der Reihe nach ab. */
const EDGE_POINT_COUNT = 56;

/** Nur `inner` und `plume` wechseln je Variante zwischen NORMAL und ADD. */
function isAdditiveVariant(variant: DamageZoneVisualStyle): boolean {
  return variant === 'electric' || variant === 'spore_void';
}

interface StinkCloudEmission {
  readonly id: number;
  readonly variant: DamageZoneVisualStyle;
  readonly tints: StinkCloudParticleTints;
  readonly additive: boolean;
  readonly flows: Record<StinkParticleFamily, ParticleFlowScheduler>;
  /** Laufender Index der Edge-Zone, wie Phasers `EdgeZone.counter`. */
  edgePoint: number;
  x: number;
  y: number;
  radius: number;
  alpha: number;
  pulseWave: number;
  visible: boolean;
}

/* ── Wiederverwendete Spawn-Vorlage; nur mutiert, nie neu angelegt ── */
const memberX: GpuVfxMemberAnimation     = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const memberY: GpuVfxMemberAnimation     = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const memberScale: GpuVfxMemberAnimation = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const memberAlpha: GpuVfxMemberAnimation = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const PUFF_MEMBER: GpuVfxMember = {
  x: memberX, y: memberY, scaleX: memberScale, scaleY: memberScale, alpha: memberAlpha,
  rotation: 0, tintBlend: 1,
  tintTopLeft: 0xffffff, tintTopRight: 0xffffff, tintBottomLeft: 0xffffff, tintBottomRight: 0xffffff,
};

const SPAWN_CIRCLE = new Phaser.Geom.Circle(0, 0, 1);
const SPAWN_POINT  = new Phaser.Math.Vector2(0, 0);

const FAMILY_ORDER: readonly StinkParticleFamily[] = ['inner', 'plume', 'accent', 'edge'];

export class StinkCloudGpuParticles {
  /** `inner` und `plume` brauchen je einen Layer pro Blend-Mode, `accent`/`edge` nur ADD. */
  private readonly emitters = new Map<string, GpuVfxEmitter>();
  private readonly clouds = new Map<number, StinkCloudEmission>();
  /** Parallel zur Map, damit der Emissions-Tick ohne Iterator-Allokation laeuft. */
  private readonly activeClouds: StinkCloudEmission[] = [];
  private readonly quality: GraphicsQualityController | null;

  constructor(
    scene: Phaser.Scene,
    registry: GpuVfxRegistry,
    texture: string,
    baseDepth: number,
  ) {
    this.quality = getGraphicsQualityController(scene);

    for (const family of FAMILY_ORDER) {
      const depth = baseDepth + FAMILY_DEPTH_OFFSET[family];
      const capacity = FAMILY_CAPACITY[family];
      const blendModes = family === 'inner' || family === 'plume'
        ? [Phaser.BlendModes.NORMAL, Phaser.BlendModes.ADD]
        : [Phaser.BlendModes.ADD];
      for (const blendMode of blendModes) {
        const additive = blendMode === Phaser.BlendModes.ADD;
        this.emitters.set(emitterKey(family, additive), registry.createEmitter({
          name: `stink-${family}${blendModes.length > 1 ? (additive ? '-add' : '-normal') : ''}`,
          texture,
          capacity,
          depth,
          blendMode,
          eases: ['Linear'],
        }));
      }
    }

    registry.registerEmission((deltaMs, nowMs) => this.emit(deltaMs, nowMs));
  }

  /** Beim Anlegen eines Wolkenbildes; die Tints sind je Variante bereits aufgeloest. */
  registerCloud(id: number, variant: DamageZoneVisualStyle, tints: StinkCloudParticleTints): void {
    this.releaseCloud(id);
    const emission: StinkCloudEmission = {
      id,
      variant,
      tints,
      additive: isAdditiveVariant(variant),
      flows: {
        inner:  new ParticleFlowScheduler(FAMILY_SPECS.inner.freqIdle),
        plume:  new ParticleFlowScheduler(FAMILY_SPECS.plume.freqIdle),
        accent: new ParticleFlowScheduler(FAMILY_SPECS.accent.freqIdle),
        edge:   new ParticleFlowScheduler(FAMILY_SPECS.edge.freqIdle),
      },
      edgePoint: -1,
      x: 0, y: 0, radius: 8, alpha: 0, pulseWave: 0, visible: false,
    };
    this.clouds.set(id, emission);
    this.activeClouds.push(emission);
  }

  /**
   * Pro Frame aus `updateVisual()`. Uebernimmt nur den aktuellen Wolkenzustand; gespawnte
   * Member werden nie wieder angefasst.
   */
  syncCloud(
    id: number,
    x: number,
    y: number,
    radius: number,
    alpha: number,
    pulseWave: number,
    visible: boolean,
  ): void {
    const emission = this.clouds.get(id);
    if (!emission) return;
    emission.x = x;
    emission.y = y;
    emission.radius = radius;
    emission.alpha = alpha;
    emission.pulseWave = pulseWave;
    emission.visible = visible;
  }

  /** Wolke entfernt, Variante gewechselt oder Teardown: alle lebenden Member freigeben. */
  releaseCloud(id: number): void {
    const emission = this.clouds.get(id);
    if (!emission) return;
    this.clouds.delete(id);
    const index = this.activeClouds.indexOf(emission);
    if (index >= 0) this.activeClouds.splice(index, 1);
    // Ueber alle Layer, nicht nur die der aktuellen Variante: ein Variantenwechsel kann
    // Material im jeweils anderen Blend-Layer hinterlassen haben.
    for (const emitter of this.emitters.values()) emitter.pool.releaseOwner(id);
  }

  releaseAll(): void {
    this.clouds.clear();
    this.activeClouds.length = 0;
    for (const emitter of this.emitters.values()) emitter.pool.releaseAll();
  }

  // ── Emission ───────────────────────────────────────────────────────────────

  /** Von der Registry nach dem Retire-Sweep gerufen, und nur ausserhalb der Ablation. */
  private emit(deltaMs: number, nowMs: number): void {
    // Die Flow-Dichte wird ueber das Intervall skaliert, nicht zusaetzlich ueber die Quantity –
    // sonst ginge der Faktor quadratisch ein.
    const factor = this.quality?.getProfile().particleFactors.standard ?? 1;
    if (factor <= 0) return;

    for (let index = 0; index < this.activeClouds.length; index += 1) {
      const emission = this.activeClouds[index];
      if (!emission.visible) continue;
      for (let f = 0; f < FAMILY_ORDER.length; f += 1) {
        this.emitFamily(emission, FAMILY_ORDER[f], deltaMs, nowMs, factor);
      }
    }
  }

  private emitFamily(
    emission: StinkCloudEmission,
    family: StinkParticleFamily,
    deltaMs: number,
    nowMs: number,
    qualityFactor: number,
  ): void {
    const spec = FAMILY_SPECS[family];
    const frequency = Math.max(
      1,
      Math.round(Math.floor(Phaser.Math.Linear(spec.freqIdle, spec.freqActive, emission.alpha)) / qualityFactor),
    );

    const flow = emission.flows[family];
    flow.setFrequency(frequency);
    // Ist-Zustand: `updateVisual()` ruft pro Frame `setFrequency()`, das den Countdown
    // zurueckstellt. Die Emission haengt damit allein an (frequency, delta).
    flow.resetCountdown();
    const emissions = flow.tick(deltaMs);
    if (emissions === 0) return;

    const emitter = this.emitters.get(emitterKey(family, family === 'inner' || family === 'plume' ? emission.additive : true));
    if (!emitter) return;

    for (let e = 0; e < emissions; e += 1) {
      for (let q = 0; q < spec.quantity; q += 1) {
        this.spawn(emitter, emission, family, spec, nowMs);
      }
    }
  }

  private spawn(
    emitter: GpuVfxEmitter,
    emission: StinkCloudEmission,
    family: StinkParticleFamily,
    spec: StinkFamilySpec,
    nowMs: number,
  ): void {
    const life = Phaser.Math.FloatBetween(spec.lifeMin, spec.lifeMax);
    const slot = emitter.pool.acquire(emission.id, nowMs, life);
    if (slot === GPU_VFX_NO_SLOT) return;

    // Zonenradien wie im bisherigen Resize-Pfad, jeweils aus dem aktuellen Wolkenradius.
    const target = Math.max(emission.radius * 0.86, 12);
    let originX = emission.x;
    let originY = emission.y;
    if (family === 'accent') originY -= emission.radius * 0.04;
    else if (family === 'plume') originY += emission.radius * 0.12;

    if (family === 'edge') {
      // `EdgeZone` laeuft die Punkte der Reihe nach ab und beginnt bei Index 0.
      emission.edgePoint = (emission.edgePoint + 1) % EDGE_POINT_COUNT;
      const angle = (emission.edgePoint / EDGE_POINT_COUNT) * Math.PI * 2;
      SPAWN_POINT.x = originX + Math.cos(angle) * target;
      SPAWN_POINT.y = originY + Math.sin(angle) * target;
    } else {
      const zoneRadius = family === 'inner'
        ? Math.max(target * 0.5, 8)
        : family === 'accent'
          ? Math.max(target * 0.36, 8)
          : Math.max(target * 0.28, 6);
      SPAWN_CIRCLE.setTo(originX, originY, zoneRadius);
      Phaser.Geom.Circle.Random(SPAWN_CIRCLE, SPAWN_POINT);
    }

    const lifeS = life / 1000;
    memberX.base      = SPAWN_POINT.x;
    memberX.amplitude = Phaser.Math.FloatBetween(-spec.speedXAbs, spec.speedXAbs) * lifeS;
    memberX.duration  = life;
    memberY.base      = SPAWN_POINT.y;
    memberY.amplitude = Phaser.Math.FloatBetween(spec.speedYMin, spec.speedYMax) * lifeS;
    memberY.duration  = life;

    memberScale.base      = spec.scaleStart;
    memberScale.amplitude = spec.scaleEnd - spec.scaleStart;
    memberScale.duration  = life;

    // Die Emitter-Alpha (AlphaSingle) multiplizierte bisher alle lebenden Partikel pro Frame.
    // Auf der GPU wird sie beim Spawn eingebacken – ein Member wird danach nicht mehr
    // angefasst. Waehrend der 300/500 ms Ein-/Ausblendung weicht das minimal ab.
    const emitterAlpha = this.resolveEmitterAlpha(family, emission);
    memberAlpha.base      = emitterAlpha * spec.alphaStart;
    memberAlpha.amplitude = -memberAlpha.base;
    memberAlpha.duration  = life;

    // `rotate: { min: 0, max: 360 }` wird einmal beim Emit gezogen und bleibt statisch.
    PUFF_MEMBER.rotation = Phaser.Math.DegToRad(Phaser.Math.FloatBetween(0, 360));
    setGpuVfxTint(PUFF_MEMBER, pickGpuVfxTint(emission.tints[family]));

    emitter.layer.editMember(slot, PUFF_MEMBER);
  }

  private resolveEmitterAlpha(family: StinkParticleFamily, emission: StinkCloudEmission): number {
    const alpha = emission.alpha;
    switch (family) {
      case 'inner':  return Phaser.Math.Linear(0.12, 0.28, alpha);
      case 'plume':  return Phaser.Math.Linear(0.08, 0.18, alpha);
      case 'accent': return Phaser.Math.Linear(0.08, 0.18 + emission.pulseWave * 0.14, alpha);
      case 'edge':   return Phaser.Math.Linear(0.1, 0.24, alpha);
    }
  }
}

function emitterKey(family: StinkParticleFamily, additive: boolean): string {
  return `${family}:${additive ? 'add' : 'normal'}`;
}
