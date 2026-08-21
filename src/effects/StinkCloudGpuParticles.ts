import * as Phaser from 'phaser';
import type { DamageZoneVisualStyle } from '../types';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { pickGpuVfxTint } from './gpu/GpuVfxMember';
import { GpuVfxLaneId } from './gpu/GpuVfxRenderLanes';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import { GPU_VFX_NO_SOURCE_HANDLE, type GpuVfxSystem } from './gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';

/**
 * Die vier kontinuierlichen Wolkenpartikel-Familien auf dem gemeinsamen GPU-VFX-Backend.
 *
 * Ersetzt die bisherigen vier `ParticleEmitter` *pro Wolke*. Die Wolkenbilder selbst (Haze,
 * Blobs, Ground/Glow/Pulse, Fairness-Kreis, Bolts, Licht) bleiben unveraendert auf der CPU – das
 * Hybridmodell ist Absicht und kein Zwischenstand.
 *
 * ## Warum die Emission an der Framerate haengt
 *
 * `StinkCloudSystem.updateVisual()` rief pro Frame `setFrequency()` auf jeden Emitter, und
 * Phasers `setFrequency()` setzt `flowCounter = frequency` zurueck. Die `UpdateList` laeuft auf
 * `SceneEvents.UPDATE` vor `scene.update()`, der Zaehler wurde also je Frame um genau ein Delta
 * verringert und danach wieder hochgesetzt. Bei Frequenzen von 18–92 ms erreicht er auf 60 fps
 * nie null: die vier Familien emittieren dort **gar nichts** und melden sich erst, wenn ein Frame
 * laenger dauert als die Frequenz.
 *
 * Diese Klasse bildet genau das nach – `resetCountdown()` pro Frame. Ob die Wolke bei 60 fps
 * wieder emittieren soll, ist ein eigener optischer Bugfix und haengt an genau dieser Zeile. Die
 * generische Infrastruktur kennt diesen Sonderfall bewusst nicht; sie bekommt nur fertige
 * Spawn-Auftraege.
 *
 * Ebenfalls Ist-Zustand: die `setParticleScale()`-Aufrufe pro Frame waren wirkungslos
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
  readonly effect: GpuVfxEffectId;
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
    effect: GpuVfxEffectId.StinkInner,
    lifeMin: 900, lifeMax: 1800, speedXAbs: 18, speedYMin: -16, speedYMax: 10,
    scaleStart: 0.34, scaleEnd: 1.0, alphaStart: 0.2, freqIdle: 74, freqActive: 34, quantity: 2,
  },
  plume: {
    effect: GpuVfxEffectId.StinkPlume,
    lifeMin: 1400, lifeMax: 2600, speedXAbs: 10, speedYMin: -34, speedYMax: -12,
    scaleStart: 0.3, scaleEnd: 1.26, alphaStart: 0.16, freqIdle: 92, freqActive: 42, quantity: 2,
  },
  accent: {
    effect: GpuVfxEffectId.StinkAccent,
    lifeMin: 900, lifeMax: 1600, speedXAbs: 14, speedYMin: -20, speedYMax: 6,
    scaleStart: 0.12, scaleEnd: 0.42, alphaStart: 0.34, freqIdle: 54, freqActive: 18, quantity: 1,
  },
  edge: {
    effect: GpuVfxEffectId.StinkEdge,
    lifeMin: 1300, lifeMax: 2400, speedXAbs: 18, speedYMin: -18, speedYMax: 18,
    scaleStart: 0.22, scaleEnd: 1.36, alphaStart: 0.22, freqIdle: 54, freqActive: 24, quantity: 3,
  },
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
  /** Numerischer Source-Handle des Backends; alle Member dieser Wolke haengen daran. */
  readonly source: number;
  /** Laufender Index der Edge-Zone, wie Phasers `EdgeZone.counter`. */
  edgePoint: number;
  x: number;
  y: number;
  radius: number;
  alpha: number;
  pulseWave: number;
  visible: boolean;
}

const SPAWN_CIRCLE = new Phaser.Geom.Circle(0, 0, 1);
const SPAWN_POINT  = new Phaser.Math.Vector2(0, 0);

const FAMILY_ORDER: readonly StinkParticleFamily[] = ['inner', 'plume', 'accent', 'edge'];

export class StinkCloudGpuParticles {
  private readonly clouds = new Map<number, StinkCloudEmission>();
  /** Parallel zur Map, damit der Emissions-Tick ohne Iterator-Allokation laeuft. */
  private readonly activeClouds: StinkCloudEmission[] = [];
  /** Ein Spawn-Spec je Familie; die Lane wird je Wolkenvariante umgeschrieben. */
  private readonly specs: Record<StinkParticleFamily, GpuVfxSpawnSpec>;

  constructor(private readonly system: GpuVfxSystem) {
    this.specs = {
      inner:  system.createSpec(FAMILY_SPECS.inner.effect),
      plume:  system.createSpec(FAMILY_SPECS.plume.effect),
      accent: system.createSpec(FAMILY_SPECS.accent.effect),
      edge:   system.createSpec(FAMILY_SPECS.edge.effect),
    };
    for (const family of FAMILY_ORDER) {
      const spec = FAMILY_SPECS[family];
      this.specs[family].scaleStart = spec.scaleStart;
      this.specs[family].scaleEnd   = spec.scaleEnd;
      this.specs[family].alphaEnd   = 0;
    }

    system.registerEmission((deltaMs, nowMs) => this.emit(deltaMs, nowMs));
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
      source: this.system.createSource(GpuVfxEffectId.StinkInner),
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

  /**
   * Wolke entfernt, Variante gewechselt oder Teardown: alle lebenden Member freigeben.
   *
   * Ein Variantenwechsel kann Material in der jeweils anderen Blend-Lane hinterlassen haben.
   * Das Backend raeumt die Quelle ueber alle Lanes hinweg ab, ohne dass hier jemand die Lanes
   * kennen muesste – und in O(Partikel dieser Wolke) statt ueber ganze Pools.
   */
  releaseCloud(id: number): void {
    const emission = this.clouds.get(id);
    if (!emission) return;
    this.clouds.delete(id);
    const index = this.activeClouds.indexOf(emission);
    if (index >= 0) this.activeClouds.splice(index, 1);
    if (emission.source !== GPU_VFX_NO_SOURCE_HANDLE) this.system.releaseSource(emission.source);
  }

  releaseAll(): void {
    for (const emission of this.activeClouds) {
      if (emission.source !== GPU_VFX_NO_SOURCE_HANDLE) this.system.releaseSource(emission.source);
    }
    this.clouds.clear();
    this.activeClouds.length = 0;
  }

  // ── Emission ───────────────────────────────────────────────────────────────

  /** Vom Backend nach dem Retire-Sweep gerufen, und nur ausserhalb der Ablation. */
  private emit(deltaMs: number, nowMs: number): void {
    for (let index = 0; index < this.activeClouds.length; index += 1) {
      const emission = this.activeClouds[index];
      if (!emission.visible) continue;
      for (let f = 0; f < FAMILY_ORDER.length; f += 1) {
        this.emitFamily(emission, FAMILY_ORDER[f], deltaMs, nowMs);
      }
    }
  }

  private emitFamily(
    emission: StinkCloudEmission,
    family: StinkParticleFamily,
    deltaMs: number,
    nowMs: number,
  ): void {
    const spec = FAMILY_SPECS[family];
    // Die Flow-Dichte wird ueber das Intervall skaliert, nicht zusaetzlich ueber die Quantity –
    // sonst ginge der Qualitaetsfaktor quadratisch ein.
    const base = Math.floor(Phaser.Math.Linear(spec.freqIdle, spec.freqActive, emission.alpha));
    const frequency = this.system.quality.scaleFrequency(base, spec.effect);
    if (frequency <= 0) {
      this.system.recordQualityDrop(spec.effect);
      return;
    }

    const flow = emission.flows[family];
    flow.setFrequency(frequency);
    // Ist-Zustand: `updateVisual()` rief pro Frame `setFrequency()`, das den Countdown
    // zurueckstellt. Die Emission haengt damit allein an (frequency, delta).
    flow.resetCountdown();
    const emissions = flow.tick(deltaMs);
    if (emissions === 0) return;

    // Nur `inner` und `plume` wechseln die Lane; `accent` und `edge` zeichnen immer additiv.
    const additive = family === 'inner' || family === 'plume' ? emission.additive : true;
    this.specs[family].lane = resolveLane(family, additive);

    for (let e = 0; e < emissions; e += 1) {
      for (let q = 0; q < spec.quantity; q += 1) {
        this.spawn(emission, family, spec, nowMs);
      }
    }
  }

  private spawn(
    emission: StinkCloudEmission,
    family: StinkParticleFamily,
    spec: StinkFamilySpec,
    nowMs: number,
  ): void {
    const target = Math.max(emission.radius * 0.86, 12);
    let originX = emission.x;
    let originY = emission.y;
    if (family === 'accent') originY -= emission.radius * 0.04;
    else if (family === 'plume') originY += emission.radius * 0.12;

    const spawnSpec = this.specs[family];
    // Ziehreihenfolge wie bisher: erst Lebenszeit, dann Zone, dann Geschwindigkeit.
    spawnSpec.lifeMs = Phaser.Math.FloatBetween(spec.lifeMin, spec.lifeMax);

    if (family === 'edge') {
      // `EdgeZone` laeuft die Punkte der Reihe nach ab und beginnt bei Index 0.
      emission.edgePoint = (emission.edgePoint + 1) % EDGE_POINT_COUNT;
      const angle = (emission.edgePoint / EDGE_POINT_COUNT) * Math.PI * 2;
      SPAWN_POINT.x = originX + Math.cos(angle) * target;
      SPAWN_POINT.y = originY + Math.sin(angle) * target;
    } else {
      // Zonenradien wie im bisherigen Resize-Pfad, jeweils aus dem aktuellen Wolkenradius.
      const zoneRadius = family === 'inner'
        ? Math.max(target * 0.5, 8)
        : family === 'accent'
          ? Math.max(target * 0.36, 8)
          : Math.max(target * 0.28, 6);
      SPAWN_CIRCLE.setTo(originX, originY, zoneRadius);
      Phaser.Geom.Circle.Random(SPAWN_CIRCLE, SPAWN_POINT);
    }

    spawnSpec.x  = SPAWN_POINT.x;
    spawnSpec.y  = SPAWN_POINT.y;
    spawnSpec.vx = Phaser.Math.FloatBetween(-spec.speedXAbs, spec.speedXAbs);
    spawnSpec.vy = Phaser.Math.FloatBetween(spec.speedYMin, spec.speedYMax);

    // Die Emitter-Alpha (AlphaSingle) multiplizierte bisher alle lebenden Partikel pro Frame.
    // Auf der GPU wird sie beim Spawn eingebacken – ein Member wird danach nicht mehr
    // angefasst. Waehrend der 300/500 ms Ein-/Ausblendung weicht das minimal ab.
    spawnSpec.alphaStart = this.resolveEmitterAlpha(family, emission) * spec.alphaStart;

    // `rotate: { min: 0, max: 360 }` wird einmal beim Emit gezogen und bleibt statisch.
    spawnSpec.rotation = Phaser.Math.DegToRad(Phaser.Math.FloatBetween(0, 360));
    spawnSpec.tint = pickGpuVfxTint(emission.tints[family]);

    this.system.spawn(spawnSpec, emission.source, nowMs);
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

/**
 * Variantenrouting: dieselbe Familie zeichnet je nach Wolke normal oder additiv. Alle vier
 * Familien teilen sich zwei physische Lanes; unterscheidbar bleiben sie ueber ihre Effekt-Id im
 * Profiler, nicht ueber den Layer.
 */
function resolveLane(family: StinkParticleFamily, additive: boolean): GpuVfxLaneId {
  if (family === 'accent' || family === 'edge') return GpuVfxLaneId.StinkAdd;
  return additive ? GpuVfxLaneId.StinkAdd : GpuVfxLaneId.StinkNormal;
}
