import './style.css';
import { at, stable } from '../../map-editor/shared/json';
import type { Entry, Field, Workspace } from '../shared/types';
import { BalanceSession } from './BalanceSession';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
};
const button = (text: string, action: () => void, className = '') => { const node = el('button', className, text); node.onclick = action; return node; };
const input = (label: string, placeholder: string) => { const node = el('input'); node.type = 'search'; node.placeholder = placeholder; node.setAttribute('aria-label', label); return node; };
const select = (label: string, options: [string, string][]) => {
  const node = el('select'); node.setAttribute('aria-label', label);
  options.forEach(([value, label]) => { const option = el('option', '', label); option.value = value; node.append(option); }); return node;
};
const kinds: Record<Entry['kind'], string> = { weapon: 'Waffen', utility: 'Utilities', ultimate: 'Ultimates', upgrade: 'Upgrades', catalog: 'Katalog', rules: 'Konstruktionsregeln' };
const app = document.querySelector<HTMLDivElement>('#app')!;
const header = el('header'), brand = el('div', 'brand'); brand.append(el('strong', '', 'FRAGDACHSE'), el('span', '', 'BALANCE EDITOR'));
const status = el('span', 'status', 'Lade Content …'); status.setAttribute('role', 'status');
const undo = button('↶ Rückgängig', () => history(false)), redo = button('↷ Wiederholen', () => history(true));
const save = button('Datei speichern', () => void saveFile(), 'primary');
header.append(brand, status, undo, redo, save, button('Neu laden', () => void load(true)), button('Entwurf exportieren', exportDraft));
const main = el('main'), sidebar = el('aside', 'sidebar'), editor = el('section', 'editor'), changes = el('aside', 'changes');
const search = input('Einträge suchen', 'Name, ID oder Wert suchen …');
const kind = select('Typ filtern', [['', 'Alle Typen'], ...Object.entries(kinds)]);
const category = select('Kategorie filtern', [['', 'Alle Kategorien']]);
const changedOnly = el('input'); changedOnly.type = 'checkbox';
const changedLabel = el('label', 'check'); changedLabel.append(changedOnly, document.createTextNode('Nur geändert'));
const count = el('p', 'muted'), list = el('div', 'entry-list');
sidebar.append(el('p', 'eyebrow', 'CONTENT-BIBLIOTHEK'), search, kind, category, changedLabel, count, list);
const title = el('h1'), context = el('p', 'context'), metrics = el('div', 'metrics'), fieldSearch = input('Felder suchen', 'Feld filtern, z. B. damage, cooldown, fire …');
const fields = el('div', 'fields'), diagnostics = el('pre', 'diagnostics'); diagnostics.setAttribute('role', 'alert'); diagnostics.hidden = true;
editor.append(el('p', 'eyebrow', 'WERTE & HERKUNFT'), title, context, metrics, fieldSearch, diagnostics, fields);
const changesTitle = el('h2', '', 'Änderungsliste'), changesHint = el('p', 'muted', 'Vergleich mit der Datei auf Disk. Gespeichert wird die Datei des ausgewählten Eintrags.'), changeList = el('div');
changes.append(changesTitle, changesHint, changeList);
main.append(sidebar, editor, changes); app.append(header, main);

let session: BalanceSession | undefined, selected = '', token = '', busy = false, validationVersion = 0, timer: ReturnType<typeof setTimeout> | undefined;
let valid = true;
const buffers = new Map<string, string>();
const bufferKey = (entry: Entry, field: Field) => `${entry.file}:${JSON.stringify(field.path)}`;
const current = () => session?.workspace.entries.find(e => e.key === selected);
const format = (value: unknown) => value === undefined ? 'nicht authored' : typeof value === 'string' ? value : JSON.stringify(value);

async function api<T>(route: string, payload?: unknown): Promise<T> {
  const response = await fetch(`/api/balance/${route}`, payload === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-balance-editor-token': token }, body: JSON.stringify(payload),
  });
  const data = await response.json(); if (!response.ok) throw Error(data.error ?? `HTTP ${response.status}`); return data;
}
function message(text = ''): void { diagnostics.textContent = text; diagnostics.hidden = !text; }
async function load(reload = false): Promise<void> {
  if (busy) return;
  if (reload && (session?.dirtyFiles.length || buffers.size) && !window.confirm('Ungespeicherte Änderungen verwerfen und Dateien neu laden?')) return;
  busy = true; validationVersion++; clearTimeout(timer); renderStatus();
  try {
    token = (await api<{ token: string }>('session')).token;
    session = new BalanceSession(await api<Workspace>('workspace')); buffers.clear(); valid = true;
    if (!current()) selected = session.workspace.entries[0]?.key ?? '';
    const categories = [...new Set(session.workspace.entries.map(e => e.category))].sort();
    category.replaceChildren(...select('', [['', 'Alle Kategorien'], ...categories.map(c => [c, c] as [string, string])]).children);
    category.value = '';
    message(); status.textContent = 'Content geladen'; render();
  } catch (error) { message(`${error}\nStart: npm run balance:editor (Speichern nur am lokalen Dev-Server).`); }
  finally { busy = false; renderStatus(); }
}
function changedFields(entry: Entry): Field[] {
  const file = session!.workspace.files.find(f => f.key === entry.file)!;
  return entry.fields.filter(f => stable(at(file.document, f.path)) !== stable(at(session!.document(entry.file), f.path)));
}
function renderList(): void {
  if (!session) return;
  const query = search.value.toLowerCase();
  const entries = session.workspace.entries.filter(e => (!kind.value || e.kind === kind.value) && (!category.value || e.category === category.value)
    && (!changedOnly.checked || changedFields(e).length > 0)
    && `${e.id} ${e.name} ${e.category} ${e.fields.map(f => `${f.label} ${format(f.value)}`).join(' ')}`.toLowerCase().includes(query));
  count.textContent = `${entries.length} / ${session.workspace.entries.length} Einträge`;
  list.replaceChildren(...entries.map(entry => {
    const node = button('', () => { selected = entry.key; fieldSearch.value = ''; render(); }, `entry ${selected === entry.key ? 'active' : ''}`);
    node.dataset.entry = entry.key;
    node.append(el('span', 'entry-name', entry.name), el('span', 'entry-meta', `${kinds[entry.kind]} · ${entry.category}${changedFields(entry).length ? ' · ● geändert' : ''}`));
    return node;
  }));
  if (!entries.length) list.append(el('p', 'muted', 'Keine passenden Einträge. Filter zurücksetzen.'));
}
function renderStatus(): void {
  // Do not lose a newer keystroke when an in-flight save accepts its earlier snapshot.
  fields.inert = sidebar.inert = changes.inert = busy;
  fieldSearch.disabled = busy;
  const entry = current(), dirty = entry && session?.dirty(entry.file);
  undo.disabled = busy || !session?.canUndo; redo.disabled = busy || !session?.canRedo;
  save.disabled = busy || !dirty || buffers.size > 0 || !valid;
  save.textContent = busy ? 'Bitte warten …' : 'Datei speichern';
  status.classList.toggle('dirty', !!session?.dirtyFiles.length);
  if (!busy && session?.dirtyFiles.length) status.textContent = `${session.dirtyFiles.length} Datei(en) ungespeichert${valid ? '' : ' · Prüfung fehlgeschlagen'}`;
  else if (!busy && session) status.textContent = 'Alle Änderungen gespeichert';
}
function renderChanges(): void {
  changeList.replaceChildren(); if (!session) return;
  let total = 0;
  for (const entry of session.workspace.entries) {
    const changed = changedFields(entry); total += changed.length;
    if (!changed.length) continue;
    const section = el('div', 'change-group');
    section.append(button(entry.name, () => { selected = entry.key; render(); }, 'link'));
    for (const field of changed) {
      const baseline = at(session.workspace.files.find(f => f.key === entry.file)!.document, field.path);
      section.append(el('code', '', field.label), el('p', 'delta', `${format(baseline)} → ${format(at(session.document(entry.file), field.path))}`));
    }
    changeList.append(section);
  }
  changesTitle.textContent = `Änderungen · ${total}`;
  if (!total) changeList.append(el('p', 'empty', 'Keine ungespeicherten Werte.'));
}
function renderMetrics(): void {
  metrics.replaceChildren(); const entry = current(); if (!entry || !session) return;
  if (entry.kind === 'weapon') {
    const get = (label: string) => { const f = entry.fields.find(f => f.label === label); return f ? session!.value(entry, f) : undefined; };
    const damage = get('damage'), cooldown = get('cooldown');
    if (typeof damage === 'number' && typeof cooldown === 'number' && cooldown > 0) {
      metrics.append(el('strong', '', `${(damage * 1000 / cooldown).toLocaleString('de-DE', { maximumFractionDigits: 2 })} Basisschaden/s`),
        el('span', 'muted', 'damage × 1000 / cooldown · ein Treffer je Schuss; ohne Pellets, Salven, Effekte, Upgrades oder Trefferquote.'));
    }
  }
}
function renderFields(): void {
  fields.replaceChildren(); const entry = current(); if (!entry || !session) return;
  title.textContent = entry.name;
  context.textContent = `${entry.id} · ${entry.file}${entry.baseId ? ` · erbt von ${entry.baseId}` : ''}`;
  const query = fieldSearch.value.toLowerCase();
  const groups = new Map<string, Field[]>();
  for (const field of entry.fields) {
    if (query && !`${field.label} ${field.source} ${format(field.value)}`.toLowerCase().includes(query)) continue;
    const group = !field.editable && !field.label.startsWith('effects.') && !field.label.startsWith('requires.') ? 'Referenzen & Identität'
      : field.label.includes('.') ? field.label.split('.')[0] : 'Basiswerte';
    groups.set(group, [...groups.get(group) ?? [], field]);
  }
  for (const [name, group] of [...groups].sort(([a], [b]) => Number(a === 'Referenzen & Identität') - Number(b === 'Referenzen & Identität'))) {
    const section = el('details', 'field-group'); section.open = name !== 'Referenzen & Identität';
    section.append(el('summary', '', `${name} · ${group.length}`));
    for (const field of group) {
      const row = el('div', 'field-row'), label = el('label', 'field-label');
      const id = `field-${entry.key}-${field.label}`; label.htmlFor = id;
      const numeric = typeof field.value === 'number';
      const bounds = field.maximum !== undefined ? `${field.minimum ?? '−∞'} … ${field.maximum}` : field.minimum !== undefined ? `ab ${field.minimum}` : 'endlich';
      const range = numeric ? `${field.integer ? 'Ganzzahl' : 'Zahl'} · ${bounds}${field.unit ? ` · ${field.unit}` : ''}` : typeof field.value === 'boolean' ? 'An / Aus' : field.unit ?? 'Text';
      label.append(el('strong', '', field.label), el('small', 'muted', range));
      const control = el('div', 'field-control');
      const value = session.value(entry, field);
      if (!field.editable) control.append(el('code', 'readonly', format(value)));
      else {
        let node: HTMLInputElement | HTMLSelectElement;
        if (typeof field.value === 'boolean' || field.options) {
          node = select(field.label, field.options ? field.options.map(v => [v, v]) : [['true', 'An'], ['false', 'Aus']]); node.value = String(value);
        } else {
          node = el('input'); node.type = numeric ? 'number' : 'text'; node.value = buffers.get(bufferKey(entry, field)) ?? String(value);
          if (numeric) { node.step = field.integer ? '1' : 'any'; if (field.minimum !== undefined) node.min = String(field.minimum); if (field.maximum !== undefined) node.max = String(field.maximum); }
          else node.pattern = '#[0-9a-fA-F]{6}';
        }
        node.id = id; node.setAttribute('aria-label', field.label); node.title = field.note ?? '';
        const commit = () => {
          const key = bufferKey(entry, field);
          if (!node.checkValidity() || node.value.trim() === '' || (numeric && !Number.isFinite(Number(node.value)))) {
            buffers.set(key, node.value); node.setAttribute('aria-invalid', 'true'); renderStatus(); return;
          }
          buffers.delete(key); node.removeAttribute('aria-invalid');
          session!.edit(entry, field, numeric ? Number(node.value) : typeof field.value === 'boolean' ? node.value === 'true' : node.value);
          valid = true; message(); renderStatus(); renderChanges(); renderMetrics(); scheduleValidation();
        };
        // Keep invalid text buffered; valid edits immediately enter the undo history.
        node.oninput = commit;
        node.onchange = commit; control.append(node);
      }
      const initial = session.initial.entries.find(e => e.key === entry.key)?.fields.find(f => f.label === field.label)?.value;
      control.append(el('small', 'original', `Ursprung: ${format(initial)}`));
      if (stable(value) !== stable(initial) && field.editable && initial !== undefined) control.append(button('Ursprung einsetzen', () => {
        buffers.delete(bufferKey(entry, field)); session!.edit(entry, field, initial); render(); scheduleValidation();
      }, 'link'));
      const source = el('small', 'source', `${field.inherited ? '↳ Geerbt / Default · Änderung gilt nur hier. ' : ''}${field.source}`); source.title = field.note ?? '';
      row.append(label, control, source); section.append(row);
    }
    fields.append(section);
  }
}
function render(): void { renderList(); renderFields(); renderChanges(); renderMetrics(); renderStatus(); }
function scheduleValidation(): void { validationVersion++; clearTimeout(timer); timer = setTimeout(() => void validate(), 350); }
async function validate(): Promise<boolean> {
  if (!session || buffers.size) return false;
  const version = ++validationVersion;
  try {
    const checked = await api<Workspace>('validate', { drafts: session.dirtyFiles.map(key => ({ key, document: session!.document(key) })) });
    if (version !== validationVersion) return false;
    session.workspace.entries = checked.entries; valid = true; message();
    if (!fields.contains(document.activeElement)) renderFields();
    renderList(); renderChanges(); renderMetrics(); renderStatus(); return true;
  } catch (error) { if (version === validationVersion) { valid = false; message(String(error)); renderStatus(); } return false; }
}
async function saveFile(): Promise<void> {
  const entry = current(); if (!entry || !session || busy) return;
  clearTimeout(timer); busy = true; renderStatus();
  try {
    if (!await validate()) return;
    const file = session.workspace.files.find(f => f.key === entry.file)!;
    const saved = await api<Workspace>('save', { key: file.key, revision: file.revision, document: session.document(file.key) });
    session.accept(file.key, saved); message(); render();
    context.textContent += ' · Gespeichert. Spiel neu laden, um die Werte zu übernehmen.';
    if (session.dirtyFiles.length) await validate();
  } catch (error) { message(String(error)); }
  finally { busy = false; renderStatus(); }
}
function history(forward: boolean): void { if (!session || busy) return; buffers.clear(); forward ? session.redo() : session.undo(); valid = true; render(); scheduleValidation(); }
function exportDraft(): void {
  if (!session) return;
  const blob = new Blob([JSON.stringify({ drafts: session.dirtyFiles.map(key => ({ key, document: session!.document(key) })), pendingInput: [...buffers] }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = 'fragdachse-balance-entwurf.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
search.oninput = renderList; kind.onchange = renderList; category.onchange = renderList; changedOnly.onchange = renderList; fieldSearch.oninput = renderFields;
window.addEventListener('beforeunload', event => { if (session?.dirtyFiles.length || buffers.size) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); (document.activeElement as HTMLElement)?.blur(); void saveFile(); } });
void load();
