export type Json = null | boolean | number | string | Json[] | JsonObject;
export interface JsonObject { [key: string]: Json | undefined }
export type Path = (string | number)[];
export const clone = <T>(value: T): T => structuredClone(value);
export const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
export const array = (value: unknown): JsonObject[] => Array.isArray(value) ? value as JsonObject[] : [];
export function at(root: JsonObject, path: Path): Json | undefined {
  let value: unknown = root;
  for (const key of path) value = value && typeof value === 'object' ? (value as Record<string | number, unknown>)[key] : undefined;
  return value as Json | undefined;
}
export function set(root: JsonObject, path: Path, value: Json | undefined): void {
  if (!path.length || path.some(p => ['__proto__', 'prototype', 'constructor'].includes(String(p)))) throw Error('Ungültiger Dokumentpfad');
  let target: Record<string | number, unknown> = root;
  path.slice(0, -1).forEach((key, i) => {
    if (target[key] === undefined) target[key] = typeof path[i + 1] === 'number' ? [] : {};
    target = target[key] as Record<string | number, unknown>;
  });
  const key = path[path.length - 1];
  if (value === undefined) delete target[key]; else target[key] = value;
}
export function stable(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as JsonObject)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const pointer = (path: Path): string => '/' + path.map(p => String(p).replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
export const pathFromPointer = (path: string): Path => path.split('/').slice(1).map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'));
export function uniqueId(entries: JsonObject[], prefix: string): string {
  const ids = new Set(entries.map(e => e.id));
  let n = 1;
  while (ids.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}
