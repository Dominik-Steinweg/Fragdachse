import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());

import { LobbyPlayerProgress } from '../src/ui/LobbyPlayerProgress';
import { t } from '../src/i18n';

describe('lobby base menu access', () => {
  it.each([false, true])('locks clients and explains the restriction on hover (unlocked=%s)', unlocked => {
    const progress = new LobbyPlayerProgress({} as never, () => {}, () => {});
    // Rendering ports: keep the actual state projection and pointer handlers under test.
    const background = new EventEmitter();
    const button = { getBackground: () => background, setEnabled: vi.fn(), setIcon: vi.fn(), setBadge: vi.fn() };
    const tooltip = { show: vi.fn(), move: vi.fn(), hide: vi.fn(), destroy: vi.fn() };
    Object.assign(progress, { coopBaseBtn: button, baseTooltip: tooltip });
    (progress as unknown as { attachBaseLockTooltip(): void }).attachBaseLockTooltip();
    const pointer = { x: 300, y: 900 };

    progress.setBaseState(unlocked, 2, false);
    expect(button.setEnabled).toHaveBeenLastCalledWith(false);
    expect(button.setIcon).toHaveBeenLastCalledWith('lock');
    expect(button.setBadge).toHaveBeenLastCalledWith(null);
    background.emit('pointerover', pointer);
    expect(tooltip.show).toHaveBeenCalledWith(t('ui.base.title'), expect.any(Number),
      [{ text: t('ui.base.hostOnly'), color: expect.any(Number) }], pointer);
    background.emit('pointermove', pointer);
    expect(tooltip.move).toHaveBeenCalledWith(pointer);
    tooltip.hide.mockClear();
    background.emit('pointerout');
    expect(tooltip.hide).toHaveBeenCalledOnce();

    // A role change with unchanged personal progress must invalidate the old button state.
    progress.setBaseState(unlocked, 2, true);
    expect(button.setEnabled).toHaveBeenLastCalledWith(unlocked);
    expect(button.setBadge).toHaveBeenLastCalledWith(unlocked ? 2 : null);
    tooltip.show.mockClear();
    background.emit('pointerover', pointer);
    expect(tooltip.show).not.toHaveBeenCalled();
    progress.setReady(true);
    expect(button.setEnabled).toHaveBeenLastCalledWith(false);
    progress.setReady(false);
    expect(button.setEnabled).toHaveBeenLastCalledWith(unlocked);
    progress.setBaseState(unlocked, 2, false);
    expect(button.setEnabled).toHaveBeenLastCalledWith(false);
    tooltip.hide.mockClear();
    progress.setVisible(false);
    expect(tooltip.hide).toHaveBeenCalledOnce();
  });
});
