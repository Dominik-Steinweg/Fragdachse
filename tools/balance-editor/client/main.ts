import './style.css';
import { at, stable } from '../../map-editor/shared/json';
import type { Entry, Field, Workspace } from '../shared/types';
import { buildFamilies, categoryNames, effectAmount, effectGroups, fieldName, isPrimaryField, primaryFields, readablePath, upgradeTitle, type Family } from '../shared/presentation';
import { BalanceSession } from './BalanceSession';

const artwork = import.meta.glob('../../../public/assets/sprites/Loadout/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
};
const button = (text: string, action: () => void, className = '') => { const node = el('button', className, text); node.onclick = action; return node; };
const input = (label: string, placeholder: string) => { const node = el('input'); node.type = 'search'; node.placeholder = placeholder; node.setAttribute('aria-label', label); return node; };
const select = (label: string, options: [string, string][]) => {
  const node = el('select'); node.setAttribute('aria-label', label);
  options.forEach(([value, label]) => { const option = el('option', '', label); option.value = value; node.append(option); }); return node;
};
function icon(key?: string, className = ''): HTMLElement {
  const url = key && artwork[`../../../public/assets/sprites/Loadout/${key}.png`];
  if (!url) return el('span', `icon fallback ${className}`, '◆');
  const img = el('img', `icon ${className}`); img.src = url; img.alt = ''; img.loading = 'lazy'; return img;
}
const app = document.querySelector<HTMLDivElement>('#app')!;
const header = el('header'), brand = el('div', 'brand'); brand.append(el('strong', '', 'FRAGDACHSE'), el('span', '', 'BALANCE WERKSTATT'));
const status = el('span', 'status', 'Lade Content …'); status.setAttribute('role', 'status');
const undo = button('↶', () => history(false)), redo = button('↷', () => history(true));
undo.title = 'Rückgängig'; undo.setAttribute('aria-label', undo.title); redo.title = 'Wiederholen'; redo.setAttribute('aria-label', redo.title);
const save = button('Datei speichern', () => void saveFile(), 'primary');
header.append(brand, status, undo, redo, save, button('Neu laden', () => void load(true)), button('Export', exportDraft));
const main = el('main'), sidebar = el('aside', 'sidebar'), canvas = el('section', 'workspace'), inspector = el('aside', 'inspector');
const search = input('Items und Upgrades suchen', 'Item, Upgrade oder Effekt …');
const category = select('Kategorie filtern', [['', 'Alle Kategorien'], ...Object.entries(categoryNames)]);
const changedOnly = el('input'); changedOnly.type = 'checkbox';
const changedLabel = el('label', 'check'); changedLabel.append(changedOnly, document.createTextNode('Nur mit Änderungen'));
const count = el('p', 'muted'), list = el('nav', 'entry-list'); list.setAttribute('aria-label', 'Items und Upgrade-Zweige');
sidebar.append(el('p', 'eyebrow', 'ARSENAL & UPGRADES'), search, category, changedLabel, count, list);
const hero = el('div', 'hero'), metrics = el('div', 'metrics'), tree = el('section', 'tree-section'), related = el('section', 'related');
canvas.append(hero, metrics, tree, related);
const title = el('h2'), context = el('p', 'context'), fieldSearch = input('Felder suchen', 'Auch in Details suchen …');
const fields = el('div', 'fields'), diagnostics = el('pre', 'diagnostics'); diagnostics.setAttribute('role', 'alert'); diagnostics.hidden = true;
const changes = el('details', 'changes'), changesTitle = el('summary', '', 'Änderungen · 0'), changeList = el('div');
changes.append(changesTitle, el('p', 'muted', 'Pro Quelldatei speichern. Änderungen am Item und seinen Upgrades können in verschiedenen Dateien liegen.'), changeList);
inspector.append(el('p', 'eyebrow', 'AUSWAHL BEARBEITEN'), title, context, diagnostics, fieldSearch, fields, changes);
main.append(sidebar, canvas, inspector); app.append(header, main);

let session: BalanceSession | undefined, selected = '', selectedFamily = '', token = '', busy = false, validationVersion = 0;
let timer: ReturnType<typeof setTimeout> | undefined, valid = true;
const buffers = new Map<string, string>(), expanded = new Set<string>();
const navExpanded = new Map<string, boolean>();
const bufferKey = (entry: Entry, field: Field) => `${entry.file}:${JSON.stringify(field.path)}`;
const current = () => session?.workspace.entries.find(e => e.key === selected);
const families = () => session ? buildFamilies(session.workspace) : [];
const familyEntries = (f: Family) => [...(f.base ? [f.base] : []), ...f.upgrades, ...f.related];
const currentFamily = () => families().find(f => f.key === selectedFamily);
const format = (value: unknown) => value === undefined ? 'nicht authored' : typeof value === 'string' ? value : JSON.stringify(value);
const valueOf = (entry: Entry, label: string) => { const f = entry.fields.find(f => f.label === label); return f && session!.value(entry, f); };

async function api<T>(route: string, payload?: unknown): Promise<T> {
  const response = await fetch(`/api/balance/${route}`, payload === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-balance-editor-token': token }, body: JSON.stringify(payload),
  });
  const data = await response.json(); if (!response.ok) throw Error(data.error ?? `HTTP ${response.status}`); return data;
}
function message(text = ''): void { diagnostics.textContent = text; diagnostics.hidden = !text; }
function choose(entry: Entry, family?: Family): void {
  const previousFamily = selectedFamily;
  const viewport = tree.querySelector('.tree-viewport'), scroll = { left: viewport?.scrollLeft ?? 0, top: viewport?.scrollTop ?? 0 };
  selected = entry.key;
  selectedFamily = (family ?? families().find(f => familyEntries(f).some(e => e.key === entry.key)))?.key ?? '';
  const activeFamily = currentFamily(); if (activeFamily) navExpanded.set(activeFamily.category, true);
  fieldSearch.value = ''; render(); inspector.scrollTop = 0;
  if (previousFamily === selectedFamily) tree.querySelector('.tree-viewport')?.scrollTo(scroll);
  else canvas.scrollTop = 0;
}
async function load(reload = false): Promise<void> {
  if (busy) return;
  if (reload && (session?.dirtyFiles.length || buffers.size) && !window.confirm('Ungespeicherte Änderungen verwerfen und Dateien neu laden?')) return;
  busy = true; validationVersion++; clearTimeout(timer); renderStatus();
  try {
    token = (await api<{ token: string }>('session')).token;
    session = new BalanceSession(await api<Workspace>('workspace')); buffers.clear(); valid = true;
    const first = currentFamily() ?? families().find(f => f.base?.kind === 'weapon') ?? families()[0];
    if (!current() || !currentFamily()) { selectedFamily = first.key; selected = (first.base ?? first.upgrades[0]).key; }
    message(); render();
  } catch (error) { message(`${error}\nStart: npm run balance:editor (Speichern nur am lokalen Dev-Server).`); }
  finally { busy = false; renderStatus(); }
}
function changedFields(entry: Entry): Field[] {
  const file = session!.workspace.files.find(f => f.key === entry.file)!;
  return entry.fields.filter(f => stable(at(file.document, f.path)) !== stable(at(session!.document(entry.file), f.path)));
}
function hasChanges(entry: Entry): boolean {
  return changedFields(entry).length > 0 || entry.fields.some(f => buffers.has(bufferKey(entry, f)));
}
function matches(entry: Entry, query: string): boolean {
  return `${entry.id} ${entry.name} ${entry.category} ${entry.fields.map(f => `${fieldName(f)} ${f.label} ${format(f.value)}`).join(' ')}`.toLowerCase().includes(query);
}
function renderList(): void {
  if (!session) return;
  const query = search.value.trim().toLowerCase(), all = families();
  const visible = all.filter(f => (!category.value || f.category === category.value)
    && (!changedOnly.checked || familyEntries(f).some(hasChanges))
    && (!query || familyEntries(f).some(e => matches(e, query))));
  count.textContent = `${visible.length} / ${all.length} Items & Zweige`;
  list.replaceChildren();
  for (const categoryId of Object.keys(categoryNames)) {
    const rows = visible.filter(f => f.category === categoryId); if (!rows.length) continue;
    const group = el('details', 'nav-group'); group.open = !!query || !!category.value || (navExpanded.get(categoryId) ?? rows.some(f => f.key === selectedFamily));
    group.ontoggle = () => { if (group.isConnected && !query && !category.value) navExpanded.set(categoryId, group.open); };
    group.append(el('summary', '', `${categoryNames[categoryId]} · ${rows.length}`));
    for (const family of rows) {
      const dirty = familyEntries(family).some(hasChanges);
      const node = button('', () => choose(family.base ?? family.upgrades[0], family), `entry ${selectedFamily === family.key ? 'active' : ''}`);
      node.dataset.family = family.key; node.setAttribute('aria-current', String(selectedFamily === family.key));
      const text = el('span', 'entry-copy'); text.append(el('strong', '', family.name), el('small', '', `${family.upgrades.length ? `${family.upgrades.length} Upgrade-Knoten` : 'Grundwerte'}${dirty ? ' · ●' : ''}`));
      node.append(icon(family.iconKey), text); group.append(node);
      if (query) for (const entry of family.upgrades.filter(e => matches(e, query))) group.append(button(`↳ ${entry.name}`, () => choose(entry, family), 'search-result'));
    }
    list.append(group);
  }
  if (!visible.length) list.append(el('p', 'empty', 'Keine Treffer. Suche oder Kategorie ändern.'));
}
function renderStatus(): void {
  fields.inert = sidebar.inert = canvas.inert = changes.inert = busy;
  fieldSearch.disabled = busy;
  const entry = current(), dirty = entry && session?.dirty(entry.file);
  undo.disabled = busy || !session?.canUndo; redo.disabled = busy || !session?.canRedo;
  save.disabled = busy || !dirty || buffers.size > 0 || !valid;
  save.textContent = busy ? 'Bitte warten …' : 'Datei speichern';
  save.title = entry ? `${entry.file} · Strg+S` : 'Datei der Auswahl speichern';
  status.classList.toggle('dirty', !!session?.dirtyFiles.length || !!buffers.size);
  if (!busy && session) status.textContent = buffers.size ? `${buffers.size} ungültige Eingabe(n) · nicht speicherbar`
    : !valid ? 'Prüfung fehlgeschlagen · Details rechts' : session.dirtyFiles.length ? `${session.dirtyFiles.length} Datei(en) ungespeichert` : 'Alle Änderungen gespeichert';
}
function renderChanges(): void {
  changeList.replaceChildren(); if (!session) return;
  let total = 0;
  for (const entry of session.workspace.entries) {
    const changed = changedFields(entry); total += changed.length;
    const pending = entry.fields.filter(f => buffers.has(bufferKey(entry, f)));
    if (!changed.length && !pending.length) continue;
    const section = el('div', 'change-group');
    section.append(button(entry.name, () => choose(entry), 'link'));
    for (const field of changed) {
      const baseline = at(session.workspace.files.find(f => f.key === entry.file)!.document, field.path);
      section.append(el('small', 'muted', fieldName(field)), el('p', 'delta', `${format(baseline)} → ${format(at(session.document(entry.file), field.path))}`));
    }
    for (const field of pending) section.append(button(`Ungültig: ${fieldName(field)}`, () => { choose(entry); fieldSearch.value = field.label; renderFields(); }, 'error link'));
    changeList.append(section);
  }
  changesTitle.textContent = `Änderungen · ${total}${buffers.size ? ` · ${buffers.size} ungültig` : ''}`;
  if (!total && !buffers.size) changeList.append(el('p', 'empty', 'Keine offenen Änderungen.'));
}
function renderMetrics(): void {
  metrics.replaceChildren(); const family = currentFamily(), entry = family?.base; if (!entry || !session) return;
  const headline = primaryFields(entry).filter(f => !f.label.includes('.')).slice(0, 4);
  for (const field of headline) {
    const card = button('', () => { choose(entry, family); document.getElementById(`field-${entry.key}-${field.label}`)?.focus(); }, 'metric');
    card.append(el('small', '', fieldName(field)), el('strong', '', `${format(session.value(entry, field))}${field.unit ? ` ${field.unit}` : ''}`)); metrics.append(card);
  }
  const damage = valueOf(entry, 'damage'), cooldown = valueOf(entry, 'cooldown');
  if (entry.kind === 'weapon' && typeof damage === 'number' && typeof cooldown === 'number' && cooldown > 0) metrics.append(el('p', 'metric-note', `${(damage * 1000 / cooldown).toLocaleString('de-DE', { maximumFractionDigits: 2 })} Basisschaden/s · damage × 1000 / cooldown; ein Treffer pro Schuss, ohne Pellets, Salven und Effekte.`));
}
function summaryEffects(entry: Entry): string {
  return effectGroups(entry).map(group => `${effectAmount(Number(valueOf(entry, `effects.${group.index}.value`)), String(valueOf(entry, `effects.${group.index}.mode`)), 1, group.stat)} ${readablePath(group.stat.split('.').at(-1)!)}`).join(' · ');
}
function renderTree(): void {
  hero.replaceChildren(); tree.replaceChildren(); related.replaceChildren();
  const family = currentFamily(); if (!family) return;
  const heading = el('div'); heading.append(el('p', 'eyebrow', categoryNames[family.category]), el('h1', '', family.name), el('p', 'muted', family.upgrades.length ? 'Ein Item. Alle Upgrades. Knoten auswählen und rechts balancieren.' : 'Grundwerte auswählen und rechts balancieren.'));
  hero.append(icon(family.iconKey, 'hero-icon'), heading);
  if (family.base) {
    const base = button('', () => choose(family.base!, family), `base-card ${selected === family.base.key ? 'active' : ''}`);
    base.append(el('span', '', '◈  Grundwerte bearbeiten'), el('small', '', `${family.base.id}${changedFields(family.base).length ? ' · ● geändert' : ''}`)); tree.append(base);
  }
  if (family.upgrades.length) {
    const bar = el('div', 'section-heading'); bar.append(el('h2', '', 'Upgrade-Baum'), el('span', 'muted', `${family.upgrades.length} Knoten · Voraussetzungen wie im Spiel`)); tree.append(bar);
    const viewport = el('div', 'tree-viewport'); viewport.setAttribute('aria-label', 'Upgrade-Baum'); viewport.tabIndex = 0;
    const graph = el('div', 'tree-graph'), byId = new Map(family.upgrades.map(e => [e.id, e]));
    const depths = new Map<string, number>();
    const depth = (entry: Entry, seen = new Set<string>()): number => {
      if (depths.has(entry.id)) return depths.get(entry.id)!;
      if (seen.has(entry.id)) return 0;
      seen.add(entry.id);
      const parents = entry.upgrade!.requires.map(r => byId.get(r.upgradeId)).filter((e): e is Entry => !!e);
      const d = parents.length ? Math.max(...parents.map(p => depth(p, new Set(seen)))) + 1 : 0;
      depths.set(entry.id, d); return d;
    };
    family.upgrades.forEach(e => depth(e));
    const levels = Array.from({ length: Math.max(...depths.values()) + 1 }, (_, d) => family.upgrades.filter(e => depths.get(e.id) === d));
    const width = Math.max(1, ...levels.map(l => l.length)) * 184 + 24, rowHeight = 176;
    graph.style.width = `${width}px`; graph.style.height = `${levels.length * rowHeight + 8}px`;
    const positions = new Map<string, { x: number; y: number }>();
    levels.forEach((level, d) => level.forEach((entry, i) => positions.set(entry.id, { x: (width - level.length * 184) / 2 + i * 184 + 8, y: d * rowHeight + 8 })));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', String(width)); svg.setAttribute('height', String(levels.length * rowHeight)); svg.setAttribute('aria-hidden', 'true');
    for (const entry of family.upgrades) for (const requirement of entry.upgrade!.requires) {
      const from = positions.get(requirement.upgradeId), to = positions.get(entry.id); if (!from || !to) continue;
      const line = document.createElementNS(svg.namespaceURI, 'path');
      line.setAttribute('d', `M ${from.x + 84} ${from.y + 140} C ${from.x + 84} ${from.y + 162}, ${to.x + 84} ${to.y - 20}, ${to.x + 84} ${to.y}`);
      if (entry.key === selected || byId.get(requirement.upgradeId)?.key === selected) line.classList.add('selected-edge'); svg.append(line);
    }
    graph.append(svg);
    for (const entry of family.upgrades) {
      const position = positions.get(entry.id)!;
      const node = button('', () => choose(entry, family), `upgrade-node ${selected === entry.key ? 'active' : ''} ${entry.upgrade!.kind === 'unlock' ? 'unlock' : ''}`);
      node.dataset.entry = entry.key; node.style.left = `${position.x}px`; node.style.top = `${position.y}px`; node.setAttribute('aria-pressed', String(selected === entry.key));
      const top = el('div', 'node-top'); top.append(icon(entry.iconKey), el('span', 'node-level', `MAX ${valueOf(entry, 'maxLevel')}`));
      node.append(top, el('strong', '', upgradeTitle(entry)), el('small', 'node-effect', summaryEffects(entry) || 'Item freischalten'), el('span', 'node-cost', `${valueOf(entry, 'costPerLevel')} P / Level${Number(valueOf(entry, 'bossPointCostPerLevel')) ? ` + ${valueOf(entry, 'bossPointCostPerLevel')} Boss` : ''}${changedFields(entry).length ? ' · ●' : ''}`));
      node.title = `${entry.name}\n${summaryEffects(entry)}\n${entry.upgrade!.requires.map(r => `Benötigt ${byId.get(r.upgradeId)?.name ?? r.upgradeId} · Level ${r.minLevel}`).join('\n')}`; graph.append(node);
    }
    viewport.append(graph); tree.append(viewport, el('p', 'tree-hint', 'Linien zeigen alle Voraussetzungen. MAX bezeichnet die höchste kaufbare Stufe.'));
  } else tree.append(el('p', 'empty', 'Für dieses Item sind keine eigenen Coop-Upgrades hinterlegt.'));
  if (family.related.length) {
    const details = el('details'); details.append(el('summary', '', 'Zugehörige Regeln & Katalog'));
    for (const entry of family.related) details.append(button(entry.name, () => choose(entry, family), 'related-button')); related.append(details);
  }
}
function fieldRow(entry: Entry, field: Field, labelText = fieldName(field)): HTMLElement {
  const row = el('div', 'field-row'), label = el('label', 'field-label'), control = el('div', 'field-control');
  const id = `field-${entry.key}-${field.label}`; label.htmlFor = id;
  const numeric = typeof field.value === 'number', value = session!.value(entry, field);
  label.append(el('strong', '', labelText));
  if (field.unit && !field.label.startsWith('effects.')) label.append(el('small', 'muted', field.unit));
  if (field.context) label.append(el('small', 'muted', field.context));
  if (!field.editable) control.append(el('code', 'readonly', format(value)));
  else {
    let node: HTMLInputElement | HTMLSelectElement;
    if (typeof field.value === 'boolean' || field.options) {
      node = select(field.label, field.options ? field.options.map(v => [v, v === 'add_per_level' ? 'Additiv / Level' : v === 'add_percent_per_level' ? 'Prozent / Level' : v]) : [['true', 'An'], ['false', 'Aus']]); node.value = String(value);
    } else {
      node = el('input'); node.type = numeric ? 'number' : 'text'; node.value = buffers.get(bufferKey(entry, field)) ?? String(value);
      if (numeric) { node.step = field.integer ? '1' : 'any'; if (field.minimum !== undefined) node.min = String(field.minimum); if (field.maximum !== undefined) node.max = String(field.maximum); }
      else node.pattern = '#[0-9a-fA-F]{6}';
    }
    node.id = id; node.setAttribute('aria-label', field.label); node.title = `${field.label}\n${field.note ?? ''}`;
    if (buffers.has(bufferKey(entry, field))) node.setAttribute('aria-invalid', 'true');
    const commit = () => {
      const key = bufferKey(entry, field);
      if (!node.checkValidity() || node.value.trim() === '' || (numeric && !Number.isFinite(Number(node.value)))) {
        buffers.set(key, node.value); node.setAttribute('aria-invalid', 'true');
        const reset = row.querySelector<HTMLButtonElement>('.reset'); if (reset) reset.disabled = false;
        renderStatus(); renderChanges(); renderList(); return;
      }
      buffers.delete(key); node.removeAttribute('aria-invalid');
      session!.edit(entry, field, numeric ? Number(node.value) : typeof field.value === 'boolean' ? node.value === 'true' : node.value);
      valid = true; message(); renderStatus(); renderChanges(); renderMetrics(); refreshEffects(); scheduleValidation();
      row.classList.toggle('edited', changedFields(entry).some(f => f.label === field.label));
      const reset = row.querySelector<HTMLButtonElement>('.reset'); if (reset) reset.disabled = stable(session!.value(entry, field)) === stable(initial);
    };
    node.oninput = commit; node.onchange = commit; control.append(node);
  }
  const initial = session!.initial.entries.find(e => e.key === entry.key)?.fields.find(f => f.label === field.label)?.value;
  control.append(el('small', 'original', `Ursprung: ${format(initial)}`));
  if (field.editable && initial !== undefined) {
    const reset = button('↶', () => { buffers.delete(bufferKey(entry, field)); session!.edit(entry, field, initial); render(); scheduleValidation(); }, 'reset');
    reset.disabled = stable(value) === stable(initial) && !buffers.has(bufferKey(entry, field));
    reset.title = `${labelText}: Ursprung einsetzen`; reset.setAttribute('aria-label', reset.title); control.append(reset);
  }
  const source = el('details', 'source'); source.append(el('summary', '', `${field.inherited ? '↳ Geerbt / Default · ' : ''}${field.label}`), el('p', '', field.source), el('p', '', `${field.note ?? ''}${numeric ? ` · ${field.integer ? 'Ganzzahl' : 'Zahl'} · ${field.minimum ?? '−∞'} bis ${field.maximum ?? '∞'}` : ''}`));
  row.classList.toggle('edited', changedFields(entry).some(f => f.label === field.label)); row.append(label, control, source); return row;
}
function disclosure(entry: Entry, name: string, rows: HTMLElement[]): HTMLElement {
  const section = el('details', 'field-group'), key = `${entry.key}:${name}`;
  section.open = !!fieldSearch.value || expanded.has(key);
  section.ontoggle = () => { if (!section.isConnected || fieldSearch.value) return; section.open ? expanded.add(key) : expanded.delete(key); };
  section.append(el('summary', '', name), ...rows); return section;
}
function refreshEffects(): void {
  const entry = current(); if (!entry) return;
  for (const group of effectGroups(entry)) {
    const preview = document.getElementById(`effect-preview-${group.index}`); if (!preview) continue;
    const mode = String(valueOf(entry, `effects.${group.index}.mode`)), value = Number(valueOf(entry, `effects.${group.index}.value`)), max = Number(valueOf(entry, 'maxLevel'));
    const levels = max <= 6 ? Array.from({ length: max }, (_, i) => i + 1) : [1, 2, 3, max];
    preview.replaceChildren(...levels.map(level => el('span', '', `L${level}  ${effectAmount(value, mode, level, group.stat)}`)));
    preview.append(el('small', '', mode === 'add_percent_per_level' ? 'Relativer Bonus auf den Basiswert. Eingabe: 0,1 = 10 %.' : 'Additiver Effektbeitrag, formatiert wie im Spiel. Eingabe in der Roh-Einheit des Zielwerts.'));
  }
}
function renderFields(): void {
  fields.replaceChildren(); const entry = current(); if (!entry || !session) return;
  title.textContent = entry.name; context.textContent = `${entry.id} · ${entry.file}${entry.baseId ? ` · erbt von ${entry.baseId}` : ''}`;
  const query = fieldSearch.value.trim().toLowerCase();
  const included = (field: Field) => !query || `${fieldName(field)} ${field.label} ${field.source} ${format(field.value)}`.toLowerCase().includes(query);
  if (entry.upgrade?.requires.length) {
    const requirements = el('div', 'requirements'); requirements.append(el('small', 'muted', 'BENÖTIGT ALLE'));
    for (const requirement of entry.upgrade.requires) {
      const parent = session.workspace.entries.find(e => e.key === `upgrade:${requirement.upgradeId}`);
      requirements.append(button(`${parent?.name ?? requirement.upgradeId} · Level ${requirement.minLevel}`, () => { if (parent) choose(parent); }, 'link'));
    }
    fields.append(requirements);
  }
  const primary = primaryFields(entry).filter(included);
  if (primary.length) {
    const section = el('section', 'primary-fields'); section.append(el('h3', '', entry.kind === 'upgrade' ? 'Progression' : 'Wichtige Balance-Werte'), ...primary.map(f => fieldRow(entry, f))); fields.append(section);
  }
  for (const group of effectGroups(entry)) {
    if (query && !`${readablePath(group.stat)} ${group.stat}`.toLowerCase().includes(query) && !group.fields.some(included)) continue;
    const card = el('section', 'effect-card'); card.append(el('p', 'eyebrow', `EFFEKT ${group.index + 1}`), el('h3', '', readablePath(group.stat)), el('code', 'effect-path', group.stat));
    const target = session.workspace.entries.find(e => ['weapon', 'utility', 'ultimate'].includes(e.kind) && group.stat.startsWith(`${e.kind}.${e.id}.`));
    const targetField = target?.fields.find(f => f.label === group.stat.slice(`${target.kind}.${target.id}.`.length));
    if (target && targetField) card.append(button(`Basiswert: ${format(session.value(target, targetField))} → ${target.name}`, () => { choose(target); fieldSearch.value = targetField.label; renderFields(); }, 'link'));
    for (const field of group.fields.filter(f => f.editable && f.label.endsWith('.value'))) card.append(fieldRow(entry, field, 'Stärke je Level'));
    const preview = el('div', 'effect-preview'); preview.id = `effect-preview-${group.index}`; card.append(preview);
    card.append(disclosure(entry, `Effekt ${group.index + 1}: Berechnung & Referenz`, group.fields.filter(f => !f.label.endsWith('.value')).map(f => fieldRow(entry, f, f.label.endsWith('.mode') ? 'Berechnung' : 'Zielwert'))));
    fields.insertBefore(card, fields.querySelector('.primary-fields'));
  }
  const advanced = entry.fields.filter(f => included(f) && !isPrimaryField(entry, f) && !f.label.startsWith('effects.'));
  const editable = advanced.filter(f => f.editable), readonly = advanced.filter(f => !f.editable);
  if (editable.length) {
    const groups = new Map<string, Field[]>();
    for (const field of editable) { const group = field.label.includes('.') ? field.label.split('.')[0] : 'Weitere Parameter'; groups.set(group, [...groups.get(group) ?? [], field]); }
    const rows = [...groups].map(([name, group]) => { const block = el('div'); block.append(el('h4', '', readablePath(name)), ...group.map(f => fieldRow(entry, f))); return block; });
    fields.append(disclosure(entry, `Weitere Parameter (${editable.length} Werte)`, rows));
  }
  if (readonly.length) fields.append(disclosure(entry, 'Identität & Referenzen', readonly.map(f => fieldRow(entry, f))));
  if (!fields.childElementCount) fields.append(el('p', 'empty', 'Keine passenden Felder.')); refreshEffects();
}
function render(): void { renderList(); renderTree(); renderFields(); renderChanges(); renderMetrics(); renderStatus(); }
function scheduleValidation(): void { validationVersion++; clearTimeout(timer); timer = setTimeout(() => void validate(), 350); }
async function validate(): Promise<boolean> {
  if (!session || buffers.size) return false;
  const version = ++validationVersion;
  try {
    const checked = await api<Workspace>('validate', { drafts: session.dirtyFiles.map(key => ({ key, document: session!.document(key) })) });
    if (version !== validationVersion) return false;
    session.workspace.entries = checked.entries; valid = true; message();
    if (!fields.contains(document.activeElement)) renderFields();
    const viewport = tree.querySelector('.tree-viewport'), scroll = { left: viewport?.scrollLeft ?? 0, top: viewport?.scrollTop ?? 0 };
    renderTree(); tree.querySelector('.tree-viewport')?.scrollTo(scroll);
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
    session.accept(file.key, saved); message(); render(); context.textContent += ' · Gespeichert. Spiel neu laden, um die Werte zu übernehmen.';
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
search.oninput = renderList; category.onchange = renderList; changedOnly.onchange = renderList; fieldSearch.oninput = renderFields;
window.addEventListener('beforeunload', event => { if (session?.dirtyFiles.length || buffers.size) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); (document.activeElement as HTMLElement)?.blur(); void saveFile(); } });
void load();
