/**
 * Shared by the service worker (`serviceWorker.ts`), its registration and the build
 * (`scripts/service-worker-build.ts`). The worker serves only URLs whose bytes can never change from
 * its cache: published assets carry `?v=<sha256 of the bytes>` (scripts/lib/runtime-asset-urls.mjs)
 * and Vite names its chunks by content hash. HTML and every other URL stay with the network.
 */

/** Deployment-relative worker script. Its folder is the scope, so root, current/ and next/ each get their own worker. */
export const SERVICE_WORKER_SCRIPT = 'service-worker.js';
/** Deployment-relative list of every hashed URL a build ships; read when a new worker activates. */
export const SERVICE_WORKER_MANIFEST = 'service-worker-manifest.json';
/** Page -> worker: same-origin URLs the page loaded before this worker controlled it. */
export const ADOPT_LOADED_MESSAGE = 'fragdachse:adopt-loaded';

export interface ServiceWorkerManifest {
  /** Inlined into the worker script; a manifest of another build is never trusted. */
  readonly version: string;
  /** Deployment-relative, e.g. `assets/sprites/x.webp?v=<sha256>` or `assets/index-<hash>.js`. */
  readonly urls: readonly string[];
}

const CACHE_NAME = /^fragdachse-immutable-v\d+:(.+)$/;
const CACHE_SCHEMA = 1;

/** One cache per deployment folder. They share the origin, so the scope URL keeps them apart. */
export function immutableCacheName(scope: string): string {
  return `fragdachse-immutable-v${CACHE_SCHEMA}:${scope}`;
}

/** This scope's caches of any schema version; another deployment's caches never match. */
export function isImmutableCacheOf(name: string, scope: string): boolean {
  return CACHE_NAME.exec(name)?.[1] === scope;
}

/** A published asset whose query is the SHA-256 of its bytes. */
const VERSIONED_ASSET = /^assets\/[^?#]+\?v=[0-9a-f]{64}$/;

/** Path and query relative to the deployment folder, or `undefined` outside it. */
export function deploymentPath(url: string, base: string): string | undefined {
  const target = new URL(url), root = new URL(base);
  if (target.origin !== root.origin || !target.pathname.startsWith(root.pathname)) return undefined;
  return target.pathname.slice(root.pathname.length) + target.search;
}

/**
 * Only this deployment's own hashed files. Another folder on the same origin (current/ below the root
 * build) has its own worker and cache, so its URLs are never immutable here.
 */
export function isImmutableUrl(url: string, base: string, buildFiles: ReadonlySet<string>): boolean {
  const path = deploymentPath(url, base);
  return path !== undefined && (VERSIONED_ASSET.test(path) || buildFiles.has(path));
}

export type RequestRoute = 'immutable' | 'navigation' | 'network';

export interface RoutedRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  readonly cache: string;
  readonly headers: { has(name: string): boolean };
}

/** `network` means the worker does not answer at all; the browser fetches as without a worker. */
export function routeRequest(request: RoutedRequest, base: string, buildFiles: ReadonlySet<string>): RequestRoute {
  if (request.method !== 'GET') return 'network';
  if (request.mode === 'navigate') return 'navigation';
  // The Cache API stores no partial responses. fetch() rejects only-if-cached outside same-origin mode.
  if (request.headers.has('range') || request.cache === 'only-if-cached' && request.mode !== 'same-origin') return 'network';
  return isImmutableUrl(request.url, base, buildFiles) ? 'immutable' : 'network';
}

/** Cached URLs the manifest no longer lists. */
export function staleCacheEntries(cached: readonly string[], manifest: ServiceWorkerManifest, base: string): string[] {
  const keep = new Set(manifest.urls.map(url => new URL(url, base).href));
  return cached.filter(url => !keep.has(url));
}
