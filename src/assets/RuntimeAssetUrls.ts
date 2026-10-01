import type * as Phaser from 'phaser';
import urls from './runtimeAssetUrls.json';

const manifest: Readonly<Record<string, string>> = urls;
/** Authored logical paths stay stable; published bytes own the cache version. */
export function runtimeAssetUrl(url: string): string {
  const path = url.split(/[?#]/, 1)[0];
  const key = path.replace(/^\.\//, '').replace(/^\//, '');
  const versioned = manifest[key];
  if (!versioned) return url; // External/data/blob URLs and unregistered tool assets stay untouched.
  return (path.startsWith('/') ? '/' : './') + versioned;
}

const versionFile = (_key: string, _type: string, _loader: unknown, file: Phaser.Loader.File): void => {
  if (typeof file.url === 'string') file.url = runtimeAssetUrl(file.url);
};
/** ADD fires before File.load resolves src, also for deferred and multi-file children. */
export function installRuntimeAssetUrls(loader: Phaser.Loader.LoaderPlugin): void {
  // Loader shutdown removes listeners. Rebind on preload, including a Scene restart/retry.
  loader.off('addfile', versionFile);
  loader.on('addfile', versionFile);
}
