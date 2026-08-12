import type { AmbientWeaponFamily } from './AmbientWeaponPool';

export type AmbientTemplateId =
  | 'quiet_transit'
  | 'enemy_patrol'
  | 'chase'
  | 'melee_chase'
  | 'short_duel'
  | 'cover_exchange'
  | 'ambush'
  | 'blocked_shot'
  | 'retreat_fire'
  | 'rock_break'
  | 'crossfire'
  | 'rare_enemy_passage'
  | 'asmd_combo';

/** Wie stark eine Sequenz das Bild an sich zieht. */
export type AmbientIntensity = 'calm' | 'normal' | 'strong';

/**
 * Wie viel Felszerstörung eingeplant ist.
 *
 * Ausdrücklich eine **Planungsregel**, keine Garantie: Zerstört die echte Mechanik mehr,
 * bleibt der Schaden bestehen und der Inspector räumt hinterher auf.
 */
export type AmbientRockHazard = 'none' | 'low' | 'high';

export interface AmbientTemplate {
  id: AmbientTemplateId;
  intensity: AmbientIntensity;
  /** Zahl der Ambient-Dachse. */
  badgers: readonly [number, number];
  /** Zahl der Gegner. */
  enemies: readonly [number, number];
  rockHazard: AmbientRockHazard;
  /** Grundgewicht der Auswahl vor allen Abwertungen. */
  weight: number;
  /** Braucht eine freie Schusslinie zwischen den Seiten. */
  requiresLineOfSight: boolean;
  /** Erzwingt eine Waffenfamilie; sonst entscheidet der gewichtete Pool. */
  weaponFamily?: AmbientWeaponFamily;
  /** Ungefähre Gefechtsdauer in Millisekunden. */
  durationMs: readonly [number, number];
}

/**
 * Semantische Situationen statt fester Cutscenes.
 *
 * Jedes Template beschreibt nur, *was* passieren soll; wo, mit wem und mit welcher Waffe löst
 * der Compiler vor dem Start gegen die tatsächliche Felslandschaft auf.
 */
export const AMBIENT_TEMPLATES: readonly AmbientTemplate[] = [
  { id: 'quiet_transit',      intensity: 'calm',   badgers: [1, 2], enemies: [0, 0], rockHazard: 'none', weight: 1.4, requiresLineOfSight: false, durationMs: [2600, 4200] },
  { id: 'enemy_patrol',       intensity: 'calm',   badgers: [0, 0], enemies: [1, 2], rockHazard: 'none', weight: 1.2, requiresLineOfSight: false, durationMs: [2800, 4400] },
  { id: 'chase',              intensity: 'normal', badgers: [1, 2], enemies: [1, 2], rockHazard: 'low',  weight: 1.0, requiresLineOfSight: true,  durationMs: [3200, 5200] },
  { id: 'melee_chase',        intensity: 'normal', badgers: [1, 1], enemies: [1, 2], rockHazard: 'none', weight: 0.9, requiresLineOfSight: true,  weaponFamily: 'melee', durationMs: [3000, 4800] },
  { id: 'short_duel',         intensity: 'normal', badgers: [1, 1], enemies: [1, 1], rockHazard: 'low',  weight: 1.1, requiresLineOfSight: true,  durationMs: [3000, 4600] },
  { id: 'cover_exchange',     intensity: 'normal', badgers: [1, 2], enemies: [1, 2], rockHazard: 'low',  weight: 1.0, requiresLineOfSight: true,  durationMs: [3600, 6000] },
  { id: 'ambush',             intensity: 'normal', badgers: [1, 2], enemies: [1, 2], rockHazard: 'low',  weight: 0.9, requiresLineOfSight: true,  durationMs: [3000, 5000] },
  { id: 'blocked_shot',       intensity: 'normal', badgers: [1, 1], enemies: [1, 1], rockHazard: 'low',  weight: 0.7, requiresLineOfSight: false, durationMs: [3000, 4400] },
  { id: 'retreat_fire',       intensity: 'normal', badgers: [1, 2], enemies: [1, 2], rockHazard: 'low',  weight: 0.9, requiresLineOfSight: true,  durationMs: [3400, 5400] },
  { id: 'rock_break',         intensity: 'strong', badgers: [1, 2], enemies: [0, 1], rockHazard: 'high', weight: 0.5, requiresLineOfSight: false, weaponFamily: 'projectile', durationMs: [3400, 5600] },
  { id: 'crossfire',          intensity: 'strong', badgers: [2, 3], enemies: [1, 3], rockHazard: 'high', weight: 0.5, requiresLineOfSight: true,  durationMs: [4000, 6000] },
  { id: 'rare_enemy_passage', intensity: 'strong', badgers: [0, 1], enemies: [2, 3], rockHazard: 'none', weight: 0.4, requiresLineOfSight: false, durationMs: [3600, 5600] },
  { id: 'asmd_combo',         intensity: 'strong', badgers: [1, 1], enemies: [0, 2], rockHazard: 'high', weight: 0.35, requiresLineOfSight: true, durationMs: [3600, 5400] },
];

const TEMPLATE_BY_ID = new Map(AMBIENT_TEMPLATES.map((template) => [template.id, template]));

export function getAmbientTemplate(id: AmbientTemplateId): AmbientTemplate {
  const template = TEMPLATE_BY_ID.get(id);
  if (!template) throw new Error(`[AmbientSequenceCatalog] Unbekanntes Template: ${id}`);
  return template;
}

/**
 * Reihenfolge, in der der Director Templates ausprobiert.
 *
 * Gewichtet nach Grundgewicht und Historie; ein Template mit Abwertung 0 – zuletzt gezeigt –
 * fällt ganz heraus. Starke Sequenzen kommen nur vor, wenn ihre Sperrzeit abgelaufen ist.
 *
 * Der Rückgabewert ist bewusst eine Liste und keine einzelne Wahl: Ein Template kann sich
 * gegen die aktuelle Felslandschaft als nicht auflösbar erweisen, und dann soll der Director
 * das nächstbeste nehmen statt eine Runde auszusetzen.
 */
export function orderAmbientTemplateCandidates(
  history: {
    templatePenalty(template: AmbientTemplateId): number;
    canRunStrong(nowMs: number): boolean;
  },
  nowMs: number,
  rng: () => number,
): AmbientTemplate[] {
  const allowStrong = history.canRunStrong(nowMs);

  const scored = AMBIENT_TEMPLATES
    .filter((template) => allowStrong || template.intensity !== 'strong')
    .map((template) => {
      const penalty = history.templatePenalty(template.id);
      // Ein zufälliger Schlüssel proportional zum Gewicht ergibt eine gewichtete Reihenfolge
      // in einem Durchgang, ohne wiederholtes Ziehen ohne Zurücklegen.
      const weight = template.weight * penalty;
      return { template, key: weight <= 0 ? -1 : rng() ** (1 / weight) };
    })
    .filter((entry) => entry.key >= 0);

  scored.sort((left, right) => right.key - left.key);
  return scored.map((entry) => entry.template);
}

/**
 * Geplantes Zerstörungsbudget einer Sequenz.
 *
 * Reine Planungsregel: Der Compiler verwirft damit offensichtlich unpassende Pläne, etwa
 * eine grosse Explosion mitten in einer massiven Felsfläche. Was die echte Mechanik danach
 * anrichtet, bleibt stehen.
 */
export function resolveRockDestructionBudget(hazard: AmbientRockHazard): readonly [number, number] {
  switch (hazard) {
    case 'none': return [0, 0];
    case 'low':  return [0, 4];
    case 'high': return [5, 8];
  }
}
