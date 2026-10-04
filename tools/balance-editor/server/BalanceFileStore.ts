import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, realpath, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { updateJsonText } from '../../map-editor/server/jsonText';
import { stable, type JsonObject } from '../../map-editor/shared/json';
import { LOADOUT_DIRECTORY, RULE_FILES, UPGRADE_FILE, type BalanceFile, type Workspace } from '../shared/types';
import type * as Content from '../shared/content';

export class BalanceConflict extends Error {}
type Rules = Pick<typeof Content, 'buildWorkspace' | 'assertSupportedEdit'>;
const revisionOf = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export class BalanceFileStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string, private readonly rules: () => Promise<Rules>, private readonly replace = rename) {}

  private async keys(): Promise<string[]> {
    return [...(await readdir(resolve(this.root, LOADOUT_DIRECTORY))).filter(f => /^[\w-]+\.json$/.test(f)).sort().map(f => `${LOADOUT_DIRECTORY}/${f}`), UPGRADE_FILE, ...RULE_FILES];
  }
  private async path(key: string): Promise<string> {
    if (!(await this.keys()).includes(key)) throw Error('Unbekannte Balance-Datei.');
    const root = await realpath(this.root);
    const directory = key.startsWith(LOADOUT_DIRECTORY + '/') ? LOADOUT_DIRECTORY : 'src/config';
    const path = await realpath(resolve(root, key));
    // Refuse junctions/symlinks out of this checkout, including parent directories.
    if (dirname(path) !== resolve(root, directory)) throw Error('Quelldatei liegt außerhalb des Content-Ordners.');
    return path;
  }
  private async read(key: string): Promise<BalanceFile & { text: string }> {
    const bytes = await readFile(await this.path(key));
    const text = bytes.toString('utf8');
    return { key, text, document: JSON.parse(text.replace(/^\uFEFF/, '')), revision: revisionOf(bytes) };
  }
  private async files(): Promise<BalanceFile[]> {
    return Promise.all((await this.keys()).map(async key => { const { text: _, ...file } = await this.read(key); return file; }));
  }
  async load(): Promise<Workspace> { return (await this.rules()).buildWorkspace(await this.files()); }

  async validate(drafts: { key: string; document: JsonObject }[]): Promise<Workspace> {
    const rules = await this.rules();
    const workspace = rules.buildWorkspace(await this.files());
    const seen = new Set<string>();
    for (const draft of drafts) {
      if (!workspace.files.some(f => f.key === draft.key) || seen.has(draft.key)) throw Error('Unbekannte oder doppelte Datei.');
      seen.add(draft.key);
      rules.assertSupportedEdit(workspace, draft.key, draft.document);
    }
    return rules.buildWorkspace(workspace.files.map(f => ({ ...f, document: drafts.find(d => d.key === f.key)?.document ?? f.document })));
  }

  save(key: string, revision: string, document: JsonObject): Promise<Workspace> {
    const task = this.pending.catch(() => {}).then(() => this.write(key, revision, document));
    this.pending = task;
    return task;
  }
  private async write(key: string, revision: string, document: JsonObject): Promise<Workspace> {
    const current = await this.read(key);
    if (current.revision !== revision) throw new BalanceConflict('Datei extern geändert. Entwurf exportieren und neu laden; nichts wurde überschrieben.');
    const rules = await this.rules();
    const files = await this.files();
    if (files.find(f => f.key === key)?.revision !== revision) throw new BalanceConflict('Datei während des Ladens extern geändert. Bitte neu laden.');
    const workspace = rules.buildWorkspace(files);
    rules.assertSupportedEdit(workspace, key, document);
    const candidate = rules.buildWorkspace(files.map(f => f.key === key ? { ...f, document } : f));
    if (stable(current.document) === stable(document)) return workspace;
    const text = updateJsonText(current.text, document);
    const path = await this.path(key);
    const temporary = join(dirname(path), `.balance-editor-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, 'wx');
      try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      const latest = await this.files();
      if (latest.length !== files.length || files.some(file => latest.find(f => f.key === file.key)?.revision !== file.revision)) {
        throw new BalanceConflict('Content während der Prüfung extern geändert. Bitte neu laden.');
      }
      // Each save replaces exactly one authored file; no partially committed multi-file batch.
      await this.replace(temporary, path);
      candidate.files.find(f => f.key === key)!.revision = revisionOf(text);
      return candidate;
    } finally { await unlink(temporary).catch(() => {}); }
  }
}
