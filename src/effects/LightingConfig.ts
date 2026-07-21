import * as Phaser from 'phaser';

export type LightProfileId = 'day' | 'night';

export type LightShape = 'radial' | 'cone';

/**
 * Ein Beleuchtungsprofil. Tag und Nacht laufen über denselben Codepfad; sie
 * unterscheiden sich nur darin, was in die Lightmap eingefärbt wird und wie das
 * Overlay komponiert wird:
 *
 * - `day`: Ambient schwarz, Overlay ADD → nur der *zusätzliche* Lichtanteil wird
 *   addiert. Hinter einem Felsen fehlt die Addition, dort bleibt normales Tageslicht.
 * - `night`: Ambient sehr dunkel, Overlay MULTIPLY → unbeleuchtet fast schwarz,
 *   beleuchtet nahe der Originalfarbe. Hinter einem Felsen bleibt das Ambient stehen.
 */
export interface LightProfile {
  readonly ambientColor: number;
  readonly compositeBlendMode: number;
  /** Skaliert alle Lichtintensitäten des Profils (Feinabstimmung Tag/Nacht). */
  readonly lightIntensityMult: number;
  /** Taschenlampen gibt es nur dort, wo sie gebraucht werden. */
  readonly flashlightEnabled: boolean;
}

export const LIGHTING_PROFILES: Readonly<Record<LightProfileId, LightProfile>> = {
  day: {
    ambientColor: 0x000000,
    compositeBlendMode: Phaser.BlendModes.ADD,
    lightIntensityMult: 1,
    flashlightEnabled: false,
  },
  night: {
    // ~11 % Helligkeit mit kaltem Blaustich: ohne Lichtquelle sieht man praktisch nichts,
    // Silhouetten bleiben nur erahnbar.
    ambientColor: 0x161a24,
    compositeBlendMode: Phaser.BlendModes.MULTIPLY,
    lightIntensityMult: 1,
    flashlightEnabled: true,
  },
};

export const DEFAULT_LIGHT_PROFILE_ID: LightProfileId = 'day';

/** Halbe Auflösung: Licht ist niederfrequent, das kostet ein Viertel Füllrate. */
export const LIGHTMAP_SCALE = 0.5;

/** Kantenlänge der Scratch-Textur für verdeckende Lichter (Lightmap-Pixel). */
export const OCCLUDER_SCRATCH_SIZE = 512;

/** Maximaler Weltradius, den ein verdeckendes Licht haben darf (Scratch-Grenze). */
export const MAX_OCCLUDING_LIGHT_RADIUS = (OCCLUDER_SCRATCH_SIZE / LIGHTMAP_SCALE) * 0.5;

export const MAX_LIGHTS_PER_FRAME = 48;
export const MAX_OCCLUDING_LIGHTS_PER_FRAME = 4;

/** Schattenpolygone werden über den Lichtradius hinaus verlängert und dann geclippt. */
export const SHADOW_EXTEND_FACTOR = 2.2;

export interface LightPresetOverride {
  readonly intensityMult?: number;
  readonly radiusMult?: number;
}

export interface LightPreset {
  readonly enabled: boolean;
  readonly shape: LightShape;
  readonly radiusPx: number;
  readonly color: number;
  readonly intensity: number;
  /** 0 = Dauerlicht (Lebenszeit wird von außen verwaltet), sonst Abklingdauer in ms. */
  readonly durationMs: number;
  /** Exponent der Abklingkurve: 1 = linear, >1 = schneller Einbruch am Anfang. */
  readonly decayExponent: number;
  readonly occludes: boolean;
  /** Höhere Priorität gewinnt Budgetplätze (Gesamt- und Verdeckungsbudget). */
  readonly priority: number;
  /** Amplitude des deterministischen Flackerns (0 = ruhig). */
  readonly flickerAmount: number;
  readonly flickerHz: number;
  /** Voller Öffnungswinkel des Kegels in Radiant; nur für `shape: 'cone'`. */
  readonly coneAngle?: number;
  readonly day?: LightPresetOverride;
  readonly night?: LightPresetOverride;
}

/**
 * Presets pro Lichtquelle. Verdeckung ist bewusst die Ausnahme: sie kostet einen
 * eigenen Renderpass und lohnt nur bei großen, seltenen oder dauerhaften Lichtern.
 */
export const LIGHT_PRESETS = {
  muzzleFlash: {
    enabled: true,
    shape: 'radial',
    radiusPx: 110,
    color: 0xffe0a8,
    intensity: 0.55,
    durationMs: 70,
    decayExponent: 2,
    occludes: false,
    priority: 2,
    flickerAmount: 0,
    flickerHz: 0,
  },
  explosion: {
    enabled: true,
    shape: 'radial',
    radiusPx: 240,
    color: 0xffb066,
    intensity: 1.15,
    durationMs: 320,
    decayExponent: 2.2,
    occludes: true,
    priority: 10,
    flickerAmount: 0,
    flickerHz: 0,
  },
  flashlight: {
    enabled: true,
    shape: 'cone',
    radiusPx: 420,
    color: 0xfff3d0,
    intensity: 1,
    durationMs: 0,
    decayExponent: 1,
    occludes: true,
    priority: 8,
    flickerAmount: 0,
    flickerHz: 0,
    // ~43° Öffnung. Deutlich weiter aufgezogen liest sich der weiche Außenrand am Ende
    // des Strahls nicht mehr als Kegel, sondern als flächiger Schein über die halbe
    // Bildhöhe – bei 75° deckt der Rand allein schon ±326 px ab.
    coneAngle: Math.PI * 0.24,
  },
  /**
   * Kleines Streulicht um den Lampenträger. Der Kegel beginnt zwangsläufig hart an der
   * Spielerlinie (die Textur hat keine Rückseite); dieses omnidirektionale Nahfeld nimmt
   * dem Übergang die Kante und lässt den Spieler nicht im Nichts stehen. Bewusst ohne
   * Verdeckung: bei diesem Radius wäre ein eigener Renderpass reine Verschwendung.
   */
  flashlightSpill: {
    enabled: true,
    shape: 'radial',
    radiusPx: 95,
    color: 0xfff3d0,
    intensity: 0.34,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 7,
    flickerAmount: 0,
    flickerHz: 0,
  },
  // ── Feuer ────────────────────────────────────────────────────────────────────
  // Alle Feuerlichter sind klein, zahlreich und bodennah – Verdeckung wäre teuer und
  // optisch kaum wahrnehmbar. Am Tag deutlich gedämpft, damit Feuer den Boden wärmt
  // statt ihn zu überstrahlen.
  groundFire: {
    enabled: true,
    shape: 'radial',
    radiusPx: 150,
    color: 0xff8b2e,
    intensity: 0.85,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 5,
    flickerAmount: 0.22,
    flickerHz: 7.5,
    day: { intensityMult: 0.35 },
  },
  flameRing: {
    enabled: true,
    shape: 'radial',
    radiusPx: 220,
    color: 0xff7b21,
    intensity: 0.95,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 6,
    flickerAmount: 0.16,
    flickerHz: 6,
    day: { intensityMult: 0.4 },
  },
  fireChunk: {
    enabled: true,
    shape: 'radial',
    radiusPx: 90,
    color: 0xffa63d,
    intensity: 0.6,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 3,
    flickerAmount: 0.25,
    flickerHz: 9,
    day: { intensityMult: 0.35 },
  },
  fireChunkImpact: {
    enabled: true,
    shape: 'radial',
    radiusPx: 130,
    color: 0xffc06a,
    intensity: 0.7,
    durationMs: 220,
    decayExponent: 2,
    occludes: false,
    priority: 3,
    flickerAmount: 0,
    flickerHz: 0,
    day: { intensityMult: 0.4 },
  },
  projectileBurn: {
    enabled: true,
    shape: 'radial',
    radiusPx: 85,
    color: 0xff5f1e,
    intensity: 0.55,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 3,
    flickerAmount: 0.2,
    flickerHz: 10,
    day: { intensityMult: 0.35 },
  },
  flameProjectile: {
    enabled: true,
    shape: 'radial',
    radiusPx: 130,
    color: 0xffab4a,
    intensity: 0.8,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 4,
    flickerAmount: 0.24,
    flickerHz: 11,
    day: { intensityMult: 0.35 },
  },
} as const satisfies Record<string, LightPreset>;

export type LightPresetKey = keyof typeof LIGHT_PRESETS;

/** Unterhalb dieses Radius bekommt eine Explosion Licht, aber keine Verdeckung. */
export const EXPLOSION_LIGHT_MIN_OCCLUDING_RADIUS = 90;
/** Explosionslicht reicht weiter als der Schadensradius. */
export const EXPLOSION_LIGHT_RADIUS_FACTOR = 1.6;

/** Gröbere Cluster-Ebene über der 32-px-Blockkarte des brennenden Bodens. */
export const GROUND_FIRE_LIGHT_BUCKET_SIZE = 96;
export const MAX_GROUND_FIRE_LIGHTS = 12;
/**
 * Flammenwerfer: ein Strahl besteht aus vielen kurzlebigen Hitboxen. Nur jede n-te
 * Projektil-ID trägt Licht. Da die IDs monoton vergeben werden, ergibt das eine
 * gleichmäßig verteilte, in der Anzahl begrenzte Lichterkette entlang des Strahls –
 * ohne Besitzer-Buchführung und ohne dass die Auswahl von Frame zu Frame springt.
 */
export const FLAME_LIGHT_ID_STRIDE = 4;

export function resolvePresetOverride(
  preset: LightPreset,
  profileId: LightProfileId,
): LightPresetOverride | undefined {
  return profileId === 'night' ? preset.night : preset.day;
}
