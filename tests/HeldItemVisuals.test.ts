import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getHeldItemAnchor, HELD_ITEM_ANCHOR_Y, MUZZLE_FORWARD_OFFSET, PLAYER_SIZE, PLAYER_TEXTURE_SIZE } from '../src/config';
import { HELD_ITEM_SPRITES, getHeldItemSpriteSpec } from '../src/loadout/HeldItemVisuals';
import { HELD_UTILITY_DISPLAY_MS, HeldItemSlotTracker } from '../src/loadout/HeldItemSlotTracker';
import { DEFAULT_LOADOUT } from '../src/loadout/LoadoutConfig';

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

  it('haelt jedes Bild im Pixelraster der Figur und den Griffpunkt darin', () => {
    for (const spec of Object.values(HELD_ITEM_SPRITES)) {
      const file = path.join(REPOSITORY_ROOT, 'public', spec.assetPath.replace(/^\.\//, ''));
      expect(existsSync(file), spec.assetPath).toBe(true);

      const { width, height } = readPngSize(spec.assetPath);
      // Ein Texturpixel ist ein Figurenpixel: eine Waffe darf nie so gross werden, dass sie
      // die Figur ueberdeckt statt vor ihr zu liegen.
      expect(width, spec.textureKey).toBeLessThanOrEqual(PLAYER_TEXTURE_SIZE / 2);
      expect(height, spec.textureKey).toBeLessThanOrEqual(PLAYER_TEXTURE_SIZE / 2);

      expect(spec.gripX, spec.textureKey).toBeGreaterThanOrEqual(0);
      expect(spec.gripX, spec.textureKey).toBeLessThanOrEqual(width);
      expect(spec.gripY, spec.textureKey).toBeGreaterThanOrEqual(0);
      expect(spec.gripY, spec.textureKey).toBeLessThanOrEqual(height);
    }
  });

  it('laesst keine Waffe ueber die Muendung hinausragen', () => {
    // Projektile, Hitscan-Ursprung, Muendungsfeuer und Schuss-Audio starten alle bei
    // MUZZLE_FORWARD_OFFSET vor der Figurenmitte. Ragt eine Waffe weiter nach vorn, entsteht der
    // Schuss sichtbar *im* Lauf statt an seiner Spitze. Das ist die einzige harte Obergrenze fuer
    // die Groesse getragener Items – nach hinten und zur Seite gibt es keine.
    const scale = PLAYER_SIZE / PLAYER_TEXTURE_SIZE;
    const maxForwardReach = MUZZLE_FORWARD_OFFSET / scale + HELD_ITEM_ANCHOR_Y;
    expect(maxForwardReach).toBeGreaterThan(0);

    for (const spec of [...Object.values(HELD_ITEM_SPRITES), getHeldItemSpriteSpec('AK47')!, getHeldItemSpriteSpec('SMOKE_GRENADE')!]) {
      // Der Griffpunkt liegt auf dem Pfotenanker, alles davor ist die Reichweite nach vorn.
      expect(spec.gripY, spec.textureKey).toBeLessThanOrEqual(maxForwardReach);
    }
  });

  it('gibt Nahkampfwaffen und Konstrukten nichts in die Pfoten', () => {
    expect(getHeldItemSpriteSpec('BITE')).toBeNull();
    expect(getHeldItemSpriteSpec('FELSBAU')).toBeNull();
    expect(getHeldItemSpriteSpec(null)).toBeNull();
    expect(getHeldItemSpriteSpec('KEIN_ITEM')).toBeNull();
  });

  it('faellt fuer Schusswaffen und Wurf-Utilities ohne eigenes Bild auf die neutrale Form zurueck', () => {
    const gun = getHeldItemSpriteSpec('AK47');
    const throwable = getHeldItemSpriteSpec('SMOKE_GRENADE');
    expect(gun?.textureKey).toBe('held_generic_gun');
    expect(throwable?.textureKey).toBe('held_generic_throwable');
  });
});

describe('Getragene Loadout-Items: Pfotenanker', () => {
  const scale = PLAYER_SIZE / PLAYER_TEXTURE_SIZE;

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
    const preview = getHeldItemAnchor(0, 0, 0, 48 / PLAYER_TEXTURE_SIZE);
    expect(preview.y).toBeCloseTo(HELD_ITEM_ANCHOR_Y * (48 / PLAYER_TEXTURE_SIZE), 6);
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
