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
 * - `muzzleX`/`muzzleY` ist der sichtbare Lauf- oder Rohrmund. Er wird zentral mit derselben
 *   Rotation und Skalierung in den World Space transformiert.
 *
 * Items ohne eigenen Eintrag fallen auf eine neutrale Form ihrer Gattung zurueck, damit ein neues
 * Loadout-Item nie mit leeren Pfoten dasteht. Nahkampfwaffen tragen bewusst nichts: Biss und
 * Klauen sind die Waffe.
 */
import type * as Phaser from 'phaser';
import { PLAYER_TEXTURE_SIZE, transformHeldItemPoint, type MuzzleOrigin } from '../config';
import { findUtilityConfig, findWeaponConfig, getUtilityBaseId } from './LoadoutConfig';

export interface HeldItemSpriteSpec {
  readonly textureKey: string;
  readonly assetPath: string;
  /** Griffpunkt in Texturpixeln, Ursprung ist die linke obere Ecke der Waffentextur. */
  readonly gripX: number;
  readonly gripY: number;
  /** Sichtbarer Mündungspunkt in Texturpixeln, Ursprung ist die linke obere Ecke. */
  readonly muzzleX: number;
  readonly muzzleY: number;
}

function sprite(
  fileName: string,
  gripX: number,
  gripY: number,
  muzzleX = gripX,
  muzzleY = 0,
): HeldItemSpriteSpec {
  return Object.freeze({
    textureKey: `held_${fileName}`,
    assetPath: `./assets/sprites/held/${fileName}.png`,
    gripX,
    gripY,
    muzzleX,
    muzzleY,
  });
}

/**
 * Liefert einen lokalen Held-Item-Punkt im World Space. Grip und Muzzle verwenden damit exakt
 * dieselbe Rotation, Skalierung und Pfotenanker-Transformation wie das sichtbare Image.
 */
export function getHeldItemPointWorld(
  originX: number,
  originY: number,
  spriteRotation: number,
  displaySize: number,
  spec: HeldItemSpriteSpec,
  pointX: number,
  pointY: number,
): MuzzleOrigin {
  return transformHeldItemPoint(
    originX,
    originY,
    spriteRotation,
    displaySize / PLAYER_TEXTURE_SIZE,
    spec.gripX,
    spec.gripY,
    pointX,
    pointY,
  );
}

/** Neutrale Form fuer Schusswaffen ohne eigenes Bild. */
const GENERIC_GUN = sprite('generic_gun', 2.5, 8.5);
/** Neutrale Form fuer geworfene Utilities ohne eigenes Bild. */
const GENERIC_THROWABLE = sprite('generic_throwable', 2.5, 4.5);

/** Bilder mit eigener Gestaltung, geschluesselt auf die Loadout-Item-ID. */
export const HELD_ITEM_SPRITES: Readonly<Record<string, HeldItemSpriteSpec>> = Object.freeze({
  GLOCK: sprite('GLOCK', 2.5, 9.5, 2.5, 0),
  ASMD_PRIM: sprite('ASMD_PRIM', 3.5, 8.5),
  PLASMA: sprite('PLASMA', 3.5, 10.5),
  HYDRA: sprite('HYDRA', 3.5, 10.5),
  XBOW: sprite('XBOW', 3.5, 10.5),
  LAUBBLAESER: sprite('LAUBBLAESER', 3.5, 11.5),
  REPARATURSTRAHL: sprite('REPARATURSTRAHL', 2.5, 9.5),
  OVERCHARGE_CORE: sprite('OVERCHARGE_CORE', 3.5, 8.5),
  ENERGIEINJEKTOR: sprite('ENERGIEINJEKTOR', 2.5, 8.5),
  P90: sprite('P90', 4.5, 14.5, 4.5, 0),
  AK47: sprite('AK47', 4.5, 22, 4.5, 0),
  SHOTGUN: sprite('SHOTGUN', 5.5, 19.5, 5.5, 0),
  ASMD_SEC: sprite('ASMD_SEC', 3.5, 11),
  ROCKET_LAUNCHER: sprite('ROCKET_LAUNCHER', 6.5, 22.5, 6.5, 0),
  MINI_ROCKET_LAUNCHER: sprite('MINI_ROCKET_LAUNCHER', 3, 9.5),
  AWP: sprite('AWP', 3.5, 29.5, 3.5, 0),
  FLAMETHROWER: sprite('FLAMETHROWER', 3.5, 11),
  NEGEV: sprite('NEGEV', 7.5, 25.5, 7.5, 0),
  HE_GRENADE: sprite('HE_GRENADE', 3, 6),
  SMOKE_GRENADE: sprite('SMOKE_GRENADE', 3, 6.5),
  MOLOTOV_GRENADE: sprite('MOLOTOV_GRENADE', 3, 7),
  TIME_BUBBLE: sprite('TIME_BUBBLE', 3, 6.5),
  STINKDRUESEN: sprite('STINKDRUESEN', 3.5, 6.5),
  DECOY: sprite('DECOY', 3, 8),
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

/**
 * Kanonischer visueller Mündungsursprung eines getragenen Items. `null` bedeutet, dass die ID
 * kein sichtbares Held-Item besitzt; Caller behalten dann ihren gameplaytauglichen Fallback.
 */
export function getHeldWeaponMuzzleOrigin(
  itemId: string | null | undefined,
  originX: number,
  originY: number,
  spriteRotation: number,
  displaySize: number,
): MuzzleOrigin | null {
  const spec = getHeldItemSpriteSpec(itemId);
  return spec
    ? getHeldItemPointWorld(originX, originY, spriteRotation, displaySize, spec, spec.muzzleX, spec.muzzleY)
    : null;
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
