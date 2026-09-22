/**
 * Bildzuordnung fuer getragene Loadout-Items.
 *
 * Die Spielerfigur haelt genau ein Item in den Pfoten. Welches das ist, bestimmen
 * eine aktive lokale Utility-/Construction-Interaktion beziehungsweise der hostseitige `HeldItemSlotTracker`,
 * welches Bild dazu gehoert; die Zuordnung entscheidet diese Datei. Beides ist bewusst getrennt:
 * Die Action-/Slot-Identity ist Zustand, die Textur reine Darstellung.
 *
 * Waffen werden aus der ausgewählten Asset-Pipeline-Produktion zugeordnet. Utilities
 * und neutrale Gattungsbilder behalten ihre Pixelkarten in `generate-held-item-sprites.mjs`.
 *
 * - Grip und Mündung liegen im **32-px-Referenzraster** (`HELD_ITEM_TEXTURE_SIZE`).
 *   `sourceScale` trennt die höhere Exportauflösung von dieser logischen Geometrie.
 * - Die Textur zeigt nach **Norden**, wie Spieler- und Gegnersprites. Den Rotationsoffset traegt
 *   allein die Figur.
 * - `gripX`/`gripY` ist der Punkt in logischen Referenzpixeln, der auf dem Pfotenanker der
 *   Figur (`HELD_ITEM_ANCHOR_X/Y`) sitzt.
 * - `muzzleX`/`muzzleY` ist der sichtbare Lauf- oder Rohrmund. Er wird zentral mit derselben
 *   Rotation und Skalierung in den World Space transformiert.
 *
 * Items ohne eigenen Eintrag fallen auf eine neutrale Form ihrer Gattung zurueck, damit ein neues
 * Loadout-Item nie mit leeren Pfoten dasteht. Nahkampfwaffen tragen bewusst nichts: Biss und
 * Klauen sind die Waffe.
 */
import type * as Phaser from 'phaser';
import {
  getPlayerSpriteRotationFromAimAngle,
  HELD_ITEM_TEXTURE_SIZE,
  transformHeldItemPoint,
  type MuzzleOrigin,
} from '../config';
import { findUtilityConfig, findWeaponConfig, getUtilityBaseId } from './LoadoutConfig';
import { PIPELINE_ASSETS } from '../config/pipelineAssets';

export interface HeldItemSpriteSpec {
  readonly textureKey: string;
  readonly assetPath: string;
  /** Source texels per logical pixel in the 32-pixel held-item reference plane. */
  readonly sourceScale?: number;
  /** Griffpunkt in logischen Referenzpixeln, Ursprung ist die linke obere Ecke. */
  readonly gripX: number;
  readonly gripY: number;
  /** Sichtbarer Mündungspunkt in logischen Referenzpixeln. */
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
    displaySize / HELD_ITEM_TEXTURE_SIZE,
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

const PIPELINE_HELD_SPRITES: Readonly<Record<string, HeldItemSpriteSpec>> = Object.fromEntries(
  PIPELINE_ASSETS.filter(asset => asset.category === 'weapon').flatMap(asset => {
    const held = ('heldItem' in asset ? asset.heldItem : null) as {
      referenceSize: number; grip: number[]; muzzle: number[];
    } | null;
    if (!held || held.referenceSize !== HELD_ITEM_TEXTURE_SIZE) throw new Error(`Invalid held weapon export: ${asset.id}`);
    const spec: HeldItemSpriteSpec = Object.freeze({ textureKey: asset.textureKey, assetPath: asset.idlePath,
      sourceScale: asset.sourceSize / held.referenceSize,
      gripX: held.grip[0], gripY: held.grip[1], muzzleX: held.muzzle[0], muzzleY: held.muzzle[1] });
    return asset.gameIds.map(id => [id, spec]);
  }),
);

/** Bilder mit eigener Gestaltung, geschluesselt auf die Loadout-Item-ID. */
export const HELD_ITEM_SPRITES: Readonly<Record<string, HeldItemSpriteSpec>> = Object.freeze({
  ...PIPELINE_HELD_SPRITES,
  HE_GRENADE: sprite('HE_GRENADE', 3, 6),
  SMOKE_GRENADE: sprite('SMOKE_GRENADE', 3, 6.5),
  MOLOTOV_GRENADE: sprite('MOLOTOV_GRENADE', 3, 7),
  TIME_BUBBLE: sprite('TIME_BUBBLE', 3, 6.5),
  STINK_CLOUD: sprite('STINKDRUESEN', 3.5, 6.5),
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

/**
 * Gameplay-Mündung eines Fire-Requests. Im Gegensatz zur visuellen Variante kommen Ursprung
 * und Winkel vollständig aus dem konkreten Gameplay-Request, nicht aus der Render-Spritepose.
 */
export function getHeldWeaponGameplayMuzzleOrigin(
  itemId: string | null | undefined,
  gameplayX: number,
  gameplayY: number,
  aimAngle: number,
  displaySize: number,
): MuzzleOrigin | null {
  return getHeldWeaponMuzzleOrigin(
    itemId,
    gameplayX,
    gameplayY,
    getPlayerSpriteRotationFromAimAngle(aimAngle),
    displaySize,
  );
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
