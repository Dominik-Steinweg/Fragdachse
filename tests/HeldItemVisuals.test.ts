import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getHeldItemAnchor, HELD_ITEM_ANCHOR_X, HELD_ITEM_ANCHOR_Y, HELD_ITEM_TEXTURE_SIZE, MUZZLE_FORWARD_OFFSET, PLAYER_SIZE } from '../src/config';
import { HELD_ITEM_SPRITES, getHeldItemPointWorld, getHeldItemSpriteSpec, getHeldWeaponMuzzleOrigin } from '../src/loadout/HeldItemVisuals';
import { HELD_UTILITY_DISPLAY_MS, HeldItemSlotTracker } from '../src/loadout/HeldItemSlotTracker';
import {
  DEFAULT_LOADOUT,
  LOADOUT_CATALOG_ENTRIES,
  findUtilityConfig,
  findWeaponConfig,
} from '../src/loadout/LoadoutConfig';

const REPOSITORY_ROOT = path.resolve(__dirname, '..');

/** Minimaler PNG-Header-Leser: Breite und Hoehe stehen im IHDR ab Byte 16. */
function readPngSize(assetPath: string): { width: number; height: number } {
  const file = path.join(REPOSITORY_ROOT, 'public', assetPath.replace(/^\.\//, ''));
  const data = readFileSync(file);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

describe('Getragene Loadout-Items: Bildvertrag', () => {
  it('liefert fuer die Standard-Items ein eigenes Bild', () => {
    for (const slot of ['weapon1', 'weapon2', 'utility'] as const) {
      const itemId = DEFAULT_LOADOUT[slot].id;
      expect(HELD_ITEM_SPRITES[itemId], `${slot} (${itemId})`).toBeDefined();
      expect(getHeldItemSpriteSpec(itemId)).toBe(HELD_ITEM_SPRITES[itemId]);
    }
  });

  it('hat fuer jedes tragbare Katalog-Item ein eigenes Bild', () => {
    const slotlessWeaponTypes = new Set(['melee', 'energy_shield', 'tesla_dome', 'healing_aura']);
    const slotlessUtilityTypes = new Set([
      'placeable_rock',
      'placeable_turret',
      'placeable_pedestal',
      'translocator',
      'taser',
    ]);

    for (const entry of LOADOUT_CATALOG_ENTRIES.filter((candidate) => candidate.kind !== 'ultimate')) {
      const weapon = findWeaponConfig(entry.id);
      const utility = findUtilityConfig(entry.id);
      const shouldHaveSprite = weapon
        ? !slotlessWeaponTypes.has(weapon.fire.type)
        : utility
          ? !slotlessUtilityTypes.has(utility.type)
          : false;

      if (shouldHaveSprite) {
        expect(HELD_ITEM_SPRITES[entry.id], entry.id).toBeDefined();
        expect(getHeldItemSpriteSpec(entry.id), entry.id).toBe(HELD_ITEM_SPRITES[entry.id]);
      }
    }
  });

  it('haelt jedes Bild im Pixelraster der Figur und den Griffpunkt darin', () => {
    for (const spec of Object.values(HELD_ITEM_SPRITES)) {
      const file = path.join(REPOSITORY_ROOT, 'public', spec.assetPath.replace(/^\.\//, ''));
      expect(existsSync(file), spec.assetPath).toBe(true);

      const { width, height } = readPngSize(spec.assetPath);
      // Das Raster bleibt an die 32-px-Figur gebunden. Die Standardpalette bleibt kompakt;
      // nur das AWP darf als echte Langwaffen-Ausnahme deutlich laenger werden.
      expect(width, spec.textureKey).toBeLessThanOrEqual(HELD_ITEM_TEXTURE_SIZE);
      expect(height, spec.textureKey).toBeLessThanOrEqual(HELD_ITEM_TEXTURE_SIZE);
      const isExceptionalLongWeapon = spec.textureKey === 'held_AWP';
      expect(width, spec.textureKey).toBeLessThanOrEqual(isExceptionalLongWeapon ? 32 : 13);
      expect(height, spec.textureKey).toBeLessThanOrEqual(isExceptionalLongWeapon ? 32 : 24);

      expect(spec.gripX, spec.textureKey).toBeGreaterThanOrEqual(0);
      expect(spec.gripX, spec.textureKey).toBeLessThanOrEqual(width);
      expect(spec.gripY, spec.textureKey).toBeGreaterThanOrEqual(0);
      expect(spec.gripY, spec.textureKey).toBeLessThanOrEqual(height);
      expect(spec.muzzleX, spec.textureKey).toBeGreaterThanOrEqual(0);
      expect(spec.muzzleX, spec.textureKey).toBeLessThanOrEqual(width);
      expect(spec.muzzleY, spec.textureKey).toBeGreaterThanOrEqual(0);
      expect(spec.muzzleY, spec.textureKey).toBeLessThanOrEqual(height);
    }
  });

  it('laesst jede registrierte Muedung in ihrer Textur liegen', () => {
    // Projektile, Hitscan-Ursprung, Muendungsfeuer und Schuss-Audio starten alle bei
    // MUZZLE_FORWARD_OFFSET vor der Figurenmitte. Die sichtbare Muedung bleibt deshalb an der
    // vorderen Texturkante; die Groessenstaffelung wird separat ueber Standard- und Ausnahmegroesse
    // Standardwaffen bleiben kompakt; nur definierte Langwaffen duerfen diese Staffelung
    // ueberschreiten.
    const scale = PLAYER_SIZE / HELD_ITEM_TEXTURE_SIZE;
    const maxForwardReach = MUZZLE_FORWARD_OFFSET / scale + HELD_ITEM_ANCHOR_Y;
    expect(maxForwardReach).toBeGreaterThan(0);

    for (const spec of Object.values(HELD_ITEM_SPRITES)) {
      expect(spec.muzzleY, spec.textureKey).toBeLessThanOrEqual(spec.gripY);
      expect(spec.muzzleY, spec.textureKey).toBeGreaterThanOrEqual(0);
      expect(spec.muzzleY, spec.textureKey).toBeLessThanOrEqual(32);
    }
    expect(HELD_ITEM_SPRITES.AWP.gripY).toBeGreaterThan(maxForwardReach);
  });

  it('gibt Nahkampfwaffen und Konstrukten nichts in die Pfoten', () => {
    expect(getHeldItemSpriteSpec('BITE')).toBeNull();
    expect(getHeldItemSpriteSpec('ROCK_BARRIER')).toBeNull();
    expect(getHeldItemSpriteSpec(null)).toBeNull();
    expect(getHeldItemSpriteSpec('KEIN_ITEM')).toBeNull();
  });

  it('faellt fuer Schusswaffen und Wurf-Utilities ohne eigenes Bild auf die neutrale Form zurueck', () => {
    // Diese Varianten gehören zur Gegner-/Sonderausstattung und haben bewusst keinen eigenen
    // Held-Sprite-Eintrag. Die spielbaren Katalog-Items werden oben vollständig abgedeckt.
    const gun = getHeldItemSpriteSpec('VOID_HUNTER_SHOTGUN');
    const throwable = getHeldItemSpriteSpec('HOLY_HAND_GRENADE');
    expect(gun?.textureKey).toBe('held_generic_gun');
    expect(throwable?.textureKey).toBe('held_generic_throwable');
  });
});

describe('Getragene Loadout-Items: Pfotenanker', () => {
  const scale = PLAYER_SIZE / HELD_ITEM_TEXTURE_SIZE;

  it('liegt bei Nordausrichtung genau vor der Figur', () => {
    // Aimwinkel -PI/2 (nach oben) plus Sprite-Offset PI/2 ergibt Rotation 0: unrotierte Textur.
    const anchor = getHeldItemAnchor(100, 200, 0, scale);
    expect(anchor.x).toBeCloseTo(100, 6);
    expect(anchor.y).toBeCloseTo(200 + HELD_ITEM_ANCHOR_Y * scale, 6);
  });

  it('dreht mit der Figur mit', () => {
    const anchor = getHeldItemAnchor(100, 200, Math.PI / 2, scale);
    expect(anchor.x).toBeCloseTo(100 - HELD_ITEM_ANCHOR_Y * scale, 6);
    expect(anchor.y).toBeCloseTo(200, 6);
  });

  it('skaliert mit der Anzeigegroesse der Figur, etwa fuer die groessere Lobby-Vorschau', () => {
    const preview = getHeldItemAnchor(0, 0, 0, 48 / HELD_ITEM_TEXTURE_SIZE);
    expect(preview.y).toBeCloseTo(HELD_ITEM_ANCHOR_Y * (48 / HELD_ITEM_TEXTURE_SIZE), 6);
  });

  it('legt Griff und Muedung ueber dieselbe Transformation wie das Bild aus', () => {
    const spec = HELD_ITEM_SPRITES.AWP;
    const grip = getHeldItemPointWorld(100, 200, 0, PLAYER_SIZE, spec, spec.gripX, spec.gripY);
    const anchor = getHeldItemAnchor(100, 200, 0, scale);
    expect(grip.x).toBeCloseTo(anchor.x, 6);
    expect(grip.y).toBeCloseTo(anchor.y, 6);

    const localX = HELD_ITEM_ANCHOR_X + spec.muzzleX - spec.gripX;
    const localY = HELD_ITEM_ANCHOR_Y + spec.muzzleY - spec.gripY;
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const muzzle = getHeldWeaponMuzzleOrigin('AWP', 100, 200, angle, PLAYER_SIZE);
      expect(muzzle?.x).toBeCloseTo(100 + (localX * Math.cos(angle) - localY * Math.sin(angle)) * scale, 6);
      expect(muzzle?.y).toBeCloseTo(200 + (localX * Math.sin(angle) + localY * Math.cos(angle)) * scale, 6);
    }
  });

  it('bewahrt die absichtlich unterschiedlichen Waffen-Silhouetten', () => {
    const dimensions = (itemId: string): [number, number] => {
      const spec = HELD_ITEM_SPRITES[itemId];
      const size = readPngSize(spec.assetPath);
      return [size.width, size.height];
    };

    expect(dimensions('GLOCK')).toEqual([7, 11]);
    expect(dimensions('P90')).toEqual([9, 13]);
    expect(dimensions('AK47')).toEqual([9, 22]);
    expect(dimensions('AWP')).toEqual([9, 28]);
    expect(dimensions('ROCKET_LAUNCHER')).toEqual([13, 22]);
    expect(dimensions('NEGEV')).toEqual([13, 22]);
    expect(dimensions('SHOTGUN')).toEqual([11, 19]);
    expect(dimensions('MINI_ROCKET_LAUNCHER')).toEqual([9, 14]);
    expect(HELD_ITEM_SPRITES.GLOCK.muzzleX).toBe(3.5);
    expect(HELD_ITEM_SPRITES.GLOCK.gripX).toBe(4.5);
    expect(HELD_ITEM_SPRITES.NEGEV.gripX).toBe(6.5);
    expect(HELD_ITEM_SPRITES.ROCKET_LAUNCHER.muzzleX).toBe(5.5);
  });
});

describe('Getragener Slot', () => {
  it('beginnt mit Waffe 1', () => {
    const tracker = new HeldItemSlotTracker();
    expect(tracker.resolve('p1', 1_000)).toBe('weapon1');
  });

  it('bleibt auf der zuletzt gefeuerten Waffe stehen', () => {
    const tracker = new HeldItemSlotTracker();
    tracker.noteWeaponUsed('p1', 'weapon2', 1_000);
    expect(tracker.resolve('p1', 60_000)).toBe('weapon2');
  });

  it('zeigt die Utility nur waehrend des Wurffensters und kehrt danach zur Waffe zurueck', () => {
    const tracker = new HeldItemSlotTracker();
    tracker.noteWeaponUsed('p1', 'weapon2', 1_000);
    tracker.noteUtilityUsed('p1', 2_000);

    expect(tracker.resolve('p1', 2_000)).toBe('utility');
    expect(tracker.resolve('p1', 2_000 + HELD_UTILITY_DISPLAY_MS - 1)).toBe('utility');
    expect(tracker.resolve('p1', 2_000 + HELD_UTILITY_DISPLAY_MS)).toBe('weapon2');
  });

  it('beendet das Wurffenster sofort, sobald wieder geschossen wird', () => {
    const tracker = new HeldItemSlotTracker();
    tracker.noteUtilityUsed('p1', 2_000);
    tracker.noteWeaponUsed('p1', 'weapon1', 2_050);
    expect(tracker.resolve('p1', 2_100)).toBe('weapon1');
  });

  it('haelt Spieler getrennt und raeumt sie beim Entfernen auf', () => {
    const tracker = new HeldItemSlotTracker();
    tracker.noteWeaponUsed('p1', 'weapon2', 1_000);
    expect(tracker.resolve('p2', 1_000)).toBe('weapon1');

    tracker.removePlayer('p1');
    expect(tracker.resolve('p1', 1_000)).toBe('weapon1');
  });
});
