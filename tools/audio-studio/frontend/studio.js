import {drawWaveform, milliseconds, moveMarker, processingOverrides} from './waveform.js';
import {jobProgress} from './progress.js';
import {generationLabel, generationSettings} from './generation.js';

const $ = id => document.getElementById(id);
let state, key, chosen, waveform, resultWaveform, resultVersion, formRevision, formEntry;
let step = 'generate', activeOperations = 0, refreshSequence = 0, candidateSignature = '', resultSequence = 0;
const basket = new Map(), observedJobs = new Map();
const activeStatuses = ['queued', 'loading', 'generating', 'cancelling'];
const node = (tag, text, attrs = {}) => {
  const element = document.createElement(tag);
  if (text !== null && text !== undefined) element.textContent = text;
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith('on')) element.addEventListener(name.slice(2), value);
    else if (name in element) element[name] = value;
    else element.setAttribute(name, value);
  }
  return element;
};
const append = (parent, ...children) => { parent.append(...children); return parent; };
const card = title => append(node('section', null, {className: 'card'}), node('h3', title));
const json = data => node('pre', JSON.stringify(data, null, 2));
const details = (title, content, open = false) => append(node('details', null, {open}), node('summary', title), content);
const date = value => new Date(value).toLocaleString('de-DE');
const feedback = id => node('div', null, {id, className: 'feedback', role: 'status', 'aria-live': 'polite'});

function button(text, action, cls = '', busy = 'Wird ausgeführt …') {
  const element = node('button', text, {className: cls, type: 'button'});
  element.onclick = () => work(action, {element, busy});return element;
}
function report(target, text, kind = 'success') {
  const host = $(target);
  if (host) {
    host.className = `feedback ${kind}`;host.replaceChildren(node('span', text));
    if (kind === 'busy') host.prepend(node('progress', null, {'aria-label': text}));
  }
  $('message').className = `toast ${kind}`;$('message-text').textContent = text;$('message').hidden = false;
}
async function work(action, {element, busy = 'Wird ausgeführt …', target} = {}) {
  if (activeOperations) return;
  target ||= element?.closest('[data-feedback]')?.dataset.feedback || 'global-feedback';
  ++activeOperations;++refreshSequence;
  const wasDisabled = element?.disabled;if (element) element.disabled = true;
  document.body.classList.add('working');report(target, busy, 'busy');
  const locked = [...document.querySelectorAll('.toolbar, #workflow, #inventory, [role="tabpanel"], #dialog-content')];
  locked.forEach(element => { element.inert = true; });
  try { const message = await action();report(target, typeof message === 'string' ? message : 'Fertig.'); }
  catch (error) { report(target, error.message || String(error), 'error'); }
  finally { --activeOperations;locked.forEach(element => { element.inert = false; });if (element) element.disabled = wasDisabled;document.body.classList.remove('working'); }
}
async function api(path, body, method = 'POST') {
  const response = await fetch(path, body === undefined ? {} : {method, headers: {'Content-Type': 'application/json', 'X-Studio-Token': state.token}, body: JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || JSON.stringify(data.detail) || response.statusText);return data;
}
function input(parent, label, id, value, type = 'text', extra = {}) {
  const wrap = append(node('div'), node('label', label, {htmlFor: id}));
  const control = node(type === 'textarea' ? 'textarea' : 'input', null, {id, value, ...(type === 'textarea' ? {} : {type}), ...extra});
  wrap.append(control);parent.append(wrap);return control;
}
function select(parent, label, id, values, value) {
  const wrap = append(node('div'), node('label', label, {htmlFor: id})), control = node('select', null, {id});
  control.append(...values.map(([v, text]) => node('option', text, {value: v, selected: v === value})));
  wrap.append(control);parent.append(wrap);return control;
}
function audio(url, label, parent) {
  parent.append(node('label', label));const player = node('audio', null, {controls: true, preload: 'none', src: url});
  player.volume = $('preview-volume')?.checked ? Math.min(1, state.catalog.entries[key].repository.volume) : 1;
  player.addEventListener('play', () => document.querySelectorAll('audio').forEach(other => { if (other !== player) other.pause(); }));
  parent.append(player);return player;
}
function media(run, candidate, kind = 'raw', version) { return `/media/run/${run}/${candidate}/${kind}${version ? `?version_id=${encodeURIComponent(version)}` : ''}`; }
function badges(entry) {
  const facts = entry.repository, result = [];
  if (!facts.exists) result.push(['Datei fehlt', 'warn']);
  if (!facts.shipped) result.push(['Nicht in Whitelist', 'warn']);
  if (!entry.prompt.text.trim()) result.push(['Prompt fehlt', 'warn']);
  if (entry.copy_notice && !entry.copy_notice.hidden) result.push(['Kopie-Hinweis', 'warn']);
  if (entry.needs_revision) result.push(['Überarbeitung', 'warn']);
  if (entry.orphaned || facts.conflicts?.length || facts.file_error) result.push(['Repository prüfen', 'error']);return result;
}
function showInventory() {
  const query = $('search').value.toLowerCase(), category = $('category').value;
  const entries = Object.entries(state.catalog.entries).filter(([id, entry]) => (!category || entry.category === category) && `${id} ${entry.name} ${badges(entry).map(b => b[0]).join(' ')}`.toLowerCase().includes(query));
  $('inventory').replaceChildren(...entries.map(([id, entry]) => {
    const control = node('button', null, {className: id === key ? 'active' : '', type: 'button'});
    control.onclick = () => { if (activeOperations) return;key = id;clearSelection();showInventory();showDetail(); };
    control.append(node('strong', entry.name || id), node('code', id));
    badges(entry).forEach(([text, cls]) => control.append(node('span', text, {className: `badge ${cls}`})));return control;
  }));$('inventory-count').textContent = `${entries.length} / ${Object.keys(state.catalog.entries).length} SFX`;
}
function clearSelection() { chosen = null;waveform = null;resultWaveform = null;resultVersion = null;++resultSequence;candidateSignature = ''; }
function showStep(next, scroll = true) {
  step = next;
  for (const name of ['source', 'generate', 'process']) { $(`panel-${name}`).hidden = name !== step;$(`step-${name}`).setAttribute('aria-selected', String(name === step)); }
  if (scroll) $('workflow').scrollIntoView({behavior: 'smooth', block: 'start'});drawWaves();
}
function showDetail() {
  if (!key) { $('detail').replaceChildren(node('p', 'Keine SFX gefunden. Spielkatalog aktualisieren.'));return; }
  const entry = state.catalog.entries[key], root = $('detail');root.replaceChildren(node('h2', entry.name || key), node('code', key));
  const nav = node('nav', null, {id: 'workflow', className: 'workflow', role: 'tablist', 'aria-label': 'Produktionsschritte'});
  for (const [id, label] of [['source', '1 · Bestand'], ['generate', '2 · Generieren'], ['process', '3 · Bearbeiten & Ergebnis']]) {
    const control = node('button', label, {id: `step-${id}`, type: 'button', role: 'tab', 'aria-controls': `panel-${id}`});
    control.onclick = () => { if (!activeOperations) showStep(id); };nav.append(control);
  }
  root.append(nav);
  for (const name of ['source', 'generate', 'process']) root.append(node('div', null, {id: `panel-${name}`, role: 'tabpanel', 'aria-labelledby': `step-${name}`, 'data-feedback': `${name}-feedback`}));
  showSource(entry);showRecipe(entry);showProcessor(entry);candidateSignature = '';showCandidates();showJobs();showStep(step, false);
}
function showSource(entry) {
  const root = $('panel-source'), facts = entry.repository, current = card('Aktuellen Sound vergleichen');current.append(node('p', facts.target_path, {className: 'path'}));
  badges(entry).forEach(([text, cls]) => current.append(node('span', text, {className: `badge ${cls}`})));
  if (facts.exists) audio(`/media/game/${key}`, 'Aktuelle Game-Datei', current);
  const volume = node('label', null, {className: 'check'});
  volume.append(node('input', null, {id: 'preview-volume', type: 'checkbox', onchange: () => { document.querySelectorAll('audio').forEach(player => { player.volume = $('preview-volume').checked ? Math.min(1, facts.volume) : 1; }); }}), node('span', `Mit Spiel-Lautstärkefaktor ${facts.volume} vorhören`));current.append(volume);
  if (facts.shared_keys.length > 1) current.append(node('p', `Gemeinsame Datei für: ${facts.shared_keys.join(', ')}`, {className: 'notice'}));
  current.append(button('Game-Datei als Arbeitskopie bearbeiten', async () => { const run = await api(`/api/import/${key}`, {});await refresh();await chooseCandidate(run.id, run.candidates[0].id);showStep('process');return 'Arbeitskopie geladen. Schnitt und Ergebnis sind unter Schritt 3 bereit.'; }, '', 'Game-Datei wird importiert …'), feedback('source-feedback'));root.append(current);
  if (entry.copy_notice && !entry.copy_notice.hidden) {
    const notice = card('Kopie-Hinweis');notice.append(node('p', `Ursprüngliche Kopie aus ${entry.copy_notice.source_path}. ${entry.copy_notice.reason}`), button('Hinweis dauerhaft ausblenden', async () => { await api(`/api/catalog/${key}/hide-notice`, {revision: state.revision});await refresh(true);return 'Kopie-Hinweis dauerhaft ausgeblendet.'; }));root.append(notice);
  }
  root.append(details('Verwendungen und Autorenhinweise', append(node('div'), json(facts.usages), node('p', entry.notes || 'Keine zusätzlichen Hinweise.'))));
  if (entry.suggested_changes.length) root.append(details(`${entry.suggested_changes.length} Änderungsvorschläge`, json(entry.suggested_changes)));
}
function showRecipe(entry) {
  formRevision = state.revision;formEntry = structuredClone(entry);
  const panel = $('panel-generate'), editor = card('Sound erzeugen'), settings = entry.generation_defaults;
  editor.append(node('p', 'Prompt und Modell wählen, Kandidaten erzeugen und einen RAW-Sound zum Bearbeiten auswählen.', {className: 'muted'}));input(editor, 'Englischer Sound-Prompt', 'prompt', entry.prompt.text, 'textarea');
  const grid = node('div', null, {className: 'grid'});
  const models = state.generation_models?.length ? state.generation_models.map(model => [model.name, `${model.label} (${{comfyui: 'ComfyUI', python: 'Python'}[model.backend] || model.backend})`]) : [['medium', 'Stable Audio 3 · Medium'], ['small-sfx', 'Stable Audio 3 · Small-SFX']];
  select(grid, 'Modell', 'model', models, settings.model);
  editor.append(node('p', 'Small-SFX ist über Python und ComfyUI vergleichbar: Für beide Durchläufe denselben Prompt, Seed, dieselbe Dauer, Schritte und CFG verwenden.', {className: 'muted'}));
  input(grid, 'Dauer (Sekunden)', 'duration', settings.duration_seconds, 'number', {min: 1, max: 47, step: 1, required: true});input(grid, 'Kandidaten (nacheinander)', 'count', settings.candidate_count, 'number', {min: 1, max: 32, step: 1, required: true});editor.append(grid);
  const advanced = node('div'), fields = node('div', null, {className: 'grid'});
  input(fields, 'Seed (leer = zufällig)', 'seed', '', 'number', {min: 0, max: 2147483615, step: 1});input(fields, 'Schritte', 'steps', settings.steps, 'number', {min: 1, max: 100, step: 1});input(fields, 'CFG', 'cfg', settings.cfg_scale, 'number', {min: 0, max: 20, step: .1});advanced.append(fields);
  input(advanced, 'Name', 'name', entry.name);input(advanced, 'Kategorie', 'entry-category', entry.category);input(advanced, 'Soundabsicht', 'intent', entry.intent, 'textarea');input(advanced, 'Dauerhafte Hinweise', 'notes', entry.notes, 'textarea');
  const revise = node('label', null, {className: 'check'});revise.append(node('input', null, {id: 'revise', type: 'checkbox', checked: entry.needs_revision}), node('span', 'Zur Überarbeitung markieren'));advanced.append(revise);editor.append(details('Modellparameter & Katalogpflege', advanced));
  editor.append(append(node('div', null, {className: 'actions'}), button('Rezept speichern', async () => { await save();return 'Produktionsrezept gespeichert.'; }, '', 'Rezept wird gespeichert …'), button('Speichern & generieren', async () => {
    await save();const run = await api(`/api/generate/${key}`, {revision: state.revision, seed: $('seed').value === '' ? null : Number($('seed').value)});observedJobs.set(run.id, run.status);await refresh();
    const current = state.runs.find(item => item.id === run.id);
    if (current?.error) throw new Error(current.error);
    return current?.status === 'complete' ? 'Generierung abgeschlossen. Die neuen RAW-Kandidaten sind bereit.' : 'Generierung eingereiht. Fortschritt und RAW-Kandidaten erscheinen direkt darunter.';
  }, 'primary', 'Rezept wird gespeichert und Generierung gestartet …')));
  const conflict = append(node('div', null, {id: 'recipe-conflict', className: 'notice', hidden: true}), node('p', 'Das Rezept wurde außerhalb dieses Formulars geändert. Neu laden, bevor du deine nächsten Änderungen speicherst.'), button('Aktuelles Rezept neu laden', async () => { clearSelection();await refresh(true);return 'Aktuelles Rezept geladen. Nicht gespeicherte Formulareingaben wurden verworfen.'; }));
  editor.append(conflict, feedback('generate-feedback'), node('div', null, {id: 'generation-progress', 'aria-live': 'polite'}));panel.append(editor);panel.append(append(card('RAW-Kandidaten auswählen'), node('div', null, {id: 'candidates'})));
}
function validateFields(ids) {
  for (const id of ids) if (!$(id).checkValidity()) { $(id).reportValidity();throw new Error(`${$(id).labels?.[0]?.textContent || id}: Bitte einen gültigen Wert eingeben.`); }
}
async function save() {
  validateFields(['duration', 'count', 'seed', 'steps', 'cfg']);if (!Number.isInteger(Number($('duration').value))) throw new Error('Die Generierungsdauer muss eine ganze Sekunde sein.');
  if (formRevision !== state.revision) throw new Error('Das Rezept wurde inzwischen geändert. Zuerst „Aktuelles Rezept neu laden“ wählen.');
  const previous = formEntry, patch = {
    name: $('name').value, category: $('entry-category').value, intent: $('intent').value, playback: $('playback').value,
    prompt: {text: $('prompt').value, source: $('prompt').value === previous.prompt.text ? previous.prompt.source : 'manual', preserve_on_sync: true},
    generation_defaults: {model: $('model').value, duration_seconds: Number($('duration').value), candidate_count: Number($('count').value), steps: Number($('steps').value), cfg_scale: Number($('cfg').value)},
    processing: {profile: $('profile').value, overrides: previous.processing.overrides}, notes: $('notes').value, needs_revision: $('revise').checked,
  };
  const result = await api(`/api/catalog/${key}`, {revision: formRevision, patch}, 'PATCH');state.catalog = result.catalog;state.revision = result.revision;formRevision = result.revision;formEntry = structuredClone(result.catalog.entries[key]);showInventory();
}
function showJobs() {
  const host = $('generation-progress');if (!host) return;
  const runs = state.runs.filter(run => run.key === key && run.status !== 'imported');
  const visible = [...runs.filter(run => activeStatuses.includes(run.status)), ...runs.filter(run => !activeStatuses.includes(run.status)).slice(0, 1)];
  host.replaceChildren(...visible.map(run => {
    const progress = jobProgress(run), row = node('div', null, {className: `job ${progress.kind}`});
    row.append(node('strong', progress.label), node('span', `${run.completed} / ${run.seeds.length} RAW-Kandidaten fertig`, {className: 'muted'}));
    const bar = node('progress', null, {max: 100, 'aria-label': progress.label});if (progress.percent !== null) bar.value = progress.percent;row.append(bar);
    if (progress.detail) row.append(node('p', progress.detail));if (run.error) row.append(node('p', run.error, {className: 'error-text'}));
    if (['queued', 'loading', 'generating'].includes(run.status)) row.append(button('Auftrag abbrechen', async () => { await api(`/api/runs/${run.id}/cancel`, {});await refresh();return 'Abbruch angefordert. Der aktuelle Kandidat kann noch fertig werden.'; }));return row;
  }));
  const active = state.runs.filter(run => activeStatuses.includes(run.status));
  $('activity').textContent = active.length ? `${active.length} Auftrag aktiv · ${state.catalog.entries[active[0].key]?.name || active[0].key}` : 'Keine laufende Generierung';
  $('activity').onclick = () => { if (activeOperations) return;if (active.length && active[0].key !== key) { key = active[0].key;clearSelection();showInventory();showDetail(); }showStep('generate');$('generation-progress').scrollIntoView({behavior: 'smooth', block: 'center'}); };
}
function showCandidates() {
  const container = $('candidates');if (!container) return;
  const runs = state.runs.filter(run => run.key === key);
  // Sampling events must not replace playing audio elements or expanded history.
  const signature = JSON.stringify(runs.map(run => [run.id, run.candidates.filter(candidate => candidate.hash || candidate.failed).map(({progress, ...candidate}) => candidate), run.status]));
  if (signature === candidateSignature) return;candidateSignature = signature;container.replaceChildren();
  if (!runs.some(run => run.candidates.length)) container.append(node('p', 'Noch keine RAW-Kandidaten. Starte eine Generierung oder importiere die Game-Datei.', {className: 'muted'}));
  runs.forEach((run, index) => {
    const group = node('div');
    for (const candidate of run.candidates) {
      if (!candidate.hash && !candidate.failed) continue;
      const box = node('div', null, {className: `candidate${chosen?.run_id === run.id && chosen?.candidate_id === candidate.id ? ' selected' : ''}`});
      box.append(node('h4', `Kandidat ${Number(candidate.id) + 1} · ${generationLabel(run, candidate, state.generation_models)}`), node('p', `${generationSettings(run, candidate)} · ${candidate.versions.length} Bearbeitungen${candidate.protected ? ' · übernommene Quelle geschützt' : ''}`, {className: 'muted'}));
      if (candidate.failed || candidate.cleaned) box.append(node('p', candidate.cleaned ? 'Audiodateien bereinigt; Nachweis erhalten.' : 'Fehlgeschlagenes RAW; nur Historie und Bereinigung verfügbar.', {className: 'warn-text'}));
      else {
        audio(media(run.id, candidate.id), 'RAW vorhören', box);
        box.append(append(node('div', null, {className: 'actions'}), button('Bearbeiten →', async () => { await chooseCandidate(run.id, candidate.id);showStep('process');return 'RAW geladen. Schnitt, Wellenformen und Versionen sind unter Schritt 3 bereit.'; }, 'primary', 'RAW und Wellenformen werden geladen …'),
          button(candidate.favorite ? '★ Favorit' : '☆ Favorisieren', async () => { await api(`/api/runs/${run.id}/${candidate.id}`, {favorite: !candidate.favorite}, 'PATCH');await refresh();return candidate.favorite ? 'Favorit entfernt.' : 'Kandidat favorisiert.'; }),
          button(candidate.discarded ? 'Verwerfen zurücknehmen' : 'Verwerfen', async () => { await api(`/api/runs/${run.id}/${candidate.id}`, {discarded: !candidate.discarded}, 'PATCH');await refresh();return candidate.discarded ? 'Kandidat wiederhergestellt.' : 'Kandidat zum Verwerfen markiert.'; })));
      }
      box.append(details('Generierungsnachweis', json(candidate.generation)));group.append(box);
    }
    if (run.error) group.append(node('p', run.error, {className: 'error-text'}));
    if (run.candidates.length || run.error) container.append(details(`${date(run.created_at)} · ${generationLabel(run, run.candidates[0], state.generation_models)} · ${run.completed} Kandidaten${run.status === 'failed' ? ' · Fehlgeschlagen' : ''}`, group, index === 0));
  });updateSourceOptions();
}
function candidateOptions() { return state.runs.filter(run => run.key === key).flatMap(run => run.candidates.filter(candidate => candidate.hash && !candidate.failed && !candidate.cleaned).map(candidate => ({run, candidate}))); }
function updateSourceOptions() {
  const control = $('source-candidate');if (!control) return;const value = chosen ? `${chosen.run_id}/${chosen.candidate_id}` : '';
  control.replaceChildren(node('option', 'RAW-Kandidaten auswählen …', {value: ''}), ...candidateOptions().map(({run, candidate}) => node('option', `${generationLabel(run, candidate, state.generation_models)} · Seed ${candidate.seed ?? '–'} · ${date(run.created_at)} · Kandidat ${Number(candidate.id) + 1}`, {value: `${run.id}/${candidate.id}`})));control.value = value;
}
function currentCandidate() { return state.runs.find(item => item.id === chosen?.run_id)?.candidates.find(item => item.id === chosen?.candidate_id); }

function showProcessor(entry) {
  const panel = $('panel-process'), editor = card('RAW schneiden und formen');
  select(editor, 'Ausgangskandidat', 'source-candidate', [['', 'RAW-Kandidaten auswählen …']], '');
  const settings = node('div', null, {className: 'grid two'});
  select(settings, 'Wiedergabe', 'playback', [['unknown', 'Unklar – zuerst prüfen'], ['oneshot', 'One-Shot'], ['loop', 'Loop']], entry.playback);
  select(settings, 'Processing-Profil', 'profile', Object.keys(state.profiles).map(profile => [profile, profile]), entry.processing.profile);editor.append(settings);
  editor.append(node('p', 'Markierung wählen und im RAW klicken oder ziehen. Die Zeitfelder lassen sich auch direkt eingeben.', {className: 'muted'}));
  const modes = node('div', null, {className: 'marker-tools', role: 'group', 'aria-label': 'Markierung mit der Maus setzen'});
  for (const [value, label] of [['start', 'Start'], ['end', 'Ende'], ['fade-in', 'Fade-In'], ['fade-out', 'Fade-Out']]) {
    const item = node('label', null, {className: 'marker-choice'});
    item.append(node('input', null, {type: 'radio', name: 'marker', value, checked: value === 'start'}), node('span', label));modes.append(item);
  }
  editor.append(modes, node('canvas', null, {id: 'wave', width: 1100, height: 240, tabIndex: 0, 'aria-label': 'RAW-Wellenform. Markierung per Maus setzen; Pfeiltasten verschieben die ausgewählte Markierung um eine Millisekunde.'}), node('p', '', {id: 'selection-summary', className: 'muted'}));
  const fields = node('div', null, {className: 'grid'}), overrides = entry.processing.overrides;
  input(fields, 'Start (ms, leer = automatisch)', 'cut-start', overrides.start_seconds === undefined ? '' : milliseconds(overrides.start_seconds), 'number', {min: 0, max: 24000, step: .1});
  input(fields, 'Ende (ms, leer = automatisch)', 'cut-end', overrides.end_seconds === undefined ? '' : milliseconds(overrides.end_seconds), 'number', {min: 0, max: 47000, step: .1});
  input(fields, 'Output Gain (dB)', 'gain', overrides.output_gain_db ?? 0, 'number', {min: -60, max: 18, step: .1});
  input(fields, 'Fade-In (ms)', 'fade-in', overrides.fade_in_ms ?? '', 'number', {min: 0, max: 1000, step: .1});
  input(fields, 'Fade-Out (ms)', 'fade-out', overrides.fade_out_ms ?? '', 'number', {min: 0, max: 5000, step: .1});
  input(fields, 'Loop-Crossfade (ms)', 'crossfade', overrides.crossfade_ms ?? '', 'number', {min: 0, max: 5000, step: .1});editor.append(fields);
  select(editor, 'Loop-Crossfade-Kurve', 'curve', [['linear', 'Linear'], ['equal_power', 'Equal Power']], overrides.crossfade_curve ?? 'linear');
  const trim = node('label', null, {className: 'check'});trim.append(node('input', null, {id: 'auto-trim', type: 'checkbox', checked: overrides.auto_trim ?? state.profiles[entry.processing.profile].auto_trim}), node('span', 'Automatische Bereichserkennung, soweit Start/Ende leer sind'));editor.append(trim);
  editor.append(append(node('div', null, {className: 'actions'}), button('Schnitt zurücksetzen', async () => {
    for (const id of ['cut-start', 'cut-end', 'fade-in', 'fade-out']) $(id).value = '';
    $('auto-trim').checked = state.profiles[$('profile').value].auto_trim;drawWaves();markResultStale();return 'Schnittfelder zurückgesetzt. Automatische Werte werden bei der nächsten Bearbeitung berechnet.';
  }), button('WAV & OGG erzeugen', processSelected, 'primary', 'RAW wird geschnitten, bearbeitet und als WAV/OGG geprüft …')));
  editor.append(feedback('process-feedback'));panel.append(editor);
  const result = card('Bearbeitetes Ergebnis');result.id = 'results';
  result.append(node('p', 'Nach der Bearbeitung erscheinen WAV, OGG und die tatsächlich erzeugte Wellenform hier.', {id: 'result-description', className: 'muted'}), node('div', null, {id: 'version-list'}), node('div', null, {id: 'result-stale', className: 'warn-text', role: 'status'}), node('canvas', null, {id: 'result-wave', width: 1100, height: 240, 'aria-label': 'Wellenform der tatsächlich bearbeiteten WAV-Datei'}), node('div', null, {id: 'result-audio'}));panel.append(result);
  $('source-candidate').onchange = event => {
    const value = event.target.value;if (!value) return;
    work(async () => { const [run, candidate] = value.split('/');await chooseCandidate(run, candidate);return 'Ausgangskandidat und vorhandene Versionen geladen.'; }, {target: 'process-feedback', busy: 'Wellenformen werden geladen …'});
  };
  $('profile').onchange = () => { $('auto-trim').checked = state.profiles[$('profile').value].auto_trim;drawWaves();markResultStale(); };
  $('playback').onchange = () => { updateLoopControls();drawWaves();markResultStale(); };
  for (const id of ['cut-start', 'cut-end', 'fade-in', 'fade-out', 'gain', 'crossfade', 'curve', 'auto-trim']) $(id).addEventListener('input', () => { drawWaves();markResultStale(); });
  setupWavePointer();updateLoopControls();drawWaves();
}
function updateLoopControls() {
  const loop = $('playback').value === 'loop';
  for (const id of ['fade-in', 'fade-out']) $(id).disabled = loop;
  for (const input of document.querySelectorAll('input[name="marker"]')) input.disabled = loop && input.value.startsWith('fade');
  if (loop && document.querySelector('input[name="marker"]:checked')?.disabled) document.querySelector('input[name="marker"][value="start"]').checked = true;
  $('crossfade').disabled = !loop;$('curve').disabled = !loop;
}
function selection() {
  if (!waveform) return null;const profile = state.profiles[$('profile').value];
  return {duration_ms: milliseconds(waveform.duration_seconds), start_ms: Number($('cut-start').value || 0), end_ms: $('cut-end').value === '' ? milliseconds(waveform.duration_seconds) : Number($('cut-end').value), fade_in_ms: $('fade-in').value === '' ? profile.fade_in_ms : Number($('fade-in').value), fade_out_ms: $('fade-out').value === '' ? profile.fade_out_ms : Number($('fade-out').value), loop: $('playback').value === 'loop'};
}
function drawWaves() {
  drawWaveform($('wave'), waveform, {selection: selection(), title: 'RAW · Quelle und Schnittmarkierungen'});
  drawWaveform($('result-wave'), resultWaveform, {title: resultWaveform ? 'WAV · tatsächlich bearbeitet' : 'Noch keine bearbeitete WAV ausgewählt.', color: '#92ccf3'});
  if (waveform && $('selection-summary')) {
    const range = selection();$('selection-summary').textContent = `RAW: ${range.duration_ms} ms · Markierter Bereich: ${range.start_ms}–${range.end_ms} ms · ${Math.max(0, range.end_ms - range.start_ms).toFixed(1)} ms${$('auto-trim').checked && ($('cut-start').value === '' || $('cut-end').value === '') ? ' · Automatische Grenzen werden beim Bearbeiten ermittelt.' : ''}`;
  }
}
function writeSelection(next) {
  $('cut-start').value = next.start_ms.toFixed(1);$('cut-end').value = next.end_ms.toFixed(1);
  if (!next.loop) { $('fade-in').value = next.fade_in_ms.toFixed(1);$('fade-out').value = next.fade_out_ms.toFixed(1); }drawWaves();markResultStale();
}
function setupWavePointer() {
  const canvas = $('wave');let dragging = false;
  const apply = event => {
    if (!waveform || activeOperations) return;
    const marker = document.querySelector('input[name="marker"]:checked').value, rect = canvas.getBoundingClientRect();
    writeSelection(moveMarker(selection(), marker, (event.clientX - rect.left) / rect.width));
  };
  canvas.onpointerdown = event => { if (event.button !== 0 || !waveform || activeOperations) return;dragging = true;canvas.setPointerCapture(event.pointerId);canvas.focus();apply(event);event.preventDefault(); };
  canvas.onpointermove = event => { if (dragging) apply(event); };canvas.onpointerup = canvas.onpointercancel = () => { dragging = false; };
  canvas.onkeydown = event => {
    if (!waveform || !['ArrowLeft', 'ArrowRight'].includes(event.key) || activeOperations) return;
    const range = selection(), marker = document.querySelector('input[name="marker"]:checked').value;
    const current = {start: range.start_ms, end: range.end_ms, 'fade-in': range.start_ms + range.fade_in_ms, 'fade-out': range.end_ms - range.fade_out_ms}[marker];
    writeSelection(moveMarker(range, marker, (current + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1)) / range.duration_ms));event.preventDefault();
  };
}
function markResultStale() { if (resultVersion) $('result-stale').textContent = 'Einstellungen geändert. Die angezeigte WAV/OGG-Version bleibt der letzte Stand; erneut „WAV & OGG erzeugen“ ausführen.'; }
async function chooseCandidate(runId, candidateId) {
  const fresh = await api(`/api/waveform/${runId}/${candidateId}`);
  chosen = {run_id: runId, candidate_id: candidateId};waveform = fresh;resultWaveform = null;resultVersion = null;
  $('source-candidate').value = `${runId}/${candidateId}`;$('cut-start').max = Math.min(24000, milliseconds(fresh.duration_seconds));$('cut-end').max = milliseconds(fresh.duration_seconds);
  const run = state.runs.find(item => item.id === runId), defaults = run.author_snapshot.processing;
  $('profile').value = defaults.profile;$('playback').value = run.author_snapshot.playback;fillProcessing(defaults.overrides);
  candidateSignature = '';showCandidates();updateVersions();drawWaves();
  const versions = currentCandidate().versions.filter(version => version.status !== 'failed');if (versions.length) await showVersion(versions.at(-1).id, true);
}
function fillProcessing(overrides) {
  for (const [id, name, factor] of [['cut-start', 'start_seconds', 1000], ['cut-end', 'end_seconds', 1000], ['fade-in', 'fade_in_ms', 1], ['fade-out', 'fade_out_ms', 1], ['crossfade', 'crossfade_ms', 1]]) $(id).value = overrides[name] === undefined ? '' : Math.round(overrides[name] * factor * 10) / 10;
  $('gain').value = overrides.output_gain_db ?? 0;$('curve').value = overrides.crossfade_curve ?? 'linear';$('auto-trim').checked = overrides.auto_trim ?? state.profiles[$('profile').value].auto_trim;updateLoopControls();
}
async function processSelected() {
  if (!chosen) throw new Error('Zuerst einen RAW-Kandidaten auswählen.');validateFields(['cut-start', 'cut-end', 'gain', 'fade-in', 'fade-out', 'crossfade']);
  const overrides = processingOverrides({start: $('cut-start').value, end: $('cut-end').value, fade_in: $('fade-in').value, fade_out: $('fade-out').value, gain: $('gain').value, crossfade: $('crossfade').value, curve: $('curve').value, auto_trim: $('auto-trim').checked});
  let version;
  try { version = await api(`/api/runs/${chosen.run_id}/${chosen.candidate_id}/process`, {playback: $('playback').value, profile: $('profile').value, overrides, replace_overrides: true}); }
  catch (error) {
    await refresh();updateVersions();
    const failed = currentCandidate()?.versions.at(-1);if (failed?.status === 'failed') await showVersion(failed.id);
    throw error;
  }
  await refresh();updateVersions();
  await showVersion(version.id);$('results').scrollIntoView({behavior: 'smooth', block: 'start'});
  return 'Bearbeitung abgeschlossen. WAV, OGG und die tatsächliche Wellenform stehen direkt im Ergebnisbereich bereit.';
}
function updateVersions() {
  const host = $('version-list');if (!host) return;host.replaceChildren();$('result-audio').replaceChildren();$('result-stale').textContent = '';
  if (!chosen) return;const versions = currentCandidate()?.versions || [];
  if (!versions.length) { resultVersion = null;resultWaveform = null;drawWaves();return; }
  const picker = select(host, 'Bearbeitungsversion', 'result-version', versions.map((version, index) => [version.id, `Version ${index + 1} · ${date(version.created_at)} · ${version.status === 'failed' ? 'Fehlgeschlagen' : version.profile} / ${version.playback}`]).reverse(), resultVersion?.id || versions.at(-1).id);
  picker.onchange = () => work(() => showVersion(picker.value), {target: 'process-feedback', busy: 'Bearbeitete WAV wird geladen …'});
}
async function showVersion(id, loadRecipe = false) {
  const candidate = currentCandidate(), version = candidate?.versions.find(item => item.id === id);if (!version) return;const sequence = ++resultSequence;
  resultVersion = null;resultWaveform = null;$('result-audio').replaceChildren();$('result-stale').textContent = '';drawWaves();if ($('result-version')) $('result-version').value = id;
  if (version.status === 'failed') { $('result-audio').append(node('p', `Bearbeitung fehlgeschlagen: ${version.recipe.error}`, {className: 'error-text'}));$('result-description').textContent = 'Keine verwendbare WAV/OGG-Version erzeugt.';return 'Fehlernachweis der Bearbeitung angezeigt.'; }
  const fresh = await api(`/api/waveform/${chosen.run_id}/${chosen.candidate_id}?kind=wav&version_id=${encodeURIComponent(id)}`);if (sequence !== resultSequence) return;
  resultVersion = version;resultWaveform = fresh;const recipe = version.recipe.recipe;
  if (loadRecipe) { $('profile').value = version.profile;$('playback').value = version.playback;fillProcessing({...recipe.overrides, start_seconds: recipe.cuts.start_seconds, end_seconds: recipe.cuts.end_seconds, fade_in_ms: recipe.fades.fade_in_ms, fade_out_ms: recipe.fades.fade_out_ms}); }
  $('result-description').textContent = `RAW ${milliseconds(waveform.duration_seconds)} ms → WAV ${milliseconds(fresh.duration_seconds)} ms · Schnitt ${milliseconds(recipe.cuts.start_seconds)}–${milliseconds(recipe.cuts.end_seconds)} ms · Fade-In ${recipe.fades.fade_in_ms.toFixed(1)} ms / Fade-Out ${recipe.fades.fade_out_ms.toFixed(1)} ms. Beide Wellenformen zeigen dieselbe Amplitudenskala; die Zeitachse passt zur jeweiligen Datei.`;
  const host = $('result-audio'), players = node('div', null, {className: 'grid two'}), wav = node('div'), ogg = node('div');
  audio(media(chosen.run_id, chosen.candidate_id, 'wav', id), 'Bearbeitetes WAV', wav);audio(media(chosen.run_id, chosen.candidate_id, 'ogg', id), 'Finales OGG · Datei für das Spiel', ogg);players.append(wav, ogg);host.append(players);
  if (version.files.loop) audio(media(chosen.run_id, chosen.candidate_id, 'loop', id), 'Loop-Prüfung · drei OGG-Wiederholungen', host);
  const warnings = version.recipe.analysis?.warnings || [];
  if (warnings.length) host.append(details(`${warnings.length} Hinweise zur Bearbeitung`, append(node('ul'), ...warnings.map(warning => node('li', warning))), true));
  host.append(button('Einstellungen dieser Version laden', async () => { await showVersion(id, true);return 'Schnitt und Fades dieser Version geladen. Weitere Bearbeitung verwendet wieder das unveränderte RAW.'; }));
  const selected = {...chosen, version_id: id}, checkbox = node('input', null, {type: 'checkbox', checked: basket.get(key)?.version_id === id});
  checkbox.onchange = () => { if (checkbox.checked) basket.set(key, selected);else basket.delete(key);updateBasket(); };
  host.append(node('p', '', {id: 'result-selection', className: 'muted'}), append(node('label', null, {className: 'check export-choice'}), checkbox, node('span', 'Diese OGG-Version zur Übernahme auswählen')), details('Messwerte & vollständiges Rezept', json(version.recipe)));
  updateBasket();drawWaves();return 'Bearbeitete WAV und OGG-Version angezeigt.';
}

function updateBasket() {
  $('basket-count').textContent = basket.size ? [...basket.entries()].map(([id, selection]) => {
    const candidate = state.runs.find(run => run.id === selection.run_id)?.candidates.find(item => item.id === selection.candidate_id);
    const index = candidate?.versions.findIndex(version => version.id === selection.version_id);
    return `${state.catalog.entries[id]?.name || id} · Version ${index >= 0 ? index + 1 : selection.version_id}`;
  }).join(' | ') : 'Keine OGG-Version ausgewählt';
  $('review').disabled = basket.size === 0;
  if ($('result-selection')) {
    const selected = basket.get(key);
    $('result-selection').textContent = !selected ? 'Für diesen Sound ist noch keine Version zur Übernahme vorgemerkt.' : selected.version_id === resultVersion?.id ? 'Diese angezeigte OGG-Version ist zur Übernahme vorgemerkt.' : 'Eine andere OGG-Version dieses Sounds ist vorgemerkt. Die Übernahmevorschau zeigt diese Auswahl; mit dem Häkchen unten ersetzt du sie durch die angezeigte Version.';
  }
}
function dialog(title) {
  const content = $('dialog-content');content.replaceChildren(node('h2', title), feedback('dialog-feedback'));content.dataset.feedback = 'dialog-feedback';
  if (!$('dialog').open) $('dialog').showModal();return content;
}
async function refresh(full = false) {
  const sequence = ++refreshSequence, fresh = await api('/api/state');if (sequence !== refreshSequence) return;
  for (const run of fresh.runs) {
    const before = observedJobs.get(run.id);
    if (before && activeStatuses.includes(before) && !activeStatuses.includes(run.status)) {
      const name = fresh.catalog.entries[run.key]?.name || run.key;
      report(run.key === key ? 'generate-feedback' : 'global-feedback', run.status === 'complete' ? `${name}: ${run.completed} RAW-Kandidaten fertig. Unter „Generieren“ anhören und auswählen.` : `${name}: ${jobProgress(run).label}${run.error ? ' · ' + run.error : ''}`, run.status === 'failed' || run.status === 'interrupted' ? 'error' : 'success');
    }
    observedJobs.set(run.id, run.status);
  }
  state = fresh;if (!key || !state.catalog.entries[key]) key = Object.keys(state.catalog.entries)[0];
  const categories = [...new Set(Object.values(state.catalog.entries).map(entry => entry.category))].sort(), category = $('category').value;
  $('category').replaceChildren(node('option', 'Alle Kategorien', {value: ''}), ...categories.map(item => node('option', item, {value: item, selected: item === category})));
  showInventory();if (full) showDetail();else showCandidates();showJobs();
  if ($('recipe-conflict')) $('recipe-conflict').hidden = formRevision === state.revision;
}
$('search').oninput = showInventory;$('category').onchange = showInventory;
$('dismiss-message').onclick = () => { $('message').hidden = true; };
$('sync').onclick = event => work(async () => { await api('/api/sync', {});clearSelection();await refresh(true);return 'Spielkatalog aktualisiert. Autorenentscheidungen und ausgeblendete Hinweise erhalten.'; }, {element: event.currentTarget, busy: 'Spielkatalog wird abgeglichen …'});
$('doctor').onclick = event => work(async () => { const result = await api('/api/doctor');dialog('Lokale Modellumgebung').append(json(result));return 'Modellstatus geladen.'; }, {element: event.currentTarget, busy: 'Modelldateien und Laufzeit werden geprüft …'});
$('unload').onclick = event => work(async () => { await api('/api/model/unload', {});return 'Lokales Python-Modell entladen. ComfyUI verwaltet seinen GPU-Speicher selbst.'; }, {element: event.currentTarget, busy: 'Lokales Modell wird entladen …'});
$('review').onclick = event => work(async () => {
  const plan = await api('/api/exports/plan', {selections: [...basket.values()]}), content = dialog('Übernahme freigeben');
  content.append(node('p', 'Jedes OGG anhören und sämtliche betroffenen Keys prüfen. Bei Mehrfachübernahme bleiben frühere erfolgreiche Ziele bei einem späteren Konflikt übernommen.'));
  const checks = [];
  for (const item of plan.items) {
    const row = card(item.key);row.append(node('p', item.target_path, {className: 'path'}), node('p', `Betroffene Keys: ${item.shared_keys.join(', ')}`), node('p', `${item.expected_file_hash ? 'Vorhandene Datei wird ersetzt.' : 'Neue Datei wird abgelegt.'} ${item.whitelist_addition ? `Whitelist wird ergänzt: ${item.whitelist_addition}` : 'Whitelist bleibt unverändert.'}`));
    audio(media(item.run_id, item.candidate_id, 'ogg', item.version_id), 'Freizugebendes OGG', row);row.append(details('Exportprüfung', json(item.analysis)));
    const check = node('input', null, {type: 'checkbox'});checks.push(check);row.append(append(node('label', null, {className: 'check'}), check, node('span', 'Dieses OGG angehört; Ziel, Ersetzung und alle betroffenen Keys freigegeben.')));content.append(row);
  }
  const commit = button('Freigegebene Dateien übernehmen', async () => {
    if (!checks.every(check => check.checked)) throw new Error('Die Freigabe aller angezeigten Dateien fehlt.');
    await api('/api/exports/commit', {plan_id: plan.id, confirmed: true});basket.clear();updateBasket();$('dialog').close();clearSelection();await api('/api/sync', {});await refresh(true);return 'Übernahme geprüft und protokolliert. Spiel für den Hörvergleich neu laden.';
  }, 'primary', 'Freigegebene OGG-Dateien werden übernommen …');
  commit.disabled = true;checks.forEach(check => { check.onchange = () => { commit.disabled = !checks.every(item => item.checked); }; });content.append(commit);return 'Übernahmevorschau bereit. Die Freigabe erfolgt im Dialog.';
}, {element: event.currentTarget, busy: 'Übernahmevorschau wird geprüft …'});
$('cleanup').onclick = event => work(async () => {
  const plan = await api('/api/cleanup/plan', {}), content = dialog('Verworfene Arbeitsdateien bereinigen');
  content.append(node('p', `${plan.items.length} Kandidaten · ${(plan.items.reduce((total, item) => total + item.bytes, 0) / 1048576).toFixed(1)} MiB. Favoriten und übernommene Quellen sind geschützt. Metadaten bleiben erhalten.`), json(plan.items));
  if (plan.items.length) content.append(button('Angezeigte Audiodateien löschen', async () => { await api('/api/cleanup/commit', {plan_id: plan.id, confirmed: true});$('dialog').close();clearSelection();await refresh(true);return 'Ausgewählte Audiodateien bereinigt. Historie erhalten.'; }, 'danger', 'Ausgewählte Arbeitsdateien werden bereinigt …'));return 'Bereinigungsvorschau bereit.';
}, {element: event.currentTarget, busy: 'Bereinigbare Dateien werden geprüft …'});
$('close-dialog').onclick = () => { if (!activeOperations) $('dialog').close(); };
await work(() => refresh(true), {busy: 'Audio Studio wird geladen …'});
let polling = false;
setInterval(async () => {
  if (activeOperations || polling) return;polling = true;
  try { await refresh(); } catch (error) { report('global-feedback', `Studio-Verbindung: ${error.message}`, 'error'); }
  finally { polling = false; }
}, 1000);
