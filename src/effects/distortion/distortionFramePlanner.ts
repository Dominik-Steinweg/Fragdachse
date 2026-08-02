/**
 * Auswahl und Begrenzung der Verzerrungsquellen für einen Frame. Ohne Phaser-Import, damit
 * Priorisierung, Kappung und Sichtbarkeitsprüfung deterministisch testbar bleiben.
 *
 * Hier steckt die gesamte Lastkontrolle: mehrere Zeitblasen, ein Schwarzes Loch und eine
 * Nuke-Druckwelle können gleichzeitig leben. Ohne Deckelung wäre das Bild unlesbar und die
 * Zeichenlast unbegrenzt.
 */

import type { DistortionProfileKey } from './distortionProfileBake';

export interface DistortionSourceState {
  readonly id: string;
  readonly profile: DistortionProfileKey;
  readonly worldX: number;
  readonly worldY: number;
  /** Wirkradius in Designpixeln. */
  readonly radiusPx: number;
  /** 0..1. Bei Zeitblasen der synchronisierte `distortion`-Wert. */
  readonly strength: number;
  readonly rotation?: number;
  /** Nuke 100, Schwarzes Loch 80, Zeitblase 50, Druckwelle 20. */
  readonly priority: number;
}

export interface DistortionViewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DistortionDrawCommand {
  readonly profile: DistortionProfileKey;
  /** Position in Pixeln der Verzerrungskarte. */
  readonly mapX: number;
  readonly mapY: number;
  /** Kantenlänge des Stempels in Kartenpixeln. */
  readonly sizePx: number;
  readonly alpha: number;
  readonly rotation: number;
}

export interface DistortionFramePlan {
  /** In Zeichenreihenfolge: schwächste Priorität zuerst, damit die stärkste Quelle Überlappungen gewinnt. */
  readonly commands: readonly DistortionDrawCommand[];
  /** Globaler Faktor für `Filters.Displacement.x/y`. 0 bedeutet: Pass entfällt. */
  readonly amount: number;
  readonly dropped: number;
}

export interface DistortionLimits {
  readonly maxSources: number;
  /** Obergrenze der aufsummierten Stärke aller sichtbaren Quellen. */
  readonly maxTotalStrength: number;
  /** Obergrenze des Displacement-Faktors. */
  readonly maxAmount: number;
}

export const DISTORTION_PRIORITY = {
  shockwave: 20,
  timeBubble: 50,
  blackHole: 80,
  nuke: 100,
} as const;

/**
 * Ein Displacement-Faktor von 1 entspräche der halben Kamerabreite an Versatz. Der Wert hier
 * ist die Obergrenze **nach** Summierung aller Quellen und damit die harte Grenze dafür, wie
 * stark sich die Welt überhaupt verbiegen kann.
 */
export const DEFAULT_DISTORTION_LIMITS: DistortionLimits = {
  maxSources: 6,
  maxTotalStrength: 2.4,
  maxAmount: 0.05,
};

const EMPTY_PLAN: DistortionFramePlan = { commands: [], amount: 0, dropped: 0 };

function isVisible(source: DistortionSourceState, view: DistortionViewRect): boolean {
  // Um den Wirkradius gepolstert: eine Quelle knapp außerhalb des Bildes verzerrt den Rand noch.
  const padding = source.radiusPx;
  return source.worldX + padding >= view.x
    && source.worldX - padding <= view.x + view.width
    && source.worldY + padding >= view.y
    && source.worldY - padding <= view.y + view.height;
}

/**
 * Wählt die Quellen dieses Frames aus und übersetzt sie in Zeichenbefehle.
 *
 * Die Abbildung ist bewusst einfach: der Designraum ist immer 1920×1080 und die Kamera bildet
 * mit `Screen = zoom · (Welt − scroll)` ab. Kartenkoordinaten hängen deshalb **weder** von der
 * Renderauflösung **noch** vom Zoom ab – `(welt − scroll) · mapScale` genügt. Der Kameraversatz
 * des Feedbacks steckt bereits in `view.x`, die Karte wackelt also gratis mit der Welt.
 */
export function planDistortionFrame(
  sources: readonly DistortionSourceState[],
  view: DistortionViewRect,
  mapScale: number,
  limits: DistortionLimits = DEFAULT_DISTORTION_LIMITS,
): DistortionFramePlan {
  if (mapScale <= 0 || limits.maxSources <= 0 || sources.length === 0) return EMPTY_PLAN;

  const visible: DistortionSourceState[] = [];
  let dropped = 0;
  for (const source of sources) {
    if (source.strength <= 0 || source.radiusPx <= 0) continue;
    if (!isVisible(source, view)) {
      dropped += 1;
      continue;
    }
    visible.push(source);
  }
  if (visible.length === 0) return { commands: [], amount: 0, dropped };

  const viewCenterX = view.x + view.width * 0.5;
  const viewCenterY = view.y + view.height * 0.5;

  // Priorität schlägt Nähe; bei gleicher Priorität gewinnt, was näher an der Bildmitte liegt.
  const ranked = [...visible].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const da = Math.hypot(a.worldX - viewCenterX, a.worldY - viewCenterY);
    const db = Math.hypot(b.worldX - viewCenterX, b.worldY - viewCenterY);
    return da - db;
  });

  if (ranked.length > limits.maxSources) {
    dropped += ranked.length - limits.maxSources;
    ranked.length = limits.maxSources;
  }

  // Gesamtstärke deckeln, indem **alle** gleichmäßig heruntergeregelt werden. Einzelne Quellen
  // wegzulassen würde einen sichtbaren Sprung erzeugen; ein gemeinsamer Faktor nicht.
  let totalStrength = 0;
  for (const source of ranked) totalStrength += source.strength;
  const scale = totalStrength > limits.maxTotalStrength ? limits.maxTotalStrength / totalStrength : 1;

  // Schwächste zuerst zeichnen: der letzte Stempel gewinnt die Überlappung.
  ranked.reverse();

  const commands: DistortionDrawCommand[] = ranked.map((source) => ({
    profile: source.profile,
    mapX: (source.worldX - view.x) * mapScale,
    mapY: (source.worldY - view.y) * mapScale,
    sizePx: source.radiusPx * 2 * mapScale,
    alpha: Math.min(1, source.strength * scale),
    rotation: source.rotation ?? 0,
  }));

  // `amount` ist bewusst konstant und **nicht** von der Gesamtstärke abhängig: die Stärke jeder
  // Quelle steckt bereits in ihrem Alpha auf der Karte. Beides zu multiplizieren würde sie
  // quadrieren und schwache Quellen unsichtbar machen. Die Überlastung regelt allein `scale`.
  return { commands, amount: limits.maxAmount, dropped };
}
