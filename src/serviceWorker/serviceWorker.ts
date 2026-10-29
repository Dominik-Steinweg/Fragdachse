/**
 * Service worker of one deployment folder, bundled by scripts/service-worker-build.ts into
 * `service-worker.js` next to index.html. Hashed files are served cache-first, navigations go to the
 * network through navigation preload, everything else is not answered here. No offline mode.
 */
import {
  ADOPT_LOADED_MESSAGE, SERVICE_WORKER_MANIFEST, immutableCacheName, isImmutableCacheOf, isImmutableUrl,
  routeRequest, staleCacheEntries, type ServiceWorkerManifest,
} from './serviceWorkerPolicy';

/** Inlined by the build: this build's hashed Vite outputs and the version of its manifest. */
declare const __SERVICE_WORKER_BUILD_FILES__: readonly string[];
declare const __SERVICE_WORKER_MANIFEST_VERSION__: string;

// The project compiles against the DOM library; these are the worker-scope members in use.
interface ExtendableEvent extends Event { waitUntil(promise: Promise<unknown>): void }
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  readonly preloadResponse: Promise<Response | undefined>;
  respondWith(response: Promise<Response>): void;
}
interface ExtendableMessageEvent extends ExtendableEvent { readonly data: unknown }
interface WorkerScope {
  readonly location: { readonly href: string };
  readonly registration: ServiceWorkerRegistration;
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: ExtendableMessageEvent) => void): void;
}

const worker = self as unknown as WorkerScope;
const base = new URL('./', worker.location.href).href;
const scope = worker.registration.scope;
const cacheName = immutableCacheName(scope);
const buildFiles: ReadonlySet<string> = new Set(__SERVICE_WORKER_BUILD_FILES__);
let pendingPrune: Promise<void> | undefined;

// Hashed URLs of two builds never collide, so a new worker may take over open pages at once.
worker.addEventListener('install', event => event.waitUntil(worker.skipWaiting()));

worker.addEventListener('activate', event => {
  event.waitUntil(Promise.all([worker.clients.claim(), worker.registration.navigationPreload?.enable()]));
  // Pruning downloads the manifest. Inside activate's waitUntil every fetch of the controlled pages
  // would wait for it, so the next fetch event keeps the worker alive for it instead.
  pendingPrune = prune().catch(() => undefined);
});

worker.addEventListener('fetch', event => {
  if (pendingPrune) { event.waitUntil(pendingPrune); pendingPrune = undefined; }
  const route = routeRequest(event.request, base, buildFiles);
  if (route === 'immutable') event.respondWith(cacheFirst(event));
  else if (route === 'navigation') event.respondWith(navigate(event));
});

worker.addEventListener('message', event => {
  const data = event.data as { type?: unknown; urls?: unknown } | null;
  if (data?.type !== ADOPT_LOADED_MESSAGE || !Array.isArray(data.urls)) return;
  event.waitUntil(adoptLoaded(data.urls.filter((url): url is string => typeof url === 'string')).catch(() => undefined));
});

const cacheable = (response: Response): boolean =>
  response.status === 200 && response.type === 'basic' && !response.redirected;

async function cacheFirst(event: FetchEvent): Promise<Response> {
  // Storage can be unavailable (quota, privacy modes); the request then behaves as without a worker.
  const cache = await caches.open(cacheName).catch(() => undefined);
  const cached = await cache?.match(event.request, { ignoreVary: true }).catch(() => undefined);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (cache && cacheable(response)) event.waitUntil(cache.put(event.request, response.clone()).catch(() => undefined));
  return response;
}

async function navigate(event: FetchEvent): Promise<Response> {
  return (await event.preloadResponse) ?? fetch(event.request);
}

/**
 * Takes over hashed files the page loaded before this worker controlled it (first visit, or a new
 * build replacing the old worker). `only-if-cached` copies them from the HTTP cache without a download.
 */
async function adoptLoaded(urls: readonly string[]): Promise<void> {
  const cache = await caches.open(cacheName);
  for (const url of new Set(urls)) {
    if (!isImmutableUrl(url, base, buildFiles) || await cache.match(url, { ignoreVary: true })) continue;
    const response = await fetch(url, { cache: 'only-if-cached', mode: 'same-origin' }).catch(() => undefined);
    if (response && cacheable(response)) await cache.put(url, response);
  }
}

/** Removes this scope's entries the new build no longer ships, and caches of older schema versions. */
async function prune(): Promise<void> {
  for (const name of await caches.keys()) {
    if (name !== cacheName && isImmutableCacheOf(name, scope)) await caches.delete(name);
  }
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length === 0) return; // A first install has nothing to prune; skip the download.
  const version = __SERVICE_WORKER_MANIFEST_VERSION__;
  const response = await fetch(new URL(`${SERVICE_WORKER_MANIFEST}?v=${version}`, base), { cache: 'no-cache' });
  if (!response.ok) return;
  const manifest = await response.json() as ServiceWorkerManifest;
  if (manifest.version !== version) return;
  await Promise.all(staleCacheEntries(keys.map(request => request.url), manifest, base).map(url => cache.delete(url)));
}
