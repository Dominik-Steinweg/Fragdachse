import { beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ setPhase: vi.fn(), detach: vi.fn(), clear: vi.fn(), destroy: vi.fn(), begin: vi.fn() }));
vi.mock('phaser', () => ({}));
vi.mock('../src/config/pipelineAssets', () => ({ PIPELINE_RUNTIME_ASSETS:
  ['', '-land', '-tentacle', '-egg'].map(suffix => ({ id: 'abyssal-kraken' + suffix, runtimeContract: 'boss', materialPass: {} })) }));
vi.mock('../src/effects/kraken/KrakenAssetResidency', () => ({ createKrakenResidencyPort: vi.fn(),
  KrakenAssetResidency: class { setPhase = f.setPhase; detach = f.detach; residentBytes = 0; reservedBytes = 0; errors = []; } }));
vi.mock('../src/effects/kraken/KrakenMeshCache', () => ({ KrakenMeshCache: class { clear = f.clear; destroy = f.destroy; bytes = 0; } }));
vi.mock('../src/effects/kraken/KrakenGpuBudget', () => ({ KrakenGpuBudget: class { begin = f.begin; retainedFilterBytes = 0; } }));
import { KrakenPresentationResidency } from '../src/effects/kraken/KrakenPresentationResidency';
beforeEach(() => vi.clearAllMocks());
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
