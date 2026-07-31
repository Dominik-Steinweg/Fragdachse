/// <reference types="vite/client" />

import type { LoadoutContentSource } from './LoadoutContentLoader';

const contentDocuments = import.meta.glob('./data/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

/** Vite is confined to this adapter; the loader itself only consumes unknown documents. */
export function getViteLoadoutContentSources(): readonly LoadoutContentSource[] {
  return Object.entries(contentDocuments).map(([sourceName, document]) => ({ sourceName, document }));
}

