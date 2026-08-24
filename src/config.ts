import type { GameMode, GamePhase, RoomQualityStartPolicy, TeamId } from './types';
import { CAPTURE_THE_BEER_MODE, COOP_DEFENSE_MODE } from './gameModes';

// ---- Display ----
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;
export const CELL_SIZE = 32;

export const DEFAULT_ARENA_WIDTH = 1440;
export const FULL_ARENA_WIDTH = GAME_WIDTH;
export const CAPTURE_THE_BEER_ARENA_WIDTH = DEFAULT_ARENA_WIDTH * 3;
export const MAX_ARENA_WIDTH = CAPTURE_THE_BEER_ARENA_WIDTH;
export const DEFAULT_ARENA_OFFSET_X = (GAME_WIDTH - DEFAULT_ARENA_WIDTH) / 2; // 240
export const DEFAULT_ARENA_VIEWPORT_WIDTH = GAME_WIDTH - DEFAULT_ARENA_OFFSET_X * 2;
export const DEFAULT_ARENA_HEIGHT = 1056;
export const DEFAULT_ARENA_OFFSET_Y = 12;
export const DEFAULT_ARENA_VIEWPORT_HEIGHT = GAME_HEIGHT - DEFAULT_ARENA_OFFSET_Y * 2;
export const LOBBY_ARENA_OFFSET_X = DEFAULT_ARENA_OFFSET_X;
export const LOBBY_ARENA_VIEWPORT_WIDTH = DEFAULT_ARENA_VIEWPORT_WIDTH;
export const MAX_ARENA_RENDER_WIDTH = DEFAULT_ARENA_OFFSET_X + MAX_ARENA_WIDTH;

export interface ArenaMetricsProfile {
  arenaWidth: number;
  arenaOffsetX: number;
  arenaViewportWidth: number;
  arenaHeight: number;
  arenaOffsetY: number;
  arenaViewportHeight: number;
  usesDynamicCamera: boolean;
  showStaticArenaFrames: boolean;
}

const DEFAULT_ARENA_METRICS_PROFILE: ArenaMetricsProfile = {
  arenaWidth: DEFAULT_ARENA_WIDTH,
  arenaOffsetX: DEFAULT_ARENA_OFFSET_X,
  arenaViewportWidth: DEFAULT_ARENA_VIEWPORT_WIDTH,
  arenaHeight: DEFAULT_ARENA_HEIGHT,
  arenaOffsetY: DEFAULT_ARENA_OFFSET_Y,
  arenaViewportHeight: DEFAULT_ARENA_VIEWPORT_HEIGHT,
  usesDynamicCamera: false,
  showStaticArenaFrames: true,
};

const FULL_WIDTH_ARENA_METRICS_PROFILE: ArenaMetricsProfile = {
  arenaWidth: FULL_ARENA_WIDTH,
  arenaOffsetX: 0,
  arenaViewportWidth: GAME_WIDTH,
  arenaHeight: DEFAULT_ARENA_HEIGHT,
  arenaOffsetY: DEFAULT_ARENA_OFFSET_Y,
  arenaViewportHeight: DEFAULT_ARENA_VIEWPORT_HEIGHT,
  usesDynamicCamera: false,
  showStaticArenaFrames: false,
};

const CAPTURE_THE_BEER_ARENA_METRICS_PROFILE: ArenaMetricsProfile = {
  arenaWidth: CAPTURE_THE_BEER_ARENA_WIDTH,
  arenaOffsetX: 0,
  arenaViewportWidth: GAME_WIDTH,
  arenaHeight: DEFAULT_ARENA_HEIGHT,
  arenaOffsetY: DEFAULT_ARENA_OFFSET_Y,
  arenaViewportHeight: DEFAULT_ARENA_VIEWPORT_HEIGHT,
  usesDynamicCamera: true,
  showStaticArenaFrames: false,
};

export let ACTIVE_ARENA_METRICS_PROFILE: ArenaMetricsProfile = DEFAULT_ARENA_METRICS_PROFILE;
export let ARENA_WIDTH = DEFAULT_ARENA_WIDTH;
export let ARENA_HEIGHT = DEFAULT_ARENA_HEIGHT;
export let ARENA_OFFSET_X = DEFAULT_ARENA_OFFSET_X;
export let ARENA_OFFSET_Y = DEFAULT_ARENA_OFFSET_Y;
export let ARENA_VIEWPORT_WIDTH = DEFAULT_ARENA_VIEWPORT_WIDTH;
export let ARENA_VIEWPORT_HEIGHT = DEFAULT_ARENA_VIEWPORT_HEIGHT;
export let ARENA_STATIC_FRAMES_VISIBLE = DEFAULT_ARENA_METRICS_PROFILE.showStaticArenaFrames;
export let ARENA_MAX_X = ARENA_OFFSET_X + ARENA_WIDTH;
export let ARENA_MAX_Y = ARENA_OFFSET_Y + ARENA_HEIGHT;

// ---- Audio ----
export const SOUND_ENABLED = true;
export const SOUND_MASTER_VOLUME = 0.25;
export const SOUND_SFX_VOLUME = 1.0;
export const SOUND_MUSIC_VOLUME = 0;
export let SHOT_AUDIO_REMOTE_MAX_DISTANCE = ARENA_WIDTH;
export let SHOT_AUDIO_PAN_RANGE = ARENA_WIDTH * 0.5;
export const SHOT_AUDIO_REMOTE_CLOSE_VOLUME = 0.58;
export const SHOT_AUDIO_REMOTE_FAR_VOLUME = 0.1;
export const SHOT_AUDIO_REMOTE_DISTANCE_EXPONENT = 0.45;

// ---- Depth Layers ----
export const DEPTH = {
  GRASS: 1,
  DIRT: 2,
  /**
   * Grosse Moosflaechen, die bewusst ueber die Dirt-Silhouette hinaus auf das Gras laufen und
   * umgekehrt. Sie liegen ueber Dirt samt eingebackenem Mottle, aber unter Gleisen, Basiszonen
   * und den kleinen Decals – Gameplay-Markierungen bleiben damit unverdeckt.
   */
  GROUND_COVER: 2.5,
  TRACKS: 3,
  BASES: 4,
  DECALS: 5,
  ROCKS: 9,
  /**
   * Grossflaechiges Moos auf dem Felsbestand. Liegt ueber der Materialstoerung des Felsens
   * (`DEPTH.ROCKS + 0.05` aufwaerts) und unter den kleinen Fels-Decals – dieselbe Staffelung wie
   * am Boden, wo Ground Cover unter den kleinen Decals liegt.
   */
  ROCK_MOSS: 9.08,
  /** Gebackene Riss-/Moos-Decals liegen knapp ueber den live-zerstoerbaren Felsen. */
  ROCK_DECALS: 9.1,
  /**
   * Matten aus Moos, Flechten und Efeu auf den freien Aussenkanten des Felsbestands. Oberste der
   * felsgebundenen Schichten: Bewuchs waechst ueber Materialstoerung, Moos und Risse hinweg. Weil
   * die Schicht ueber `DEPTH.ROCKS` liegt, darf sie ausserdem ein Stueck ueber die Felskante auf
   * Dirt und Gras hinausragen, ohne dass der Fels sie dort beschneidet.
   */
  ROCK_VEGETATION: 9.12,
  PLAYERS: 10,
  TRAIN: 11,  
  PROJECTILES: 15,
  FIRE: 16,
  /** Giftwolken und ihre Partikel; liegt zwischen FIRE (16) und SMOKE (18). */
  STINK: 17,
  SMOKE: 18,
  CANOPY: 20,
  LOCAL_UI: 22,
  OVERLAY: 100,
} as const;

// ---- Colors ----
export const COLORS = {
  // ─── BLUES (1 = Hellstes Eisblau, 6 = Dunkelstes Nachtblau) ──────
  BLUE_1:   0xa4dddb,
  BLUE_2:   0x73bed3,
  BLUE_3:   0x4f8fba,
  BLUE_4:   0x3c5e8b,
  BLUE_5:   0x253a5e,
  BLUE_6:   0x172038,

  // ─── GREENS (1 = Helles Gelbgrün, 6 = Dunkles Tannengrün) ────────
  GREEN_1:  0xd0da91,
  GREEN_2:  0xa8ca58,
  GREEN_3:  0x75a743,
  GREEN_4:  0x468232,
  GREEN_5:  0x25562e,
  GREEN_6:  0x19332d,

  // ─── BROWNS (1 = Heller Sand, 6 = Dunkles Holz/Erde) ─────────────
  BROWN_1:  0xe7d5b3,
  BROWN_2:  0xd7b594,
  BROWN_3:  0xc09473,
  BROWN_4:  0xad7757,
  BROWN_5:  0x7a4841,
  BROWN_6:  0x4d2b32,

  // ─── GOLDS (1 = Helles Gold, 6 = Dunkles Rostrot/Braun) ──────────
  GOLD_1:   0xe8c170,
  GOLD_2:   0xde9e41,
  GOLD_3:   0xbe772b,
  GOLD_4:   0x884b2b,
  GOLD_5:   0x602c2c,
  GOLD_6:   0x341c27,

  // ─── REDS (1 = Helles Orange, 6 = Sehr dunkles Weinrot) ──────────
  RED_1:    0xda863e,
  RED_2:    0xcf573c,
  RED_3:    0xa53030, // Dein "dritthellstes Rot"
  RED_4:    0x752438, // Dein "vierthellstes Rot"
  RED_5:    0x411d31,
  RED_6:    0x241527,

  // ─── PURPLES (1 = Helles Rosa, 6 = Dunkles Indigo) ───────────────
  PURPLE_1: 0xdf84a5,
  PURPLE_2: 0xc65197,
  PURPLE_3: 0xa23e8c,
  PURPLE_4: 0x7a367b,
  PURPLE_5: 0x402751,
  PURPLE_6: 0x1e1d39,

  // ─── GREYS (1 = Fast Weiß, 10 = Fast Schwarz) ────────────────────
  GREY_1:   0xebede9,
  GREY_2:   0xc7cfcc,
  GREY_3:   0xa8b5b2,
  GREY_4:   0x819796,
  GREY_5:   0x577277,
  GREY_6:   0x394a50,
  GREY_7:   0x202e37,
  GREY_8:   0x151d28,
  GREY_9:   0x10141f,
  GREY_10:  0x090a14,


  // Alpha-Werte
  CANOPY_ALPHA: 0.4
} as const;

/** Kanonischer VFX-Akzent fuer die lila Boss-Feuerfamilie. */
export const VOID_FIRE_COLOR = 0xb347ff;
/**
 * Gemeinsamer Akzent des Plasmabrenners fuer Strahl, Treffer und Regenerations-VFX.
 */
export const PLASMA_BURNER_COLOR = 0x5cf58f;
export const ENERGY_INJECTOR_COLOR = 0x53b6ff;
/** @deprecated Persistenz-/Testkompatibilitaet; UI und Fachlogik verwenden Energieinjektor. */

/** Gemeinsame Palette aller Leerenjäger-Warnungen, Projektile und Einschläge. */
export const VOID_PALETTE = {
  core: 0xf9e8ff,
  bright: 0xd98cff,
  primary: VOID_FIRE_COLOR,
  deep: 0x6f16a8,
  shadow: 0x240a38,
} as const;

export interface BeamPalette {
  shadow: number;
  glow: number;
  core: number;
}

const DEFAULT_BEAM_PALETTE: BeamPalette = {
  shadow: COLORS.GREY_9,
  glow:   COLORS.GREY_5,
  core:   COLORS.GREY_1,
};

export function getBeamPaletteForPlayerColor(color: number): BeamPalette {
  switch (color) {
    case COLORS.BLUE_3:
    case COLORS.BLUE_2:
      return { shadow: COLORS.BLUE_6, glow: COLORS.BLUE_4, core: COLORS.BLUE_1 };

    case COLORS.GREEN_3:
    case COLORS.GREEN_2:
      return { shadow: COLORS.GREEN_6, glow: COLORS.GREEN_4, core: COLORS.GREEN_1 };

    case COLORS.BROWN_3:
    case COLORS.BROWN_2:
      return { shadow: COLORS.BROWN_6, glow: COLORS.BROWN_4, core: COLORS.BROWN_1 };

    case COLORS.GOLD_3:
    case COLORS.GOLD_2:
      return { shadow: COLORS.GOLD_6, glow: COLORS.GOLD_4, core: COLORS.GOLD_1 };

    case COLORS.RED_3:
    case COLORS.RED_2:
      return { shadow: COLORS.RED_6, glow: COLORS.RED_4, core: COLORS.RED_1 };

    case COLORS.PURPLE_3:
    case COLORS.PURPLE_2:
      return { shadow: COLORS.PURPLE_6, glow: COLORS.PURPLE_4, core: COLORS.PURPLE_1 };

    default:
      return DEFAULT_BEAM_PALETTE;
  }
}

export function toCssColor(color: number): `#${string}` {
  return `#${color.toString(16).padStart(6, '0')}`;
}


// ---- Player ----
export const PLAYER_SIZE  = 32;
export const PLAYER_SPEED = 200;
export const MUZZLE_FORWARD_OFFSET = PLAYER_SIZE * 0.7;
export const MUZZLE_PROJECTILE_FALLBACK_BACKTRACK = PLAYER_SIZE * 1.1;
/**
 * Authoring-/Referenzraster der getragenen Items. Dieses Raster ist unabhaengig von der
 * Source-/Frame-Aufloesung animierter Charakter-Sprites.
 */
export const HELD_ITEM_TEXTURE_SIZE = 32;

/** Backwards-compatible name for the held-item reference raster. */
export const PLAYER_TEXTURE_SIZE = HELD_ITEM_TEXTURE_SIZE;
/**
 * Pfotenanker in Texturpixeln relativ zur Bildmitte, `-y` ist Blickrichtung. Auf diesem Punkt
 * sitzt der Griff des getragenen Items. Er entspricht der Stelle, an der `32x32dachsweapon01.png`
 * die Waffe mit braunen Pixeln vormerkte: mittig auf der Laengsachse, knapp vor der Schnauze.
 */
export const HELD_ITEM_ANCHOR_X = 0;
export const HELD_ITEM_ANCHOR_Y = -9;

// ---- Combat ----
export const HP_MAX           = 100;
export const BURN_TICK_INTERVAL_MS = 250;
export const ARMOR_MAX        = 100;
export const ARMOR_COLOR      = COLORS.GOLD_2;
export const RESPAWN_DELAY_MS = 2000;
export const HITSCAN_FAVOR_THE_SHOOTER_MS = 120;
export const HITSCAN_FAVOR_THE_SHOOTER_MAX_OFFSET = 36;

export const BLOOD_HIT_VFX = {
  spawnPushPx: PLAYER_SIZE * 0.18,
  lateralJitterPx: 8,
  killshotMultiplier: 2.5,
  /** Aggressive Killshot-Tuningwerte; normale Treffer bleiben beim GPU-Basisstil. */
  killshot: {
    streakTravelScale: 2.25,
    streakScale: 1.8,
    dropletTravelScale: 2.05,
    dropletScale: 1.55,
    stainScale: 2.0,
    microDropletScale: 1.25,
  },
  maxActiveStains: 500,
  palette: [0x3c070b, 0x5b0d12, 0x76171b, 0x8d2429] as const,
  coreSplashScale: 1.52,
  coreSplashAlpha: 0.98,
  coreSplashDurationMs: 160,
  stainDelayMs: 250,
  bands: {
    light: {
      maxDamage: 14,
      spreadDeg: 18,
      streakCountMin: 3,
      streakCountMax: 5,
      dropletCountMin: 2,
      dropletCountMax: 4,
      travelMinPx: 14,
      travelMaxPx: 34,
      streakScaleMin: 0.64,
      streakScaleMax: 1.08,
      dropletScaleMin: 0.36,
      dropletScaleMax: 0.68,
      flightMinMs: 110,
      flightMaxMs: 190,
      stainCountMin: 1,
      stainCountMax: 3,
      stainScaleMin: 0.28,
      stainScaleMax: 0.50,
      stainAlpha: 0.34,
      stainFadeMs: 6000,
    },
    medium: {
      maxDamage: 38,
      spreadDeg: 28,
      streakCountMin: 6,
      streakCountMax: 9,
      dropletCountMin: 5,
      dropletCountMax: 8,
      travelMinPx: 22,
      travelMaxPx: 56,
      streakScaleMin: 0.70,
      streakScaleMax: 1.28,
      dropletScaleMin: 0.40,
      dropletScaleMax: 0.84,
      flightMinMs: 140,
      flightMaxMs: 240,
      stainCountMin: 2,
      stainCountMax: 4,
      stainScaleMin: 0.36,
      stainScaleMax: 0.64,
      stainAlpha: 0.44,
      stainFadeMs: 8000,
    },
    heavy: {
      maxDamage: Number.POSITIVE_INFINITY,
      spreadDeg: 40,
      streakCountMin: 10,
      streakCountMax: 15,
      dropletCountMin: 7,
      dropletCountMax: 12,
      travelMinPx: 32,
      travelMaxPx: 84,
      streakScaleMin: 0.78,
      streakScaleMax: 1.46,
      dropletScaleMin: 0.38,
      dropletScaleMax: 0.86,
      flightMinMs: 170,
      flightMaxMs: 290,
      stainCountMin: 4,
      stainCountMax: 7,
      stainScaleMin: 0.40,
      stainScaleMax: 0.80,
      stainAlpha: 0.56,
      stainFadeMs: 10000,
    },
  },
} as const;

export const DEATH_DISINTEGRATION_VFX = {
  durationMs: 700,
  chunkSizePx: 4,
  travelMinPx: 22,
  travelMaxPx: 104,
  jitterPx: 18,
  rotationMaxDeg: 180,
  scaleStart: 1.55,
  scaleEnd: 0.42,
  /** Sichtbarer Zuschlag fuer die Hauptmasse; basiert weiterhin auf der World-Display-Groesse. */
  mainFragmentScaleBoost: 1.35,
  /** Hit-Impuls als Vielfaches des radialen Fragment-Reisewegs. */
  mainHitImpulse: 1.65,
  microHitImpulse: 1.85,
  glowHitImpulse: 1.6,
  alpha: 1,
  auraTintMix: 0.26,
  maxChunksPerEffect: 64,
  glowCount: 8,
  glowTravelMinPx: 26,
  glowTravelMaxPx: 118,
  glowScaleMin: 0.34,
  glowScaleMax: 0.96,
  glowAlpha: 0.48,
} as const;

/**
 * Dauerzustand „wenig Leben" am Bildschirmrand: großflächiges, dezentes Blut auf der
 * Klarheitskamera. Es ersetzt den früheren Gesundheitsanteil der schwarzen Weltvignette – ein
 * dunkler werdender Rand las sich als „Licht geht aus", nicht als „du blutest", und verschluckte
 * nachts Gegner am Bildrand.
 *
 * Die Farben kommen aus {@link BLOOD_HIT_VFX.palette}, damit Rand und Blutspritzer dieselbe
 * Sprache sprechen. Bewusst die **dunklen** Palettentöne: der Effekt deckt bei wenig Leben
 * große Teile des Bildes ab, und ein hellerer Rotton legt sich dort als Schleier über die
 * Karte, statt am Rand zu kleben. Sichtbarkeit kommt aus der Deckkraft, nicht aus der
 * Helligkeit.
 *
 * Die Spritzer stehen genau eine Palettenstufe über der Fläche. Sie bedecken als einzelne
 * Tropfen wenig Bildfläche und dürfen sich deshalb abheben, ohne zu schleiern – gleichauf mit
 * der Fläche verschwänden sie in ihr, eine Stufe höher wären sie so hell wie die
 * Schadensvignette und nähmen ihr den Akzent.
 */
export const LOW_HEALTH_BLOOD_VFX = {
  filmColor: BLOOD_HIT_VFX.palette[1],
  speckleColor: BLOOD_HIT_VFX.palette[2],
  /** Ab hier blendet der Rand ein; darüber ist er vollständig unsichtbar. */
  onsetHpFraction: 0.5,
  /** Einzelne Spritzer kommen später dazu – sie markieren den kritischen Bereich. */
  speckleOnsetHpFraction: 0.42,
  filmAlphaMax: 0.42,
  speckleAlphaMax: 0.44,
  /** Ein Treffer schlägt sofort durch, Heilung blutet aus, statt zu blinken. */
  riseMs: 180,
  fallMs: 600,
  pulseAmplitude: 0.15,
  pulsePeriodOnsetMs: 1400,
  pulsePeriodCriticalMs: 700,
} as const;

export const DAMAGE_VIGNETTE_VFX = {
  color: BLOOD_HIT_VFX.palette[3],
  durationMs: 800,
  damageFloor: 6,
  damageMid: 22,
  damageCeil: 58,
  alphaMin: 0.1,
  alphaMid: 0.3,
  alphaMax: 0.52,
  maxAlpha: 0.72,
  stackAlphaBonus: 0.08,
  /** Fraction of the directional alpha shown uniformly on all 4 edges (the base frame). */
  frameAlphaRatio: 0.2,
} as const;

/**
 * Trefferreaktion am Ziel: kurzlebige additive Kopie der **eigenen** Textur des Getroffenen
 * plus ein rein visueller Positionsimpuls. Die Schadensbänder werden aus
 * {@link BLOOD_HIT_VFX} abgeleitet, damit Blut und Blitz dieselbe Schwelle benutzen.
 *
 * `maxRearmLifetimeMs` deckelt das Nachtriggern: Schaden über Zeit und Schnellfeuerwaffen
 * liefern viele winzige Trefferereignisse. Ohne Deckel bliebe die Silhouette dauerhaft
 * erleuchtet statt zu pulsieren.
 */
export const HIT_FEEDBACK_VFX = {
  refractoryMs: 45,
  maxRearmLifetimeMs: 320,
  maxJoltPx: 5,
  /** Der eigene Dachs zuckt bewusst schwächer – sonst löst er sich beim Zielen vom Fadenkreuz. */
  localPlayerJoltFactor: 0.4,
  bands: {
    light:  { alpha: 0.35, durationMs:  70, scaleBoost: 1.00, whiteMix: 0.55, joltPx: 0.9, joltMs:  90, cameraKickPx: 0 },
    medium: { alpha: 0.55, durationMs:  95, scaleBoost: 1.05, whiteMix: 0.70, joltPx: 1.8, joltMs: 110, cameraKickPx: 0 },
    heavy:  { alpha: 0.78, durationMs: 125, scaleBoost: 1.10, whiteMix: 0.85, joltPx: 3.0, joltMs: 130, cameraKickPx: 4 },
    lethal: { alpha: 0.95, durationMs: 150, scaleBoost: 1.14, whiteMix: 1.00, joltPx: 4.4, joltMs: 150, cameraKickPx: 7 },
  },
} as const;

// ---- HP-Balken ----
export const HP_BAR_WIDTH    = PLAYER_SIZE;     // gleiche Breite wie Spieler
export const HP_BAR_HEIGHT   = 5;
export const HP_BAR_OFFSET_Y = 24;              // Pixel unter Sprite-Mittelpunkt
export const ENEMY_HP_BAR_VISIBLE_MS = 3000;
export const ARMOR_BAR_WIDTH    = PLAYER_SIZE;
export const ARMOR_BAR_HEIGHT   = 3;
export const ARMOR_BAR_OFFSET_Y = HP_BAR_OFFSET_Y + HP_BAR_HEIGHT + 1;

// ---- Effekt-Layer (über Baumkronen) ----
export const DEPTH_TRACE = 16;
export const DEPTH_FX = 25;

/**
 * Die Zielhilfe ist ein reines HUD-Element und darf weder vom Lightmap-Overlay
 * verdunkelt noch von seiner Färbung verschoben werden – sie soll zu jeder Uhrzeit
 * gleich aussehen. Sie liegt deshalb knapp über `DEPTH_LIGHTING`, aber unter den
 * Baumkronen (`DEPTH.CANOPY`).
 */
export const DEPTH_AIM = DEPTH.CANOPY - 0.4;

/**
 * Lightmap-Overlay der dynamischen Beleuchtung: über Boden, Felsen, Baumstämmen und
 * Spielern, aber **unter** den Baumkronen (`DEPTH.CANOPY` = 20) und unter `DEPTH_FX` –
 * Explosions- und Feuer-Visuals sind emissiv und sollen auch nachts ungedimmt bleiben.
 * Genau deshalb erfasst sie die Uhrzeit nicht: ihre Tagesbalance läuft stattdessen über
 * `EmissiveScale`.
 *
 * Die Kronen liegen bewusst darüber: der Schattenwurf gehört zum Baumstamm und darf
 * optisch nicht auf der eigenen Krone landen. Kronen werden stattdessen einzeln über
 * `LightingSystem.resolveCanopyTint()` eingefärbt.
 */
export const DEPTH_LIGHTING = DEPTH.CANOPY - 0.5;

// ---- Prozedurales Arena-Grid ----
/** Lobby side menus extend two grid cells farther toward the screen centre than the arena HUD. */
export const LOBBY_SIDE_MENU_WIDTH = DEFAULT_ARENA_OFFSET_X + CELL_SIZE * 2;
/** The lobby rock frames gain one grid row at their lower edge. */
export const LOBBY_SIDE_MENU_EXTRA_HEIGHT = CELL_SIZE;
export let GRID_COLS             = Math.floor(ARENA_WIDTH  / CELL_SIZE); // 45 / 135
export let GRID_ROWS              = Math.floor(ARENA_HEIGHT / CELL_SIZE); // 33
/** Aktuelle Coop-Breite: 60 Rasterzellen entsprechen der 1920-px-Designbreite. */
export const DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS = FULL_ARENA_WIDTH / CELL_SIZE;
/**
 * Gemeinsame Obergrenze beider Coop-Achsen.
 *
 * Sie ist bewusst kein Designmass und auch keine Ableitung aus einer konkreten Testkarte,
 * sondern die Stelle, an der die vorhandenen Datenstrukturen technisch enden:
 *
 * - `RockOverlayRegions.rockCellKey` packt beide Achsen mit Stride 65536 in eine Zahl,
 * - `RockGridIndex` haelt `cols * rows` Eintraege in einem `Int32Array`,
 * - `TerrainColorSnapshot` haelt drei Bytes je 4x4-Samplingpixel.
 *
 * 1024 Zellen je Achse bleiben mit rund einer Million Zellen deutlich unter allen dreien.
 * Die bisherigen Grenzen (135 Spalten aus der CTB-Breite, 56 Zeilen aus arenagrossen
 * Render-/Sampler-Puffern) sind entfallen, weil ihre technische Ursache entfallen ist:
 * Der Arena-Hintergrund ist eine kachelnde Textur ohne modusabhaengiges Grossbild, und die
 * sichtbaren Weltschichten liegen seit dem Chunk-Streaming nicht mehr in arenagrossen
 * Renderzielen (siehe `arena/chunks/ChunkedRenderSurface.ts`).
 */
export const MAX_COOP_DEFENSE_ARENA_AXIS_CELLS = 1024;
export const MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS = MAX_COOP_DEFENSE_ARENA_AXIS_CELLS;
/** Bestehende Coop-Maps bleiben ohne Angabe bei 33 Zeilen (1056 px). */
export const DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS = DEFAULT_ARENA_HEIGHT / CELL_SIZE;
export const MIN_COOP_DEFENSE_ARENA_HEIGHT_CELLS = DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS;
export const MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS = MAX_COOP_DEFENSE_ARENA_AXIS_CELLS;
export const ROCK_FILL_RATIO     = 0.30;
export const DIRT_FILL_RATIO     = 0.05;   
export const DEFAULT_TREE_COUNT  = 3;
export const CAPTURE_THE_BEER_TREE_COUNT = 8;
export let TREE_COUNT            = DEFAULT_TREE_COUNT;
export const CA_SMOOTHING_STEPS  = 4;    // Anzahl Cellular-Automata-Durchläufe (0 = kein Smoothing)
export const CA_MIN_ROCK_NEIGHBORS = 3;  // Fels mit < N Nachbarn wird zu Boden
export const CA_MAX_FLOOR_NEIGHBORS = 4; // Boden mit > N Nachbarn wird zu Fels

// ---- Gleise ----
/** Anzahl Gleise pro Runde */
export const TRACK_COUNT           = 1;
/** Erste erlaubte Spalte (≥ 25 % der Arena-Breite, inklusive) */
export let TRACK_SPAWN_MIN_COL     = Math.floor(GRID_COLS * 0.25);
/** Letzte erlaubte Spalte (≤ 75 % der Arena-Breite, inklusive) */
export let TRACK_SPAWN_MAX_COL     = Math.floor(GRID_COLS * 0.75);
export const CAPTURE_THE_BEER_BASE_WIDTH_CELLS = 8;
export const CAPTURE_THE_BEER_TEAM_ZONE_WIDTH_CELLS = CAPTURE_THE_BEER_BASE_WIDTH_CELLS * 2;
export let CAPTURE_THE_BEER_BASES_ACTIVE = false;

// ---- Coop-Defense Basen ----
// Anzahl, Position, Form und HP pro Basis werden in
// `src/config/coopDefenseMaps/*.json` definiert und vom `BaseRegistry` aufgelöst.
/** Wird beim Wechsel in den Coop-Modus von applyArenaMetricsForMode() gesetzt. */
export let COOP_DEFENSE_BASES_ACTIVE = false;
/** HP-Bar Höhe für Coop-Basen (~2× Spieler-HP-Bar). */
export const COOP_DEFENSE_BASE_HP_BAR_HEIGHT = 10;
/** Vertikaler Abstand der HP-Bar zur Unterkante der Basis (px). */
export const COOP_DEFENSE_BASE_HP_BAR_GAP = 12;
/** Füll-Farbe der Coop-Basis HP-Bar (gleiches Grün wie Verbündete). */
export const COOP_DEFENSE_BASE_HP_BAR_FILL = 0x00cc44;
/** Füll-Farbe der HP-Bar einer feindlichen Basis – dasselbe Rot wie das rote Team. */
export const COOP_DEFENSE_HOSTILE_BASE_HP_BAR_FILL = COLORS.RED_2;

// ---- Coop-Defense Pathfinding ----
/** Standardkosten fuer begehbaren Boden im hostseitigen Cost Field. */
export const COOP_DEFENSE_FLOW_FIELD_GROUND_COST = 1;
/** Dirt bleibt begehbar, ist aber leicht unattraktiver als Gras. */
export const COOP_DEFENSE_FLOW_FIELD_DIRT_COST = 2;
/** Gleise bleiben passierbar, sollen aber deutlicher gemieden werden als Gras oder Dirt. */
export const COOP_DEFENSE_FLOW_FIELD_TRACK_COST = 4;
/** Zusatzkosten nur fuer einen Schritt laengs von einer Gleiszelle zur naechsten. */
export const COOP_DEFENSE_FLOW_FIELD_TRACK_LONGITUDINAL_COST = 24;
/** Eine notwendige Route darf hoechstens so viele Gleiszellen am Stueck benoetigen. */
export const COOP_DEFENSE_MAX_REQUIRED_TRACK_RUN_CELLS = 4;
/** Breite der prozedural freigehaltenen Querungsstreifen in Rasterzellen. */
export const COOP_DEFENSE_TRACK_CROSSING_WIDTH_CELLS = 2;
/** Seitlicher Freiraum links und rechts eines Querungsstreifens. */
export const COOP_DEFENSE_TRACK_CROSSING_CLEARANCE_SIDE_CELLS = 2;
/** Querungsstreifen liegen regelmaessig dichter als der zentrale Gleislauf-Grenzwert. */
export const COOP_DEFENSE_TRACK_CROSSING_INTERVAL_CELLS = COOP_DEFENSE_MAX_REQUIRED_TRACK_RUN_CELLS + 1;
/** Zerstoerbare Hindernisse bleiben semantisch separat, sind aber aktuell blockiert. */
export const COOP_DEFENSE_FLOW_FIELD_ROCK_COST = 100;
/** Unzerstoerbare, unpassierbare Hindernisse. */
export const COOP_DEFENSE_FLOW_FIELD_TRUNK_COST = 999999;
/** Basis-Footprints bleiben blockiert, nutzen aber dieselbe Kostenklasse wie Rocks. */
export const COOP_DEFENSE_FLOW_FIELD_BASE_COST = COOP_DEFENSE_FLOW_FIELD_ROCK_COST;
/**
 * Aufschlag fuer begehbare Zellen, die an ein unzerstoerbares Hindernis grenzen (Basis, Baumstumpf).
 * Normale Gegnerkoerper sind hoechstens 30 px breit, eine Zelle nur 32 px: Eine Route entlang der
 * Zellmittelpunkte direkt an einer Basiswand laesst den Koerper trotzdem dauerhaft in der Wand
 * haengen. Der Aufschlag biegt Routen um eine Zelle von solchen Waenden weg, laesst enge Korridore
 * aber weiterhin zu; Bosse verwenden ihr eigenes Clearance-Profil.
 * Felsen sind bewusst ausgenommen: an ihnen soll der Gegner haengen bleiben und sie wegbeissen.
 */
export const COOP_DEFENSE_FLOW_FIELD_WALL_ADJACENT_COST = 2;
/** Host prueft hoechstens alle 100 ms, ob das Flow Field wegen Arena-Mutationen neu gebaut werden muss. */
export const COOP_DEFENSE_FLOW_FIELD_REBUILD_INTERVAL_MS = 100;
/**
 * Basistakt der Flowfield-Navigation. Die Berechnung laeuft im Web Worker; aktiviert wird ein
 * Ergebnis ausschliesslich an einem Nav-Tick und nie dazwischen. Damit haengt das Verhalten weder
 * an den Render-FPS noch an der Worker-Dauer, solange diese innerhalb eines Ticks bleibt.
 *
 * 50 ms statt der frueheren 100 ms: Ziel-Eingaben werden erst am Folgetick aktiv, ein 100-ms-Takt
 * wuerde die Verfolgungslatenz gegenueber der synchronen Berechnung sonst verdoppeln. Unveraenderte
 * Zielzellen erzeugen keinen Rebuild, die zusaetzlichen Ticks sind also meist kostenlos.
 */
export const COOP_DEFENSE_NAV_TICK_INTERVAL_MS = 50;
/** Player-, Boss- und Ally-Felder folgen jedem Nav-Tick (20 Hz). */
export const COOP_DEFENSE_NAV_TICK_DIVISOR_DEFAULT = 1;
/** Das strategische Feld reicht mit 5 Hz; seine Zielmenge aendert sich deutlich traeger. */
export const COOP_DEFENSE_NAV_TICK_DIVISOR_STRATEGIC = 4;

export interface ArenaGridRegion {
  minGridX: number;
  maxGridX: number;
  minGridY: number;
  maxGridY: number;
}

export function isGridCellInArenaRegion(region: ArenaGridRegion, gx: number, gy: number): boolean {
  return gx >= region.minGridX
    && gx <= region.maxGridX
    && gy >= region.minGridY
    && gy <= region.maxGridY;
}

function clampCaptureTheBeerRegionWidth(widthCells: number): number {
  return Math.max(1, Math.min(widthCells, Math.max(1, GRID_COLS)));
}

export function getCaptureTheBeerBaseRegion(teamId: TeamId): ArenaGridRegion {
  const width = clampCaptureTheBeerRegionWidth(CAPTURE_THE_BEER_BASE_WIDTH_CELLS);
  if (teamId === 'blue') {
    return { minGridX: 0, maxGridX: width - 1, minGridY: 0, maxGridY: GRID_ROWS - 1 };
  }
  return { minGridX: GRID_COLS - width, maxGridX: GRID_COLS - 1, minGridY: 0, maxGridY: GRID_ROWS - 1 };
}

export function getCaptureTheBeerTeamSpawnRegion(teamId: TeamId): ArenaGridRegion {
  const width = clampCaptureTheBeerRegionWidth(CAPTURE_THE_BEER_TEAM_ZONE_WIDTH_CELLS);
  if (teamId === 'blue') {
    return { minGridX: 0, maxGridX: width - 1, minGridY: 0, maxGridY: GRID_ROWS - 1 };
  }
  return { minGridX: GRID_COLS - width, maxGridX: GRID_COLS - 1, minGridY: 0, maxGridY: GRID_ROWS - 1 };
}

export function getCaptureTheBeerMiddleThirdRegion(): ArenaGridRegion {
  const width = Math.max(1, Math.floor(GRID_COLS / 3));
  const minGridX = Math.floor((GRID_COLS - width) / 2);
  return {
    minGridX,
    maxGridX: minGridX + width - 1,
    minGridY: 0,
    maxGridY: GRID_ROWS - 1,
  };
}

export function getCaptureTheBeerBaseWorldBounds(teamId: TeamId): { x: number; y: number; width: number; height: number } {
  const region = getCaptureTheBeerBaseRegion(teamId);
  const x = ARENA_OFFSET_X + region.minGridX * CELL_SIZE;
  const y = ARENA_OFFSET_Y + region.minGridY * CELL_SIZE;
  const width = (region.maxGridX - region.minGridX + 1) * CELL_SIZE;
  const height = (region.maxGridY - region.minGridY + 1) * CELL_SIZE;
  return { x, y, width, height };
}

export function getCaptureTheBeerHomeWorldPosition(teamId: TeamId): { x: number; y: number } {
  const bounds = getCaptureTheBeerBaseWorldBounds(teamId);
  const inset = Math.min(bounds.width * 0.5, CELL_SIZE * 1.5);
  return {
    x: teamId === 'blue' ? bounds.x + bounds.width - inset : bounds.x + inset,
    y: bounds.y + bounds.height * 0.5,
  };
}

export function isCaptureTheBeerBaseModeActive(): boolean {
  return CAPTURE_THE_BEER_BASES_ACTIVE;
}

export function isCaptureTheBeerBaseCell(gx: number, gy: number): boolean {
  if (!CAPTURE_THE_BEER_BASES_ACTIVE) return false;
  return isGridCellInArenaRegion(getCaptureTheBeerBaseRegion('blue'), gx, gy)
    || isGridCellInArenaRegion(getCaptureTheBeerBaseRegion('red'), gx, gy);
}

export function isCoopDefenseBasesActive(): boolean {
  return COOP_DEFENSE_BASES_ACTIVE;
}

const COOP_DEFENSE_ARENA_METRICS_PROFILES = new Map<string, ArenaMetricsProfile>();

export function normalizeCoopDefenseArenaWidthCells(widthCells: number | undefined): number {
  if (typeof widthCells !== 'number' || !Number.isFinite(widthCells)) {
    return DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS;
  }
  return Math.max(
    DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
    Math.min(MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS, Math.floor(widthCells)),
  );
}

export function normalizeCoopDefenseArenaHeightCells(heightCells: number | undefined): number {
  if (typeof heightCells !== 'number' || !Number.isFinite(heightCells)) {
    return DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS;
  }
  return Math.max(
    MIN_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
    Math.min(MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS, Math.floor(heightCells)),
  );
}

function getCoopDefenseArenaMetricsProfile(
  widthCells: number | undefined,
  heightCells: number | undefined,
): ArenaMetricsProfile {
  const normalizedWidthCells = normalizeCoopDefenseArenaWidthCells(widthCells);
  const normalizedHeightCells = normalizeCoopDefenseArenaHeightCells(heightCells);
  const cacheKey = `${normalizedWidthCells}:${normalizedHeightCells}`;
  const cached = COOP_DEFENSE_ARENA_METRICS_PROFILES.get(cacheKey);
  if (cached) return cached;

  const arenaWidth = normalizedWidthCells * CELL_SIZE;
  const arenaHeight = normalizedHeightCells * CELL_SIZE;
  const usesVerticalScrolling = arenaHeight > DEFAULT_ARENA_VIEWPORT_HEIGHT;
  const profile: ArenaMetricsProfile = {
    arenaWidth,
    arenaOffsetX: 0,
    arenaHeight,
    arenaOffsetY: usesVerticalScrolling ? 0 : DEFAULT_ARENA_OFFSET_Y,
    arenaViewportWidth: GAME_WIDTH,
    arenaViewportHeight: usesVerticalScrolling ? GAME_HEIGHT : DEFAULT_ARENA_VIEWPORT_HEIGHT,
    usesDynamicCamera: arenaWidth > GAME_WIDTH || usesVerticalScrolling,
    showStaticArenaFrames: false,
  };
  COOP_DEFENSE_ARENA_METRICS_PROFILES.set(cacheKey, profile);
  return profile;
}

export function getArenaMetricsProfile(
  mode: GameMode,
  phase: GamePhase,
  coopDefenseArenaWidthCells?: number,
  coopDefenseArenaHeightCells?: number,
): ArenaMetricsProfile {
  // Die Lobby benutzt bewusst dasselbe Arenamass wie das Deathmatch: volle Bildschirmbreite,
  // keine Seitenbalken, und als einziger nicht nutzbarer Rand die schmalen Streifen oben und
  // unten (`ARENA_OFFSET_Y`). Nur so decken sich Weltgrenzen, Kameragrenzen, Audio-Panning und
  // das Beschneiden von Effekten mit der Flaeche, die die Lobby-Vorschau tatsaechlich zeigt –
  // die Ambient-Inszenierung spielt sonst ausserhalb der Arena, die das Spiel annimmt.
  if (phase !== 'ARENA') return FULL_WIDTH_ARENA_METRICS_PROFILE;
  if (mode === CAPTURE_THE_BEER_MODE) return CAPTURE_THE_BEER_ARENA_METRICS_PROFILE;
  if (mode === COOP_DEFENSE_MODE) {
    return getCoopDefenseArenaMetricsProfile(coopDefenseArenaWidthCells, coopDefenseArenaHeightCells);
  }
  return FULL_WIDTH_ARENA_METRICS_PROFILE;
}

export function applyArenaMetricsForMode(
  mode: GameMode,
  phase: GamePhase,
  coopDefenseArenaWidthCells?: number,
  coopDefenseArenaHeightCells?: number,
): void {
  ACTIVE_ARENA_METRICS_PROFILE = getArenaMetricsProfile(
    mode,
    phase,
    coopDefenseArenaWidthCells,
    coopDefenseArenaHeightCells,
  );
  ARENA_WIDTH = ACTIVE_ARENA_METRICS_PROFILE.arenaWidth;
  ARENA_OFFSET_X = ACTIVE_ARENA_METRICS_PROFILE.arenaOffsetX;
  ARENA_VIEWPORT_WIDTH = ACTIVE_ARENA_METRICS_PROFILE.arenaViewportWidth;
  ARENA_HEIGHT = ACTIVE_ARENA_METRICS_PROFILE.arenaHeight;
  ARENA_OFFSET_Y = ACTIVE_ARENA_METRICS_PROFILE.arenaOffsetY;
  ARENA_VIEWPORT_HEIGHT = ACTIVE_ARENA_METRICS_PROFILE.arenaViewportHeight;
  ARENA_STATIC_FRAMES_VISIBLE = ACTIVE_ARENA_METRICS_PROFILE.showStaticArenaFrames;
  ARENA_MAX_X = ARENA_OFFSET_X + ARENA_WIDTH;
  ARENA_MAX_Y = ARENA_OFFSET_Y + ARENA_HEIGHT;
  SHOT_AUDIO_REMOTE_MAX_DISTANCE = ARENA_WIDTH;
  SHOT_AUDIO_PAN_RANGE = ARENA_WIDTH * 0.5;
  GRID_COLS = Math.floor(ARENA_WIDTH / CELL_SIZE);
  GRID_ROWS = Math.floor(ARENA_HEIGHT / CELL_SIZE);
  TRACK_SPAWN_MIN_COL = Math.floor(GRID_COLS * 0.25);
  TRACK_SPAWN_MAX_COL = Math.floor(GRID_COLS * 0.75);
  CAPTURE_THE_BEER_BASES_ACTIVE = mode === CAPTURE_THE_BEER_MODE;
  COOP_DEFENSE_BASES_ACTIVE = mode === COOP_DEFENSE_MODE;
  TREE_COUNT = mode === CAPTURE_THE_BEER_MODE ? CAPTURE_THE_BEER_TREE_COUNT : DEFAULT_TREE_COUNT;
  ARENA_DURATION_SEC = mode === CAPTURE_THE_BEER_MODE ? CAPTURE_THE_BEER_ARENA_DURATION_SEC : DEFAULT_ARENA_DURATION_SEC;
}

// ---- Felsen HP ----
export const ROCK_HP_MAX         = 100;
export const ROCK_TINT_STEPS     = 20;     // Anzahl visueller Abstufungen (0xffffff → 0x666666)

// ---- Baumstumpf & Baumkrone ----
export const TRUNK_RADIUS        = 16;     // Kollisions-Radius Baumstumpf (px)
export const CANOPY_RADIUS       = 96;     // Visueller Radius Baumkrone (px)
export const CANOPY_ALPHA_PLAYER = 0.2;   // Alpha wenn lokaler Spieler darunter (80% transparent)

// ---- Ressourcen ----
export const ADRENALINE_MAX            = 100;
export const ADRENALINE_START          = 30;
export const ADRENALINE_REGEN_PER_SEC  = 10;    // passiv, Host
export const ADRENALINE_DRAIN_PER_SEC  = 20;   // während Burrow
export const ADRENALINE_REGEN_PAUSE_MS = 500;  // Pause nach Verbrauch

export const RAGE_MAX                  = 600;
export const RAGE_PER_DAMAGE           = 1;    // Wut pro Schadenspunkt

// ---- Dash ----
export const DASH_T1_S    = 0.5;    // Burst-Phase Dauer (s)
export const DASH_T2_S    = 0.25;    // Recovery-Phase Dauer (s)
export const DASH_F_MIN   = 0.25;   // Kriechgang-Faktor (25 % v_norm)
// f_start = (3*t1 + 2*t2 - 2*f_min*(t1+t2)) / t1 = 3.25 — Strecken-Neutralität
export const DASH_F_START =
  (3 * DASH_T1_S + 2 * DASH_T2_S - 2 * DASH_F_MIN * (DASH_T1_S + DASH_T2_S)) / DASH_T1_S;
export const DASH_HOLD_MAX_DURATION_FACTOR = 2;
export const DASH_GROUND_FIRE_BURN_DURATION_MS = 2000;
export const DASH_GROUND_FIRE_DAMAGE_PER_TICK = 0.25;

// ---- Burrow ----
export const BURROW_MIN_ADRENALINE       = 15;
export const BURROW_WINDUP_DURATION_MS   = 150;
export const BURROW_WINDUP_SPEED_FACTOR  = 0.8;
export const BURROW_UNDERGROUND_SPEED_FACTOR = 1.3;
export const BURROW_DRAIN_AMOUNT_PER_TICK = 5;
export const BURROW_DRAIN_INTERVAL_MS    = 60;
export const BURROW_STUCK_DAMAGE_PER_SEC = 25;
export const BURROW_POPOUT_WEAPON_LOCK_MS = 300;

export interface MuzzleOrigin {
  x: number;
  y: number;
}

export function getTopDownMuzzleOrigin(originX: number, originY: number, aimAngle: number, forwardOffset = MUZZLE_FORWARD_OFFSET): MuzzleOrigin {
  return {
    x: originX + Math.cos(aimAngle) * forwardOffset,
    y: originY + Math.sin(aimAngle) * forwardOffset,
  };
}

export function getTopDownMuzzleOriginFromVector(originX: number, originY: number, vx: number, vy: number, forwardOffset = MUZZLE_FORWARD_OFFSET): MuzzleOrigin {
  const len = Math.hypot(vx, vy);
  if (len <= 0.0001) {
    return { x: originX, y: originY };
  }

  return {
    x: originX + (vx / len) * forwardOffset,
    y: originY + (vy / len) * forwardOffset,
  };
}

/**
 * Transformiert einen lokalen Punkt eines getragenen Items in den World Space.
 *
 * Die Texturkoordinaten bleiben pixelrasterbezogen (x rechts, y nach unten), der Grip liegt auf
 * dem Pfotenanker und die Sprite-Rotation ist dieselbe Rotation, die HeldItemVisual verwendet.
 * Der Helfer ist bewusst frei von Loadout-IDs: Die Geometrie kommt vollständig aus der Spec.
 */
export function transformHeldItemPoint(
  originX: number,
  originY: number,
  spriteRotation: number,
  textureScale: number,
  gripX: number,
  gripY: number,
  pointX: number,
  pointY: number,
): MuzzleOrigin {
  const cos = Math.cos(spriteRotation);
  const sin = Math.sin(spriteRotation);
  const localX = HELD_ITEM_ANCHOR_X + pointX - gripX;
  const localY = HELD_ITEM_ANCHOR_Y + pointY - gripY;
  const dx = localX * textureScale;
  const dy = localY * textureScale;
  return {
    x: originX + dx * cos - dy * sin,
    y: originY + dx * sin + dy * cos,
  };
}

/**
 * Weltposition des Pfotenankers einer Figur, auf dem das getragene Item sitzt.
 *
 * `spriteRotation` ist die Rotation des Figuren-Sprites, also der Aimwinkel **inklusive** des
 * Nordausrichtungs-Offsets `+PI/2`. Anders als bei der Muendung ist der Anker ein Punkt der
 * Textur und nicht ein Vorwaertsversatz entlang der Schussrichtung; er wird deshalb bewusst mit
 * derselben Rotation gedreht, mit der die Textur gezeichnet wird.
 */
export function getHeldItemAnchor(
  originX: number,
  originY: number,
  spriteRotation: number,
  textureScale: number,
): MuzzleOrigin {
  return transformHeldItemPoint(
    originX,
    originY,
    spriteRotation,
    textureScale,
    0,
    0,
    0,
    0,
  );
}

export function isPointInsideArena(x: number, y: number): boolean {
  return x >= ARENA_OFFSET_X && x <= ARENA_MAX_X && y >= ARENA_OFFSET_Y && y <= ARENA_MAX_Y;
}

export function clampPointToArena(x: number, y: number): MuzzleOrigin {
  return {
    x: Math.min(ARENA_MAX_X, Math.max(ARENA_OFFSET_X, x)),
    y: Math.min(ARENA_MAX_Y, Math.max(ARENA_OFFSET_Y, y)),
  };
}

export function clipPointToArenaRay(startX: number, startY: number, endX: number, endY: number): { x: number; y: number; inside: boolean } {
  const inside = isPointInsideArena(endX, endY);
  if (inside) return { x: endX, y: endY, inside: true };

  const dx = endX - startX;
  const dy = endY - startY;
  let t = 1;

  if (dx > 0) t = Math.min(t, (ARENA_MAX_X - startX) / dx);
  else if (dx < 0) t = Math.min(t, (ARENA_OFFSET_X - startX) / dx);

  if (dy > 0) t = Math.min(t, (ARENA_MAX_Y - startY) / dy);
  else if (dy < 0) t = Math.min(t, (ARENA_OFFSET_Y - startY) / dy);

  return {
    x: startX + t * dx,
    y: startY + t * dy,
    inside: false,
  };
}

// ---- Schockwelle ----
export const SHOCKWAVE_RADIUS          = 100;   // px
export const SHOCKWAVE_DAMAGE          = 20;
export const SHOCKWAVE_KNOCKBACK       = 2500;   // px/s Impuls

// ---- Spielerfarben (12 auswählbare, einzigartige Farben) ----
export const PLAYER_COLORS: readonly number[] = [
  COLORS.BLUE_3,   COLORS.BLUE_2,
  COLORS.GREEN_3,  COLORS.GREEN_2,
  COLORS.BROWN_3,  COLORS.BROWN_2,
  COLORS.GOLD_3,   COLORS.GOLD_2,
  COLORS.RED_3,    COLORS.RED_2,
  COLORS.PURPLE_3, COLORS.PURPLE_2,
] as const;

export const TEAM_BLUE_COLOR = COLORS.BLUE_3;
export const TEAM_RED_COLOR = COLORS.RED_3;
/** Pseudo-Besitzer für fest an Coop-Basen montierte Geschütztürme. */
export const COOP_DEFENSE_BASE_TURRET_OWNER_ID = '__coop_base_turret__';
export const COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID = '__coop_hostile_base_turret__';
/** Synthetic attacker id for enemy airstrikes in Coop Defense. */
export const COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID = 'coop-zombie-bomber';
export const CAPTURE_THE_BEER_BASE_TINT_ALPHA = 0.80;
export const CAPTURE_THE_BEER_BLUE_BASE_TINT = TEAM_BLUE_COLOR;
export const CAPTURE_THE_BEER_RED_BASE_TINT = TEAM_RED_COLOR;
// (Coop-Basis-Tint entfällt – Basen werden nun als 47-Blob-Sprites gerendert.)

// ---- Szenen / Match ----
export const MAX_PLAYERS        = 12;
export const ARENA_COUNTDOWN_SEC = 3;
/** Vorlauf fuer die reliable Verteilung des autoritativen Startzeitpunkts. */
export const DEFAULT_ARENA_DURATION_SEC = 120;
export const CAPTURE_THE_BEER_ARENA_DURATION_SEC = 300;
export let ARENA_DURATION_SEC = DEFAULT_ARENA_DURATION_SEC;

// ---- Netzwerk ----
/** Netzwerk-Tick-Rate: Wie oft der Host den Game State an Clients sendet. */
export const NET_TICK_RATE_HZ     = 20;
/** Berechnetes Intervall in ms zwischen Netzwerk-Ticks. */
export const NET_TICK_INTERVAL_MS = 1000 / NET_TICK_RATE_HZ;  // 50 ms
/** Zeitbasierte Glättung für Client-Interpolation (ms). ~1.5× Tick-Intervall. */
export const NET_SMOOTH_TIME_MS   = 80;
/** Unveraenderte Enemies werden rollierend ueber diesen Zyklus einmal voll aufgefrischt, statt alle auf einmal. */
export const ENEMY_NET_REFRESH_CYCLE_TICKS = NET_TICK_RATE_HZ * 2;
/**
 * Intervall, in dem der Host die vollständige Liste aktiver Gegner-IDs zur Reconciliation mitschickt.
 * Räumt clientseitige "Phantom"-Gegner ab (Host hat sie entfernt, Client hat die Removal verpasst) –
 * als günstiger Backstop hinter den Sticky-Removals. Ersetzt den früheren schweren Full-Snapshot
 * (~4 KB Burst alle 10 s) durch eine kompakte ID-Liste (~0.8 KB), die State-Korrektur übernimmt der
 * rollierende Refresh-Zyklus [[ENEMY_NET_REFRESH_CYCLE_TICKS]].
 */
export const ENEMY_NET_ACTIVE_LIST_INTERVAL_TICKS = NET_TICK_RATE_HZ * 2;
/** Positionsänderungen unterhalb dieses Deltas bleiben bis zum nächsten Dirty-Frame lokal. */
export const ENEMY_NET_POSITION_DELTA_PX = 6;
/** Kleine Rotationsänderungen werden erst gesammelt und dann als Delta gesendet. */
export const ENEMY_NET_ROTATION_DELTA_RAD = 0.12;
/**
 * Anzahl aufeinanderfolgender Delta-Snapshots, in denen eine Gegner-Removal wiederholt
 * gesendet wird. Da der GameState unreliable (last-write-wins) übertragen wird, würde eine
 * einmalig gesendete Removal bei Paketverlust verloren gehen – der tote Gegner bliebe beim
 * Client bis zum nächsten Full-Snapshot (10 s) sichtbar. Gegner-IDs werden nie wiederverwendet,
 * daher ist das wiederholte Senden idempotent.
 */
export const ENEMY_NET_REMOVAL_RESEND_TICKS = 10;
/** Boden-Power-Ups senden meist nur Spawn-/Pickup-Deltas; Full-Resync korrigiert verlorene Frames. */
export const POWERUP_NET_FULL_SNAPSHOT_INTERVAL_TICKS = NET_TICK_RATE_HZ;
/** Statische Rocks senden normalerweise nur HP-Änderungen und Zerstörungen; Full-Resync korrigiert verlorene Frames. */
export const ROCK_NET_FULL_SNAPSHOT_INTERVAL_TICKS = NET_TICK_RATE_HZ;
/** Debug-only: Host loggt aggregierte Enemy-Sync-Payload-Metriken ins Dev-Console. */
export const NET_DEBUG_ENEMY_SYNC_METRICS = (
  import.meta as ImportMeta & { env?: { DEV?: boolean } }
).env?.DEV === true;
/** Aggregationsfenster für Enemy-Sync-Debug-Metriken. */
export const NET_DEBUG_ENEMY_SYNC_METRICS_WINDOW_MS = 2000;
/** Debug-only: Lokale Laufzeitmetriken fuer Host-/Client-Frames, unabhaengig vom Netzwerkpayload. */
export const DEBUG_RUNTIME_PERF_METRICS = false;
/** Aggregationsfenster fuer lokale Laufzeitmetriken. */
export const DEBUG_RUNTIME_PERF_METRICS_WINDOW_MS = 2000;

// ---- Raumqualitaet / Lobby ----
export const ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS = 60;
export const ROOM_QUALITY_REQUIRED_SAMPLES = 3;
export const ROOM_QUALITY_SAMPLE_INTERVAL_MS = 500;
export const ROOM_QUALITY_START_POLICY: RoomQualityStartPolicy = 'warn';

// ---- WebRTC-Transport (PeerJS-Signaling, eigene Datenebene) ----
/**
 * Signaling-Broker. Nur fuer den Verbindungsaufbau zustaendig – ueber ihn laufen NIEMALS
 * Spieldaten. Default ist die kostenlose PeerJS-Cloud; fuer einen eigenen PeerServer nur
 * diese Konstanten aendern, kein Code.
 */
export const PEER_BROKER = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  key: 'peerjs',
  secure: true,
} as const;

/**
 * ICE-Server: ausschliesslich STUN. Bewusst KEIN TURN.
 *
 * Wichtig: PeerJS' eigener Default (`util.defaultConfig`) enthaelt TURN-Server
 * (turn:eu-0.turn.peerjs.com / turn:us-0.turn.peerjs.com). Ohne dieses explizite Override
 * waere die Anforderung "keine Relay-Verbindungen" still verletzt. Diese Liste muss daher
 * immer vollstaendig an `new Peer({ config })` uebergeben werden.
 */
export const PEER_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: ['stun:stun.cloudflare.com:3478'] },
];

/** Laenge des menschenlesbaren Raumcodes (Crockford-Base32 ohne I/L/O/U). */
export const PEER_ROOM_CODE_LENGTH = 6;
/** Praefix der Broker-Peer-ID. Trennt uns von anderen Nutzern der geteilten PeerJS-Cloud. */
export const PEER_ID_PREFIX = 'fragdachse-';
/** Maximale Versuche, einen freien Raumcode auf dem Broker zu belegen. */
export const PEER_ROOM_CODE_MAX_ATTEMPTS = 5;
/** Zeit bis zum Broker (Peer 'open'), danach Abbruch mit Fehlermeldung. */
export const PEER_BROKER_TIMEOUT_MS = 10_000;
/** Zeit bis die direkte Verbindung zum Host steht, danach Abbruch. */
export const PEER_CONNECT_TIMEOUT_MS = 15_000;
/** Zeit zwischen offenem Link und abgeschlossenem hello/welcome-Handshake. */
export const PEER_HANDSHAKE_TIMEOUT_MS = 5_000;
/** Kurzes Fenster, in dem ein getrennter Client seinen vorhandenen Spielerslot fortsetzt. */
export const PEER_RESUME_GRACE_MS = 10_000;
/** Obergrenze des Backoffs zwischen Resume-Versuchen. */
export const PEER_RECONNECT_MAX_DELAY_MS = 2_000;
/** Abstand zwischen zwei kleinen Liveness-Proben auf dem zuverlässigen Link. */
export const PEER_HEARTBEAT_INTERVAL_MS = 2_000;
/** Nach dieser Zeit ohne Heartbeat-Antwort gilt ein ansonsten stille Link als abgebrochen. */
export const PEER_HEARTBEAT_TIMEOUT_MS = 7_000;
/** Kurze Toleranz für den nativen Zustand `disconnected`, bevor der Link geschlossen wird. */
export const PEER_DISCONNECTED_GRACE_MS = 3_000;
/** Kurze Sendepause vor dem Schließen nach einem bewussten Client-Leave, damit `leave` abfließen kann. */
export const PEER_LEAVE_FLUSH_DELAY_MS = 100;
/**
 * Feste SCTP-Stream-ID des unzuverlaessigen Kanals. Der Kanal wird mit `negotiated: true`
 * erzeugt: beide Seiten legen ihn lokal an, es feuert kein 'datachannel'-Event. Das ist
 * zwingend, weil PeerJS' eigener ondatachannel-Handler jeden eingehenden Kanal als seinen
 * eigenen behandeln wuerde und damit die zuverlaessige DataConnection kapern wuerde.
 */
export const PEER_FAST_CHANNEL_ID = 100;
export const PEER_FAST_CHANNEL_LABEL = 'fdx-fast';
/**
 * Frist, in der der unzuverlaessige Kanal nach dem zuverlaessigen aufgehen muss. Da die
 * SCTP-Verbindung zu diesem Zeitpunkt bereits steht, geschieht das normalerweise sofort.
 * Laeuft die Frist ab, gilt der Link als gescheitert – lieber ein klarer Abbruch als eine
 * still degradierte Verbindung, die alles ueber den geordneten Kanal schiebt.
 */
export const PEER_FAST_CHANNEL_TIMEOUT_MS = 3_000;
/** Ab dieser Fuellung des Sendepuffers werden unzuverlaessige Nachrichten verworfen statt gestaut. */
export const PEER_FAST_BUFFER_LIMIT_BYTES = 256 * 1024;
/** Abstand zwischen zwei getStats()-Abfragen pro Verbindung. */
export const PEER_DIAGNOSTICS_POLL_MS = 1_000;
/** Groesse des gleitenden Fensters fuer Median, Maximum und Jitter. */
export const PEER_DIAGNOSTICS_SAMPLE_WINDOW = 60;
/**
 * Schwelle, ab der ein wachsender Sendepuffer als Rueckstau gemeldet wird. Rein diagnostisch:
 * ein echter Grenzwert wird erst festgelegt, wenn reale Messwerte mit den ueblichen
 * Mitspielern vorliegen.
 */
export const PEER_DIAGNOSTICS_BACKPRESSURE_BYTES = 64 * 1024;

// State-Keys und RPC-Namen sind intern in NetworkBridge gekapselt.
