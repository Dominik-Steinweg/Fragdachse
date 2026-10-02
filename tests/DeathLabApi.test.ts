import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
vi.mock('../src/dev/deathLab/Export', async original => ({
  ...await original<typeof import('../src/dev/deathLab/Export')>(),
  decodePng: async (png: string) => ({ src: png }),
  contactSheet: async () => 'contact-sheet',
}));
import { DeathLabApi } from '../src/dev/deathLab/api';
import { DeathPlayback } from '../src/dev/deathLab/Playback';
import { INITIAL_SETTINGS, resolveSettings } from '../src/dev/deathLab/State';
import { DEATH_TUNING_DEFAULTS } from '../src/effects/gpu/DeathTuning';
import type { LabExport } from '../src/dev/deathLab/Export';

function setup(capture?: (time: number) => Promise<string>) {
  const events: unknown[] = [];
  const scene = {
    settings: structuredClone(INITIAL_SETTINGS), tuning: DEATH_TUNING_DEFAULTS,
    playback: new DeathPlayback({ reset: () => events.push('reset'), spawn: () => events.push('spawn'),
      advance: dt => events.push(['advance', dt]), sample: t => events.push(['sample', t]) }),
    applySettings: vi.fn(function(values) { scene.settings = values; }),
    applyTuning: vi.fn(function(values) { scene.tuning = values; }),
    capture: vi.fn(async () => capture ? capture(scene.playback.timeMs) : `png-${scene.playback.timeMs}`),
  };
  const api = new DeathLabApi(scene as never, Promise.resolve({ codeSha256: 'fixture-code', assets: ['asset-1'] }));
  return { api, scene, events };
}

describe('death lab automation', () => {
  it('validates settings and commands atomically, including loop and duration safety', async () => {
    const { api, scene } = setup(); await api.whenReady();
    const before = api.status();
    for (const command of [{ action: 'unknown' }, { action: 'seek', timeMs: -1 }, { action: 'play', speed: 0.3 },
      { action: 'configure', values: { seed: Infinity } }, { action: 'configure', values: { fixture: 'missing' } },
      { action: 'configure', values: { layers: { ghost: 'true' } } },
      { action: 'tuning', values: { dustAt: 0.8 } }, { action: 'tuning', values: {}, reset: true }]) {
      await expect(api.run(command)).rejects.toThrow();
      expect(api.status().settings).toEqual(before.settings); expect(api.status().tuning).toEqual(before.tuning);
      expect(scene.applyTuning).not.toHaveBeenCalled(); expect(scene.playback.timeMs).toBe(0);
    }
    expect(() => resolveSettings({ seed: 1.5 }, INITIAL_SETTINGS)).toThrow();
    api.dispose(); await expect(api.run({ action: 'status' })).rejects.toThrow();
  });
  it('freezes A, snaps BOTH views together, keeps A through tuning and invalidates it for fixture changes', async () => {
    const { api, scene } = setup();
    await api.run({ action: 'freeze', frames: 4, stepMs: 500 });
    expect(scene.capture).toHaveBeenCalledTimes(4);
    await api.run({ action: 'tuning', values: { dustAt: 0.42 } });
    expect(api.status().baseline?.metadata.tuning).toEqual(DEATH_TUNING_DEFAULTS);
    await api.run({ action: 'seek', timeMs: 480 });
    expect(api.status().timeMs).toBe(500); expect(api.status().requestedTimeMs).toBe(480);
    const leaked = api.status().baseline!; (leaked.metadata.tuning as Record<string, number>).dustAt = 99;
    expect(api.status().baseline?.metadata.tuning).toEqual(DEATH_TUNING_DEFAULTS);
    await api.run({ action: 'configure', values: { fixture: 'small', pose: 'move' } });
    expect(api.status().baseline).toBeNull();
    expect(scene.applyTuning).toHaveBeenCalledTimes(1); // no rebake from seek/configure/capture
  });
  it('exports exact timestamps, immutable A and reproducible metadata; restores the selected time', async () => {
    const { api } = setup();
    await api.run({ action: 'freeze', frames: 4, stepMs: 500 });
    await api.run({ action: 'seek', timeMs: 1000 });
    const result = await api.run({ action: 'export', frames: 4, stepMs: 500 }) as LabExport;
    expect(result.frames).toEqual([0, 500, 1000, 1500].map(timeMs => ({ timeMs, png: `png-${timeMs}` })));
    expect(result.baseline?.frames).toEqual(result.frames);
    expect(result.metadata).toMatchObject({ codeSha256: 'fixture-code', timesMs: [0, 500, 1000, 1500],
      snapshot: { seed: INITIAL_SETTINGS.seed }, settings: INITIAL_SETTINGS, tuning: DEATH_TUNING_DEFAULTS });
    expect(api.status().timeMs).toBe(1000);
    result.baseline!.frames[0].png = 'changed';
    const again = await api.run({ action: 'export', frames: 1, stepMs: 25 }) as LabExport;
    expect(again.baseline!.frames[0].png).toBe('png-0');
    await expect(api.run({ action: 'export', frames: 60, stepMs: 25 })).rejects.toThrow(/Zeitschritt/);
    expect(api.status().timeMs).toBe(1000);
  });
  it('serializes capture and seek, freezes commands at submission and recovers after capture failure', async () => {
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let rejectNext = false;
    const { api, scene } = setup(async time => { await barrier; if (rejectNext) throw new Error('render lost'); return `png-${time}`; });
    await api.whenReady();
    const exporting = api.run({ action: 'export', frames: 1, stepMs: 25 });
    const command = { action: 'seek', timeMs: 480 }, seeking = api.run(command); command.timeMs = 5;
    await Promise.resolve(); await Promise.resolve();
    api.tick(300); expect(scene.playback.timeMs).toBe(0);
    release(); await exporting; await seeking; expect(scene.playback.timeMs).toBe(480);
    rejectNext = true;
    await expect(api.run({ action: 'export', frames: 1, stepMs: 25 })).rejects.toThrow('render lost');
    expect(scene.playback.timeMs).toBe(480); expect(api.status().busy).toBe(false);
    await api.run({ action: 'seek', timeMs: 0 }); expect(api.status().error).toBeNull();
  });
});
