import { at, clone, set, stable, type Json, type JsonObject, type Path } from '../../shared/json';

interface Snapshot { document: JsonObject; keys: Record<string, string[]>; selection: string | null; label: string }
export interface LoadedMap { sourceKey: string; mapId: string; text: string; revision: string; document: JsonObject }

/** Owns authoring state only. Derived runtime data never enters the document. */
export class MapDocumentSession {
  draft: JsonObject;
  baseline: JsonObject;
  revision: string;
  originalText: string;
  selection: string | null = null;
  version = 0;
  readonly pending = new Set<string>();
  private keys: Record<string, string[]> = {};
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private nextKey = 0;
  private keyName(path: Path): string {
    let value: unknown = this.draft;
    return JSON.stringify(path.map(part => {
      const child = value && typeof value === 'object' ? (value as Record<string | number, unknown>)[part] : undefined;
      value = child;
      return typeof part === 'number' && child && typeof child === 'object' && 'id' in child ? `@${child.id}` : part;
    }));
  }
  constructor(readonly sourceKey: string, loaded: LoadedMap) {
    this.draft = clone(loaded.document); this.baseline = clone(loaded.document);
    this.revision = loaded.revision; this.originalText = loaded.text;
  }
  get dirty(): boolean { return stable(this.draft) !== stable(this.baseline); }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  key(path: Path, index: number): string {
    const name = this.keyName(path);
    const keys = this.keys[name] ??= [];
    while (keys.length <= index) keys.push(`item-${this.nextKey++}`);
    return keys[index];
  }
  private snapshot(label: string): Snapshot { return { document: clone(this.draft), keys: clone(this.keys), selection: this.selection, label }; }
  private restore(snapshot: Snapshot): void {
    this.draft = clone(snapshot.document); this.keys = clone(snapshot.keys); this.selection = snapshot.selection; this.version++;
  }
  transact(label: string, change: (draft: JsonObject) => void, keyChange?: () => void): void {
    const before = this.snapshot(label);
    const candidate = clone(this.draft);
    change(candidate);
    if (stable(candidate) === stable(this.draft)) return;
    this.past.push(before); this.future = []; this.draft = candidate; keyChange?.(); this.version++;
  }
  change(path: Path, value: Json | undefined, label = 'Eigenschaft ändern'): void {
    this.transact(label, d => set(d, path, value));
  }
  splice(path: Path, index: number, remove: number, values: Json[] = []): void {
    this.transact('Objektliste ändern', d => {
      const entries = (at(d, path) as Json[] | undefined) ?? [];
      entries.splice(index, remove, ...clone(values)); set(d, path, entries);
    }, () => this.keys[this.keyName(path)]?.splice(index, remove, ...values.map(() => `item-${this.nextKey++}`)));
  }
  undo(): void { const previous = this.past.pop(); if (previous) { this.future.push(this.snapshot(previous.label)); this.restore(previous); } }
  redo(): void { const next = this.future.pop(); if (next) { this.past.push(this.snapshot(next.label)); this.restore(next); } }
  acceptSaved(saved: LoadedMap): void {
    // A response acknowledges the sent snapshot, never any edits made while it was in flight.
    this.baseline = clone(saved.document); this.revision = saved.revision; this.originalText = saved.text;
  }
}
