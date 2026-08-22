import * as Phaser from 'phaser';
import {
  ARENA_HEIGHT,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_WIDTH,
  COLORS,
  DEPTH_FX,
} from '../config';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import type {
  CoopDefenseEncounterPresentationPhase,
  CoopDefenseEncounterPresentationState,
  SpawnFront,
} from '../types';
import {
  createQualityEmitter,
  ensureCanvasTexture,
  killAllAndResetParticlePositions,
  registerGraphicsObject,
  setEmitterTintArray,
} from './EffectUtils';

const TEX_ENCOUNTER_SPARK = '__coop_defense_encounter_spark';
const TEX_ENCOUNTER_HAZE = '__coop_defense_encounter_haze';
const TEX_ENCOUNTER_EDGE = '__coop_defense_encounter_edge';

/**
 * Dicke der Kantenlinie quer zur Front. Sie ist die lokale Breite des rotierten Bildes; die
 * lokale Höhe trägt immer die Spanne entlang der Front.
 */
const EDGE_THICKNESS = 26;

/** Vertikale Reserve, damit die Front nicht in den Arenarahmen läuft. */
const TELEGRAPH_INSET = 30;
const CHEVRON_ROWS = 7;
/** Weglänge einer Marschmarke, bevor sie wieder an der Kante beginnt. */
const CHEVRON_TRAVEL = 190;
const CHEVRON_START_OFFSET = 16;
const CHEVRON_HALF_H = 11;
const CHEVRON_LENGTH = 15;
const CHEVRON_THICKNESS = 5;
const SPAWN_COMPLETE_FADE_MS = 4_200;
/**
 * Der Ankunftslook hält über den host-seitigen Wechsel `incoming` → `active` hinaus und klingt
 * danach über die Release-Zeitkonstante aus. Der Host-Vertrag bleibt unberührt; das ist reine
 * Darstellungszeit im Renderer.
 */
const ARRIVAL_SUSTAIN_MS = 1_000;
/** Partikelstoß entlang der Kante im Moment der Ankunft. */
const ARRIVAL_BURST_PARTICLES = 26;
const ARRIVAL_BURST_MIN_WEIGHT = 0.35;
/** Anteil der Clear-Phase, der auf voller Stärke steht, bevor der Erfolgsglanz ausblendet. */
const CLEARED_HOLD_RATIO = 0.4;
/** Zeitkonstanten der exponentiellen Angleichung; Aufbau schnell, Ausklang lang. */
const INTENSITY_ATTACK_TAU_MS = 240;
const INTENSITY_RELEASE_TAU_MS = 820;
const SHAPE_TAU_MS = 320;
const COLOR_TAU_MS = 260;
const FRONT_FADE_IN_MS = 240;
const FRONT_FADE_OUT_MS = 620;
const FRONT_WEIGHT_EPSILON = 0.01;
const MIN_VISIBLE_INTENSITY = 0.02;
/** Obergrenze eines Integrationsschritts, damit ein Frame-Hänger keinen Sprung erzeugt. */
const MAX_SYNC_STEP_MS = 120;
/** Tiefe der Driftzone nach innen und Abstand ihres Emitters zur Kante. */
const DRIFT_ZONE_DEPTH = 10;
const DRIFT_ZONE_OFFSET = 4;
/** Die Kantenzone ist eine Linie; ihre Breite kommt allein aus der Partikelgröße. */
const CREST_ZONE_DEPTH = 2;
/**
 * Die Schwadenzone deckt nur den vorderen Teil der Wandtiefe ab. Den Rest tragen Flugbahn und
 * Ausblenden der Schwaden, damit die Wand nach innen ausläuft statt an einer Kante zu enden.
 */
const HAZE_ZONE_DEPTH_RATIO = 0.34;
/** Ecken bleiben partikelfrei, damit die Front nicht in den Arenarahmen ausfranst. */
const ZONE_END_INSET = 14;

const FALLBACK_FRONTS: readonly SpawnFront[] = ['west'];

interface TelegraphProfile {
  readonly color: number;
  /** Reichweite der Lichtwand nach innen; sie steuert nur die Schwadenzone, keine Kante. */
  readonly hazeDepth: number;
  readonly chevronSpeed: number;
  /** Marschmarken pro Reihe; gebrochene Zwischenwerte blenden eine Marke ein oder aus. */
  readonly chevronDensity: number;
  readonly intensity: number;
  /** Emissionsintervall der Lichtschwaden in ms; sie tragen das Volumen der Front. */
  readonly hazeFrequency: number;
  /** Emissionsintervall der nach innen ziehenden Funken in ms. */
  readonly driftFrequency: number;
  /** Emissionsintervall der Kantenfunken in ms; sie tragen die Lesbarkeit der Frontlinie. */
  readonly crestFrequency: number;
  readonly pulsePeriodMs: number;
  readonly pulseDepth: number;
  readonly sparkTints: readonly number[];
}

/** Fortlaufend angeglichener Ist-Zustand der Darstellung; keine Zielwerte, keine Spielregeln. */
interface TelegraphLook {
  red: number;
  green: number;
  blue: number;
  hazeDepth: number;
  chevronSpeed: number;
  chevronDensity: number;
  /** Partikel pro Sekunde; im Ratenraum interpoliert, weil `frequency` ein Kehrwert ist. */
  hazeRate: number;
  driftRate: number;
  crestRate: number;
  pulseRate: number;
  pulseDepth: number;
  intensity: number;
}

interface TelegraphFrontVisual {
  readonly edge: Phaser.GameObjects.Image;
  readonly haze: Phaser.GameObjects.Particles.ParticleEmitter;
  readonly drift: Phaser.GameObjects.Particles.ParticleEmitter;
  readonly crest: Phaser.GameObjects.Particles.ParticleEmitter;
  readonly hazeZone: Phaser.Geom.Rectangle;
  readonly driftZone: Phaser.Geom.Rectangle;
  readonly crestZone: Phaser.Geom.Rectangle;
  /** 0..1 Ein-/Ausblendung dieser Front, damit Frontwechsel nicht hart schalten. */
  weight: number;
}

const PROFILE_INCOMING: TelegraphProfile = {
  color: COLORS.PURPLE_1,
  hazeDepth: 152,
  chevronSpeed: 118,
  chevronDensity: 2,
  intensity: 1,
  hazeFrequency: 46,
  driftFrequency: 34,
  crestFrequency: 13,
  pulsePeriodMs: 115,
  pulseDepth: 0.18,
  sparkTints: [0xffffff, COLORS.PURPLE_1, COLORS.PURPLE_3],
};
const PROFILE_ACTIVE: TelegraphProfile = {
  color: COLORS.PURPLE_2,
  hazeDepth: 94,
  chevronSpeed: 62,
  chevronDensity: 1,
  intensity: 0.44,
  hazeFrequency: 130,
  driftFrequency: 110,
  crestFrequency: 40,
  pulsePeriodMs: 210,
  pulseDepth: 0.16,
  sparkTints: [0xffffff, COLORS.PURPLE_1, COLORS.PURPLE_3],
};
const PROFILE_REST: TelegraphProfile = {
  color: COLORS.PURPLE_2,
  hazeDepth: 70,
  chevronSpeed: 28,
  chevronDensity: 1,
  intensity: 0.22,
  hazeFrequency: 280,
  driftFrequency: 260,
  crestFrequency: 90,
  pulsePeriodMs: 260,
  pulseDepth: 0.14,
  sparkTints: [0xffffff, COLORS.PURPLE_1, COLORS.PURPLE_3],
};
const PROFILE_CLEARED: TelegraphProfile = {
  color: COLORS.GREEN_2,
  hazeDepth: 94,
  chevronSpeed: 38,
  chevronDensity: 1,
  intensity: 0.55,
  hazeFrequency: 110,
  driftFrequency: 150,
  crestFrequency: 30,
  pulsePeriodMs: 195,
  pulseDepth: 0.16,
  sparkTints: [0xffffff, COLORS.GREEN_1, COLORS.GREEN_3],
};

/** Welt-Telegraph für den host-autoritativ replizierten Encounter-Zustand. */
export class CoopDefenseEncounterTelegraphRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly visuals = new Map<SpawnFront, TelegraphFrontVisual>();
  private readonly look: TelegraphLook = createLook(PROFILE_REST);
  private activeProfile: TelegraphProfile = PROFILE_REST;
  private activeSparkTints: readonly number[] | null = null;
  private lastEncounterId: string | null = null;
  private lastPhase: CoopDefenseEncounterPresentationPhase | null = null;
  private spawnCompleteFadeStartedAtMs: number | null = null;
  private arrivalSustainUntilMs = 0;
  private pendingArrivalBurst = false;
  private lastSyncMs: number | null = null;
  /** Fortlaufend integrierte Animationsphasen; sie überleben jeden Profilwechsel sprungfrei. */
  private chevronPhase = 0;
  private pulsePhase = 0;
  private dormant = true;
  private readonly chevronPoints: Phaser.Math.Vector2[] = Array.from(
    { length: 6 },
    () => new Phaser.Math.Vector2(0, 0),
  );

  constructor(private readonly scene: Phaser.Scene) {
    this.graphics = scene.add.graphics()
      .setDepth(DEPTH_FX)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    registerGraphicsObject(scene, 'encounterTelegraphs', this.graphics);
  }

  generateTextures(): void {
    ensureCanvasTexture(this.scene.textures, TEX_ENCOUNTER_SPARK, 12, 12, (ctx) => {
      const center = 6;
      const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.35, 'rgba(232,210,255,0.85)');
      gradient.addColorStop(1, 'rgba(174,88,220,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 12, 12);
    });

    // Runde Schwade mit weichem Auslauf. Sie ersetzt das frühere Bandbild: eine gestreckte
    // Verlaufsfläche endet additiv über dunklem Boden als sichtbare gerade Kante, eine Wolke
    // aus überlappenden Schwaden hat keine.
    ensureCanvasTexture(this.scene.textures, TEX_ENCOUNTER_HAZE, 64, 64, (ctx) => {
      const center = 32;
      const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
      gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
      gradient.addColorStop(0.35, 'rgba(255,255,255,0.4)');
      gradient.addColorStop(0.68, 'rgba(255,255,255,0.12)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
    });

    ensureCanvasTexture(this.scene.textures, TEX_ENCOUNTER_EDGE, 32, 64, (ctx) => {
      const horizontal = ctx.createLinearGradient(0, 0, 32, 0);
      horizontal.addColorStop(0, 'rgba(255,255,255,0)');
      horizontal.addColorStop(0.42, 'rgba(255,255,255,0.55)');
      horizontal.addColorStop(0.5, 'rgba(255,255,255,1)');
      horizontal.addColorStop(0.58, 'rgba(255,255,255,0.55)');
      horizontal.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = horizontal;
      ctx.fillRect(0, 0, 32, 64);
      applyVerticalFalloff(ctx, 32, 64);
    });

    for (const front of ['west', 'north', 'east', 'south'] as const) {
      if (this.visuals.has(front)) continue;
      const edge = this.scene.add.image(0, 0, TEX_ENCOUNTER_EDGE)
        .setOrigin(0.5, 0.5)
        .setDepth(DEPTH_FX - 0.1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false);
      // Alle Zonen sind emitterlokal und werden pro Frame auf die aktuelle Frontspanne gesetzt.
      const hazeZone = new Phaser.Geom.Rectangle(0, 0, DRIFT_ZONE_DEPTH, ARENA_HEIGHT);
      const driftZone = new Phaser.Geom.Rectangle(0, 0, DRIFT_ZONE_DEPTH, ARENA_HEIGHT);
      const crestZone = new Phaser.Geom.Rectangle(0, 0, CREST_ZONE_DEPTH, ARENA_HEIGHT);
      const haze = createQualityEmitter(this.scene, 0, 0, TEX_ENCOUNTER_HAZE, {
        lifespan: { min: 900, max: 1700 },
        frequency: 120,
        quantity: 1,
        speedX: this.getHazeSpeedX(front),
        speedY: this.getHazeSpeedY(front),
        scale: { start: 1.05, end: 2.1 },
        alpha: { start: 0.1, end: 0 },
        tint: [0xffffff, COLORS.PURPLE_1, COLORS.PURPLE_3],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      }, 'critical', 'coopDefenseTelegraph');
      const drift = createQualityEmitter(this.scene, 0, 0, TEX_ENCOUNTER_SPARK, {
        lifespan: { min: 360, max: 820 },
        frequency: 90,
        quantity: 1,
        speedX: this.getDriftSpeedX(front),
        speedY: this.getDriftSpeedY(front),
        scale: { start: 0.72, end: 0.06 },
        alpha: { start: 0.8, end: 0 },
        tint: [0xffffff, COLORS.PURPLE_1, COLORS.PURPLE_3],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      }, 'critical', 'coopDefenseTelegraph');
      const crest = createQualityEmitter(this.scene, 0, 0, TEX_ENCOUNTER_SPARK, {
        lifespan: { min: 170, max: 430 },
        frequency: 30,
        quantity: 1,
        speedX: this.getCrestSpeedX(front),
        speedY: this.getCrestSpeedY(front),
        scale: { start: 0.5, end: 0.02 },
        alpha: { start: 0.95, end: 0 },
        tint: [0xffffff, COLORS.PURPLE_1, COLORS.PURPLE_3],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      }, 'critical', 'coopDefenseTelegraph');
      haze.setDepth(DEPTH_FX - 0.2).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      drift.setDepth(DEPTH_FX + 0.1).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      crest.setDepth(DEPTH_FX + 0.15).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      for (const [emitter, zone] of [[haze, hazeZone], [drift, driftZone], [crest, crestZone]] as const) {
        emitter.addEmitZone({
          type: 'random',
          source: zone,
        } as unknown as Phaser.Types.GameObjects.Particles.EmitZoneData);
        emitter.stop();
      }
      this.visuals.set(front, { edge, haze, drift, crest, hazeZone, driftZone, crestZone, weight: 0 });
    }
  }

  sync(
    state: CoopDefenseEncounterPresentationState | null,
    elapsedMs: number,
    inArena: boolean,
  ): void {
    if (!inArena || this.visuals.size === 0) {
      this.clear();
      return;
    }

    const now = Number.isFinite(elapsedMs) ? elapsedMs : this.lastSyncMs ?? 0;
    const dtMs = this.advanceClock(now);
    const live = state !== null && state.phase !== 'complete' ? state : null;
    const target = live !== null
      ? this.resolveTarget(live, now)
      : { profile: this.activeProfile, intensity: 0, fronts: [] as readonly SpawnFront[] };
    // Ein beendeter oder abgeräumter Encounter klingt aus, statt hart zu verschwinden.
    if (live === null) this.forgetEncounter(state === null);

    this.integrateLook(target.profile, target.intensity, dtMs);
    this.activeProfile = target.profile;
    this.pulsePhase = (this.pulsePhase + dtMs * this.look.pulseRate) % (Math.PI * 2);
    this.chevronPhase = (this.chevronPhase + (dtMs / 1000) * this.look.chevronSpeed) % CHEVRON_TRAVEL;

    const maxWeight = this.updateFrontWeights(target.fronts, dtMs);
    // Die Ruhegrenze prüft den ungepulsten Ist-Wert, damit der Puls kein Ein-/Ausschalten flackert.
    if (this.look.intensity <= MIN_VISIBLE_INTENSITY || maxWeight <= FRONT_WEIGHT_EPSILON) {
      this.goDormant();
      return;
    }
    const pulse = 0.78 + Math.sin(this.pulsePhase) * this.look.pulseDepth;
    const intensity = Phaser.Math.Clamp(this.look.intensity * pulse, 0, 1);

    this.dormant = false;
    if (target.profile.sparkTints !== this.activeSparkTints) {
      this.activeSparkTints = target.profile.sparkTints;
      for (const visual of this.visuals.values()) {
        for (const emitter of [visual.haze, visual.drift, visual.crest]) {
          setEmitterTintArray(emitter, [...target.profile.sparkTints]);
        }
      }
    }

    this.graphics.clear().setVisible(true);
    const color = Phaser.Display.Color.GetColor(
      Math.round(this.look.red),
      Math.round(this.look.green),
      Math.round(this.look.blue),
    );
    // Der Telegraph ist Lesbarkeit, kein Schmuck: die Partikelmenge skaliert mit der Qualität,
    // sie verschwindet nicht.
    const particleFactor = getGraphicsQualityProfile(this.scene).particleFactors.critical;
    const camera = this.scene.cameras.main;
    const zoom = Math.max(0.1, camera.zoom);
    const visibleLeft = camera.scrollX + 6 / zoom;
    const visibleRight = camera.scrollX + camera.width / zoom - 6 / zoom;
    const visibleTop = camera.scrollY + 6 / zoom;
    const visibleBottom = camera.scrollY + camera.height / zoom - 6 / zoom;
    const top = ARENA_OFFSET_Y + TELEGRAPH_INSET;
    const bottom = ARENA_OFFSET_Y + ARENA_HEIGHT - TELEGRAPH_INSET;
    const left = ARENA_OFFSET_X + 5;
    const right = ARENA_OFFSET_X + ARENA_WIDTH - 5;

    for (const [front, visual] of this.visuals) {
      if (visual.weight <= FRONT_WEIGHT_EPSILON) {
        this.softHideVisual(visual);
        continue;
      }
      const frontIntensity = intensity * visual.weight;
      const layout = this.getFrontLayout(front, left, right, top, bottom, visibleLeft, visibleRight, visibleTop, visibleBottom);

      // Die lokale Breite ist immer die Dicke quer zur Front, die lokale Höhe immer die Spanne
      // entlang der Front; die Rotation ordnet beide der jeweiligen Weltachse zu.
      visual.edge
        .setPosition(layout.rimX, layout.rimY)
        .setRotation(layout.rotation)
        .setDisplaySize(EDGE_THICKNESS, layout.spanLength)
        .setTint(color)
        .setAlpha(Phaser.Math.Clamp(0.85 * frontIntensity, 0, 1))
        .setVisible(true);

      this.drawChevrons(front, layout, color, frontIntensity);

      this.updateEmitZones(visual, layout);
      visual.haze
        .setPosition(layout.rimX, layout.rimY)
        .setAlpha(Phaser.Math.Clamp(frontIntensity * 1.4, 0, 1))
        .setVisible(true);
      visual.drift
        .setPosition(layout.rimX + layout.inwardX * DRIFT_ZONE_OFFSET, layout.rimY + layout.inwardY * DRIFT_ZONE_OFFSET)
        .setAlpha(Phaser.Math.Clamp(frontIntensity * 1.1, 0, 1))
        .setVisible(true);
      visual.crest
        .setPosition(layout.rimX, layout.rimY)
        .setAlpha(Phaser.Math.Clamp(frontIntensity * 1.3, 0, 1))
        .setVisible(true);
      this.driveEmitter(visual.haze, this.look.hazeRate, visual.weight, particleFactor);
      this.driveEmitter(visual.drift, this.look.driftRate, visual.weight, particleFactor);
      this.driveEmitter(visual.crest, this.look.crestRate, visual.weight, particleFactor);
      if (this.pendingArrivalBurst && visual.weight >= ARRIVAL_BURST_MIN_WEIGHT) {
        visual.crest.emitParticleAt(undefined, undefined, ARRIVAL_BURST_PARTICLES);
      }
    }
    this.pendingArrivalBurst = false;
  }

  clear(): void {
    this.resetTimeline();
    this.goDormant();
  }

  destroy(): void {
    this.clear();
    for (const visual of this.visuals.values()) {
      visual.haze.destroy();
      visual.drift.destroy();
      visual.crest.destroy();
      visual.edge.destroy();
    }
    this.visuals.clear();
    this.activeSparkTints = null;
    this.graphics.destroy();
  }

  /** Setzt Zeitachse und Ist-Look zurück; nur für Teardown und Arenawechsel. */
  private resetTimeline(): void {
    assignLook(this.look, PROFILE_REST);
    this.activeProfile = PROFILE_REST;
    this.lastEncounterId = null;
    this.lastPhase = null;
    this.spawnCompleteFadeStartedAtMs = null;
    this.arrivalSustainUntilMs = 0;
    this.pendingArrivalBurst = false;
    this.lastSyncMs = null;
    this.chevronPhase = 0;
    this.pulsePhase = 0;
  }

  private goDormant(): void {
    if (this.dormant) return;
    this.dormant = true;
    this.graphics.clear().setVisible(false);
    for (const visual of this.visuals.values()) this.hideVisual(visual);
  }

  private forgetEncounter(fullyGone: boolean): void {
    this.lastPhase = null;
    this.spawnCompleteFadeStartedAtMs = null;
    this.arrivalSustainUntilMs = 0;
    if (fullyGone) this.lastEncounterId = null;
  }

  private advanceClock(now: number): number {
    const previous = this.lastSyncMs;
    this.lastSyncMs = now;
    if (previous === null) return 0;
    const delta = now - previous;
    if (!Number.isFinite(delta) || delta <= 0) return 0;
    return Math.min(delta, MAX_SYNC_STEP_MS);
  }

  /**
   * Übersetzt den replizierten Phasenzustand in Zielprofil und Zielintensität. Der Renderer
   * bewertet hier nur Darstellung; Phasen, Zeiten und Fronten stammen unverändert vom Host.
   */
  private resolveTarget(
    state: CoopDefenseEncounterPresentationState,
    now: number,
  ): { profile: TelegraphProfile; intensity: number; fronts: readonly SpawnFront[] } {
    if (state.encounterId !== this.lastEncounterId) {
      this.lastEncounterId = state.encounterId;
      this.lastPhase = null;
      this.spawnCompleteFadeStartedAtMs = null;
      this.arrivalSustainUntilMs = 0;
    }
    if (state.phase !== this.lastPhase) {
      if (this.lastPhase === 'incoming' && state.phase === 'active') {
        this.arrivalSustainUntilMs = now + ARRIVAL_SUSTAIN_MS;
        this.pendingArrivalBurst = true;
      }
      this.lastPhase = state.phase;
    }
    if (state.phase === 'active' && state.spawnComplete === true) {
      this.spawnCompleteFadeStartedAtMs ??= now;
    } else {
      this.spawnCompleteFadeStartedAtMs = null;
    }

    const phaseProgress = state.phaseEndsAtMs === null
      ? 1
      : Phaser.Math.Clamp(
        (now - state.phaseStartedAtMs) / Math.max(1, state.phaseEndsAtMs - state.phaseStartedAtMs),
        0,
        1,
      );
    const isIncoming = state.phase === 'incoming';
    const isCleared = state.phase === 'cleared';
    const isRest = state.phase === 'rest';
    const sustainsArrival = state.phase === 'active' && now < this.arrivalSustainUntilMs;
    const profile = isIncoming || sustainsArrival
      ? PROFILE_INCOMING
      : isCleared
        ? PROFILE_CLEARED
        : isRest
          ? PROFILE_REST
          : PROFILE_ACTIVE;
    const spawnCompleteFade = this.spawnCompleteFadeStartedAtMs === null
      ? 1
      : 1 - Phaser.Math.Clamp((now - this.spawnCompleteFadeStartedAtMs) / SPAWN_COMPLETE_FADE_MS, 0, 1);
    const clearedFade = 1 - Phaser.Math.Clamp(
      (phaseProgress - CLEARED_HOLD_RATIO) / (1 - CLEARED_HOLD_RATIO),
      0,
      1,
    );
    const fade = isCleared ? clearedFade : spawnCompleteFade;
    const restRamp = isRest ? 0.7 + phaseProgress * 0.3 : 1;
    // Die Ankündigung schwillt über ihr Zeitfenster an und erreicht ihren Höhepunkt am Spawn.
    const incomingRamp = isIncoming ? 0.52 + phaseProgress * 0.48 : 1;
    return {
      profile,
      intensity: profile.intensity * fade * restRamp * incomingRamp,
      fronts: state.fronts?.length > 0 ? state.fronts : FALLBACK_FRONTS,
    };
  }

  private integrateLook(profile: TelegraphProfile, targetIntensity: number, dtMs: number): void {
    const look = this.look;
    const shape = easeFactor(dtMs, SHAPE_TAU_MS);
    look.hazeDepth += (profile.hazeDepth - look.hazeDepth) * shape;
    look.chevronSpeed += (profile.chevronSpeed - look.chevronSpeed) * shape;
    look.chevronDensity += (profile.chevronDensity - look.chevronDensity) * shape;
    look.hazeRate += (1000 / profile.hazeFrequency - look.hazeRate) * shape;
    look.driftRate += (1000 / profile.driftFrequency - look.driftRate) * shape;
    look.crestRate += (1000 / profile.crestFrequency - look.crestRate) * shape;
    look.pulseRate += (1 / profile.pulsePeriodMs - look.pulseRate) * shape;
    look.pulseDepth += (profile.pulseDepth - look.pulseDepth) * shape;
    look.intensity += (targetIntensity - look.intensity) * easeFactor(
      dtMs,
      targetIntensity > look.intensity ? INTENSITY_ATTACK_TAU_MS : INTENSITY_RELEASE_TAU_MS,
    );
    // Solange nichts sichtbar ist, springt die Farbe; sichtbar blendet sie über.
    const colorFactor = look.intensity <= MIN_VISIBLE_INTENSITY ? 1 : easeFactor(dtMs, COLOR_TAU_MS);
    look.red += (((profile.color >> 16) & 0xff) - look.red) * colorFactor;
    look.green += (((profile.color >> 8) & 0xff) - look.green) * colorFactor;
    look.blue += ((profile.color & 0xff) - look.blue) * colorFactor;
  }

  private updateFrontWeights(fronts: readonly SpawnFront[], dtMs: number): number {
    let maxWeight = 0;
    for (const [front, visual] of this.visuals) {
      const target = fronts.includes(front) ? 1 : 0;
      visual.weight = target > visual.weight
        ? Math.min(target, visual.weight + dtMs / FRONT_FADE_IN_MS)
        : Math.max(target, visual.weight - dtMs / FRONT_FADE_OUT_MS);
      maxWeight = Math.max(maxWeight, visual.weight);
    }
    return maxWeight;
  }

  /**
   * Die Emissionsrate trägt die Stärke der Front. Sie wird als Rate skaliert und erst danach in
   * ein Intervall zurückgerechnet; `frequency` wird direkt gesetzt, weil setFrequency() den
   * Flow-Zähler jeden Frame zurücksetzen und den Fluss damit ganz unterbinden würde.
   */
  private driveEmitter(
    emitter: Phaser.GameObjects.Particles.ParticleEmitter,
    rate: number,
    weight: number,
    particleFactor: number,
  ): void {
    if (particleFactor <= 0) {
      if (emitter.emitting) emitter.stop();
      return;
    }
    emitter.frequency = 1000 / Math.max(0.35, rate * weight * particleFactor);
    if (!emitter.emitting) emitter.start();
  }

  /** Setzt alle Emitterzonen auf die aktuelle Frontspanne; sie sind emitterlokal. */
  private updateEmitZones(
    visual: TelegraphFrontVisual,
    layout: ReturnType<CoopDefenseEncounterTelegraphRenderer['getFrontLayout']>,
  ): void {
    const span = Math.max(1, layout.spanLength - ZONE_END_INSET * 2);
    const hazeDepth = Math.max(1, this.look.hazeDepth * HAZE_ZONE_DEPTH_RATIO);
    if (layout.rimIsVertical) {
      visual.hazeZone.setTo(layout.inwardX < 0 ? -hazeDepth : 0, -span / 2, hazeDepth, span);
      visual.driftZone.setTo(layout.inwardX < 0 ? -DRIFT_ZONE_DEPTH : 0, -span / 2, DRIFT_ZONE_DEPTH, span);
      visual.crestZone.setTo(-CREST_ZONE_DEPTH / 2, -span / 2, CREST_ZONE_DEPTH, span);
    } else {
      visual.hazeZone.setTo(-span / 2, layout.inwardY < 0 ? -hazeDepth : 0, span, hazeDepth);
      visual.driftZone.setTo(-span / 2, layout.inwardY < 0 ? -DRIFT_ZONE_DEPTH : 0, span, DRIFT_ZONE_DEPTH);
      visual.crestZone.setTo(-span / 2, -CREST_ZONE_DEPTH / 2, span, CREST_ZONE_DEPTH);
    }
  }

  /** Ausgeblendete Front: Emission stoppt, fliegende Partikel sterben über ihre eigene Kurve. */
  private softHideVisual(visual: TelegraphFrontVisual): void {
    visual.edge.setVisible(false);
    visual.haze.stop();
    visual.drift.stop();
    visual.crest.stop();
  }

  private hideVisual(visual: TelegraphFrontVisual): void {
    visual.weight = 0;
    visual.edge.setVisible(false);
    for (const emitter of [visual.haze, visual.drift, visual.crest]) {
      emitter.stop();
      killAllAndResetParticlePositions(emitter);
      emitter.setVisible(false);
    }
  }

  private getFrontLayout(
    front: SpawnFront,
    left: number,
    right: number,
    top: number,
    bottom: number,
    visibleLeft: number,
    visibleRight: number,
    visibleTop: number,
    visibleBottom: number,
  ) {
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    if (front === 'west') {
      const anchor = Math.max(left, visibleLeft);
      return {
        rimX: anchor, rimY: centerY, inwardX: 1, inwardY: 0, rimIsVertical: true, rotation: 0,
        spanStart: top, spanLength: bottom - top, boundary: anchor,
      };
    }
    if (front === 'east') {
      const anchor = Math.min(right, visibleRight);
      return {
        rimX: anchor, rimY: centerY, inwardX: -1, inwardY: 0, rimIsVertical: true, rotation: 0,
        spanStart: top, spanLength: bottom - top, boundary: anchor,
      };
    }
    if (front === 'north') {
      const anchor = Math.max(top, visibleTop);
      return {
        rimX: centerX, rimY: anchor, inwardX: 0, inwardY: 1, rimIsVertical: false, rotation: Math.PI / 2,
        spanStart: left, spanLength: right - left, boundary: anchor,
      };
    }
    const anchor = Math.min(bottom, visibleBottom);
    return {
      rimX: centerX, rimY: anchor, inwardX: 0, inwardY: -1, rimIsVertical: false, rotation: -Math.PI / 2,
      spanStart: left, spanLength: right - left, boundary: anchor,
    };
  }

  private drawChevrons(
    front: SpawnFront,
    layout: ReturnType<CoopDefenseEncounterTelegraphRenderer['getFrontLayout']>,
    color: number,
    intensity: number,
  ): void {
    const rowSpacing = layout.spanLength / CHEVRON_ROWS;
    const density = Math.max(0, this.look.chevronDensity);
    const slots = Math.ceil(density - 1e-4);
    const spacing = CHEVRON_TRAVEL / Math.max(1, density);
    const inwardSign = front === 'west' || front === 'north' ? 1 : -1;

    for (let row = 0; row < CHEVRON_ROWS; row += 1) {
      const cross = layout.spanStart + rowSpacing * (row + 0.5);
      const rowEnvelope = 0.55 + Math.sin(Math.PI * ((row + 0.5) / CHEVRON_ROWS)) * 0.45;
      for (let index = 0; index < slots; index += 1) {
        // Der letzte Slot trägt den Nachkommaanteil und blendet beim Dichtewechsel weich.
        const slotWeight = Phaser.Math.Clamp(density - index, 0, 1);
        const offset = (row * 41 + index * spacing) % CHEVRON_TRAVEL;
        const travelled = (this.chevronPhase + offset) % CHEVRON_TRAVEL;
        const progress = travelled / CHEVRON_TRAVEL;
        const alpha = intensity * rowEnvelope * slotWeight * Math.sin(Math.PI * progress);
        if (alpha <= 0.02) continue;
        const scale = 0.72 + (1 - progress) * 0.38;
        const distance = CHEVRON_START_OFFSET + travelled * inwardSign;
        const x = layout.rimIsVertical ? layout.boundary + distance : cross;
        const y = layout.rimIsVertical ? cross : layout.boundary + distance;
        this.graphics.fillStyle(color, alpha);
        this.graphics.fillPoints(this.buildChevron(front, x, y, scale), true);
      }
    }

    this.graphics.lineStyle(2.5, color, Phaser.Math.Clamp(0.8 * intensity, 0, 1));
    this.graphics.beginPath();
    if (layout.rimIsVertical) {
      this.graphics.moveTo(layout.boundary, layout.spanStart);
      this.graphics.lineTo(layout.boundary, layout.spanStart + layout.spanLength);
    } else {
      this.graphics.moveTo(layout.spanStart, layout.boundary);
      this.graphics.lineTo(layout.spanStart + layout.spanLength, layout.boundary);
    }
    this.graphics.strokePath();
  }

  private buildChevron(front: SpawnFront, x: number, y: number, scale: number): Phaser.Math.Vector2[] {
    const halfH = CHEVRON_HALF_H * scale;
    const length = CHEVRON_LENGTH * scale;
    const thickness = CHEVRON_THICKNESS * scale;
    const points = this.chevronPoints;
    if (front === 'west') {
      points[0].set(x, y - halfH); points[1].set(x + length, y); points[2].set(x, y + halfH);
      points[3].set(x - thickness, y + halfH); points[4].set(x + length - thickness, y); points[5].set(x - thickness, y - halfH);
    } else if (front === 'east') {
      points[0].set(x, y - halfH); points[1].set(x - length, y); points[2].set(x, y + halfH);
      points[3].set(x + thickness, y + halfH); points[4].set(x - length + thickness, y); points[5].set(x + thickness, y - halfH);
    } else if (front === 'north') {
      points[0].set(x - halfH, y); points[1].set(x, y + length); points[2].set(x + halfH, y);
      points[3].set(x + halfH, y - thickness); points[4].set(x, y + length - thickness); points[5].set(x - halfH, y - thickness);
    } else {
      points[0].set(x - halfH, y); points[1].set(x, y - length); points[2].set(x + halfH, y);
      points[3].set(x + halfH, y + thickness); points[4].set(x, y - length + thickness); points[5].set(x - halfH, y + thickness);
    }
    return points;
  }

  /** Schwaden ziehen langsam und weit nach innen; ihre Reichweite ersetzt die Bandtiefe. */
  private getHazeSpeedX(front: SpawnFront) {
    if (front === 'west') return { min: 26, max: 96 };
    if (front === 'east') return { min: -96, max: -26 };
    return { min: -18, max: 18 };
  }

  private getHazeSpeedY(front: SpawnFront) {
    if (front === 'north') return { min: 26, max: 96 };
    if (front === 'south') return { min: -96, max: -26 };
    return { min: -18, max: 18 };
  }

  private getDriftSpeedX(front: SpawnFront) {
    if (front === 'west') return { min: 42, max: 110 };
    if (front === 'east') return { min: -110, max: -42 };
    return { min: -24, max: 24 };
  }

  private getDriftSpeedY(front: SpawnFront) {
    if (front === 'north') return { min: 42, max: 110 };
    if (front === 'south') return { min: -110, max: -42 };
    return { min: -24, max: 24 };
  }

  /** Kantenfunken laufen vor allem längs der Front und nur leicht nach innen. */
  private getCrestSpeedX(front: SpawnFront) {
    if (front === 'west') return { min: 6, max: 48 };
    if (front === 'east') return { min: -48, max: -6 };
    return { min: -74, max: 74 };
  }

  private getCrestSpeedY(front: SpawnFront) {
    if (front === 'north') return { min: 6, max: 48 };
    if (front === 'south') return { min: -48, max: -6 };
    return { min: -74, max: 74 };
  }
}

/** Exponentielle Angleichung: framerateunabhängiger Anteil, der pro Schritt zurückgelegt wird. */
function easeFactor(dtMs: number, tauMs: number): number {
  if (dtMs <= 0) return 0;
  if (tauMs <= 0) return 1;
  return 1 - Math.exp(-dtMs / tauMs);
}

function createLook(profile: TelegraphProfile): TelegraphLook {
  const look: TelegraphLook = {
    red: 0, green: 0, blue: 0,
    hazeDepth: 0, chevronSpeed: 0, chevronDensity: 0,
    hazeRate: 0, driftRate: 0, crestRate: 0, pulseRate: 0, pulseDepth: 0, intensity: 0,
  };
  assignLook(look, profile);
  return look;
}

/** Blendet die Enden der Kantenlinie aus, damit sie nicht in den Arenarahmen läuft. */
function applyVerticalFalloff(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const previousOperation = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'destination-in';
  const vertical = ctx.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, 'rgba(0,0,0,0)');
  vertical.addColorStop(0.16, 'rgba(0,0,0,1)');
  vertical.addColorStop(0.84, 'rgba(0,0,0,1)');
  vertical.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = previousOperation;
}

function assignLook(look: TelegraphLook, profile: TelegraphProfile): void {
  look.red = (profile.color >> 16) & 0xff;
  look.green = (profile.color >> 8) & 0xff;
  look.blue = profile.color & 0xff;
  look.hazeDepth = profile.hazeDepth;
  look.chevronSpeed = profile.chevronSpeed;
  look.chevronDensity = profile.chevronDensity;
  look.hazeRate = 1000 / profile.hazeFrequency;
  look.driftRate = 1000 / profile.driftFrequency;
  look.crestRate = 1000 / profile.crestFrequency;
  look.pulseRate = 1 / profile.pulsePeriodMs;
  look.pulseDepth = profile.pulseDepth;
  look.intensity = 0;
}
