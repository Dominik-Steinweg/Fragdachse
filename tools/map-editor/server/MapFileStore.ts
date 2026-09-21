import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, join } from 'node:path';
import { updateJsonText } from './jsonText';
import { assertSupportedMapEdit } from '../shared/editPolicy';
import { stable, type JsonObject } from '../shared/json';
import type { LoadedMap } from '../client/document/MapDocumentSession';
import type { Validation } from '../shared/validation';

export class FileConflict extends Error { readonly status = 409; }
export class MapFileStore {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(
    readonly directory: string,
    readonly sources: readonly { file: string; mapId: string }[],
    private readonly validate: (document: JsonObject) => Validation | Promise<Validation>,
    private readonly replaceFile: typeof rename = rename,
    private readonly checkEdit: (before: JsonObject, after: JsonObject) => void | Promise<void> = assertSupportedMapEdit,
  ) {}
  private async file(key: string): Promise<{ path: string; mapId: string }> {
    const source = this.sources.find(s => s.file === key);
    if (!source) throw Error('Unbekannte Map-Datei.');
    const root = await realpath(this.directory);
    const path = await realpath(resolve(root, source.file));
    const local = relative(root, path);
    if (local.startsWith('..') || isAbsolute(local) || dirname(path) !== root) throw Error('Datei liegt außerhalb des Map-Ordners.');
    return { path, mapId: source.mapId };
  }
  async load(key: string): Promise<LoadedMap> {
    const { path, mapId } = await this.file(key);
    const bytes = await readFile(path);
    const text = bytes.toString('utf8');
    const document = JSON.parse(text.replace(/^\uFEFF/, '')) as JsonObject;
    if (document.mapId !== mapId) throw Error('Map-ID entspricht nicht dem Quellkatalog.');
    return { sourceKey: key, mapId, text, document, revision: createHash('sha256').update(bytes).digest('hex') };
  }
  async save(key: string, revision: string, document: JsonObject): Promise<LoadedMap> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() => this.write(key, revision, document));
    this.pending.set(key, task);
    try { return await task; } finally { if (this.pending.get(key) === task) this.pending.delete(key); }
  }
  private async write(key: string, revision: string, document: JsonObject): Promise<LoadedMap> {
    let current: LoadedMap;
    try { current = await this.load(key); } catch { throw new FileConflict('Quelldatei ist nicht mehr lesbar. Entwurf sichern und Datei prüfen.'); }
    if (current.revision !== revision) throw new FileConflict('Die Datei wurde außerhalb des Editors geändert. Entwurf sichern oder bewusst neu laden.');
    if (stable(current.document) === stable(document)) return current;
    await this.checkEdit(current.document, document);
    const result = await this.validate(document);
    const errors = result.issues.filter(i => i.severity === 'error');
    if (!result.normalized || errors.length) throw Error(errors.map(i => `${i.path}: ${i.message}`).join('\n') || 'Ungültiger Entwurf');
    const text = updateJsonText(current.text, document);
    const { path } = await this.file(key);
    const temporary = join(dirname(path), `.map-editor-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, 'wx');
      try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      const latest = await this.load(key);
      if (latest.revision !== revision) throw new FileConflict('Die Datei hat sich während des Speicherns geändert.');
      await this.replaceFile(temporary, path);
      return { ...current, text, document: structuredClone(document), revision: createHash('sha256').update(text).digest('hex') };
    } finally { await unlink(temporary).catch(() => {}); }
  }
}
