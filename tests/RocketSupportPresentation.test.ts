import { describe, expect, it, vi } from 'vitest';
const visuals = vi.hoisted(() => ({ shields: [] as any[], heals: [] as any[] }));
vi.mock('phaser', () => ({ BlendModes: { ADD: 1 } }));
vi.mock('../src/effects/PressureShieldRenderer', () => ({ PressureShieldRenderer: class {
  sync = vi.fn(); destroy = vi.fn(); constructor() { visuals.shields.push(this); }
} }));
vi.mock('../src/effects/HealingAuraRenderer', () => ({ HealingAuraRenderer: class {
  playHealingBurst = vi.fn(); destroyAll = vi.fn(); constructor() { visuals.heals.push(this); }
} }));
import { PlayerEntity } from '../src/entities/PlayerEntity';

describe('Rocket support presentation lifetime', () => {
  it('expires the shell exactly, batches confirmed healing and clears both effects on death', () => {
    const player = Object.create(PlayerEntity.prototype) as PlayerEntity;
    Object.assign(player, { sprite: { x: 10, y: 20, displayWidth: 30, visible: true, scene: {} } });
    player.updateRocketSupport({ alive: true, rocketHealSequence: 0 }, 1000);
    player.updateRocketSupport({ alive: true, pressureShieldUntil: 1500, rocketHealSequence: 3 }, 1100);
    const shield = visuals.shields.at(-1), heal = visuals.heals.at(-1);
    expect(shield.sync).toHaveBeenLastCalledWith(10, 20, 30, true);
    expect(heal.playHealingBurst).toHaveBeenCalledExactlyOnceWith(10, 20);
    player.updateRocketSupport({ alive: true, pressureShieldUntil: 1500, rocketHealSequence: 3 }, 1499);
    expect(shield.destroy).not.toHaveBeenCalled(); expect(heal.playHealingBurst).toHaveBeenCalledOnce();
    player.updateRocketSupport({ alive: true, pressureShieldUntil: 1500, rocketHealSequence: 3 }, 1500);
    expect(shield.destroy).toHaveBeenCalledOnce();
    player.updateRocketSupport({ alive: true, pressureShieldUntil: 1900, rocketHealSequence: 4 }, 1600);
    const nextShield = visuals.shields.at(-1);
    player.updateRocketSupport({ alive: false, pressureShieldUntil: 1900, rocketHealSequence: 4 }, 1601);
    expect(nextShield.destroy).toHaveBeenCalledOnce(); expect(heal.destroyAll).toHaveBeenCalledOnce();
  });
});
