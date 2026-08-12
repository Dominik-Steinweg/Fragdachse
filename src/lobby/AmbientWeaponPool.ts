import { LOADOUT_CATALOG_ENTRIES } from '../loadout/content';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { WeaponConfig } from '../loadout/LoadoutConfig';
import { isAmbientCompatibleWeapon } from '../loadout/WeaponFireExecutor';

/** Grobe Waffenfamilie für die Anti-Wiederholung des Directors. */
export type AmbientWeaponFamily = 'projectile' | 'hitscan' | 'melee';

export interface AmbientWeaponEntry {
  id: string;
  config: WeaponConfig;
  family: AmbientWeaponFamily;
  weight: number;
}

/** Gewicht einer normalen kompatiblen Waffe. */
const BASE_WEIGHT = 1;
/** Gewicht einer aktuell gewählten, kompatiblen weapon1/weapon2. */
const LOADOUT_FOCUS_WEIGHT = 2.5;

/**
 * Alle Waffen, die ein Spieler tatsächlich in weapon1 oder weapon2 tragen kann.
 *
 * Turm-, Gegner- und Basiswaffen stehen zwar in derselben Konfiguration, gehören aber keinem
 * Dachs in die Pfoten. Der Katalog ist die Wahrheit darüber, was auswählbar ist.
 */
const SELECTABLE_WEAPON_IDS: readonly string[] = [...new Set(
  LOADOUT_CATALOG_ENTRIES
    .filter((entry) => entry.kind === 'weapon' && (entry.slot === 'weapon1' || entry.slot === 'weapon2'))
    .map((entry) => entry.id),
)];

function resolveFamily(config: WeaponConfig): AmbientWeaponFamily {
  switch (config.fire.type) {
    case 'hitscan': return 'hitscan';
    case 'melee':   return 'melee';
    default:        return 'projectile';
  }
}

/**
 * Der Reparaturstrahl bleibt dem Inspector vorbehalten.
 *
 * Er ist zwar ein Hitscan und damit technisch Ambient-kompatibel, aber seine Wirkung ist
 * Reparatur – als Gefechtswaffe eines normalen Ambient-Dachses wäre er sinnlos.
 */
const INSPECTOR_ONLY_WEAPON_IDS: ReadonlySet<string> = new Set(['REPARATURSTRAHL']);

/**
 * Waffen, die generische Ambient-Dachse tragen können.
 *
 * Ausschlusskriterium ist allein der Fire-Typ: Was nicht über den gemeinsamen
 * {@link WeaponFireExecutor} läuft, wird **nicht** vereinfacht nachgebaut, sondern kommt
 * schlicht nicht vor.
 */
export const AMBIENT_WEAPON_IDS: readonly string[] = SELECTABLE_WEAPON_IDS.filter((id) => {
  const config = WEAPON_CONFIGS[id as keyof typeof WEAPON_CONFIGS] as WeaponConfig | undefined;
  if (!config || INSPECTOR_ONLY_WEAPON_IDS.has(id)) return false;
  return isAmbientCompatibleWeapon(config);
});

/** Ist die aktuell gewählte Waffe über den gemeinsamen Pfad zeigbar? */
export function isAmbientWeapon(weaponId: string | null | undefined): boolean {
  return weaponId !== null && weaponId !== undefined && AMBIENT_WEAPON_IDS.includes(weaponId);
}

/**
 * Baut den gewichteten Waffenpool einer neu kompilierten Sequenz.
 *
 * Die aktuell gewählten Slots weapon1/weapon2 erhalten einen Bonus – aber nur, wenn ihr
 * Fire-Typ Ambient-kompatibel ist. Eine inkompatible Wahl bekommt keinen Ersatz und keine
 * Fake-Mechanik, sondern schlicht keinen Bonus.
 *
 * Der Pool wird pro Sequenz neu gebaut. Eine Loadout-Änderung im Menü wirkt sich damit erst
 * auf die nächste Sequenz aus; laufende Actors behalten ihre Waffe.
 */
export function buildAmbientWeaponPool(selectedWeaponIds: readonly (string | null | undefined)[]): AmbientWeaponEntry[] {
  const focused = new Set(selectedWeaponIds.filter(isAmbientWeapon) as string[]);

  return AMBIENT_WEAPON_IDS.map((id) => {
    const config = WEAPON_CONFIGS[id as keyof typeof WEAPON_CONFIGS] as WeaponConfig;
    return {
      id,
      config,
      family: resolveFamily(config),
      weight: focused.has(id) ? LOADOUT_FOCUS_WEIGHT : BASE_WEIGHT,
    };
  });
}

/**
 * Wählt eine Waffe aus dem Pool.
 *
 * `penalty` senkt das Gewicht kürzlich gezeigter Waffen und Familien. Anti-Repetition hat
 * damit Vorrang vor der Loadout-Gewichtung: eine gerade erst gezeigte Fokuswaffe fällt unter
 * eine frische Normalwaffe zurück.
 */
export function pickAmbientWeapon(
  pool: readonly AmbientWeaponEntry[],
  rng: () => number,
  penalty: (entry: AmbientWeaponEntry) => number,
): AmbientWeaponEntry | null {
  if (pool.length === 0) return null;

  const weights = pool.map((entry) => Math.max(0.01, entry.weight * penalty(entry)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng() * total;
  for (let index = 0; index < pool.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return pool[index];
  }
  return pool[pool.length - 1];
}
