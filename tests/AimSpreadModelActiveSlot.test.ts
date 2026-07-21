import { describe, expect, it } from 'vitest';
import { AimSpreadModel } from '../src/ui/AimSpreadModel';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { WeaponConfig } from '../src/loadout/LoadoutConfig';
import type { WeaponSlot } from '../src/types';

function model(): AimSpreadModel {
  const configs: Record<WeaponSlot, WeaponConfig> = {
    weapon1: WEAPON_CONFIGS.AK47,
    weapon2: WEAPON_CONFIGS.AWP,
  };
  return new AimSpreadModel((slot) => configs[slot]);
}

describe('AimSpreadModel: aktiver Slot fuers Fadenkreuz', () => {
  it('uebernimmt Waffe 2 beim Anvisieren, auch wenn zuletzt mit Waffe 1 geschossen wurde', () => {
    const spreadModel = model();

    spreadModel.notifyShot('weapon1');
    expect(spreadModel.getResolvedState().activeSlot).toBe('weapon1');

    // Zielen mit der AWP feuert keinen Schuss – ohne setActiveSlot bliebe das
    // Fadenkreuz auf Waffe 1 und der Ladebalken unsichtbar.
    spreadModel.setActiveSlot('weapon2');
    expect(spreadModel.getResolvedState().activeSlot).toBe('weapon2');
  });

  it('meldet den Bloom des angezielten Slots, nicht den der zuvor gefeuerten Waffe', () => {
    const spreadModel = model();

    spreadModel.notifyShot('weapon1');
    const weapon1Bloom = spreadModel.getResolvedState().dynamicSpread;
    expect(weapon1Bloom).toBeGreaterThan(0);

    spreadModel.setActiveSlot('weapon2');
    expect(spreadModel.getResolvedState().dynamicSpread).toBe(0);
  });
});
