import type { HudTone } from '../../ui/HudFrameAssets';

/**
 * Vertrag des gemeinsamen Marker-Systems (Stilvorgabe `build/dawn/M3-marker-style.md`, Inventar
 * `build/dawn/M3-marker-inventory.md` Abschnitt 4). Reine Praesentation: Adapter lesen vorhandene, bereits
 * replizierte Zustaende und liefern Deskriptoren; das Layoutmodell entscheidet Sichtbarkeit, Platz,
 * Prioritaet und Buendelung; der GPU-Renderer zeichnet. Keine neuen Netzwerkfelder.
 */

/** Glyphen des Icon-Satzes 01 (Atlas 16/24/32 px aus der Leit-Session; bis dahin Platzhalter). */
export const MARKER_GLYPH_IDS = [
  'base', 'boss',
  'site-wreck', 'site-extractor', 'site-brood-nest', 'site-supply', 'site-scrap-heaps', 'scavenger',
  'mission-destroy', 'mission-hold', 'mission-carry',
  'crate', 'flag', 'hazard', 'timebomb', 'tool',
  'check', 'cross',
] as const;
export type MarkerGlyphId = typeof MARKER_GLYPH_IDS[number];

export type MarkerKind =
  | 'main-objective' | 'return' | 'boss' | 'site' | 'mission' | 'carry' | 'delivery'
  | 'checkpoint' | 'hazard' | 'utility';

export type MarkerState = 'dormant' | 'active' | 'completed' | 'failed';

/** Prioritaetsklassen, hoechste zuerst (Stilvorgabe „Informationsdichte und Prioritaet“). */
export const MARKER_PRIORITY: Readonly<Record<MarkerKind, number>> = {
  'main-objective': 6, return: 6, boss: 5, hazard: 4,
  site: 3, mission: 3, carry: 3, delivery: 3, checkpoint: 3,
  utility: 1,
};

export interface MarkerStyle {
  readonly shape: 'round' | 'triangle';
  readonly tone: HudTone;
  /** Badge-Aussendurchmesser in Designpixeln bei Zoom 1 (Bildschirmgroesse auf 22–40 px geklemmt). */
  readonly diameter: number;
}

/**
 * Globaler Groessenfaktor (Leit-Abnahme 2026-10-14): Weltbadges, Randpfeile, Zeiger, Abstaende und
 * Entfernungstext wachsen gemeinsam; die Stilvorgabe nennt die Basiswerte (30/34/36, Clamp 22–40).
 */
export const MARKER_SCALE = 1.3;
const scaled = (designPx: number): number => Math.round(designPx * MARKER_SCALE);

/** Eine Quelle fuer Form, Ton und Groesse je Typ (Tabelle „Typen“ der Stilvorgabe). */
export const MARKER_STYLES: Readonly<Record<MarkerKind, MarkerStyle>> = {
  'main-objective': { shape: 'round', tone: 'gold', diameter: scaled(36) },
  return: { shape: 'round', tone: 'gold', diameter: scaled(36) },
  boss: { shape: 'round', tone: 'purple', diameter: scaled(34) },
  site: { shape: 'round', tone: 'blue', diameter: scaled(30) },
  mission: { shape: 'round', tone: 'blue', diameter: scaled(30) },
  carry: { shape: 'round', tone: 'blue', diameter: scaled(30) },
  delivery: { shape: 'round', tone: 'green', diameter: scaled(30) },
  checkpoint: { shape: 'round', tone: 'gold', diameter: scaled(30) },
  hazard: { shape: 'triangle', tone: 'red', diameter: scaled(32) },
  utility: { shape: 'round', tone: 'orange', diameter: scaled(24) },
};

export const MARKER_LIMITS = {
  worldBadges: 8,
  edgeArrows: 6,
  /** Gleichartige Randziele innerhalb dieses Winkels werden zu einem Badge „n×“ gebuendelt. */
  edgeBundleDegrees: 18,
  edgeInsetPx: scaled(24),
  edgeMinSpacingPx: scaled(8),
  edgeBadgeDiameter: scaled(28),
  screenDiameterMin: scaled(22),
  screenDiameterMax: scaled(40),
  /** Abstand Badge-Unterkante zur Ziel-Oberkante (Spielgeometrie), Designpixel. */
  anchorGapPx: scaled(10),
  /** Zeigerlaenge Randpfeil / Weltbadge und Entfernungstext, Designpixel. */
  edgePointerPx: scaled(8),
  worldPointerPx: scaled(6),
  labelFontPx: scaled(11),
  /** Groesste Glyphe (Atlas waehlt 16/24/32 px). */
  glyphMaxPx: scaled(16),
  fadeAfterResolvedMs: 2500,
  pulsePeriodMs: 1600,
  urgentPulsePeriodMs: 800,
  popMs: 300,
} as const;

/** Bodenring aus Spielgeometrie (Zonen-/Aktivierungsradius, Baugrenze), nie aus Sprite-Groessen. */
export interface MarkerGroundRing {
  readonly radiusPx: number;
  /** Ueberschreibt den Typton, z. B. Lieferzone gruen. */
  readonly tone?: HudTone;
}

/**
 * Ein semantischer Marker. Er kann mehrere Renderrollen erzeugen (Weltbadge, Bodenring, Randpfeil).
 * `key` ist ueber Frames stabil; Wechsel von Zustand oder Typ behalten den Schluessel (z. B. Site wird aktiv).
 */
export interface MarkerDescriptor {
  readonly key: string;
  readonly kind: MarkerKind;
  readonly state: MarkerState;
  readonly glyph: MarkerGlyphId;
  /** Zielpunkt in Weltkoordinaten (Mittelpunkt). */
  readonly x: number;
  readonly y: number;
  /** Halbe Zielhoehe in Weltpixeln: der Badge sitzt `anchorGapPx` ueber der Ziel-Oberkante. */
  readonly targetHalfHeight: number;
  readonly visibility: 'world-and-edge' | 'world-only' | 'edge-only' | 'edge-when-offscreen';
  /** Fortschrittsbogen 0..1 (Halten/Zerstoeren); fehlt = kein Bogen. */
  readonly progress?: number;
  /** Friendly core under attack: local observations of replicated HP, never a wire timestamp. */
  readonly baseAttack?: { readonly lastHitAtMs: number; readonly pulseAtMs: number };
  /** Focus wins within the same semantic priority class. */
  readonly focused?: boolean;
  /** Tier-Punkte 1–3 unter dem Badge (Sites). */
  readonly tier?: 1 | 2 | 3;
  readonly groundRing?: MarkerGroundRing;
  /** Nur gleiche `bundleKey` duerfen am Rand gebuendelt werden; fehlt = nie buendeln. */
  readonly bundleKey?: string;
  /** Boss-Verwundbarkeit: weisser pulsierender Innenrand statt Tonfarbe. */
  readonly vulnerable?: boolean;
  /** Dringlichkeit (Rueckkehr, Gefahr): schnellerer Puls am Randpfeil. */
  readonly urgent?: boolean;
  /** Zeitanker des letzten Zustandswechsels (ms, lokale Szenenzeit); fehlt = Zustand direkt setzen (Late Join). */
  readonly stateChangedAtMs?: number;
}

/** Ein Adapter liefert pro Frame die Deskriptoren seiner Quelle (World, Activity oder Round). */
export interface MarkerSource {
  readonly id: string;
  collect(out: MarkerDescriptor[]): void;
}

/** Ergebnis des Layoutmodells fuer einen Badge; Grenze zwischen Layout und GPU-Renderer. */
export interface MarkerBadgeInstance {
  readonly key: string;
  /** `world`: x/y in Weltkoordinaten (Badge-Mittelpunkt); `screen`: x/y in Designpixeln (Randpfeil). */
  readonly space: 'world' | 'screen';
  readonly x: number;
  readonly y: number;
  /** Endgueltiger Durchmesser in der jeweiligen Einheit (geklemmt auf die Bildschirmgrenzen). */
  readonly diameter: number;
  readonly shape: MarkerStyle['shape'];
  readonly tone: HudTone;
  readonly glyph: MarkerGlyphId;
  readonly state: MarkerState;
  readonly alpha: number;
  /** Animationsskala (Pop 0,8→1,1→1,0), 1 im Ruhezustand. */
  readonly scale: number;
  readonly progress?: number;
  /** Sampled inner-rim glow, shared by world badge and edge compass. */
  readonly baseAttackGlow?: number;
  readonly tier?: 1 | 2 | 3;
  readonly vulnerable: boolean;
  readonly pulse: 'none' | 'calm' | 'urgent';
  /** Weltbadge: Zeiger nach unten; Randpfeil: Richtung zum Ziel in Radiant (0 = rechts, im Uhrzeigersinn). */
  readonly pointerAngle: number;
  /** Gebuendelte Randziele („3×“); fehlt = einzeln. */
  readonly count?: number;
  /** Entfernung vom lokalen Spieler, nur Randpfeile, bereits lokalisiert („42 m“). */
  readonly distanceLabel?: string;
}

export interface MarkerGroundRingInstance {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  readonly tone: HudTone;
  readonly alpha: number;
}

export interface MarkerFrame {
  readonly worldBadges: readonly MarkerBadgeInstance[];
  readonly edgeBadges: readonly MarkerBadgeInstance[];
  readonly groundRings: readonly MarkerGroundRingInstance[];
}

/** GPU-Darstellung: ein SDF-Batch je Kamerarolle (Weltbadges/Randpfeile emissiv, Bodenringe unter Figuren). */
export interface MarkerRenderer {
  sync(frame: MarkerFrame, nowMs: number, lowQuality: boolean): void;
  destroy(): void;
}
