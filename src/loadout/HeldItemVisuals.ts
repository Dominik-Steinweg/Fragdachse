/**
 * Bildzuordnung fuer getragene Loadout-Items.
 *
 * Die Spielerfigur haelt genau ein Item in den Pfoten. Welches das ist, entscheidet
 * `HeldItemSlotTracker`; welches Bild dazu gehoert, entscheidet diese Datei. Beides ist bewusst
 * getrennt: Der Slot ist replizierter Spielzustand, die Textur reine Darstellung.
 *
 * Vertrag fuer neue Waffen – eine Zeile in `HELD_ITEM_SPRITES` und eine Pixelkarte in
 * `scripts/generate-held-item-sprites.mjs`:
 *
 * - Die Textur liegt im **Pixelraster der Figur** (`PLAYER_TEXTURE_SIZE`), also 1 Texturpixel je
 *   Figurenpixel. Die Anzeigegroesse ergibt sich daraus von selbst; Waffen duerfen und sollen
 *   unterschiedlich gross sein, ohne dass hier eine Groesse gepflegt wird.
 * - Die Textur zeigt nach **Norden**, wie Spieler- und Gegnersprites. Den Rotationsoffset traegt
 *   allein die Figur.
 * - `gripX`/`gripY` ist der Punkt der Waffentextur in Texturpixeln, der auf dem Pfotenanker der
 *   Figur (`HELD_ITEM_ANCHOR_X/Y`) sitzt.
 *
 * Items ohne eigenen Eintrag fallen auf eine neutrale Form ihrer Gattung zurueck, damit ein neues
 * Loadout-Item nie mit leeren Pfoten dasteht. Nahkampfwaffen tragen bewusst nichts: Biss und
 * Klauen sind die Waffe.
 */
import type * as Phaser from 'phaser';
import { findUtilityConfig, findWeaponConfig, getUtilityBaseId } from './LoadoutConfig';

export interface HeldItemSpriteSpec {
  readonly textureKey: string;
  readonly assetPath: string;
  /** Griffpunkt in Texturpixeln, Ursprung ist die linke obere Ecke der Waffentextur. */
  readonly gripX: number;
  readonly gripY: number;
}

function sprite(fileName: string, gripX: number, gripY: number): HeldItemSpriteSpec {
  return Object.freeze({
    textureKey: `held_${fileName}`,
    assetPath: `./assets/sprites/held/${fileName}.png`,
    gripX,
    gripY,
  });
}

/** Neutrale Form fuer Schusswaffen ohne eigenes Bild. */
const GENERIC_GUN = sprite('generic_gun', 2.5, 8.5);
/** Neutrale Form fuer geworfene Utilities ohne eigenes Bild. */
const GENERIC_THROWABLE = sprite('generic_throwable', 2.5, 4.5);

/** Bilder mit eigener Gestaltung, geschluesselt auf die Loadout-Item-ID. */
export const HELD_ITEM_SPRITES: Readonly<Record<string, HeldItemSpriteSpec>> = Object.freeze({
  GLOCK: sprite('GLOCK', 2.5, 8.5),
  P90: sprite('P90', 3, 11),
  HE_GRENADE: sprite('HE_GRENADE', 3, 6),
});

const FALLBACK_SPRITES: readonly HeldItemSpriteSpec[] = [GENERIC_GUN, GENERIC_THROWABLE];

/**
 * Waffenarten, die in den Pfoten nichts Sichtbares halten. Nahkampf ist die Figur selbst, und
 * `energy_shield`, `tesla_dome` sowie `healing_aura` besitzen bereits eine eigene, deutlich
 * groessere Weltdarstellung – ein zusaetzlicher Klotz in den Pfoten stuende nur davor.
 */
const SLOTLESS_WEAPON_FIRE_TYPES: ReadonlySet<string> = new Set([
  'melee',
  'energy_shield',
  'tesla_dome',
  'healing_aura',
]);

/** Utility-Arten, die nicht geworfen, sondern platziert oder sofort ausgeloest werden. */
const SLOTLESS_UTILITY_TYPES: ReadonlySet<string> = new Set([
  'placeable_rock',
  'placeable_turret',
  'placeable_pedestal',
  'translocator',
  'taser',
]);

/**
 * Bild fuer eine Loadout-Item-ID, oder `null` wenn dieses Item nichts in den Pfoten zeigt.
 * Unbekannte IDs liefern `null` statt einer Rueckfallform – sie sind ein Datenfehler und sollen
 * nicht als Waffe erscheinen.
 */
export function getHeldItemSpriteSpec(itemId: string | null | undefined): HeldItemSpriteSpec | null {
  if (!itemId) return null;

  const explicit = HELD_ITEM_SPRITES[itemId];
  if (explicit) return explicit;

  // Modusvarianten (`..._COOP`) sind derselbe Gegenstand mit anderen Werten und erben deshalb das
  // Bild ihrer Basis, statt auf die neutrale Rueckfallform zu fallen.
  const utilityBaseId = getUtilityBaseId(itemId);
  if (utilityBaseId && utilityBaseId !== itemId && HELD_ITEM_SPRITES[utilityBaseId]) {
    return HELD_ITEM_SPRITES[utilityBaseId];
  }

  const weapon = findWeaponConfig(itemId);
  if (weapon) return SLOTLESS_WEAPON_FIRE_TYPES.has(weapon.fire.type) ? null : GENERIC_GUN;

  const utility = findUtilityConfig(itemId);
  if (utility) return SLOTLESS_UTILITY_TYPES.has(utility.type) ? null : GENERIC_THROWABLE;

  return null;
}

/** Stellt jede getragene Textur genau einmal in die Ladeschlange. */
export function preloadHeldItemAssets(loader: Phaser.Loader.LoaderPlugin): void {
  const queued = new Set<string>();
  for (const spec of [...Object.values(HELD_ITEM_SPRITES), ...FALLBACK_SPRITES]) {
    if (queued.has(spec.textureKey)) continue;
    queued.add(spec.textureKey);
    loader.image(spec.textureKey, spec.assetPath);
  }
}
