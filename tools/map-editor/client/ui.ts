import type { MapDocumentSession } from './document/MapDocumentSession';
import { at, set, type Json, type Path } from '../shared/json';

export interface EditorEnvironment {
  session: MapDocumentSession;
  changed(): void;
  inputChanged?(): void;
  message(text: string): void;
  openMap(path: Path): void;
  buffers: Map<string, string>;
}
const committers = new WeakMap<HTMLElement, () => boolean>();
export function commitFocused(): boolean {
  const active = document.activeElement;
  return !(active instanceof HTMLElement) || (committers.get(active)?.() ?? true);
}
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(text: string, action: () => void, className = '', disabled = false, commit = true): HTMLButtonElement {
  const b = element('button', className, text); b.type = 'button'; b.disabled = disabled;
  // Keep the focused field alive until it has committed, even when a view is rebuilt.
  b.onpointerdown = event => event.preventDefault();
  b.onclick = () => { if (!commit || commitFocused()) action(); }; return b;
}
export function heading(text: string, detail?: string): HTMLElement {
  const h = element('div', 'section-heading'); h.append(element('h2', '', text));
  if (detail) h.append(element('p', 'muted', detail)); return h;
}
export function numberField(env: EditorEnvironment, label: string, path: Path, options: {
  fallback?: number; min?: number; max?: number; step?: number; scale?: number; optional?: boolean; disabled?: boolean;
  read?: number; write?: (value: number | undefined) => void;
} = {}): HTMLElement {
  const box = element('label', 'field'); const key = JSON.stringify(path);
  const raw = options.read ?? at(env.session.draft, path);
  const scale = options.scale ?? 1;
  const current = typeof raw === 'number' ? raw : options.fallback;
  box.append(element('span', '', label));
  const input = element('input'); input.type = 'number'; input.step = String(options.step ?? 1); input.disabled = options.disabled ?? false;
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  input.value = env.buffers.get(key) ?? (current === undefined ? '' : String(current / scale));
  input.setAttribute('aria-label', label);
  const hint = element('small', 'muted', raw === undefined ? `Standard${current !== undefined ? `: ${current / scale}` : ' – nicht gesetzt'}` : 'Explizit gesetzt');
  const commit = () => {
    if (!env.buffers.has(key)) return true;
    const value = input.valueAsNumber;
    const step = options.step ?? 1;
    const valid = input.value.trim() !== '' && Number.isFinite(value) && input.validity.valid
      && (step !== 1 || Number.isInteger(value)) && Number.isSafeInteger(Math.round(value * scale));
    if (!valid) { input.setCustomValidity('Gültigen Wert eingeben; Escape stellt den vorherigen Wert wieder her.'); input.reportValidity(); return false; }
    input.setCustomValidity(''); env.buffers.delete(key); env.session.pending.delete(key);
    if (options.write) options.write(value * scale); else env.session.change(path, value * scale, label);
    env.changed(); return true;
  };
  committers.set(input, commit);
  input.oninput = () => { input.setCustomValidity(''); env.buffers.set(key, input.value); env.session.pending.add(key); env.inputChanged?.(); };
  input.onchange = commit;
  input.onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { env.buffers.delete(key); env.session.pending.delete(key); input.setCustomValidity(''); env.changed(); }
  };
  box.append(input, hint);
  if (options.optional && raw !== undefined && !options.disabled) box.append(button('Standard', () => {
    env.buffers.delete(key); env.session.pending.delete(key);
    if (options.write) options.write(undefined); else env.session.change(path, undefined, `${label}: Standard`);
    env.changed();
  }, 'text-button'));
  return box;
}
export function selectField(label: string, value: string, values: readonly { value: string; label: string; disabled?: boolean }[], change: (value: string) => void): HTMLElement {
  const box = element('label', 'field'); box.append(element('span', '', label));
  const select = element('select'); select.setAttribute('aria-label', label);
  for (const entry of values) { const option = element('option', '', entry.label); option.value = entry.value; option.disabled = entry.disabled ?? false; select.append(option); }
  select.value = value;
  select.onchange = () => change(select.value); box.append(select); return box;
}
export function propertySelect(env: EditorEnvironment, label: string, path: Path, fallback: string, values: readonly string[]): HTMLElement {
  return selectField(label, String(at(env.session.draft, path) ?? fallback), values.map(v => ({ value: v, label: v })), value => {
    env.session.transact(label, draft => set(draft, path, value as Json)); env.changed();
  });
}
export function confirmEdit(message: string): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = element('dialog', 'confirmation'); dialog.setAttribute('aria-label', 'Änderung bestätigen');
    const finish = (accepted: boolean) => { dialog.close(); dialog.remove(); resolve(accepted); };
    const actions = element('div', 'toolbar');
    const cancel = button('Abbrechen', () => finish(false), '', false, false);
    actions.append(cancel, button('Übernehmen', () => finish(true), 'primary', false, false));
    dialog.append(heading('Änderung bestätigen'), element('p', 'confirmation-message', message), actions);
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
    document.body.append(dialog); dialog.showModal(); cancel.focus();
  });
}
