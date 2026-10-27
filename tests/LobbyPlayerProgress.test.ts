import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());

import { LobbyPlayerProgress } from '../src/ui/LobbyPlayerProgress';
import { t } from '../src/i18n';
import { DAWN_UNLOCK_AFTER_MAP_ID } from '../src/dawn/rules/DawnUnlock';
import { getStoredCoopDefenseProgress, restoreStoredCoopDefenseProgress } from '../src/utils/localPreferences';
import { getCoopDefenseProgressSnapshot } from '../src/utils/coopDefenseProgression';

describe('lobby base menu access', () => {
  it('locks the merchant until Dawn is unlocked and closes it when the lobby locks, not when the panel hides', () => {
    const saved = getStoredCoopDefenseProgress();
    const progress = new LobbyPlayerProgress({} as never, () => {}, () => {});
    const button = { setVisible: vi.fn(), setEnabled: vi.fn(), setPosition: vi.fn(), setIcon: vi.fn() };
    const merchant = { hide: vi.fn() };
    Object.assign(progress, { coopBand: { visible: false, setVisible: vi.fn() },
      coopProgressLevelText: { setText: vi.fn() }, merchantBtn: button, merchant });
    try {
      restoreStoredCoopDefenseProgress({ ...saved, completedMapIds: [] });
      progress.setVisible(true);
      merchant.hide.mockClear();
      progress.setCoopDefenseProgress(getCoopDefenseProgressSnapshot(0));
      expect(button.setVisible).toHaveBeenLastCalledWith(true);
      expect(merchant.hide).not.toHaveBeenCalled();
      // Visible but disabled with a lock until the final campaign map has been won.
      progress.setDawnUnlocked(true);
      progress.setDawnUnlocked(false);
      expect(button.setIcon).toHaveBeenLastCalledWith('lock');
      expect(button.setEnabled).toHaveBeenLastCalledWith(false);
      restoreStoredCoopDefenseProgress({ ...saved, completedMapIds: [DAWN_UNLOCK_AFTER_MAP_ID] });
      progress.setCoopDefenseProgress(getCoopDefenseProgressSnapshot(0));
      expect(button.setVisible).toHaveBeenLastCalledWith(true);
      progress.setDawnUnlocked(true);
      expect(button.setIcon).toHaveBeenLastCalledWith(null);
      expect(button.setEnabled).toHaveBeenLastCalledWith(true);
      merchant.hide.mockClear();
      progress.setReady(true);
      expect(button.setEnabled).toHaveBeenLastCalledWith(false);
      expect(merchant.hide).toHaveBeenCalled();
      progress.setReady(false);
      expect(button.setEnabled).toHaveBeenLastCalledWith(true);
      // The lobby stall opens the merchant with Shift while the panel may be hidden.
      merchant.hide.mockClear();
      progress.setVisible(false);
      expect(merchant.hide).not.toHaveBeenCalled();
      progress.setCoopDefenseProgress(null);
      expect(merchant.hide).toHaveBeenCalled();
    } finally { restoreStoredCoopDefenseProgress(saved); }
  });

  it.each([false, true])('opens the base for clients too and keeps the reward badge with the host (unlocked=%s)', unlocked => {
    const progress = new LobbyPlayerProgress({} as never, () => {}, () => {});
    // Rendering ports: keep the actual state projection and pointer handlers under test.
    const background = new EventEmitter();
    const button = { getBackground: () => background, setEnabled: vi.fn(), setIcon: vi.fn(), setBadge: vi.fn() };
    const tooltip = { show: vi.fn(), move: vi.fn(), hide: vi.fn(), destroy: vi.fn() };
    Object.assign(progress, { coopBaseBtn: button, lockTooltip: tooltip });
    const internals = progress as unknown as {
      attachLockTooltip(button: unknown, content: () => unknown): void; baseLockContent(): unknown;
    };
    internals.attachLockTooltip(button, () => internals.baseLockContent());
    const pointer = { x: 300, y: 900 };

    progress.setBaseState(unlocked, 2, false);
    expect(button.setEnabled).toHaveBeenLastCalledWith(unlocked);
    expect(button.setIcon).toHaveBeenLastCalledWith(unlocked ? null : 'lock');
    // Pending rewards are base-owned; a client edits only its own constructions.
    expect(button.setBadge).toHaveBeenLastCalledWith(null);
    background.emit('pointerover', pointer);
    if (unlocked) expect(tooltip.show).not.toHaveBeenCalled();
    else expect(tooltip.show).toHaveBeenCalledOnce(); // Still locked by personal progress.
    tooltip.hide.mockClear();
    background.emit('pointerout');

    // A role change with unchanged personal progress must invalidate the old button state.
    progress.setBaseState(unlocked, 2, true);
    expect(button.setEnabled).toHaveBeenLastCalledWith(unlocked);
    expect(button.setBadge).toHaveBeenLastCalledWith(unlocked ? 2 : null);
    progress.setReady(true);
    expect(button.setEnabled).toHaveBeenLastCalledWith(false);
    progress.setReady(false);
    expect(button.setEnabled).toHaveBeenLastCalledWith(unlocked);
    tooltip.hide.mockClear();
    progress.setVisible(false);
    expect(tooltip.hide).toHaveBeenCalledOnce();
  });
});
