import { enableDevScenarioMode } from '../utils/devScenarioMode';
import { createMemoryStorage } from './scenario/memoryStorage';
import { installVisualTest } from './scenario/visualTest';

if (import.meta.env.DEV) {
  // Must precede ALL game imports: preference modules can read at module evaluation time.
  Object.defineProperty(window, 'localStorage', { value: createMemoryStorage() });
  Object.defineProperty(window, 'sessionStorage', { value: createMemoryStorage() });
  enableDevScenarioMode();
  installVisualTest();
  void import('../main');
} else {
  document.body.textContent = 'Dev-Szenarien sind nur im Entwicklungsserver verfügbar.';
}
