import { enableDevScenarioMode } from '../utils/devScenarioMode';
import { createMemoryStorage } from './scenario/memoryStorage';
import { installVisualTest } from './scenario/visualTest';

if (import.meta.env.DEV) {
  // Must precede ALL game imports: preference modules can read at module evaluation time.
  Object.defineProperty(window, 'localStorage', { value: createMemoryStorage() });
  Object.defineProperty(window, 'sessionStorage', { value: createMemoryStorage() });
  enableDevScenarioMode();
  installVisualTest();
  const quality = new URLSearchParams(location.search).get('quality');
  if (quality === 'high' || quality === 'medium' || quality === 'low') {
    // Use the ordinary preference decoder before Scene creation and warmup.
    // Storage is private to this diagnostic page, never the player's settings.
    void import('../utils/localPreferences').then(({ setStoredGraphicsQuality }) => {
      setStoredGraphicsQuality(quality);
      return import('../main');
    });
  } else {
    void import('../main');
  }
} else {
  document.body.textContent = 'Dev-Szenarien sind nur im Entwicklungsserver verfügbar.';
}
