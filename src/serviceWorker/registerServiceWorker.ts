/**
 * Loaded from index.html next to the game entry. Production builds register the worker of their own
 * deployment folder (`./service-worker.js`, scope `./`). Every other build of this page – dev server,
 * performance lab – removes one left on its origin, so HMR and measurements never run through it.
 * Nothing here may fail or delay the boot; the room hash in the URL is never touched.
 */
import { ADOPT_LOADED_MESSAGE, SERVICE_WORKER_SCRIPT, isImmutableCacheOf } from './serviceWorkerPolicy';

/** Requests still running when the worker takes over finish later, outside of it. */
const ADOPTION_WINDOW_MS = 60_000;

try {
  if ('serviceWorker' in navigator) {
    const container = navigator.serviceWorker;
    if (import.meta.env.PROD && !__PERFORMANCE_LAB__) register(container);
    else void unregisterStale(container).catch(() => undefined);
  }
} catch (error) {
  // Storage-restricted contexts can throw on access; the game runs without a worker.
  console.warn('[ServiceWorker] unavailable', error);
}

function register(container: ServiceWorkerContainer): void {
  container.addEventListener('controllerchange', () => adoptLoadedResources(container));
  container.register(SERVICE_WORKER_SCRIPT, { scope: './' }).catch((error: unknown) => {
    console.warn('[ServiceWorker] registration failed', error);
  });
}

/**
 * A worker that just took over (first visit, or a new build replacing the old worker) has not seen
 * what this page already loaded. It copies the hashed files among these URLs from the HTTP cache,
 * so the next visit needs none of them from the network.
 */
function adoptLoadedResources(container: ServiceWorkerContainer): void {
  const send = (entries: PerformanceEntryList): void => {
    const urls = entries.map(entry => entry.name).filter(url => url.startsWith(location.origin + '/'));
    if (urls.length > 0) container.controller?.postMessage({ type: ADOPT_LOADED_MESSAGE, urls });
  };
  try {
    send(performance.getEntriesByType('resource'));
    const observer = new PerformanceObserver(list => send(
      list.getEntries().filter(entry => (entry as PerformanceResourceTiming).workerStart === 0)));
    observer.observe({ type: 'resource' });
    setTimeout(() => observer.disconnect(), ADOPTION_WINDOW_MS);
  } catch (error) {
    console.warn('[ServiceWorker] adoption skipped', error);
  }
}

async function unregisterStale(container: ServiceWorkerContainer): Promise<void> {
  const registration = await container.getRegistration('./');
  const script = (registration?.active ?? registration?.waiting ?? registration?.installing)?.scriptURL;
  if (!registration || !script || new URL(script).href !== new URL(SERVICE_WORKER_SCRIPT, location.href).href) return;
  await registration.unregister();
  for (const name of await caches.keys()) {
    if (isImmutableCacheOf(name, registration.scope)) await caches.delete(name);
  }
}
