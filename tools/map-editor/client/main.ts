import './style.css';
import { getMapName } from '../../../src/i18n/contentPresentation';
import { MapDocumentSession, type LoadedMap } from './document/MapDocumentSession';
import { EncounterView } from './encounters/EncounterView';
import { MapView } from './map/MapView';
import { PreviewController, geometryRevision, type VariantResult } from './preview/PreviewController';
import { validateDocument } from '../shared/validation';
import { clone, pathFromPointer, type Path } from '../shared/json';
import { button, commitFocused, confirmEdit, element, type EditorEnvironment } from './ui';

const app = document.querySelector<HTMLDivElement>('#app')!;
const header = element('header', 'app-header'), brand = element('div', 'brand');
brand.append(element('strong', '', 'FRAGDACHSE'), element('span', '', 'MAP EDITOR / V1'));
const mapSelect = element('select', 'map-select'); mapSelect.setAttribute('aria-label', 'Map auswählen');
const fileInfo = element('div', 'file-info'), saveStatus = element('span', 'save-status');
const saveButton = button('Speichern', () => void save(), 'primary');
const undoButton = button('↶ Rückgängig', () => { const pending = env?.session.pending.size; discardBuffers(); if (!pending) env?.session.undo(); render(); }, '', false, false);
const redoButton = button('↷ Wiederholen', () => { discardBuffers(); env?.session.redo(); render(); }, '', false, false);
header.append(brand, mapSelect, fileInfo, saveStatus, undoButton, redoButton, saveButton,
  button('Neu laden', () => { if (env) void load(env.session.sourceKey, true); }, '', false, false), button('Entwurf sichern', () => exportDraft(), '', false, false));
const navigation = element('nav', 'view-tabs');
const mapButton = button('Karte', () => switchView('map'), 'active'), encountersButton = button('Encounter & XP', () => switchView('encounters'));
navigation.append(mapButton, encountersButton);
const previewToolbar = element('div', 'preview-toolbar');
const seedInput = element('input', 'seed'); seedInput.type = 'number'; seedInput.min = '0'; seedInput.max = '4294967295'; seedInput.step = '1'; seedInput.setAttribute('aria-label', 'Vorschau-Seed');
let seed = crypto.getRandomValues(new Uint32Array(1))[0]; seedInput.value = String(seed);
seedInput.onchange = () => {
  const value = seedInput.valueAsNumber;
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) { seedInput.value = String(seed); return; }
  seed = value; renderStatus();
};
seedInput.oninput = () => {
  const value = seedInput.valueAsNumber;
  if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) { seed = value; renderStatus(); }
};
const generateButton = button('Aktualisieren', () => void generate(1));
const variantsButton = button('5 Varianten prüfen', () => void generate(5));
const cancelButton = button('Abbrechen', () => { preview.cancel(); renderStatus(); });
const previewStatus = element('span', 'preview-status');
previewToolbar.append(element('span', 'eyebrow', 'VORSCHAU'), element('span', '', 'Seed'), seedInput, generateButton,
  button('Neue Variante', () => { seed = crypto.getRandomValues(new Uint32Array(1))[0]; seedInput.value = String(seed); void generate(1); }), variantsButton, cancelButton, previewStatus);
const mapHost = element('main', 'map-host'), encounterHost = element('main', 'encounter-host'); encounterHost.hidden = true;
const footer = element('section', 'diagnostics'), message = element('pre', 'message'); message.setAttribute('role', 'status'); message.hidden = true;
const issuesHost = element('div', 'issues'); const variantsHost = element('details', 'variants'); variantsHost.append(element('summary', '', 'Variantenbericht')); variantsHost.hidden = true;
footer.append(message, issuesHost, variantsHost); app.append(header, navigation, previewToolbar, mapHost, encounterHost, footer);

let token = '', env: EditorEnvironment | null = null, encounterView: EncounterView | null = null, mapView: MapView | null = null;
let activeView: 'map' | 'encounters' = 'map', saving = false;
let previewKey: string | null = null, previewSeed: number | null = null, lastPreviewInfo = '';
let validation = { issues: [] } as ReturnType<typeof validateDocument>;
const preview = new PreviewController();
const report: VariantResult[] = [];

function showMessage(text: string): void { message.textContent = text; message.hidden = !text; }
function discardBuffers(): void { env?.buffers.clear(); env?.session.pending.clear(); }
function switchView(view: typeof activeView): void {
  activeView = view; mapHost.hidden = view !== 'map'; encounterHost.hidden = view !== 'encounters'; previewToolbar.hidden = view !== 'map';
  mapButton.classList.toggle('active', view === 'map'); encountersButton.classList.toggle('active', view === 'encounters');
  mapView?.canvas.paint();
}
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options); const payload = await response.json();
  if (!response.ok) throw Error(payload.error ?? `HTTP ${response.status}`);
  return payload as T;
}
async function load(key: string, reload = false): Promise<void> {
  if (env && (env.session.dirty || env.session.pending.size) && !await confirmEdit('Ungespeicherte Änderungen verwerfen und Map neu laden? Bei einem Konflikt zuerst „Entwurf sichern“ verwenden.')) { mapSelect.value = env.session.sourceKey; return; }
  try {
    const loaded = await api<LoadedMap>(`/api/maps/${encodeURIComponent(key)}`);
    preview.cancel(); mapView?.destroy();
    const session = new MapDocumentSession(key, loaded);
    env = { session, buffers: new Map(), changed: render, inputChanged: renderStatus, message: showMessage, openMap: path => { switchView('map'); mapView?.open(path); } };
    encounterView = new EncounterView(env); mapView = new MapView(env);
    mapHost.replaceChildren(mapView.root); previewKey = null; previewSeed = null; lastPreviewInfo = ''; report.length = 0; variantsHost.hidden = true;
    mapSelect.value = key; showMessage(reload ? 'Datei neu geladen.' : ''); render();
  } catch (error) { if (env) mapSelect.value = env.session.sourceKey; showMessage(error instanceof Error ? error.message : String(error)); }
}
function render(): void {
  if (!env) return;
  validation = validateDocument(env.session.draft);
  const scroll = encounterHost.scrollTop;
  encounterHost.replaceChildren(encounterView!.render()); encounterHost.scrollTop = scroll;
  mapView?.render(); renderStatus();
  issuesHost.replaceChildren();
  for (const issue of validation.issues) {
    const b = button(`${issue.path}: ${issue.message}`, () => navigateIssue(pathFromPointer(issue.path)), `issue ${issue.severity}`); issuesHost.append(b);
  }
  if (!validation.issues.length) issuesHost.append(element('span', 'valid', '● Entwurf fachlich gültig'));
}
function navigateIssue(path: Path): void {
  if (path[0] === 'encounters') {
    switchView('encounters'); const encounters = env?.session.draft.encounters as { id: string }[];
    if (encounters?.[Number(path[1])]) { encounterView!.selectedId = encounters[Number(path[1])].id; render(); }
  } else { switchView('map'); for (let n = path.length; n > 0; n--) mapView?.open(path.slice(0, n)); }
}
function renderStatus(): void {
  const session = env?.session;
  saveStatus.textContent = saving ? 'Speichert …' : session?.pending.size ? 'Eingabe offen · XP nach Bestätigung' : session?.dirty ? 'Ungespeicherte Änderungen' : 'Gespeichert';
  saveStatus.classList.toggle('dirty', Boolean(session?.dirty || session?.pending.size));
  saveButton.disabled = saving || !(session?.dirty || session?.pending.size) || (!session?.pending.size && !validation.normalized);
  undoButton.disabled = !session?.canUndo && !session?.pending.size; redoButton.disabled = !session?.canRedo;
  fileInfo.textContent = session ? `${session.sourceKey} · ID ${session.draft.mapId} · ${session.draft.objective}` : 'Maps werden geladen …';
  const stale = session && (previewKey !== geometryRevision(session.draft) || previewSeed !== seed);
  previewStatus.textContent = preview.busy ? 'Generierung läuft … Bearbeitung bleibt möglich.' : previewKey === null ? 'Noch keine Vorschau' : stale ? 'Vorschau veraltet' : lastPreviewInfo;
  previewStatus.classList.toggle('stale', Boolean(stale)); cancelButton.hidden = !preview.busy;
  generateButton.disabled = !validation.normalized; variantsButton.disabled = !validation.normalized;
}
async function save(): Promise<void> {
  if (!env || !commitFocused()) return;
  const session = env.session;
  if (session.pending.size) return showMessage('Offene oder ungültige Eingaben zuerst abschließen.');
  const result = validateDocument(session.draft);
  if (!result.normalized || !session.dirty) return;
  saving = true; renderStatus();
  try {
    const saved = await api<LoadedMap>(`/api/maps/${encodeURIComponent(session.sourceKey)}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-map-editor-token': token }, body: JSON.stringify({ revision: session.revision, document: clone(session.draft) }) });
    session.acceptSaved(saved); if (env.session === session) showMessage('Projektdatei gespeichert.');
  } catch (error) { showMessage(error instanceof Error ? error.message : String(error)); }
  finally { saving = false; render(); }
}
function exportDraft(): void {
  if (!env) return;
  const data = { sourceKey: env.session.sourceKey, baseRevision: env.session.revision, originalText: env.session.originalText,
    document: env.session.draft, pendingInputs: Object.fromEntries(env.buffers) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = `${env.session.sourceKey.replace('.json', '')}.draft.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function generate(count: number): Promise<void> {
  if (!env || !commitFocused()) return;
  const enteredSeed = seedInput.valueAsNumber;
  if (!Number.isInteger(enteredSeed) || enteredSeed < 0 || enteredSeed > 0xffffffff) return showMessage('Seed muss eine Ganzzahl zwischen 0 und 4294967295 sein.');
  seed = enteredSeed;
  if (env.session.pending.size) return showMessage('Offene Eingaben zuerst abschließen.');
  const session = env.session, key = geometryRevision(session.draft), requestedSeed = seed;
  report.length = 0; variantsHost.replaceChildren(element('summary', '', 'Variantenbericht')); variantsHost.hidden = false;
  const promise = preview.run(session.draft, requestedSeed, count, variant => {
    report.push(variant);
    const duplicate = variant.result && report.slice(0, -1).some(v => v.result?.fingerprint === variant.result!.fingerprint);
    const text = variant.result ? `Seed ${variant.seed} → ${variant.result.layout.seed} · ${Math.round(variant.result.elapsedMs)} ms · ${variant.result.fingerprint}${duplicate ? ' · bereits in Stichprobe enthalten' : ''}` : `Seed ${variant.seed}: ${variant.error}`;
    variantsHost.append(element('p', variant.error ? 'error' : '', text));
    if (variant.error && env?.session === session) showMessage(`Vorschau fehlgeschlagen: ${text}`);
    if (env?.session !== session || geometryRevision(session.draft) !== key || seed !== requestedSeed) return;
    if (variant.result) {
      mapView?.canvas.setPreview(variant.result); previewKey = key; previewSeed = requestedSeed;
      lastPreviewInfo = `Seed ${variant.result.requestedSeed} → ${variant.result.layout.seed} · Generator v${variant.result.version} · ${variant.result.fingerprint}`;
    }
    renderStatus();
  });
  renderStatus(); await promise; renderStatus();
}

mapSelect.onchange = () => void load(mapSelect.value);
window.addEventListener('beforeunload', event => { if (env && (env.session.dirty || env.session.pending.size)) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]')) return;
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
  if (event.key.toLowerCase() === 'z' && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); discardBuffers(); event.shiftKey ? env?.session.redo() : env?.session.undo(); render(); }
});
void (async () => {
  const session = await api<{ token: string }>('/api/session'); token = session.token;
  const maps = await api<{ file: string; mapId: string }[]>('/api/maps');
  for (const map of maps) { const option = element('option', '', `${map.mapId} · ${getMapName(map.mapId, 'de')}`); option.value = map.file; mapSelect.append(option); }
  if (maps.length) await load(maps.find(m => m.mapId === '1')?.file ?? maps[0].file);
})().catch(error => showMessage(error instanceof Error ? error.message : String(error)));
