import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/utils/devScenarioMode', () => ({ isDevScenarioMode: () => false }));
import { isLocalScenarioSessionRequested } from '../src/network/peer/LocalScenarioSession';
afterEach(() => vi.unstubAllGlobals());
it('requires both a lab build and an explicit local host request', () => {
  vi.stubGlobal('window', { __FD_PERF_REQUEST__: { localHost: true } });
  vi.stubGlobal('__PERFORMANCE_LAB__', false);
  expect(isLocalScenarioSessionRequested()).toBe(false);
  vi.stubGlobal('__PERFORMANCE_LAB__', true);
  expect(isLocalScenarioSessionRequested()).toBe(true);
  vi.stubGlobal('window', { __FD_PERF_REQUEST__: {} });
  expect(isLocalScenarioSessionRequested()).toBe(false);
  vi.stubGlobal('window', {});
  expect(isLocalScenarioSessionRequested()).toBe(false);
});
