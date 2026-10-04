import { at, set, stable, type Json, type JsonObject } from '../../map-editor/shared/json';
import type { Entry, Field, Workspace } from '../shared/types';

export class BalanceSession {
  readonly initial: Workspace;
  readonly drafts = new Map<string, JsonObject>();
  private past: { file: string; before: JsonObject; after: JsonObject }[] = [];
  private future: typeof this.past = [];
  constructor(public workspace: Workspace) { this.initial = structuredClone(workspace); }
  document(file: string): JsonObject { return this.drafts.get(file) ?? this.workspace.files.find(f => f.key === file)!.document; }
  dirty(file: string): boolean { return stable(this.document(file)) !== stable(this.workspace.files.find(f => f.key === file)!.document); }
  get dirtyFiles(): string[] { return this.workspace.files.filter(f => this.dirty(f.key)).map(f => f.key); }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  value(entry: Entry, field: Field): Json { return at(this.document(entry.file), field.path) ?? field.value; }
  edit(entry: Entry, field: Field, value: Json): void {
    const before = structuredClone(this.document(entry.file)), after = structuredClone(before);
    // An inherited array must remain a complete replacement, including its readonly leaves.
    const index = field.path.findIndex((p, i) => typeof p === 'number' && at(after, field.path.slice(0, i)) === undefined);
    if (index >= 0) for (const sibling of entry.fields.filter(f => stable(f.path.slice(0, index)) === stable(field.path.slice(0, index)))) {
      set(after, sibling.path, structuredClone(sibling.value));
    }
    set(after, field.path, value);
    if (stable(before) === stable(after)) return;
    this.past.push({ file: entry.file, before, after });
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.drafts.set(entry.file, after);
  }
  undo(): void { const change = this.past.pop(); if (change) { this.drafts.set(change.file, change.before); this.future.push(change); } }
  redo(): void { const change = this.future.pop(); if (change) { this.drafts.set(change.file, change.after); this.past.push(change); } }
  accept(file: string, workspace: Workspace): void {
    this.workspace.files = this.workspace.files.map(f => f.key === file ? workspace.files.find(saved => saved.key === file)! : f);
    this.workspace.entries = workspace.entries;
    this.drafts.delete(file);
  }
}
