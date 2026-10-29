import { describe, expect, it } from 'vitest';
import {
  immutableCacheName, isImmutableCacheOf, routeRequest, staleCacheEntries, type RoutedRequest,
} from '../src/serviceWorker/serviceWorkerPolicy';

const ROOT = 'https://example.github.io/Fragdachse/';
const CURRENT = `${ROOT}current/`;
const SHA = 'a'.repeat(64);
const BUILD_FILES = new Set(['assets/index-Cq5bFo1D.js', 'assets/FlowFieldWorker-Cj1y241X.js']);

const request = (url: string, init: Partial<RoutedRequest> & { range?: boolean } = {}): RoutedRequest => ({
  url, method: init.method ?? 'GET', mode: init.mode ?? 'no-cors', cache: init.cache ?? 'default',
  headers: { has: name => name === 'range' && init.range === true },
});

describe('service worker request routing', () => {
  it('serves only content-addressed files of its own deployment from the cache', () => {
    for (const path of [`assets/sprites/rock_base.webp?v=${SHA}`, 'assets/index-Cq5bFo1D.js', 'assets/FlowFieldWorker-Cj1y241X.js']) {
      expect(routeRequest(request(ROOT + path), ROOT, BUILD_FILES), path).toBe('immutable');
    }
    for (const path of [
      'index.html', 'voice-deletions.json', 'service-worker-manifest.json', 'assets/sprites/rock_base.webp',
      `assets/sprites/rock_base.webp?v=${SHA.slice(1)}`, `assets/sprites/rock_base.webp?v=${SHA}&x=1`,
      'assets/index-Cq5bFo1D.js.map', 'assets/index-OldBuild.js',
    ]) expect(routeRequest(request(ROOT + path), ROOT, BUILD_FILES), path).toBe('network');
  });

  it('leaves a nested deployment and other origins to their own workers', () => {
    expect(routeRequest(request(`${CURRENT}assets/a.png?v=${SHA}`), ROOT, BUILD_FILES)).toBe('network');
    expect(routeRequest(request(`${CURRENT}assets/index-Cq5bFo1D.js`), ROOT, BUILD_FILES)).toBe('network');
    expect(routeRequest(request(`${CURRENT}assets/a.png?v=${SHA}`), CURRENT, BUILD_FILES)).toBe('immutable');
    expect(routeRequest(request(`${ROOT}assets/a.png?v=${SHA}`), CURRENT, BUILD_FILES)).toBe('network');
    expect(routeRequest(request(`https://0.peerjs.com/Fragdachse/assets/a.png?v=${SHA}`), ROOT, BUILD_FILES)).toBe('network');
  });

  it('passes navigations, writes, partial and cache-only requests through', () => {
    expect(routeRequest(request(`${ROOT}#r=ABC123`, { mode: 'navigate' }), ROOT, BUILD_FILES)).toBe('navigation');
    const asset = `${ROOT}assets/a.ogg?v=${SHA}`;
    expect(routeRequest(request(asset, { method: 'POST' }), ROOT, BUILD_FILES)).toBe('network');
    expect(routeRequest(request(asset, { range: true }), ROOT, BUILD_FILES)).toBe('network');
    expect(routeRequest(request(asset, { cache: 'only-if-cached' }), ROOT, BUILD_FILES)).toBe('network');
    expect(routeRequest(request(asset, { cache: 'only-if-cached', mode: 'same-origin' }), ROOT, BUILD_FILES)).toBe('immutable');
  });
});

describe('service worker caches', () => {
  it('keeps one cache per deployment folder and never claims another folder\'s cache', () => {
    expect(immutableCacheName(ROOT)).not.toBe(immutableCacheName(CURRENT));
    expect(isImmutableCacheOf(immutableCacheName(ROOT), ROOT)).toBe(true);
    expect(isImmutableCacheOf('fragdachse-immutable-v0:' + ROOT, ROOT)).toBe(true);
    expect(isImmutableCacheOf(immutableCacheName(CURRENT), ROOT)).toBe(false);
    expect(isImmutableCacheOf(immutableCacheName(ROOT), CURRENT)).toBe(false);
    expect(isImmutableCacheOf('other-cache:' + ROOT, ROOT)).toBe(false);
  });

  it('drops exactly the entries a new build no longer ships', () => {
    const kept = [`${ROOT}assets/a.png?v=${SHA}`, `${ROOT}assets/index-Cq5bFo1D.js`];
    const stale = [`${ROOT}assets/a.png?v=${'b'.repeat(64)}`, `${ROOT}assets/index-OldBuild.js`];
    const manifest = { version: 'x', urls: [`assets/a.png?v=${SHA}`, 'assets/index-Cq5bFo1D.js', 'assets/new.png?v=' + SHA] };
    expect(staleCacheEntries([...kept, ...stale], manifest, ROOT)).toEqual(stale);
  });
});
