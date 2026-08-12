/**
 * Ausweichende Deckkraft der rechten Missionsspalte.
 *
 * Die Spalte steht in Coop-Maps über dem Spielfeld – die Arena ist dort breiter als der
 * Bildschirm, es gibt also keine freie Randfläche, auf die man sie schieben könnte. Statt die
 * Panels zu verkleinern oder dauerhaft durchscheinend zu machen, weichen sie nur dann zurück,
 * wenn unter ihnen tatsächlich etwas passiert: eine Figur steht dort oder der Zeiger zielt
 * dorthin. Der Rest der Zeit bleiben sie voll lesbar.
 *
 * Bewusst Phaser-frei, damit die Zeitkurve ohne Szene prüfbar bleibt (Vorbild:
 * `coopDefenseSecondaryObjectiveModel`).
 */

/** Bildschirmrechteck der Spalte; Ursprung oben links wie im übrigen HUD-Layout. */
export interface HudOcclusionRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Restdeckkraft im ausgewichenen Zustand. Nicht null: Die Spalte soll durchsichtig werden,
 * aber nicht verschwinden – sonst verliert man mitten im Gefecht den Missionsfortschritt aus
 * dem Blick und sucht ihn danach.
 */
export const HUD_OCCLUSION_MIN_ALPHA = 0.16;

/**
 * Vorlauf um das Rechteck. Die Spalte ist damit bereits durchsichtig, wenn eine Figur sie
 * erreicht, statt erst darunter aufzuklaren.
 */
export const HUD_OCCLUSION_ENTITY_MARGIN_PX = 52;
/** Der Zeiger ist präzise geführt und braucht deshalb kaum Vorlauf. */
export const HUD_OCCLUSION_POINTER_MARGIN_PX = 24;

/** Schnell weg, langsam zurück: Das Ausweichen darf nie zu spät kommen. */
export const HUD_OCCLUSION_FADE_OUT_MS = 110;
export const HUD_OCCLUSION_FADE_IN_MS = 380;
/**
 * Nachlaufzeit, bevor die Spalte zurückkommt. Ohne sie flackert sie, sobald eine Figur an der
 * Kante entlangläuft oder der Zeiger die Grenze mehrfach kreuzt.
 */
export const HUD_OCCLUSION_HOLD_MS = 300;

export interface HudOcclusionFadeOptions {
  readonly minAlpha?: number;
  readonly fadeOutMs?: number;
  readonly fadeInMs?: number;
  readonly holdMs?: number;
}

export interface HudOcclusionFadeState {
  alpha: number;
  /** Zeit seit der letzten Verdeckung; speist die Nachlaufzeit. */
  clearedForMs: number;
}

export function createHudOcclusionFadeState(): HudOcclusionFadeState {
  return { alpha: 1, clearedForMs: HUD_OCCLUSION_HOLD_MS };
}

/** Rundengebundener Reset: Eine neu eingeblendete Spalte startet voll sichtbar. */
export function resetHudOcclusionFade(state: HudOcclusionFadeState): void {
  state.alpha = 1;
  state.clearedForMs = HUD_OCCLUSION_HOLD_MS;
}

export function isPointNearRect(
  x: number,
  y: number,
  rect: HudOcclusionRect,
  margin: number,
): boolean {
  return x >= rect.left - margin
    && x <= rect.right + margin
    && y >= rect.top - margin
    && y <= rect.bottom + margin;
}

/**
 * Führt die Deckkraft einen Frame weiter und liefert den neuen Wert.
 *
 * Exponentielle Annäherung statt Tween: Die Verdeckung wechselt pro Frame, ein Tween je Wechsel
 * würde sich selbst ständig abbrechen und neu starten.
 */
export function advanceHudOcclusionFade(
  state: HudOcclusionFadeState,
  occluded: boolean,
  deltaMs: number,
  options: HudOcclusionFadeOptions = {},
): number {
  const delta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
  const minAlpha = Math.max(0, Math.min(1, options.minAlpha ?? HUD_OCCLUSION_MIN_ALPHA));
  const fadeOutMs = Math.max(1, options.fadeOutMs ?? HUD_OCCLUSION_FADE_OUT_MS);
  const fadeInMs = Math.max(1, options.fadeInMs ?? HUD_OCCLUSION_FADE_IN_MS);
  const holdMs = Math.max(0, options.holdMs ?? HUD_OCCLUSION_HOLD_MS);
  state.clearedForMs = occluded ? 0 : state.clearedForMs + delta;

  const holding = state.clearedForMs < holdMs;
  const target = occluded || holding ? minAlpha : 1;
  const timeConstant = target < state.alpha ? fadeOutMs : fadeInMs;

  state.alpha += (target - state.alpha) * (1 - Math.exp(-delta / timeConstant));
  // Ohne Fangbereich läuft die Annäherung endlos mit unmerklichen Restwerten weiter.
  if (Math.abs(target - state.alpha) < 0.004) state.alpha = target;
  return state.alpha;
}
