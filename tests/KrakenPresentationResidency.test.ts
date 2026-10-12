import { beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ setPhase: vi.fn(), detach: vi.fn(), clear: vi.fn(), destroy: vi.fn(), begin: vi.fn(), register: vi.fn(),
  instances: [] as { activeLeaseCount: number; detach: ReturnType<typeof vi.fn> }[] }));
vi.mock('../src/dev/scenario/KrakenDraftAssets', () => ({ registerKrakenDraftConsumer: f.register, updateKrakenDraftFilters: vi.fn() }));
vi.mock('phaser', () => ({}));
vi.mock('../src/config/pipelineAssets', () => ({ PIPELINE_RUNTIME_ASSETS:
  ['', '-land', '-tentacle', '-egg'].map(suffix => ({ id: 'abyssal-kraken' + suffix, runtimeContract: 'boss', materialPass: {} })) }));
vi.mock('../src/effects/kraken/KrakenAssetResidency', () => ({ createKrakenResidencyPort: vi.fn(),
  KrakenAssetResidency: class { setPhase = f.setPhase; detach = vi.fn(() => f.detach()); residentBytes = 0; reservedBytes = 0; errors = [];
    activeLeaseCount = 0; constructor() { f.instances.push(this); } } }));
vi.mock('../src/effects/kraken/KrakenMeshCache', () => ({ KrakenMeshCache: class { clear = f.clear; destroy = f.destroy; bytes = 0; } }));
vi.mock('../src/effects/kraken/KrakenGpuBudget', () => ({ KrakenGpuBudget: class { begin = f.begin; retainedFilterBytes = 0; } }));
import { KrakenPresentationResidency } from '../src/effects/kraken/KrakenPresentationResidency';
beforeEach(() => { vi.clearAllMocks(); f.instances.length = 0;
  f.setPhase.mockReturnValue({ ready: Promise.resolve(true), settled: Promise.resolve() }); });
function owner() {
  const events = { on: vi.fn(), off: vi.fn() };
  return { events, owner: new KrakenPresentationResidency({ game: { events } } as never, vi.fn(), () => 128) };
}
it('does not restart intro loads when body and intro synchronization report different irrelevant options', () => {
  const { owner: r } = owner();
  r.setPhase('intro'); r.setPhase('intro', { prefetchLand: false, waterBody: true }); r.setPhase('intro');
  expect(f.setPhase).toHaveBeenCalledTimes(1);
  r.setPhase('water'); r.setPhase('water', { prefetchLand: true }); r.setPhase('water', { prefetchLand: true });
  expect(f.setPhase).toHaveBeenCalledTimes(3);
  expect(f.setPhase).toHaveBeenLastCalledWith('water', { prefetchLand: true, waterMove: false });
  r.destroy();
});
it('retains swimming through water cycles and forwards the grip handoff without reloading per frame', () => {
  const { owner: r } = owner();
  r.setPhase('water', { waterMove: true }); r.setPhase('water', { waterMove: false });
  expect(f.setPhase).toHaveBeenCalledTimes(1);
  r.setPhase('ashore', { waterBody: true }); r.setPhase('ashore', { waterBody: false });
  expect(f.setPhase).toHaveBeenLastCalledWith('ashore', { waterBody: false });
  r.setPhase('dead'); expect(f.clear).toHaveBeenCalledOnce();
  r.setPhase('water'); expect(f.setPhase).toHaveBeenLastCalledWith('water', { prefetchLand: false, waterMove: false });
  r.destroy();
});
it('starts a late land join in land and removes its postrender accounting at teardown', () => {
  const { owner: r, events } = owner();
  r.setPhase('land', { prefetchLand: true });
  expect(f.setPhase).toHaveBeenCalledExactlyOnceWith('land', {});
  expect(events.on).toHaveBeenCalledOnce();
  r.destroy(); expect(f.detach).toHaveBeenCalledOnce(); expect(f.destroy).toHaveBeenCalledOnce();
  expect(events.off.mock.calls[0]).toEqual(events.on.mock.calls[0]);
});

it('reloads stable adapters and retires old pages only after views release their leases', async () => {
  const { EventEmitter } = await import('node:events');
  const events = new EventEmitter();
  const r = new KrakenPresentationResidency({ game: { events } } as never, vi.fn(), () => 0);
  await vi.dynamicImportSettled();
  r.setPhase('water');
  const adapter = r.assets!.water, old = f.instances[0]; old.activeLeaseCount = 1;
  const reload = f.register.mock.calls.at(-1)![0];
  const next = { water: { id: 'changed' }, land: {}, tentacle: {}, egg: {} };
  const resolvePaths = vi.fn();
  const loading = reload(next, resolvePaths);
  await vi.waitFor(() => expect(resolvePaths).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(adapter.metadata.id).toBe('changed'));
  // EventEmitter does not implement Phaser's context argument; call the observer directly.
  const observer = events.listeners('postrender')[0]; observer.call(r);
  expect(old.detach).not.toHaveBeenCalled();
  old.activeLeaseCount = 0; observer.call(r);
  expect(old.detach).toHaveBeenCalledOnce();
  for (const listener of events.listeners('postrender').slice(1)) listener();
  await loading;
  expect(r.assets!.water).toBe(adapter);
  r.destroy();
});

it('keeps the old source on load failure and cancels a pending reload on teardown', async () => {
  const { owner: r } = owner(); await vi.dynamicImportSettled(); r.setPhase('water');
  const old = r.assets!.water.metadata, reload = f.register.mock.calls.at(-1)![0];
  f.setPhase.mockReturnValue({ ready: Promise.resolve(false), settled: Promise.resolve() });
  await expect(reload({ water: { id: 'failed' } }, () => {})).rejects.toThrow(/rest poses/);
  expect(r.assets!.water.metadata).toBe(old);
  expect(f.instances[1].detach).toHaveBeenCalledOnce();
  expect(f.instances[0].detach).not.toHaveBeenCalled();
  r.destroy();
});
