import './workshop.css';
import { VoiceDirector } from '../../../src/voice/VoiceDirector';
import type { VoicePackage } from '../../../src/voice/VoicePackage';
import referenceText from '../reference-text.json';
import { WaveformEditor, type ReferenceDraft } from './WaveformEditor';
import { productionProgress, explainError, TEST_IDS, ACTIVE_JOBS } from './workflow';

const token = document.querySelector<HTMLMetaElement>('meta[name=voice-token]')!.content;
const app = document.querySelector<HTMLDivElement>('#app')!;
let state: any; let tab = 'Referenzen'; let voiceId = ''; let recording: MediaRecorder | null = null;
let notice = ''; let noticeError = false;
let recordingStream: MediaStream | null = null; let recordingContext: AudioContext | null = null;
let poll: number;
const referenceDrafts = new Map<string, ReferenceDraft>();
let referenceEditor: WaveformEditor | null = null;
let recordingPending = false;
let pageActive = true;
const selections = new Set<string>();
const openSections = new Set<string>();
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node;
}
function icon(kind: 'mic' | 'wave' | 'settings'): SVGSVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24'); node.setAttribute('class', 'ui-icon'); node.setAttribute('aria-hidden', 'true');
  const paths = { mic: ['M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0Z', 'M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8'],
    wave: ['M3 10v4M7.5 6v12M12 2v20M16.5 7v10M21 10v4'], settings: ['M4 7h16M4 17h16', 'M9 4v6M15 14v6'] };
  for (const d of paths[kind]) { const path = document.createElementNS(node.namespaceURI, 'path'); path.setAttribute('d', d); node.append(path); }
  return node;
}
function message(text: string, error = false) {
  notice = text; noticeError = error;
  const box = document.querySelector<HTMLElement>('#message'); if (!box) return;
  box.textContent = text; box.hidden = !text; box.className = error ? 'notice error' : 'notice'; box.setAttribute('role', error ? 'alert' : 'status');
}
function changeView(change: () => void) {
  if (recording || recordingPending || referenceEditor?.busy) { message('Bitte zuerst Aufnahme oder Wiedergabe stoppen und Laden der Wellenform abwarten.'); return; }
  change(); render();
}
async function api(action: string, data?: unknown) {
  try {
    const response = await fetch(`/api/${action}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'x-voice-token': token, 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    if (response.status === 403) throw new Error('Die Werkstattsitzung ist abgelaufen. Lade die Seite neu und versuche es erneut.');
    if (response.status === 413) throw new Error('Die Datei ist zu groß. Verwende eine Aufnahme unter 30 Sekunden und 28 MiB.');
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  } catch (error) { throw new Error(explainError(error)); }
}
function button(text: string, action: () => unknown, parent: HTMLElement, disabled = false) {
  const b = el('button', text); b.disabled = disabled; b.onclick = async () => { const previouslyDisabled = b.disabled; b.disabled = true; try { await action(); } catch (error) { message(explainError(error), true); document.querySelector('#message')?.scrollIntoView({ block: 'nearest' }); } finally { b.disabled = previouslyDisabled; } }; parent.append(b); return b;
}
async function mutate(action: string, data: unknown) { state = await api(action, data); render(); }
function field(parent: HTMLElement, label: string, value = '', type = 'text') {
  const row = el('label', label); const input = el('input'); input.type = type; input.value = value; row.append(input); parent.append(row); return input;
}
function check(parent: HTMLElement, text: string, checked: boolean) { const input = field(parent, text, '', 'checkbox'); input.checked = checked; return input; }
function optionalSection(title: string, id: string) {
  const section = el('details'); const key = `${voiceId}:${id}`;
  section.append(el('summary', title)); section.open = openSections.has(key);
  section.ontoggle = () => { if (section.isConnected) { if (section.open) openSections.add(key); else openSections.delete(key); } };
  return section;
}
function audio(parent: HTMLElement, file: string, onEnd?: () => void) {
  const a = el('audio'); a.controls = true; a.preload = 'none'; a.src = `/media/${encodeURIComponent(file)}?token=${token}`; a.onended = onEnd ?? null;
  a.onerror = () => message('Die Aufnahme konnte nicht abgespielt werden. Prüfe, ob die Werkstatt läuft, und lade die Seite neu. Falls nur diese Datei betroffen ist, erzeuge den Take erneut.', true);
  parent.append(a); return a;
}
const status: Record<string, string> = { waiting: 'Wartend', checking: 'Voraussetzungen prüfen', generating: 'Generierung läuft', processing: 'Audio aufbereiten', review: 'Prüfbereit', failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen', interrupted: 'Unterbrochen' };
function render() {
  if (recording || recordingPending) return;
  referenceEditor?.destroy(); referenceEditor = null;
  app.replaceChildren();
  const header = el('header', '', 'app-header'); const brand = el('div', '', 'brand');
  const mark = el('span', '', 'brand-mark'); mark.append(icon('wave')); const title = el('div');
  title.append(el('div', 'FRAGDACHSE', 'eyebrow'), el('h1', 'Voice-Werkstatt')); brand.append(mark, title); header.append(brand);
  const headerActions = el('div', '', 'header-actions'); headerActions.append(el('span', 'Lokal auf deinem Rechner', 'local-badge'));
  const settings = el('details', '', 'maintenance'); const settingsLabel = el('summary', 'Werkstatt verwalten'); settingsLabel.prepend(icon('settings')); settings.append(settingsLabel);
  const controls = el('div', '', 'row'); settings.append(controls);
  button('Private ComfyUI-Kopien bereinigen', () => mutate('cleanup', {}), controls);
  button('Generator prüfen', async () => { const result = await api('generator'); message(result.ok ? 'Generator bereit. Du kannst den Stimmtest starten.' : explainError(new Error(result.message)), !result.ok); }, controls);
  button('Dienst beenden', async () => { await api('shutdown', {}); clearInterval(poll); message('Werkstatt beendet. Zum Weiterarbeiten den Dienst neu starten und diese Seite neu laden.'); }, controls).classList.add('danger'); headerActions.append(settings); header.append(headerActions); app.append(header);
  const hero = el('section', '', 'page-heading'); const heroCopy = el('div');
  heroCopy.append(el('div', tab === 'Referenzen' ? 'DEIN PERSÖNLICHES VOICE-STUDIO' : 'VON DER STIMME ZUM SPIEL', 'eyebrow'), el('h2', tab === 'Referenzen' ? 'Deine Stimme. Dein Charakter.' : 'Gib deinen Sprüchen Leben.'),
    el('p', tab === 'Referenzen' ? 'Eine gute Aufnahme ist der Anfang. Den Rest machst du hier.' : 'Teste deine Stimme, produziere deine Sprüche und stelle dein Paket zusammen.'));
  const voiceCount = state.voices.filter((v: any) => !v.archived).length;
  const library = el('div', '', 'library-count'); library.append(el('strong', String(voiceCount)), el('span', `${voiceCount === 1 ? 'Stimme' : 'Stimmen'} in deiner Werkstatt`)); hero.append(heroCopy, library); app.append(hero);
  const nav = el('nav', '', 'main-nav'); nav.setAttribute('aria-label', 'Arbeitsbereich');
  for (const [index, [name, label, description]] of [['Referenzen', 'Referenzen aufnehmen', 'Name & kurze Aufnahme'], ['Produktion', 'Für die LAN produzieren', 'Sprüche erzeugen & ins Spiel übernehmen']].entries()) {
    const b = button('', () => changeView(() => { tab = name; }), nav); b.append(icon(index === 0 ? 'mic' : 'wave'));
    const copy = el('span', '', 'nav-copy'); copy.append(el('strong', label), el('small', description)); b.append(copy, el('span', `0${index + 1}`, 'nav-index'));
    b.setAttribute('aria-current', String(name === tab));
  }
  app.append(nav, el('p'));
  app.lastElementChild!.id = 'message';
  message(notice, noticeError);
  const main = el('main'); app.append(main);
  if (tab === 'Referenzen') renderVoices(main);
  if (tab === 'Produktion') renderProduction(main);
  const footer = el('footer', '', 'row');
  const queued = state.jobs.filter((j: any) => j.status === 'waiting').length;
  const running = state.jobs.find((j: any) => ['checking', 'generating', 'processing'].includes(j.status));
  const ready = state.jobs.filter((j: any) => !j.stale && j.status === 'review' && !j.decision).length;
  footer.append(el('span', running ? 'IN ARBEIT' : queued ? 'WARTESCHLANGE' : 'STUDIO', `queue-badge${running ? ' running' : ''}`));
  footer.append(el('span', running ? `${status[running.status]}: ${running.text} · ${queued} weitere wartend` : queued ? `${queued} Aufträge warten · ${state.paused ? 'pausiert' : 'werden nacheinander erzeugt'}` : ready ? `${ready} Aufnahmen fertig · Anhören ist optional.` : 'Bereit für deine nächste Stimme.'));
  if (queued || running) {
    button(state.paused ? 'Warteschlange fortsetzen' : 'Nach aktuellem Take pausieren', () => mutate(state.paused ? 'resume' : 'pause', {}), footer);
    button('Warteschlange abbrechen', () => mutate('cancel', {}), footer);
  }
  app.append(footer);
}
function renderVoices(main: HTMLElement) {
  const layout = el('div', '', 'grid'); const list = el('aside', '', 'voice-sidebar'); const detail = el('section', '', 'voice-detail'); layout.append(list, detail); main.append(layout);
  list.append(el('div', 'DEINE STIMMEN', 'eyebrow'));
  button('+ Neue Stimme', () => changeView(() => { voiceId = ''; }), list).classList.add('new-voice');
  for (const voice of state.voices) {
    const item = button('', () => changeView(() => { voiceId = voice.id; }), list); item.className = 'voice-item'; item.setAttribute('aria-current', String(voice.id === voiceId));
    const avatar = el('span', voice.name.trim().slice(0, 1).toUpperCase(), 'voice-avatar'); avatar.setAttribute('aria-hidden', 'true');
    const copy = el('span', '', 'voice-copy'); copy.append(el('strong', voice.name), el('small', voice.archived ? 'Archiviert' : voice.reference ? 'Referenz gespeichert' : 'Aufnahme fehlt'));
    const indicator = el('span', voice.reference && !voice.archived ? '●' : '○', 'voice-indicator'); indicator.setAttribute('aria-hidden', 'true'); item.append(avatar, copy, indicator);
  }
  if (!state.voices.length) list.append(el('p', 'Deine erste Stimme beginnt mit einer kurzen Aufnahme.', 'sidebar-hint'));
  const voice = state.voices.find((v: any) => v.id === voiceId);
  detail.append(el('div', voice ? 'REFERENZAUFNAHME' : 'LOS GEHT’S', 'eyebrow'));
  detail.append(el('h2', voice ? `Referenz für ${voice.name}` : 'Neue Stimme anlegen'), el('p', 'Hier bereitest du die Stimme vor: Profil speichern → Text aufnehmen → Ausschnitt anhören und speichern. Die Generierung folgt im Bereich Produktion.', 'intro'));
  const form = el('article', '', 'profile-card'); form.append(el('h3', '1 · Profil und Zustimmung')); const name = field(form, 'Anzeigename', voice?.name ?? '');
  const consent = check(form, 'Die sprechende Person ist mit Generierung und Nutzung in unserer LAN-Runde einverstanden.', !!voice?.consentGenerate && !!voice?.consentLan);
  const more = el('details', '', 'profile-more'); more.append(el('summary', 'Weitere Profileinstellungen'));
  const publicUse = check(more, 'Öffentliche Weitergabe gesondert erlaubt (keine automatische Veröffentlichung).', voice?.consentPublic ?? false);
  const archived = check(more, 'Stimme archivieren und neue Generierungen sperren', voice?.archived ?? false); form.append(more);
  button('Profil speichern & aufnehmen', async () => { state = await api('voice', { id: voice?.id, name: name.value, consentGenerate: consent.checked, consentLan: consent.checked, consentPublic: publicUse.checked, archived: archived.checked }); voiceId = voice?.id ?? state.voices.at(-1).id; message('Profil gespeichert. Jetzt den Vorlesetext aufnehmen.'); render(); }, form).classList.add('primary');
  if (voice?.reference && voice.consentGenerate && voice.consentLan) {
    const profile = el('details', '', 'profile-settings'); const summary = el('summary', '1 · Profil und Zustimmung'); summary.append(el('span', 'Gespeichert', 'saved-label'));
    profile.append(summary, form); detail.append(profile);
  } else detail.append(form);
  if (!voice) return;
  const record = el('article', '', 'recording-card'); record.append(el('h2', '2 · Vorlesetext aufnehmen'), el('p', 'Lies immer diesen vollständigen Text wortgetreu und natürlich vor, ohne Schauspiel oder Hintergrundmusik. Lass vor und nach dem Text eine kurze Pause.'),
    el('blockquote', referenceText.text, 'reference-script'), el('p', 'Der Vorlesetext wird automatisch als Referenztranskript übernommen. Abtippen ist nicht nötig. Schneide nur Pausen am Anfang und Ende ab, keine gesprochenen Wörter.'));
  const inputStrip = el('div', '', 'input-strip'); record.append(inputStrip);
  const deviceLabel = el('label', 'MIKROFON'); const devices = el('select'); devices.setAttribute('aria-label', 'Mikrofon'); const defaultDevice = el('option', 'Standardmikrofon'); defaultDevice.value = ''; devices.append(defaultDevice); deviceLabel.append(devices); inputStrip.append(deviceLabel);
  void navigator.mediaDevices?.enumerateDevices().then(items => { for (const d of items.filter(d => d.kind === 'audioinput' && d.deviceId)) { const o = el('option', d.label || `Mikrofon ${devices.length}`); o.value = d.deviceId; devices.append(o); } });
  const meter = el('meter'); meter.min = 0; meter.max = 1; meter.setAttribute('aria-label', 'Mikrofonpegel'); const elapsed = el('span', '0 s', 'recording-time'); inputStrip.append(meter, elapsed);
  const recordButtons = el('div', '', 'row'); record.append(recordButtons);
  record.append(el('h3', '3 · Zuschneiden, anhören und speichern'));
  const sourceVoiceId = voice.id;
  const editor = new WaveformEditor(record, referenceDrafts.get(sourceVoiceId) ?? null,
    draft => referenceDrafts.set(sourceVoiceId, draft), text => message(explainError(new Error(text)), true)); referenceEditor = editor;
  const recordButton = button('Aufnehmen / neu aufnehmen', async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Mikrofon benötigt localhost und eine Browserberechtigung. Alternativ Datei importieren.');
    if (recording || recordingPending) return;
    recordingPending = true; editor.setLocked(true);
    document.querySelectorAll('audio').forEach(a => a.pause());
    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: devices.value ? { deviceId: { exact: devices.value } } : true });
      if (!pageActive) { stopTracks(); return; }
      recordingContext = new AudioContext(); const analyser = recordingContext.createAnalyser(); analyser.fftSize = 256;
      recordingContext.createMediaStreamSource(recordingStream).connect(analyser);
      const chunks: BlobPart[] = []; const recorder = new MediaRecorder(recordingStream); recording = recorder; const began = performance.now();
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => { const blob = new Blob(chunks, { type: recorder.mimeType }); stopTracks(); recording = null; meter.value = 0; recordButton.disabled = false; editor.setLocked(false); void editor.load(blob).then(() => message('Aufnahme beendet. Wähle den Ausschnitt, höre ihn an und speichere die Referenz.')).catch(error => message(explainError(error), true)); };
      recorder.onerror = () => { stopTracks(); recording = null; recordButton.disabled = false; editor.setLocked(false); message('Aufnahme fehlgeschlagen. Bitte erneut aufnehmen.'); };
      const sample = new Uint8Array(analyser.fftSize);
      const tick = () => { if (!recording) return; analyser.getByteTimeDomainData(sample); meter.value = Math.max(...sample.map(x => Math.abs(x - 128))) / 128; elapsed.textContent = `${((performance.now() - began) / 1000).toFixed(1)} s`; if (performance.now() - began > 29000) recorder.stop(); else requestAnimationFrame(tick); };
      recorder.start(); tick();
    } catch (error) { stopTracks(); recording = null; throw error; }
    finally { recordingPending = false; if (!recording) editor.setLocked(false); }
  }, recordButtons);
  recordButton.classList.add('record-button');
  button('Stoppen', () => { if (recording?.state === 'recording') recording.stop(); }, recordButtons);
  const file = field(record, 'Oder Aufnahme desselben Vorlesetexts importieren', '', 'file'); file.accept = 'audio/*'; file.onchange = () => {
    if (recording || recordingPending) { message('Bitte zuerst die Aufnahme stoppen.'); return; }
    if (file.files?.[0]) void editor.load(file.files[0]).catch(error => message(explainError(error), true));
  };
  button('Referenz speichern & weiter', async () => {
    if (recording || recordingPending || editor.busy) throw new Error('Aufnahme oder Wiedergabe zuerst stoppen und Laden der Wellenform abwarten.');
    const draft = referenceDrafts.get(sourceVoiceId); if (!draft) throw new Error('Zuerst aufnehmen oder eine Datei wählen.');
    const { start, end } = draft.selection;
    const encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(draft.blob); });
    state = await api('reference', { voiceId: sourceVoiceId, audio: encoded, referenceTextId: referenceText.id, start, end });
    referenceDrafts.delete(sourceVoiceId); tab = 'Produktion'; message('Referenz gespeichert. Jetzt die LAN-Sprüche erzeugen – sie laufen ohne einzelne Freigaben durch.'); render();
  }, record).classList.add('primary');
  if (voice.reference) {
    record.append(el('p', `Gespeicherte Referenz · ${voice.referenceInfo.duration.toFixed(1)} s · ${voice.referenceInfo.warnings.join(' · ')}`)); audio(record, voice.reference);
    if (voice.referenceTextId === referenceText.id || voice.transcript === referenceText.text) button('Gespeicherte Referenz in Wellenform bearbeiten', async () => {
      if (recording || recordingPending) throw new Error('Aufnahme zuerst stoppen.');
      recordingPending = true;
      try {
        const response = await fetch(`/media/${encodeURIComponent(voice.reference)}?token=${token}`);
        if (!response.ok) throw new Error('Gespeicherte Referenz konnte nicht geladen werden.');
        await editor.load(await response.blob());
      } finally { recordingPending = false; }
    }, record);
    else record.append(el('p', 'Diese ältere Referenz verwendet noch einen eigenen Text. Für den einheitlichen Vorlesetext bitte neu aufnehmen.', 'warning'));
    button('Alle lokalen Referenzen löschen', async () => { state = await api('delete-reference', { voiceId: sourceVoiceId }); referenceDrafts.delete(sourceVoiceId); render(); }, record);
  }
  detail.append(record);
  const next = el('article', '', 'next-step'); next.append(el('h3', 'Referenz bereit? Weiter zur Produktion'), el('p', voice.reference ? 'Die Referenz ist gespeichert. Du kannst direkt alle LAN-Sprüche erzeugen.' : 'Speichere zuerst eine Referenz. Danach geht es hier mit der Produktion weiter.'));
  button('Weiter zur LAN-Produktion', () => changeView(() => { tab = 'Produktion'; }), next, !voice.reference); detail.append(next);
}
function stopTracks() { recordingStream?.getTracks().forEach(track => track.stop()); recordingStream = null; void recordingContext?.close(); recordingContext = null; }
window.addEventListener('pagehide', () => { pageActive = false; if (recording?.state === 'recording') recording.stop(); stopTracks(); referenceEditor?.destroy(); referenceDrafts.clear(); });
window.addEventListener('pageshow', event => { pageActive = true; if (event.persisted && state) render(); });
function renderCatalog(main: HTMLElement) {
  main.append(el('h2', `Gemeinsamer Satzkatalog · Revision ${state.catalogVersion}`), el('p', 'Normale, eher neutrale Sprüche nutzen Ultimate Cloning. Emotionale Sprüche nutzen Controllable Cloning mit Darbietungsvorgabe. Änderungen machen Entwürfe überholt; freigegebene Pakete bleiben unverändert.'));
  for (const sentence of state.catalog) {
    const card = el('article'); card.append(el('h3', `${sentence.id} · ${sentence.event}`)); const row = el('div', '', 'sentence');
    const text = el('textarea'); text.value = sentence.text; text.setAttribute('aria-label', 'Zieltext'); const style = el('textarea'); style.value = sentence.style; style.setAttribute('aria-label', 'Darbietung'); row.append(text, style); card.append(row);
    const modeLabel = el('label', 'Generierungsmodus'); const mode = el('select');
    for (const [value, label] of [['ultimate', 'Neutral · Ultimate Cloning'], ['controllable', 'Emotionen · Controllable Cloning']]) { const option = el('option', label); option.value = value; mode.append(option); }
    mode.value = sentence.cloningMode; modeLabel.append(mode); card.append(modeLabel);
    const hint = el('p'); card.append(hint);
    const updateMode = () => { style.disabled = mode.value === 'ultimate'; hint.textContent = style.disabled ? 'Darbietung wie die Referenz; die Stilvorgabe wird nicht verwendet.' : 'Die Stilvorgabe steuert Emotion und Darbietung bei gleicher Referenzstimme.'; }; mode.onchange = updateMode; updateMode();
    const active = check(card, 'Aktiv', sentence.active);
    button('Neue Satzrevision speichern', () => mutate('sentence', { id: sentence.id, text: text.value, style: style.value, cloningMode: mode.value, active: active.checked }), card);
    const selectedVoice = state.voices.find((v: any) => v.id === voiceId);
    if (voiceId) button('Diesen Satz erzeugen', () => startGeneration({ voiceId, sentenceId: sentence.id }), card,
      !productionProgress(selectedVoice, state.jobs.filter((j: any) => j.voiceId === voiceId), true).canProduce);
    main.append(card);
  }
}
function renderJob(parent: HTMLElement, job: any) {
  const card = el('article', '', 'take-card');
  const meta = el('div', '', 'take-meta'); const stateLabel = job.stale ? 'Überholt' : job.decision === 'rejected' ? 'Weggelassen' : job.status === 'review' ? (job.test ? 'Probe fertig' : 'Im Paket dabei') : status[job.status];
  const badgeKind = job.stale || job.decision === 'rejected' || ['failed', 'interrupted'].includes(job.status) ? 'attention' : job.status === 'review' ? 'ready' : 'pending';
  meta.append(el('span', job.cloningMode === 'ultimate' ? 'REFERENZSTIMME' : 'MIT EMOTION', 'eyebrow'), el('span', stateLabel, `status-badge ${badgeKind}`));
  card.append(meta, el('h3', job.text), el('p', job.cloningMode === 'ultimate' ? 'Ultimate Cloning · Darbietung wie Referenz' : `Controllable Cloning · ${job.style}`, 'take-style'));
  if (job.error) card.append(el('p', explainError(new Error(job.error)), 'notice error'));
  if (job.stale) card.append(el('p', 'Referenz oder Satz wurden geändert. Dieser alte Take kann nicht mehr freigegeben werden; erzeuge ihn neu.', 'warning'));
  if (job.raw) { const raw = el('details'); raw.append(el('summary', 'Unbearbeitete Aufnahme vergleichen')); audio(raw, job.raw); card.append(raw); }
  if (job.audio && job.status === 'review') {
    card.append(el('p', [`Exportfassung · ${job.audioInfo.duration.toFixed(2)} s`, ...job.audioInfo.warnings].join(' · ')));
    const player = audio(card, job.audio);
    player.onplay = () => { document.querySelectorAll('audio').forEach(a => { if (a !== player) a.pause(); }); };
    if (!job.test) button(job.decision === 'rejected' ? 'Wieder ins Paket nehmen' : 'Diesen Spruch weglassen', () => mutate('lan-selection', { id: job.id, include: job.decision === 'rejected' }), card, job.stale);
  }
  if (job.raw && ['review', 'failed'].includes(job.status)) {
    const trim = el('details'); trim.append(el('summary', 'Audio nachträglich kürzen')); card.append(trim);
    const start = field(trim, 'Schnitt Anfang', '0', 'number'); const end = field(trim, 'Schnitt Ende', '', 'number');
    button('Neue Exportfassung schneiden', () => mutate('trim', { id: job.id, start: Number(start.value), end: end.value ? Number(end.value) : null }), trim);
  }
  button('Neu erzeugen', () => startGeneration({ voiceId: job.voiceId, ...(job.test ? { testId: job.sentenceId } : { sentenceId: job.sentenceId }) }), card,
    state.jobs.some((j: any) => j.voiceId === job.voiceId && j.sentenceId === job.sentenceId && !j.stale && ACTIVE_JOBS.includes(j.status)));
  const details = el('details'); details.append(el('summary', 'Produktionsnachweis'), el('pre', JSON.stringify({ cloningMode: job.cloningMode, referenceRevision: job.referenceRevision, sentenceRevision: job.sentenceRevision, seed: job.seed, generator: job.generator, processing: job.audioInfo }, null, 2))); card.append(details); parent.append(card);
}
async function startGeneration(data: Record<string, unknown>) {
  message('Generator wird geprüft. Die Aufträge starten anschließend automatisch.');
  state = await api('generate', { ...data, lan: true, start: true });
  message('Produktion läuft. Fertige Sprüche sind automatisch für das LAN-Paket ausgewählt.'); render();
}
function renderProduction(main: HTMLElement) {
  main.append(el('h2', 'Deine Stimme direkt ins Spiel'), el('p', 'Referenz speichern → Sprüche erzeugen → ins Spiel übernehmen. Anhören und Nachbearbeiten sind optional.', 'intro'));
  const selector = el('label', 'Deine Stimme'); const filter = el('select');
  const none = el('option', 'Stimme auswählen …'); none.value = ''; filter.append(none);
  for (const v of state.voices.filter((v: any) => !v.archived)) { const o = el('option', v.name); o.value = v.id; filter.append(o); }
  filter.value = voiceId; filter.onchange = () => changeView(() => { voiceId = filter.value; }); selector.append(filter); main.append(selector);
  const voice = state.voices.find((v: any) => v.id === voiceId);
  const jobs = state.jobs.filter((j: any) => j.voiceId === voiceId);
  const progress = productionProgress(voice, jobs, true);
  if (progress.reason) { const missing = el('article', '', 'next-step'); missing.append(el('h3', 'Zuerst die Referenz vorbereiten'), el('p', progress.reason)); button('Zu den Referenzen', () => changeView(() => { tab = 'Referenzen'; }), missing); main.append(missing); return; }
  const catalog = state.catalog.filter((s: any) => s.active);
  const current = catalog.map((s: any) => {
    const candidates = jobs.filter((j: any) => !j.test && !j.stale && j.sentenceId === s.id);
    return candidates.findLast((j: any) => ACTIVE_JOBS.includes(j.status)) ?? candidates.at(-1);
  }).filter(Boolean);
  const ready = new Map<string, any>();
  for (const j of jobs) if (!j.test && !j.stale && j.status === 'review' && j.audio && catalog.some((s: any) => s.id === j.sentenceId)) ready.set(j.sentenceId, j);
  const included = [...ready.values()].filter(j => j.decision !== 'rejected');
  const excluded = ready.size - included.length;
  const remaining = catalog.length - ready.size;
  const next = el('article', '', 'next-step');
  next.append(el('div', 'LAN-PRODUKTION', 'eyebrow'), el('h3', progress.active ? 'Deine Sprüche entstehen' : remaining ? 'Alles bereit für deine Stimme' : 'Dein Spielpaket ist bereit'));
  next.append(el('p', included.length + ' von ' + catalog.length + ' Sprüchen im Paket' + (excluded ? ' · ' + excluded + ' bewusst weggelassen' : '') + (progress.active ? ' · ' + progress.active + ' Aufträge offen' : '')));
  const bar = el('progress'); bar.max = Math.max(1, catalog.length); bar.value = ready.size; bar.setAttribute('aria-label', 'Fertige Spielsprüche'); next.append(bar);
  next.append(el('p', 'Neutrale Sprüche nutzen Ultimate Cloning, emotionale Sprüche Controllable Cloning. Die Produktion läuft ohne einzelne Bestätigungen durch.'));
  if (progress.active && state.paused) button('Produktion fortsetzen', () => mutate('resume', {}), next).classList.add('primary');
  else if (remaining > 0) button(ready.size ? 'Fehlende Sprüche erzeugen' : 'Alle LAN-Sprüche erzeugen', () => startGeneration({ voiceId }), next, progress.active > 0).classList.add('primary');
  if (current.some((j: any) => ['failed', 'interrupted'].includes(j.status))) next.append(el('p', 'Einzelne Aufträge sind fehlgeschlagen. Fertige Sprüche bleiben erhalten. Details und erneuten Versuch findest du unten.', 'warning'));
  if (included.length) {
    button(remaining > 0 || progress.active ? 'Fertige Sprüche ins Spiel übernehmen' : 'Ins Spiel übernehmen', async () => {
      state = await api('install-game', { voiceId });
      message('Ins Projekt übernommen. Jetzt npm run build ausführen, das Spiel neu laden und die Stimme unter PROFIL → STIMME auswählen.'); render();
    }, next).classList.add('primary');
    next.append(el('small', 'Enthält alle fertigen, nicht weggelassenen Sprüche. Fehlende Kategorien bleiben im Spiel stumm.'));
  }
  main.append(next);
  const use = el('article', '', 'import-guide'); use.append(el('h3', voice.gamePackage ? `Version ${voice.gamePackage.version} ins Projekt übernommen` : 'Einmal übernehmen, für alle verfügbar'), el('p', 'Die Werkstatt legt die fertige Stimme direkt im Spielprojekt ab. Danach npm run build ausführen und den neuen Spielstand öffnen. Alle Spieler können die Stimme unter PROFIL → STIMME auswählen – kein Dateiimport nötig.'));
  if (voice.gamePackage) use.append(el('small', `${voice.gamePackage.clips} Sprüche übernommen. Bei Änderungen erneut „Ins Spiel übernehmen“ und anschließend neu bauen.`)); main.append(use);
  const takes = optionalSection('Sprüche anhören oder ändern (optional) · ' + current.length, 'takes');
  if (!current.length) takes.append(el('p', 'Hier erscheinen deine erzeugten Sprüche.'));
  const grid = el('div', '', 'test-grid'); for (const job of current) renderJob(grid, job); takes.append(grid); main.append(takes);
  const tests = optionalSection('Vorab drei kurze Stimmproben erzeugen (optional)', 'tests');
  tests.append(el('p', 'Zum Ausprobieren vor der gesamten Produktion. Die Proben müssen nicht freigegeben werden und kommen nicht ins Spielpaket.'));
  button('Stimmproben erzeugen', () => startGeneration({ voiceId, tests: true }), tests, progress.active > 0 || progress.testsAvailable === 3);
  const testGrid = el('div', '', 'test-grid');
  for (const id of TEST_IDS) { const job = jobs.findLast((j: any) => !j.stale && j.sentenceId === id); if (job) renderJob(testGrid, job); }
  tests.append(testGrid); main.append(tests);
  const advanced = optionalSection('Satzkatalog und Emotionen anpassen (optional)', 'catalog'); renderCatalog(advanced); main.append(advanced);
  const packages = optionalSection('Gespeicherte Pakete & gemeinsames LAN-Bundle', 'packages'); renderPackages(packages); main.append(packages);
}
function renderPackages(main: HTMLElement) {
  main.append(el('h2', 'Freigegebene Pakete'));
  for (const pack of state.packages) {
    const card = el('article'); const selected = check(card, `${pack.name} · v${pack.version} · ${pack.clips} Clips · ${(pack.bytes / 1024).toFixed(0)} KiB`, selections.has(pack.checksum)); selected.onchange = () => selected.checked ? selections.add(pack.checksum) : selections.delete(pack.checksum);
    button('Paket exportieren', () => download([pack.checksum]), card);
    button('Lokal entfernen', () => mutate('remove-package', { checksum: pack.checksum }), card); main.append(card);
  }
  button('Ausgewählte Pakete als LAN-Bundle exportieren', () => download([...selections]), main);
  const preview = el('article'); preview.append(el('h2', 'Ereignis-Vorschau'), el('p', 'Verwendet dieselbe Sprechregie wie das Spiel. Die ausgewählten Pakete stellen verschiedene Sprecher dar.'));
  const log = el('div', '', 'preview-log');
  button('Kill + Führung + mehrere Bursts simulieren', async () => {
    const bundle = await api('export', { checksums: [...selections] }); const packs = new Map<string, VoicePackage>(bundle.packages.map((p: VoicePackage, i: number) => [`Spieler ${i + 1}`, p]));
    const director = new VoiceDirector(); director.reset({ worldRevision: 1, roundRevision: 1 }); const entries: string[] = []; const now = 1000;
    for (const id of packs.keys()) { director.offer(id, 'kill', now); director.offer(id, 'damage_burst', now); }
    const first = packs.keys().next().value!; director.offer(first, 'leader', now);
    const winner = director.select(now + 200, packs); entries.push(winner ? `${winner.speakerId}: ${winner.event} zugelassen; andere Kandidaten durch Priorität verworfen.` : 'Keine passende freigegebene Kategorie.');
    director.offer(first, 'kill', now + 1000); entries.push(director.select(now + 1200, packs) ? 'Kill zugelassen.' : 'Kill wegen Sprechpause unterdrückt; wird nach Ablauf verworfen.'); log.textContent = entries.join('\n');
    if (winner) { const p = packs.get(winner.speakerId)!; const clip = p.manifest.clips.find(c => c.id === winner.clipId)!; const a = el('audio'); a.controls = true; const bytes = Uint8Array.from(atob(p.files[clip.file]), c => c.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' })); a.src = url; a.onended = () => URL.revokeObjectURL(url); preview.append(a); await a.play(); }
  }, preview); preview.append(log); main.append(preview);
}
async function download(checksums: string[]) { const bundle = await api('export', { checksums }); const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' })); const a = el('a'); a.href = url; a.download = 'fragdachse-lan.fdvoice'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
void api('state').then(initial => { state = initial; voiceId = state.voices.find((v: any) => !v.archived && v.reference)?.id ?? state.voices[0]?.id ?? ''; render(); }).catch(error => { app.textContent = explainError(error); });
poll = window.setInterval(async () => {
  if (!state) return;
  try {
    const latest = await api('state');
    const changed = JSON.stringify(latest.jobs) !== JSON.stringify(state.jobs) || latest.paused !== state.paused;
    const playing = [...document.querySelectorAll('audio')].some(a => !a.paused);
    if (changed && !recording && !recordingPending && !referenceEditor?.busy && !playing && !['INPUT', 'TEXTAREA', 'SELECT', 'CANVAS'].includes(document.activeElement?.tagName ?? '')) { state = latest; render(); }
  } catch { /* Keep the editor when the service closes. */ }
}, 2500);
