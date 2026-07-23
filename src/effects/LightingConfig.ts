import * as Phaser from 'phaser';
import type { EnergyBallVariant, GrenadeVisualPreset, ProjectileStyle } from '../types';

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
  /**
   * Künstliche Lichter, die man nur nachts einschaltet: Taschenlampen der Spieler und
   * der Scheinwerfer des Zugs. Am Tag existieren sie gar nicht.
   */
  readonly nightLightsEnabled: boolean;
  /**
   * Baumkronen liegen über dem Lightmap-Overlay und werden einzeln eingefärbt. Dieser
   * Faktor dämpft, wie stark Lichtquellen sie erreichen – eine einfache Näherung dafür,
   * dass die Krone deutlich höher liegt als die bodennahen Lichtquellen. 0 = die Krone
   * bleibt immer auf Umgebungsniveau, 1 = so hell wie der Boden.
   */
  readonly canopyLightFactor: number;
}

export const LIGHTING_PROFILES: Readonly<Record<LightProfileId, LightProfile>> = {
  day: {
    ambientColor: 0x000000,
    compositeBlendMode: Phaser.BlendModes.ADD,
    lightIntensityMult: 1,
    nightLightsEnabled: false,
    // Am Tag additiv komponiert: eine Krone kann über einen Tint nicht heller als ihre
    // eigene Textur werden, deshalb bleibt sie hier unverändert.
    canopyLightFactor: 0,
  },
  night: {
    // ~11 % Helligkeit mit kaltem Blaustich: ohne Lichtquelle sieht man praktisch nichts,
    // Silhouetten bleiben nur erahnbar.
    ambientColor: 0x161a24,
    compositeBlendMode: Phaser.BlendModes.MULTIPLY,
    lightIntensityMult: 1,
    nightLightsEnabled: true,
    canopyLightFactor: 0.45,
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
/**
 * Jeder Slot kostet eine eigene Scratch-Textur und einen Renderpass. Sechs reichen für
 * vier Spielertaschenlampen plus die beiden Zugscheinwerfer; darüber hinaus fallen
 * Lichter weich auf den verdeckungsfreien Pfad zurück.
 */
export const MAX_OCCLUDING_LIGHTS_PER_FRAME = 6;

/** Schattenpolygone werden über den Lichtradius hinaus verlängert und dann geclippt. */
export const SHADOW_EXTEND_FACTOR = 2.2;

/**
 * Länge des weichen Helligkeitsabfalls auf der Oberseite eines Hindernisses.
 *
 * Der Abfall beginnt exakt an der beleuchteten Außenkante des Blocks – die äußersten
 * Pixel bleiben voll hell, danach läuft die Helligkeit über diese Strecke stufenlos in
 * den Schatten. Der Verlauf entsteht aus Gouraud-Dreiecken mit Alpha pro Ecke, also
 * hardware-interpoliert und ohne sichtbare Stufen.
 *
 * Wichtig: der Schatten selbst wird dadurch nicht versetzt. Der Verlauf sitzt zwischen
 * Kante und Vollschatten; die seitlichen Silhouettenstrahlen bleiben unverändert, weil
 * das Zurücksetzen entlang des Lichtstrahls auf demselben Strahl bleibt.
 *
 * Gemessen ab der Außenkante des zusammenhängenden Blocks, nicht ab der Gitterzelle:
 * `LightOccluderIndex` liefert dafür die freiliegenden Kanten mit.
 */
export const OCCLUDER_SHADE_FALLOFF_PX = 14;

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
    radiusPx: 180,
    color: 0xffe0a8,
    intensity: 0.9,
    // Etwas länger und mit flacherem Abklingen als ein reiner Ein-Frame-Blitz, sonst
    // ist der Impuls bei 60 fps kaum als Licht zu erkennen.
    durationMs: 130,
    decayExponent: 1.5,
    occludes: false,
    priority: 2,
    flickerAmount: 0,
    flickerHz: 0,
  },
  /**
   * Explosionen sind das hellste Ereignis der Szene und leuchten deutlich über ihren
   * Wirkradius hinaus. Der flache Abklingexponent ist dabei fast wichtiger als die
   * Intensität: mit einer steilen Kurve ist der Blitz nach zwei, drei Frames weg und
   * liest sich als kurzes Zucken statt als Detonation.
   */
  explosion: {
    enabled: true,
    shape: 'radial',
    radiusPx: 240,
    color: 0xffc49f,
    intensity: 1,
    durationMs: 520,
    decayExponent: 1.35,
    occludes: true,
    priority: 10,
    flickerAmount: 0,
    flickerHz: 0,
    // Am Tag wird additiv komponiert: die volle Intensität brennt das Zentrum auf
    // hellem Boden zu einer weißen Fläche aus. Nachts bleibt sie unangetastet.
    day: { intensityMult: 0.7 },
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
  /**
   * Scheinwerfer an der Front der Lokomotive, strahlt in Fahrtrichtung. Die Lok trägt
   * zwei davon, links und rechts wie beim Vorbild; jeder ist deshalb schmaler als ein
   * einzelner Strahl es wäre. Wie die Taschenlampe nur im Nachtprofil aktiv, und mit
   * Verdeckung, weil der Strahl über die halbe Arena läuft und ohne Felsschatten
   * unglaubwürdig wirkt.
   */
  trainHeadlight: {
    enabled: true,
    shape: 'cone',
    radiusPx: 460,
    color: 0xfff0c8,
    intensity: 0.92,
    durationMs: 0,
    decayExponent: 1,
    occludes: true,
    // Unter der Taschenlampe: die eigenen Strahlen der Spieler sollen die knappen
    // Verdeckungs-Slots zuerst bekommen.
    priority: 7,
    flickerAmount: 0,
    flickerHz: 0,
    coneAngle: Math.PI * 0.15,
  },
  /**
   * Fensterlicht an der Seite eines Waggons: klein, ungerichtet, warm. Bewusst ohne
   * Verdeckung – bei diesem Radius wäre ein eigener Renderpass reine Verschwendung, und
   * es sind viele davon.
   */
  trainWindow: {
    enabled: true,
    shape: 'radial',
    radiusPx: 78,
    color: 0xffd9a0,
    intensity: 0.42,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 4,
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
  /**
   * Brennendes Projektil: kleiner Radius, dafür ein heller Kern.
   *
   * Die Farbe ist bewusst weit weniger gesättigt als die Flammenpartikel selbst. Unter
   * dem MULTIPLY-Composite der Nacht bestimmt der *schwächste* Kanal, wie hell der Boden
   * werden kann – ein sattes Orange wie 0xff5f1e (normalisiert 1.00/0.37/0.12) lässt
   * Grün und Blau unten und liest sich deshalb selbst bei voller Intensität nur als
   * rötlicher Schleier, nicht als Licht. Die heiße Kernfarbe hebt alle drei Kanäle an.
   */
  projectileBurn: {
    enabled: true,
    shape: 'radial',
    radiusPx: 112,
    color: 0xffb060,
    intensity: 1,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    // Über den dekorativen Zugfenstern: ein brennendes Projektil zeigt an, wo etwas
    // Gefährliches unterwegs ist, und darf nicht als Erstes aus dem Budget fallen.
    priority: 6,
    // Nur noch leichtes Flackern: bei Intensität 1 wird der Ausschlag nach oben ohnehin
    // abgeschnitten, ein starkes Flackern würde das Licht im Mittel nur dunkler machen.
    flickerAmount: 0.12,
    flickerHz: 11,
    day: { intensityMult: 0.45 },
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
  // ── Energie und Projektile ───────────────────────────────────────────────────
  /**
   * Kaltweiß-blauer Kern für Energie-, Plasma-, Gauss- und Hydra-Geschosse.
   *
   * Die Farbe ist deutlich heller als die Partikel des jeweiligen Renderers. Der Grund
   * ist derselbe wie bei `projectileBurn`: unter dem MULTIPLY-Composite der Nacht deckelt
   * der schwächste Kanal die erreichbare Bodenhelligkeit. Wo ein Aufrufer die Waffenfarbe
   * durchreichen will, mischt `getProjectileLightSpec().whitenFromColor` sie erst Richtung
   * Weiß, statt sie roh zu übernehmen.
   */
  energyProjectile: {
    enabled: true,
    shape: 'radial',
    radiusPx: 128,
    color: 0xd8f0ff,
    intensity: 0.95,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 6,
    flickerAmount: 0,
    flickerHz: 0,
    day: { intensityMult: 0.4 },
  },
  /**
   * Die BFG-Kugel ist das einzige neue Preset mit Verdeckung: sie ist selten, fliegt
   * langsam und leuchtet über einen so großen Radius, dass ein fehlender Felsschatten
   * sofort auffällt. Die Priorität liegt unter Taschenlampe und Explosion, damit sie
   * deren knappe Verdeckungs-Slots nicht wegnimmt.
   */
  bfgOrb: {
    enabled: true,
    shape: 'radial',
    radiusPx: 260,
    color: 0xdcffd0,
    intensity: 1,
    durationMs: 0,
    decayExponent: 1,
    occludes: true,
    priority: 6,
    flickerAmount: 0.06,
    flickerHz: 5,
    day: { intensityMult: 0.45 },
  },
  /** Triebwerksfeuer einer Rakete: klein, warm, hinter dem Geschoss. */
  rocketThruster: {
    enabled: true,
    shape: 'radial',
    radiusPx: 96,
    color: 0xffc98a,
    intensity: 0.8,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 5,
    flickerAmount: 0.18,
    flickerHz: 13,
    day: { intensityMult: 0.35 },
  },
  /** Heilige Granate – der einzige Wurfkörper mit gelbem Eigenleuchten. */
  holyProjectile: {
    enabled: true,
    shape: 'radial',
    radiusPx: 150,
    color: 0xffeaa0,
    intensity: 0.9,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 6,
    flickerAmount: 0.08,
    flickerHz: 4,
    day: { intensityMult: 0.4 },
  },
  /** Sporen glimmen nur schwach; sie sollen die Szene nicht mitbeleuchten. */
  sporeProjectile: {
    enabled: true,
    shape: 'radial',
    radiusPx: 72,
    color: 0xd6ffc4,
    intensity: 0.42,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 3,
    flickerAmount: 0.14,
    flickerHz: 6,
    day: { intensityMult: 0.15 },
  },
  // ── Strahlen und Entladungen ─────────────────────────────────────────────────
  /**
   * Stützpunkt entlang eines Hitscan-Strahls. Sehr kurz, dafür ein heller Kern – ein
   * Schuss ist im Bild vorbei, bevor ein langsameres Abklingen überhaupt lesbar würde.
   */
  beamPulse: {
    enabled: true,
    shape: 'radial',
    radiusPx: 120,
    color: 0xfff0d8,
    intensity: 0.75,
    durationMs: 90,
    decayExponent: 1.6,
    occludes: false,
    priority: 2,
    flickerAmount: 0,
    flickerHz: 0,
  },
  /** Elektrische Entladung: Zeus-Taser, ASMD, Tesla-Treffer. Kalt und hart. */
  electricArc: {
    enabled: true,
    shape: 'radial',
    radiusPx: 165,
    color: 0xcdf1ff,
    intensity: 0.9,
    durationMs: 150,
    decayExponent: 1.8,
    occludes: false,
    priority: 4,
    flickerAmount: 0,
    flickerHz: 0,
  },
  // ── Dauerhafte Felder ────────────────────────────────────────────────────────
  // Felder stehen lange und sind zahlreich; alle ohne Verdeckung. Am Tag sind sie stark
  // gedämpft: dort komponiert das Overlay additiv, ein Dauerfeld würde den Boden
  // permanent aufhellen, ohne dass es als Effekt gelesen wird.
  electricField: {
    enabled: true,
    shape: 'radial',
    radiusPx: 190,
    color: 0xbfe9ff,
    intensity: 0.62,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 4,
    flickerAmount: 0.2,
    flickerHz: 14,
    day: { intensityMult: 0.25 },
  },
  shieldField: {
    enabled: true,
    shape: 'radial',
    radiusPx: 160,
    color: 0xc8e4ff,
    intensity: 0.5,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 3,
    flickerAmount: 0,
    flickerHz: 0,
    day: { intensityMult: 0.15 },
  },
  /** Zeitblase, Heilaura, Schutzgeist – blass, die Farbe kommt vom Aufrufer. */
  arcaneField: {
    enabled: true,
    shape: 'radial',
    radiusPx: 170,
    color: 0xd6d0ff,
    intensity: 0.52,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 3,
    flickerAmount: 0.07,
    flickerHz: 2.5,
    day: { intensityMult: 0.18 },
  },
  /** Schleimspur: nur ein Schimmer. Am Tag bewusst ganz aus. */
  slimeGlow: {
    enabled: true,
    shape: 'radial',
    radiusPx: 110,
    color: 0xc9ffb0,
    intensity: 0.3,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 2,
    flickerAmount: 0.1,
    flickerHz: 3,
    day: { intensityMult: 0 },
  },
  // ── Welt und Entities ────────────────────────────────────────────────────────
  /**
   * PowerUp-Kugeln, Podeste und das Bier. Dekorativ, deshalb die niedrigste Priorität:
   * bei Überlast sollen zuerst diese Lichter fallen, nicht die des Kampfgeschehens.
   * Am Tag ganz aus – ein Pickup am helllichten Tag beleuchtet nichts.
   */
  pickupGlow: {
    enabled: true,
    shape: 'radial',
    radiusPx: 88,
    color: 0xffffff,
    intensity: 0.45,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 1,
    flickerAmount: 0.06,
    flickerHz: 1.6,
    day: { intensityMult: 0 },
  },
  /** Brennende Spieler und Gegner. Etwas weiter als `projectileBurn`, gleiche Kernfarbe. */
  entityBurn: {
    enabled: true,
    shape: 'radial',
    radiusPx: 128,
    color: 0xffb060,
    intensity: 0.9,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 5,
    flickerAmount: 0.14,
    flickerHz: 9,
    day: { intensityMult: 0.4 },
  },
  /**
   * Ruhiges Standlicht einer Basis in ihrer Teamfarbe. Groß und schwach – es soll die
   * Basis nachts erkennbar machen, nicht die Umgebung ausleuchten. Am Tag praktisch aus.
   */
  baseGlow: {
    enabled: true,
    shape: 'radial',
    radiusPx: 150,
    color: 0xffffff,
    intensity: 0.9,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 2,
    flickerAmount: 0.04,
    flickerHz: 0.8,
    day: { intensityMult: 0.12 },
  },
  /**
   * Der Fliegenpilz-Turret glüht mit seiner roten Kappe. Warmes, ruhiges Dauerlicht mit
   * leichtem Pulsieren – ein platziertes Gefahrenobjekt, das nachts sichtbar bleibt.
   */
  fliegenpilz: {
    enabled: true,
    shape: 'radial',
    radiusPx: 150,
    color: 0xffc2b0,
    intensity: 0.95,
    durationMs: 0,
    decayExponent: 1,
    occludes: false,
    priority: 4,
    flickerAmount: 0.04,
    flickerHz: 1.6,
    day: { intensityMult: 0.3 },
  },
  /** Translocator- und Spawn-Blitz: kurz, hell, kalt. */
  teleportFlash: {
    enabled: true,
    shape: 'radial',
    radiusPx: 175,
    color: 0xe4f4ff,
    intensity: 0.85,
    durationMs: 260,
    decayExponent: 1.7,
    occludes: false,
    priority: 4,
    flickerAmount: 0,
    flickerHz: 0,
  },
} as const satisfies Record<string, LightPreset>;

export type LightPresetKey = keyof typeof LIGHT_PRESETS;

/** Unterhalb dieses Radius bekommt eine Explosion Licht, aber keine Verdeckung. */
export const EXPLOSION_LIGHT_MIN_OCCLUDING_RADIUS = 90;
/**
 * Explosionslicht reicht deutlich weiter als der Schadensradius. Der Faktor sorgt auch
 * dafür, dass der Wirkradius selbst noch im helleren Teil der Abstandskurve liegt –
 * bei Faktor 1 säße er genau dort, wo die Kurve schon auf null gelaufen ist.
 */
export const EXPLOSION_LIGHT_RADIUS_FACTOR = 2.4;

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

/**
 * Schleimspur: dasselbe Cluster-Verfahren wie beim brennenden Boden. Eine Spur besteht
 * aus vielen kleinen Zellen; ohne Bucketing würde allein sie das Frame-Budget füllen,
 * obwohl das Ergebnis optisch eine zusammenhängende Fläche ist. Die Buckets sind gröber
 * und deutlich seltener als beim Feuer – der Schimmer ist Beiwerk, kein Leitlicht.
 */
export const SLIME_LIGHT_BUCKET_SIZE = 128;
export const MAX_SLIME_LIGHTS = 6;

export function resolvePresetOverride(
  preset: LightPreset,
  profileId: LightProfileId,
): LightPresetOverride | undefined {
  return profileId === 'night' ? preset.night : preset.day;
}

/**
 * Wie ein Projektil eines bestimmten Stils leuchtet.
 *
 * Der Radius wächst mit der Trefferfläche, damit ein aufgeladener Schuss auch heller
 * wirkt als ein normaler, ohne dass es dafür ein eigenes Preset braucht.
 */
export interface ProjectileLightSpec {
  readonly preset: LightPresetKey;
  readonly baseRadiusPx: number;
  readonly radiusPerSizePx: number;
  /**
   * Fehlt das Feld, gilt die Presetfarbe. Sonst kommt die Lichtfarbe aus der
   * Projektilfarbe, um diesen Anteil Richtung Weiß gemischt – rohe Waffenfarben sind für
   * Licht meist zu gesättigt (siehe Kommentar bei `projectileBurn`).
   */
  readonly whitenFromColor?: number;
}

/**
 * Ein Projektil, wie es die Beleuchtung sieht. Gegenstück zu `ShadowProjectileSample`:
 * `ProjectileManager` liefert die Liste pro Frame für Host und Client aus derselben
 * Methode, der Aufrufer meldet daraus die Lichter an.
 */
export interface ProjectileLightSample {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly color: number;
  readonly style?: ProjectileStyle;
  readonly energyBallVariant?: EnergyBallVariant;
  readonly grenadeVisualPreset?: GrenadeVisualPreset;
}

const ENERGY_PROJECTILE_LIGHT: ProjectileLightSpec = {
  preset: 'energyProjectile',
  baseRadiusPx: 58,
  radiusPerSizePx: 2.6,
  whitenFromColor: 0.62,
};

/**
 * Lichtprofil eines Projektils, oder `null`, wenn es nicht selbst leuchtet.
 *
 * Bewusst nicht abgedeckt:
 * - `bullet`, `awp`, `leaf_blower` – ein Geschoss ohne eigene Emission; das sichtbare
 *   Licht eines Schusses ist das Mündungsfeuer, und das hat sein eigenes Preset.
 * - `flame` – `FlameRenderer` meldet sein Licht selbst an, mit einem Stride über die IDs,
 *   damit ein einzelner Strahl nicht das gesamte Frame-Budget belegt.
 *
 * Granaten leuchten grundsätzlich nicht: das Licht gehört ihrer Explosion. Ausnahmen sind
 * nur die Wurfkörper, die selbst eine Emissionsquelle sind – der brennende Molotow, die
 * Zeitblasen-Granate und die Heilige Granate.
 */
export function getProjectileLightSpec(
  style?: ProjectileStyle,
  energyBallVariant?: EnergyBallVariant,
  grenadeVisualPreset?: GrenadeVisualPreset,
): ProjectileLightSpec | null {
  switch (style) {
    case 'energy_ball':
      // Plasma glüht heißer und enger als der normale Energieball.
      return energyBallVariant === 'plasma'
        ? { preset: 'energyProjectile', baseRadiusPx: 66, radiusPerSizePx: 2.9, whitenFromColor: 0.78 }
        : ENERGY_PROJECTILE_LIGHT;
    case 'gauss':
    case 'hydra':
      return ENERGY_PROJECTILE_LIGHT;
    case 'bfg':
      return { preset: 'bfgOrb', baseRadiusPx: 150, radiusPerSizePx: 3.4 };
    case 'rocket':
      return { preset: 'rocketThruster', baseRadiusPx: 54, radiusPerSizePx: 2.2 };
    case 'fireball':
      return { preset: 'projectileBurn', baseRadiusPx: 60, radiusPerSizePx: 2.6 };
    case 'spore':
      return { preset: 'sporeProjectile', baseRadiusPx: 42, radiusPerSizePx: 1.8 };
    case 'holy_grenade':
      return { preset: 'holyProjectile', baseRadiusPx: 78, radiusPerSizePx: 2.4 };
    case 'translocator_puck':
      return { preset: 'teleportFlash', baseRadiusPx: 52, radiusPerSizePx: 1.6 };
    case 'grenade':
      if (grenadeVisualPreset === 'molotov') {
        // Brennt im Flug bereits sichtbar. `ProjectileBurnRenderer` überspringt Granaten,
        // das Licht muss also von hier kommen.
        return { preset: 'projectileBurn', baseRadiusPx: 52, radiusPerSizePx: 2.2 };
      }
      if (grenadeVisualPreset === 'time_bubble') {
        // Dieselbe Herleitung wie beim Feld, das nach der Detonation daraus entsteht:
        // Besitzerfarbe Richtung Weiß gemischt.
        return { preset: 'energyProjectile', baseRadiusPx: 46, radiusPerSizePx: 2, whitenFromColor: 0.55 };
      }
      return null;
    case 'bullet':
    case 'awp':
    case 'flame':
    case 'leaf_blower':
    case 'ball':
    default:
      return null;
  }
}
