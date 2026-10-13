import { createMemoryStorage } from './scenario/memoryStorage';
if (import.meta.env.DEV) {
  Object.defineProperty(window, 'localStorage', { value: createMemoryStorage() });
  Object.defineProperty(window, 'sessionStorage', { value: createMemoryStorage() });
  void import('./markerReviewScene');
} else document.body.textContent = 'Marker-Review ist nur im Entwicklungsserver verfügbar.';
