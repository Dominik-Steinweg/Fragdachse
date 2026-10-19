import * as Phaser from 'phaser';
import {
  ARENA_HEIGHT,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_WIDTH,
  COLORS,
  DEFAULT_ARENA_HEIGHT,
  DEPTH_FX,
} from '../config';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { createVisibleWorldView, getVisibleWorldView } from '../graphics/CameraWorldView';
import type {
  CoopDefenseEncounterPresentationPhase,
  CoopDefenseEncounterPresentationState,
  SpawnFront,
} from '../types';
import { getSpawnFrontInwardVector } from '../utils/spawnFront';
import {
  mergePerimeterIntervals,
  perimeterLength,
  pointAtPerimeter,
  projectZoneOntoBorder,
  splitPerimeterSegment,
  type BorderRect,
  type BorderSidePiece,
  type PerimeterInterval,
  type SpawnZoneRect,
  type WorldRect,
} from '../utils/spawnDirection';
import {
  createQualityEmitter,
  ensureCanvasTexture,
  killAllAndResetParticlePositions,
  registerGraphicsObject,
  setEmitterTintArray,
} from './EffectUtils';

const TEX_ENCOUNTER_SPARK = '__coop_defense_encounter_spark';
const TEX_ENCOUNTER_HAZE = '__coop_defense_encounter_haze';
/** Kantenlinie mit ausblendenden Enden; die offenen Varianten laufen an einer Ecke weiter. */
const TEX_ENCOUNTER_EDGE = '__coop_defense_encounter_edge';
const TEX_ENCOUNTER_EDGE_OPEN_LOW = '__coop_defense_encounter_edge_open_low';
const TEX_ENCOUNTER_EDGE_OPEN_HIGH = '__coop_defense_encounter_edge_open_high';
const TEX_ENCOUNTER_EDGE_OPEN = '__coop_defense_encounter_edge_open';

/**
 * Dicke der Kantenlinie quer zur Seite. Sie ist die lokale Breite des rotierten Bildes; die
 * lokale Höhe trägt immer die Spanne entlang der Seite.
 */
const EDGE_THICKNESS = 26;

/** Vertikale Reserve, damit die Front nicht in den Arenarahmen läuft. */
const TELEGRAPH_INSET = 30;
/**
 * Höchstzahl gleichzeitiger Seitenstücke. Vier ganze Fronten passen immer; ein Zonenabschnitt
 * belegt je berührter Seite ein Stück.
 */
const MAX_SIDE_PIECES = 6;
/**
 * Spanne eines Zonenabschnitts auf dem Rand: lang genug zum Lesen, kurz genug, um nur eine
 * Richtung zu zeigen.
 */
const ZONE_SEGMENT_SPAN = { minSpan: 260, maxSpan: 720 } as const;
/** Höchstzahl der Marschreihen; eine ganze Front trägt genau so viele. */
const CHEVRON_ROWS = 7;
/** Abstand der Marschreihen entlang eines Abschnitts; die Reihenzahl folgt seiner Länge. */
const CHEVRON_ROW_SPACING = 142;
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
/** Partikelstoß entlang einer ganzen Front im Moment der Ankunft; kürzere Stücke anteilig. */
const ARRIVAL_BURST_PARTICLES = 26;
const ARRIVAL_BURST_MIN_PARTICLES = 6;
const ARRIVAL_BURST_MIN_WEIGHT = 0.35;
/** Anteil der Clear-Phase, der auf voller Stärke steht, bevor der Erfolgsglanz ausblendet. */
const CLEARED_HOLD_RATIO = 0.4;
/** Zeitkonstanten der exponentiellen Angleichung; Aufbau schnell, Ausklang lang. */
const INTENSITY_ATTACK_TAU_MS = 240;
const INTENSITY_RELEASE_TAU_MS = 820;
const SHAPE_TAU_MS = 320;
const COLOR_TAU_MS = 260;
const SEGMENT_FADE_IN_MS = 240;
const SEGMENT_FADE_OUT_MS = 620;
const SEGMENT_WEIGHT_EPSILON = 0.01;
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
/** Geschlossene Enden bleiben partikelfrei, damit der Abschnitt nicht in den Rahmen ausfranst. */
const ZONE_END_INSET = 14;
/**
 * Spanne, auf der ein Seitenstück die volle Emissionsrate trägt: eine ganze Westfront. Kürzere
 * Stücke emittieren anteilig, damit mehrere Abschnitte das Partikelbudget nicht vervielfachen.
 */
const FULL_RATE_SPAN = DEFAULT_ARENA_HEIGHT - TELEGRAPH_INSET * 2;
const MIN_RATE_SCALE = 0.2;
/** Abstand des sichtbaren Rands zur Bildschirmkante in Bildschirmpixeln. */
const VISIBLE_EDGE_INSET = 6;

/**
 * Eingang der Randwarnung. Der Host entscheidet beides; der Renderer bewertet nur Darstellung.
 */
export interface EncounterTelegraphIncoming {
  /** Ganze Arenaseiten (Dawn, Rückfall); sie behalten den Look der Frontwand. */
  readonly fronts: readonly SpawnFront[];
  /**
   * Authored Spawnzonen in Welt-Pixeln. Jede wird vom Mittelpunkt des sichtbaren Bereichs aus
   * als Abschnitt auf den sichtbaren Rand projiziert, der um Ecken laufen darf.
   */
  readonly zones: readonly SpawnZoneRect[];
}

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

type TelegraphSource =
  | { readonly kind: 'front'; readonly front: SpawnFront }
  | { readonly kind: 'zone'; readonly rect: WorldRect };

/** Eine angekündigte Quelle mit eigener Ein-/Ausblendung, damit Wechsel nicht hart schalten. */
interface TelegraphSegment {
  readonly key: string;
  source: TelegraphSource;
  weight: number;
}

/** Ein Seitenstück dieses Frames; der Schlüssel hält es über Frames demselben Poolobjekt zu. */
interface TelegraphPieceLayout extends BorderSidePiece {
  readonly key: string;
  readonly weight: number;
}

interface TelegraphChevronRow {
  readonly side: SpawnFront;
  /** Feste Koordinate der Seite, von der aus die Marke nach innen läuft. */
  readonly at: number;
  /** Position entlang der Seite. */
  readonly along: number;
  readonly row: number;
  readonly envelope: number;
  readonly weight: number;
}

interface TelegraphFrame {
  readonly arena: BorderRect;
  /** Arenarand, auf den sichtbaren Bereich geklemmt; Fronten verankern dort, Zonen liegen darauf. */
  readonly rim: BorderRect;
  readonly centreX: number;
  readonly centreY: number;
}

/** Wiederverwendbares Seitenstück: Kantenlinie plus drei Emitter, frei einer Seite zuweisbar. */
interface TelegraphPieceVisual {
  readonly edge: Phaser.GameObjects.Image;
  readonly haze: Phaser.GameObjects.Particles.ParticleEmitter;
  readonly drift: Phaser.GameObjects.Particles.ParticleEmitter;
  readonly crest: Phaser.GameObjects.Particles.ParticleEmitter;
  readonly hazeZone: Phaser.Geom.Rectangle;
  readonly driftZone: Phaser.Geom.Rectangle;
  readonly crestZone: Phaser.Geom.Rectangle;
  /** Schlüssel des dargestellten Seitenstücks; null, solange das Objekt frei ist. */
  owner: string | null;
  /** Seite, für die die Partikelgeschwindigkeiten gerade konfiguriert sind. */
  side: SpawnFront;
}

const NO_INCOMING: EncounterTelegraphIncoming = { fronts: [], zones: [] };

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

/**
 * Welt-Telegraph für den host-autoritativ replizierten Encounter-Zustand. Fronten leuchten als
 * ganze Arenaseite, Spawnzonen nur als Randabschnitt in ihrer Richtung; beide teilen sich einen
 * Pool von Seitenstücken.
 */
export class CoopDefenseEncounterTelegraphRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly pool: TelegraphPieceVisual[] = [];
  private readonly segments = new Map<string, TelegraphSegment>();
  private readonly wantedSegments = new Set<string>();
  private readonly pieces: TelegraphPieceLayout[] = [];
  private readonly rows: TelegraphChevronRow[] = [];
  private readonly frontSides = new Set<SpawnFront>();
  private readonly view = createVisibleWorldView();
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

    // Die Bildoberkante liegt immer am niedrigen Ende der Seite (oben bzw. links); offene Enden
    // setzen die Linie über eine Ecke ins nächste Seitenstück fort.
    for (const [key, fadeLow, fadeHigh] of [
      [TEX_ENCOUNTER_EDGE, true, true],
      [TEX_ENCOUNTER_EDGE_OPEN_LOW, false, true],
      [TEX_ENCOUNTER_EDGE_OPEN_HIGH, true, false],
      [TEX_ENCOUNTER_EDGE_OPEN, false, false],
    ] as const) {
      ensureCanvasTexture(this.scene.textures, key, 32, 64, (ctx) => drawEdgeTexture(ctx, 32, 64, fadeLow, fadeHigh));
    }

    while (this.pool.length < MAX_SIDE_PIECES) this.pool.push(this.createPieceVisual('west'));
  }

  /**
   * @param incoming Fronten und Zonen, die der Host für diesen Encounter ankündigt; Phase und
   *   Zeiten kommen aus `state`.
   */
  sync(
    state: CoopDefenseEncounterPresentationState | null,
    elapsedMs: number,
    inArena: boolean,
    incoming: EncounterTelegraphIncoming,
  ): void {
    if (!inArena || this.pool.length === 0) {
      this.clear();
      return;
    }

    const now = Number.isFinite(elapsedMs) ? elapsedMs : this.lastSyncMs ?? 0;
    const dtMs = this.advanceClock(now);
    const live = state !== null && state.phase !== 'complete' ? state : null;
    const target = live !== null
      ? this.resolveTarget(live, now)
      : { profile: this.activeProfile, intensity: 0 };
    // Ein beendeter oder abgeräumter Encounter klingt aus, statt hart zu verschwinden.
    if (live === null) this.forgetEncounter(state === null);

    this.integrateLook(target.profile, target.intensity, dtMs);
    this.activeProfile = target.profile;
    this.pulsePhase = (this.pulsePhase + dtMs * this.look.pulseRate) % (Math.PI * 2);
    this.chevronPhase = (this.chevronPhase + (dtMs / 1000) * this.look.chevronSpeed) % CHEVRON_TRAVEL;

    const maxWeight = this.updateSegmentWeights(live !== null ? incoming : NO_INCOMING, dtMs);
    // Die Ruhegrenze prüft den ungepulsten Ist-Wert, damit der Puls kein Ein-/Ausschalten flackert.
    if (this.look.intensity <= MIN_VISIBLE_INTENSITY || maxWeight <= SEGMENT_WEIGHT_EPSILON) {
      this.goDormant();
      return;
    }
    const pulse = 0.78 + Math.sin(this.pulsePhase) * this.look.pulseDepth;
    const intensity = Phaser.Math.Clamp(this.look.intensity * pulse, 0, 1);

    this.dormant = false;
    if (target.profile.sparkTints !== this.activeSparkTints) {
      this.activeSparkTints = target.profile.sparkTints;
      for (const visual of this.pool) {
        for (const emitter of [visual.haze, visual.drift, visual.crest]) {
          setEmitterTintArray(emitter, [...target.profile.sparkTints]);
        }
      }
    }

    this.layoutPieces(this.readFrame());
    this.assignPool();

    this.graphics.clear().setVisible(true);
    const color = Phaser.Display.Color.GetColor(
      Math.round(this.look.red),
      Math.round(this.look.green),
      Math.round(this.look.blue),
    );
    // Der Telegraph ist Lesbarkeit, kein Schmuck: die Partikelmenge skaliert mit der Qualität,
    // sie verschwindet nicht.
    const particleFactor = getGraphicsQualityProfile(this.scene).particleFactors.critical;

    for (const visual of this.pool) {
      const piece = visual.owner === null ? undefined : this.pieces.find(candidate => candidate.key === visual.owner);
      if (!piece) {
        this.softHideVisual(visual);
        continue;
      }
      this.drawPiece(visual, piece, color, intensity * piece.weight, particleFactor);
    }
    this.drawChevrons(color, intensity);
    this.pendingArrivalBurst = false;
  }

  clear(): void {
    this.resetTimeline();
    this.goDormant();
  }

  destroy(): void {
    this.clear();
    for (const visual of this.pool) {
      visual.haze.destroy();
      visual.drift.destroy();
      visual.crest.destroy();
      visual.edge.destroy();
    }
    this.pool.length = 0;
    this.activeSparkTints = null;
    this.graphics.destroy();
  }

  private createPieceVisual(side: SpawnFront): TelegraphPieceVisual {
    const edge = this.scene.add.image(0, 0, TEX_ENCOUNTER_EDGE)
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH_FX - 0.1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    // Alle Zonen sind emitterlokal und werden pro Frame auf die aktuelle Stückspanne gesetzt.
    const hazeZone = new Phaser.Geom.Rectangle(0, 0, DRIFT_ZONE_DEPTH, ARENA_HEIGHT);
    const driftZone = new Phaser.Geom.Rectangle(0, 0, DRIFT_ZONE_DEPTH, ARENA_HEIGHT);
    const crestZone = new Phaser.Geom.Rectangle(0, 0, CREST_ZONE_DEPTH, ARENA_HEIGHT);
    const motion = sideMotion(side);
    const haze = createQualityEmitter(this.scene, 0, 0, TEX_ENCOUNTER_HAZE, {
      lifespan: { min: 900, max: 1700 },
      frequency: 120,
      quantity: 1,
      speedX: motion.haze.x,
      speedY: motion.haze.y,
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
      speedX: motion.drift.x,
      speedY: motion.drift.y,
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
      speedX: motion.crest.x,
      speedY: motion.crest.y,
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
    return { edge, haze, drift, crest, hazeZone, driftZone, crestZone, owner: null, side };
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
    this.segments.clear();
    for (const visual of this.pool) this.hideVisual(visual);
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
   * bewertet hier nur Darstellung; Phasen und Zeiten stammen unverändert vom Host.
   */
  private resolveTarget(
    state: CoopDefenseEncounterPresentationState,
    now: number,
  ): { profile: TelegraphProfile; intensity: number } {
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

  /** Blendet angekündigte Quellen ein und verschwundene aus; ausgeblendete werden vergessen. */
  private updateSegmentWeights(incoming: EncounterTelegraphIncoming, dtMs: number): number {
    const wanted = this.wantedSegments;
    wanted.clear();
    for (const front of incoming.fronts) {
      const key = `front:${front}`;
      wanted.add(key);
      if (!this.segments.has(key)) this.segments.set(key, { key, source: { kind: 'front', front }, weight: 0 });
    }
    for (const zone of incoming.zones) {
      const key = `zone:${zone.id}`;
      wanted.add(key);
      const segment = this.segments.get(key);
      // Eine ausblendende Zone behält ihr letztes Rechteck, damit sie am alten Ort verklingt.
      if (segment) segment.source = { kind: 'zone', rect: zone };
      else this.segments.set(key, { key, source: { kind: 'zone', rect: zone }, weight: 0 });
    }
    let maxWeight = 0;
    for (const [key, segment] of this.segments) {
      const target = wanted.has(key) ? 1 : 0;
      segment.weight = target > segment.weight
        ? Math.min(target, segment.weight + dtMs / SEGMENT_FADE_IN_MS)
        : Math.max(target, segment.weight - dtMs / SEGMENT_FADE_OUT_MS);
      if (target === 0 && segment.weight <= 0) {
        this.segments.delete(key);
        continue;
      }
      maxWeight = Math.max(maxWeight, segment.weight);
    }
    return maxWeight;
  }

  private readFrame(): TelegraphFrame {
    const camera = this.scene.cameras.main;
    const view = getVisibleWorldView(camera, this.view);
    const inset = VISIBLE_EDGE_INSET / Math.max(0.1, camera.zoom);
    const arena: BorderRect = {
      left: ARENA_OFFSET_X + 5,
      top: ARENA_OFFSET_Y + TELEGRAPH_INSET,
      right: ARENA_OFFSET_X + ARENA_WIDTH - 5,
      bottom: ARENA_OFFSET_Y + ARENA_HEIGHT - TELEGRAPH_INSET,
    };
    return {
      arena,
      rim: {
        left: Math.max(arena.left, view.x + inset),
        top: Math.max(arena.top, view.y + inset),
        right: Math.min(arena.right, view.right - inset),
        bottom: Math.min(arena.bottom, view.bottom - inset),
      },
      centreX: view.centerX,
      centreY: view.centerY,
    };
  }

  /**
   * Legt die Seitenstücke und Marschreihen dieses Frames fest. Fronten belegen ihre ganze Seite
   * und verdrängen dort Zonenabschnitte; sich überlappende Zonenabschnitte verschmelzen.
   */
  private layoutPieces(frame: TelegraphFrame): void {
    const pieces = this.pieces;
    const rows = this.rows;
    pieces.length = 0;
    rows.length = 0;
    this.frontSides.clear();

    for (const segment of this.segments.values()) {
      if (segment.source.kind !== 'front' || segment.weight <= SEGMENT_WEIGHT_EPSILON) continue;
      const piece = frontPiece(segment.source.front, frame);
      this.frontSides.add(piece.side);
      pieces.push({ ...piece, key: `${segment.key}|${piece.side}`, weight: segment.weight });
      const span = piece.high - piece.low;
      const count = chevronRowCount(span);
      for (let row = 0; row < count; row += 1) {
        rows.push({
          side: piece.side,
          at: piece.at,
          along: piece.low + span * ((row + 0.5) / count),
          row,
          envelope: chevronRowEnvelope(row, count),
          weight: segment.weight,
        });
      }
    }

    const perimeter = perimeterLength(frame.rim);
    if (!(perimeter > 0)) return;
    const projections: (PerimeterInterval & { readonly segment: TelegraphSegment })[] = [];
    for (const segment of this.segments.values()) {
      if (segment.source.kind !== 'zone' || segment.weight <= SEGMENT_WEIGHT_EPSILON) continue;
      const interval = projectZoneOntoBorder(
        frame.rim,
        { x: frame.centreX, y: frame.centreY },
        segment.source.rect,
        ZONE_SEGMENT_SPAN,
      );
      if (interval) projections.push({ ...interval, segment });
    }
    for (const group of mergePerimeterIntervals(perimeter, projections)) {
      const lead = group.members[0].segment;
      const weight = group.members.reduce((max, member) => Math.max(max, member.segment.weight), 0);
      const groupPieces = splitPerimeterSegment(frame.rim, group.interval)
        .filter(piece => !this.frontSides.has(piece.side));
      // Ein Abschnitt erscheint ganz oder gar nicht; ein halber würde in die falsche Richtung zeigen.
      if (groupPieces.length === 0 || pieces.length + groupPieces.length > MAX_SIDE_PIECES) continue;
      for (const piece of groupPieces) pieces.push({ ...piece, key: `${lead.key}|${piece.side}`, weight });
      const count = chevronRowCount(group.interval.length);
      for (let row = 0; row < count; row += 1) {
        const point = pointAtPerimeter(frame.rim, group.interval.start + group.interval.length * ((row + 0.5) / count));
        if (this.frontSides.has(point.side)) continue;
        const vertical = point.side === 'west' || point.side === 'east';
        rows.push({
          side: point.side,
          at: vertical ? point.x : point.y,
          along: vertical ? point.y : point.x,
          row,
          envelope: chevronRowEnvelope(row, count),
          weight,
        });
      }
    }
  }

  /**
   * Hält jedes Seitenstück bei seinem Poolobjekt. Neue Stücke nehmen bevorzugt ein Objekt ohne
   * fliegende Partikel, denn Partikel sind emitterlokal und würden sonst mitspringen.
   */
  private assignPool(): void {
    for (const visual of this.pool) {
      if (visual.owner !== null && !this.pieces.some(piece => piece.key === visual.owner)) visual.owner = null;
    }
    for (const piece of this.pieces) {
      if (this.pool.some(visual => visual.owner === piece.key)) continue;
      let chosen: TelegraphPieceVisual | null = null;
      let chosenAlive = Infinity;
      for (const visual of this.pool) {
        if (visual.owner !== null) continue;
        const alive = aliveParticles(visual);
        if (alive < chosenAlive) {
          chosen = visual;
          chosenAlive = alive;
        }
      }
      if (!chosen) continue;
      if (chosenAlive > 0) this.hideVisual(chosen);
      chosen.owner = piece.key;
      if (chosen.side !== piece.side) applySideMotion(chosen, piece.side);
    }
  }

  private drawPiece(
    visual: TelegraphPieceVisual,
    piece: TelegraphPieceLayout,
    color: number,
    pieceIntensity: number,
    particleFactor: number,
  ): void {
    const vertical = piece.side === 'west' || piece.side === 'east';
    const span = Math.max(1, piece.high - piece.low);
    const middle = (piece.low + piece.high) / 2;
    const rimX = vertical ? piece.at : middle;
    const rimY = vertical ? middle : piece.at;
    const inward = getSpawnFrontInwardVector(piece.side);
    const edgeTexture = piece.openLow
      ? piece.openHigh ? TEX_ENCOUNTER_EDGE_OPEN : TEX_ENCOUNTER_EDGE_OPEN_LOW
      : piece.openHigh ? TEX_ENCOUNTER_EDGE_OPEN_HIGH : TEX_ENCOUNTER_EDGE;
    if (visual.edge.texture.key !== edgeTexture) visual.edge.setTexture(edgeTexture);

    // Die lokale Breite ist immer die Dicke quer zur Seite, die lokale Höhe immer die Spanne
    // entlang der Seite. Waagerechte Seiten drehen die Bildoberkante nach links (niedriges x).
    visual.edge
      .setPosition(rimX, rimY)
      .setRotation(vertical ? 0 : -Math.PI / 2)
      .setDisplaySize(EDGE_THICKNESS, span)
      .setTint(color)
      .setAlpha(Phaser.Math.Clamp(0.85 * pieceIntensity, 0, 1))
      .setVisible(true);

    this.graphics.lineStyle(2.5, color, Phaser.Math.Clamp(0.8 * pieceIntensity, 0, 1));
    this.graphics.beginPath();
    if (vertical) {
      this.graphics.moveTo(piece.at, piece.low);
      this.graphics.lineTo(piece.at, piece.high);
    } else {
      this.graphics.moveTo(piece.low, piece.at);
      this.graphics.lineTo(piece.high, piece.at);
    }
    this.graphics.strokePath();

    this.updateEmitZones(visual, piece, vertical, span);
    visual.haze
      .setPosition(rimX, rimY)
      .setAlpha(Phaser.Math.Clamp(pieceIntensity * 1.4, 0, 1))
      .setVisible(true);
    visual.drift
      .setPosition(rimX + inward.x * DRIFT_ZONE_OFFSET, rimY + inward.y * DRIFT_ZONE_OFFSET)
      .setAlpha(Phaser.Math.Clamp(pieceIntensity * 1.1, 0, 1))
      .setVisible(true);
    visual.crest
      .setPosition(rimX, rimY)
      .setAlpha(Phaser.Math.Clamp(pieceIntensity * 1.3, 0, 1))
      .setVisible(true);
    const rateScale = Phaser.Math.Clamp(span / FULL_RATE_SPAN, MIN_RATE_SCALE, 1);
    this.driveEmitter(visual.haze, this.look.hazeRate, piece.weight * rateScale, particleFactor);
    this.driveEmitter(visual.drift, this.look.driftRate, piece.weight * rateScale, particleFactor);
    this.driveEmitter(visual.crest, this.look.crestRate, piece.weight * rateScale, particleFactor);
    if (this.pendingArrivalBurst && piece.weight >= ARRIVAL_BURST_MIN_WEIGHT) {
      visual.crest.emitParticleAt(
        undefined,
        undefined,
        Math.max(ARRIVAL_BURST_MIN_PARTICLES, Math.round(ARRIVAL_BURST_PARTICLES * rateScale)),
      );
    }
  }

  /**
   * Die Emissionsrate trägt die Stärke des Stücks. Sie wird als Rate skaliert und erst danach in
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

  /**
   * Setzt alle Emitterzonen auf die aktuelle Stückspanne; sie sind emitterlokal. Nur geschlossene
   * Enden bleiben frei, an einer Ecke laufen die Partikel ins nächste Stück weiter.
   */
  private updateEmitZones(
    visual: TelegraphPieceVisual,
    piece: TelegraphPieceLayout,
    vertical: boolean,
    span: number,
  ): void {
    const from = -span / 2 + (piece.openLow ? 0 : ZONE_END_INSET);
    const length = Math.max(1, span / 2 - (piece.openHigh ? 0 : ZONE_END_INSET) - from);
    const hazeDepth = Math.max(1, this.look.hazeDepth * HAZE_ZONE_DEPTH_RATIO);
    const inward = getSpawnFrontInwardVector(piece.side);
    if (vertical) {
      visual.hazeZone.setTo(inward.x < 0 ? -hazeDepth : 0, from, hazeDepth, length);
      visual.driftZone.setTo(inward.x < 0 ? -DRIFT_ZONE_DEPTH : 0, from, DRIFT_ZONE_DEPTH, length);
      visual.crestZone.setTo(-CREST_ZONE_DEPTH / 2, from, CREST_ZONE_DEPTH, length);
    } else {
      visual.hazeZone.setTo(from, inward.y < 0 ? -hazeDepth : 0, length, hazeDepth);
      visual.driftZone.setTo(from, inward.y < 0 ? -DRIFT_ZONE_DEPTH : 0, length, DRIFT_ZONE_DEPTH);
      visual.crestZone.setTo(from, -CREST_ZONE_DEPTH / 2, length, CREST_ZONE_DEPTH);
    }
  }

  /** Freies Poolobjekt: Emission stoppt, fliegende Partikel sterben über ihre eigene Kurve. */
  private softHideVisual(visual: TelegraphPieceVisual): void {
    visual.edge.setVisible(false);
    visual.haze.stop();
    visual.drift.stop();
    visual.crest.stop();
  }

  private hideVisual(visual: TelegraphPieceVisual): void {
    visual.owner = null;
    visual.edge.setVisible(false);
    for (const emitter of [visual.haze, visual.drift, visual.crest]) {
      emitter.stop();
      killAllAndResetParticlePositions(emitter);
      emitter.setVisible(false);
    }
  }

  private drawChevrons(color: number, intensity: number): void {
    const density = Math.max(0, this.look.chevronDensity);
    const slots = Math.ceil(density - 1e-4);
    const spacing = CHEVRON_TRAVEL / Math.max(1, density);
    for (const row of this.rows) {
      const inward = getSpawnFrontInwardVector(row.side);
      const vertical = row.side === 'west' || row.side === 'east';
      for (let index = 0; index < slots; index += 1) {
        // Der letzte Slot trägt den Nachkommaanteil und blendet beim Dichtewechsel weich.
        const slotWeight = Phaser.Math.Clamp(density - index, 0, 1);
        const offset = (row.row * 41 + index * spacing) % CHEVRON_TRAVEL;
        const travelled = (this.chevronPhase + offset) % CHEVRON_TRAVEL;
        const progress = travelled / CHEVRON_TRAVEL;
        const alpha = intensity * row.weight * row.envelope * slotWeight * Math.sin(Math.PI * progress);
        if (alpha <= 0.02) continue;
        const scale = 0.72 + (1 - progress) * 0.38;
        const distance = CHEVRON_START_OFFSET + travelled;
        const x = vertical ? row.at + inward.x * distance : row.along;
        const y = vertical ? row.along : row.at + inward.y * distance;
        this.graphics.fillStyle(color, alpha);
        this.graphics.fillPoints(this.buildChevron(row.side, x, y, scale), true);
      }
    }
  }

  private buildChevron(side: SpawnFront, x: number, y: number, scale: number): Phaser.Math.Vector2[] {
    const halfH = CHEVRON_HALF_H * scale;
    const length = CHEVRON_LENGTH * scale;
    const thickness = CHEVRON_THICKNESS * scale;
    const points = this.chevronPoints;
    if (side === 'west') {
      points[0].set(x, y - halfH); points[1].set(x + length, y); points[2].set(x, y + halfH);
      points[3].set(x - thickness, y + halfH); points[4].set(x + length - thickness, y); points[5].set(x - thickness, y - halfH);
    } else if (side === 'east') {
      points[0].set(x, y - halfH); points[1].set(x - length, y); points[2].set(x, y + halfH);
      points[3].set(x + thickness, y + halfH); points[4].set(x - length + thickness, y); points[5].set(x + thickness, y - halfH);
    } else if (side === 'north') {
      points[0].set(x - halfH, y); points[1].set(x, y + length); points[2].set(x + halfH, y);
      points[3].set(x + halfH, y - thickness); points[4].set(x, y + length - thickness); points[5].set(x - halfH, y - thickness);
    } else {
      points[0].set(x - halfH, y); points[1].set(x, y - length); points[2].set(x + halfH, y);
      points[3].set(x + halfH, y + thickness); points[4].set(x, y - length + thickness); points[5].set(x - halfH, y + thickness);
    }
    return points;
  }
}

/** Eine Front belegt ihre ganze Arenaseite; nur ihr Anker folgt dem sichtbaren Rand. */
function frontPiece(front: SpawnFront, frame: TelegraphFrame): BorderSidePiece {
  const { arena, rim } = frame;
  if (front === 'west' || front === 'east') {
    return {
      side: front, at: front === 'west' ? rim.left : rim.right,
      low: arena.top, high: arena.bottom, openLow: false, openHigh: false,
    };
  }
  return {
    side: front, at: front === 'north' ? rim.top : rim.bottom,
    low: arena.left, high: arena.right, openLow: false, openHigh: false,
  };
}

function chevronRowCount(span: number): number {
  return Phaser.Math.Clamp(Math.round(span / CHEVRON_ROW_SPACING), 1, CHEVRON_ROWS);
}

/** Die Mitte eines Abschnitts trägt die hellsten Marken, die Enden laufen aus. */
function chevronRowEnvelope(row: number, count: number): number {
  return 0.55 + Math.sin(Math.PI * ((row + 0.5) / count)) * 0.45;
}

function aliveParticles(visual: TelegraphPieceVisual): number {
  return visual.haze.getAliveParticleCount()
    + visual.drift.getAliveParticleCount()
    + visual.crest.getAliveParticleCount();
}

interface SpeedRange {
  readonly min: number;
  readonly max: number;
}

interface SideMotion {
  /** Schwaden ziehen langsam und weit nach innen; ihre Reichweite ersetzt die Bandtiefe. */
  readonly haze: { readonly x: SpeedRange; readonly y: SpeedRange };
  readonly drift: { readonly x: SpeedRange; readonly y: SpeedRange };
  /** Kantenfunken laufen vor allem längs der Seite und nur leicht nach innen. */
  readonly crest: { readonly x: SpeedRange; readonly y: SpeedRange };
}

function sideMotion(side: SpawnFront): SideMotion {
  const inward = getSpawnFrontInwardVector(side);
  const axis = (sign: number, inwardRange: SpeedRange, lateral: number): SpeedRange => (
    sign > 0 ? inwardRange : sign < 0 ? { min: -inwardRange.max, max: -inwardRange.min } : { min: -lateral, max: lateral }
  );
  const motion = (inwardRange: SpeedRange, lateral: number) => ({
    x: axis(inward.x, inwardRange, lateral),
    y: axis(inward.y, inwardRange, lateral),
  });
  return {
    haze: motion({ min: 26, max: 96 }, 18),
    drift: motion({ min: 42, max: 110 }, 24),
    crest: motion({ min: 6, max: 48 }, 74),
  };
}

/** Partikelgeschwindigkeiten gelten nur für neue Partikel; fliegende behalten ihre Bahn. */
function applySideMotion(visual: TelegraphPieceVisual, side: SpawnFront): void {
  const motion = sideMotion(side);
  for (const [emitter, speed] of [
    [visual.haze, motion.haze],
    [visual.drift, motion.drift],
    [visual.crest, motion.crest],
  ] as const) {
    emitter.ops.speedX.loadConfig({ speedX: speed.x });
    emitter.ops.speedY.loadConfig({ speedY: speed.y });
  }
  visual.side = side;
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

/**
 * Kantenlinie: quer ein heller Grat, längs optional ausblendende Enden, damit sie nicht in den
 * Arenarahmen läuft. Offene Enden schließen an einer Ecke an das nächste Seitenstück an.
 */
function drawEdgeTexture(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  fadeLow: boolean,
  fadeHigh: boolean,
): void {
  const horizontal = ctx.createLinearGradient(0, 0, width, 0);
  horizontal.addColorStop(0, 'rgba(255,255,255,0)');
  horizontal.addColorStop(0.42, 'rgba(255,255,255,0.55)');
  horizontal.addColorStop(0.5, 'rgba(255,255,255,1)');
  horizontal.addColorStop(0.58, 'rgba(255,255,255,0.55)');
  horizontal.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, width, height);
  if (!fadeLow && !fadeHigh) return;

  const previousOperation = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'destination-in';
  const vertical = ctx.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, fadeLow ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)');
  vertical.addColorStop(0.16, 'rgba(0,0,0,1)');
  vertical.addColorStop(0.84, 'rgba(0,0,0,1)');
  vertical.addColorStop(1, fadeHigh ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)');
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
