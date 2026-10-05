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
type ReferenceSource = 'script' | 'upload';
const referenceInputs = new Map<string, { source: ReferenceSource; transcript: string; filename: string }>();
interface SentenceFields { text: string; directionHint: string; active: boolean }
const sentenceDrafts = new Map<string, SentenceFields>();
let catalogScope = 'profile';
let eventFilter = 'all';
const eventNames: Record<string, string> = { ready: 'Rundenstart', kill: 'Abschuss', leader: 'In Führung', ultimate: 'Ultimate', damage_burst: 'Unter Beschuss', victory: 'Sieg' };
let referenceEditor: WaveformEditor | null = null;
let recordingPending = false;
let pageActive = true;
let deleting = false;
let deletionEpoch = 0;
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
  if (deleting) return;
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
  a.onplay = () => document.querySelectorAll('audio').forEach(other => { if (other !== a) other.pause(); });
  parent.append(a); return a;
}
const status: Record<string, string> = { waiting: 'Wartend', checking: 'Voraussetzungen prüfen', generating: 'Generierung läuft', processing: 'Audio aufbereiten', review: 'Prüfbereit', failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen', interrupted: 'Unterbrochen' };
function render() {
  if (recording || recordingPending || deleting) return;
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
  heroCopy.append(el('div', 'DEIN PERSÖNLICHES VOICE-STUDIO', 'eyebrow'), el('h2', tab === 'Referenzen' ? 'Deine Stimme. Dein Charakter.' : 'Deine Texte. Deine Voice-Lines.'));
  const voiceCount = state.voices.filter((v: any) => !v.archived).length;
  const library = el('div', '', 'library-count'); library.append(el('strong', String(voiceCount)), el('span', `${voiceCount === 1 ? 'Stimme' : 'Stimmen'} in deiner Werkstatt`)); hero.append(heroCopy, library); app.append(hero);
  const nav = el('nav', '', 'main-nav'); nav.setAttribute('aria-label', 'Arbeitsbereich');
  for (const [index, [name, label, description]] of [['Referenzen', 'Stimmprofile', 'Aufnehmen oder Referenz hochladen'], ['Produktion', 'Texte & Voice-Lines', 'Anpassen · anhören · ins Spiel übernehmen']].entries()) {
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
  footer.append(el('span', running ? `${status[running.status]}: ${running.text} · ${queued} weitere wartend` : queued ? `${queued} Aufträge warten · ${state.paused ? 'pausiert' : 'werden nacheinander erzeugt'}` : ready ? `${ready} Aufnahmen fertig` : 'Bereit für deine nächste Stimme.'));
  if (queued || running) {
    button(state.paused ? 'Warteschlange fortsetzen' : 'Nach aktuellem Take pausieren', () => mutate(state.paused ? 'resume' : 'pause', {}), footer);
    button('Warteschlange abbrechen', () => mutate('cancel', {}), footer);
  }
  app.append(footer);
}
function renderVoiceDeletion(parent: HTMLElement, voice: any) {
  const section = el('details'); section.open = !!voice.deletion;
  section.append(el('summary', voice.deletion ? 'Löschung fortsetzen' : 'Stimme löschen'));
  section.append(el('p', 'Löscht dieses Profil endgültig: Referenzen, alle Takes und Schnittfassungen, Hörproben, Produktionsnachweise, lokale Paketversionen sowie die Stimme aus den lokalen Spielquellen und Builds. Auch lokale Werkstatt-Datensicherungen und die zugehörigen ComfyUI-Kopien werden bereinigt.'));
  section.append(el('p', 'Das Spiel anschließend neu laden, damit importierte Browserkopien und die Profilauswahl bereinigt werden. Externe Originaldateien und Downloads, Browsercache, Git-Historie und Kopien auf anderen Rechnern bleiben außerhalb dieser Löschung.'));
  if (voice.deletion?.error) section.append(el('p', voice.deletion.error, 'notice error'));
  const confirmation = field(section, `Zur Bestätigung „${voice.name}“ eingeben`, voice.deletion ? voice.name : '');
  const running = state.jobs.some((j: any) => ['checking', 'generating', 'processing'].includes(j.status));
  if (running) section.append(el('p', 'Vor dem Löschen die Produktion pausieren und den aktuellen Take beenden lassen.'));
  const remove = button(voice.deletion ? 'Löschung fortsetzen' : 'Stimme endgültig löschen', async () => {
    if (recording || recordingPending || referenceEditor?.busy) throw new Error('Zuerst Aufnahme und Referenzwiedergabe stoppen.');
    if (confirmation.value !== voice.name) throw new Error('Den Namen der Stimme zur Bestätigung eingeben.');
    deleting = true; deletionEpoch++;
    document.querySelectorAll('audio').forEach(a => {
      a.pause(); if (a.src.startsWith('blob:')) URL.revokeObjectURL(a.src);
      a.removeAttribute('src'); a.load();
    });
    referenceEditor?.destroy(); referenceEditor = null;
    for (const key of referenceDrafts.keys()) if (key.startsWith(`${voice.id}:`)) referenceDrafts.delete(key);
    referenceInputs.delete(voice.id);
    for (const key of sentenceDrafts.keys()) if (key.startsWith(`${voice.id}:`)) sentenceDrafts.delete(key);
    for (const key of openSections) if (key.startsWith(`${voice.id}:`)) openSections.delete(key);
    message('Stimme und zugehörige Dateien werden gelöscht …');
    try {
      state = await api('delete-voice', { voiceId: voice.id, confirmName: confirmation.value });
      for (const checksum of selections) if (!state.packages.some((p: any) => p.checksum === checksum)) selections.delete(checksum);
      voiceId = state.voices[0]?.id ?? '';
      message('Stimme aus Werkstatt und lokalen Spieldateien gelöscht. Ein geöffnetes Spiel jetzt neu laden; dort werden auch importierte Kopien bereinigt.');
    } catch (error) {
      state = await api('state').catch(() => state); throw error;
    } finally { deleting = false; render(); }
  }, section, running || confirmation.value !== voice.name);
  remove.classList.add('danger');
  confirmation.oninput = () => { remove.disabled = running || confirmation.value !== voice.name; };
  parent.append(section);
}

function renderVoices(main: HTMLElement) {
  main.append(el('p', 'Sprich die Referenz klar, selbstbewusst und mit Energie ein. Wortlaut vollständig erhalten; Effekte werden erst auf die erzeugten Voice-Lines angewendet.'));
  const layout = el('div', '', 'grid'); const list = el('aside', '', 'voice-sidebar'); const detail = el('section', '', 'voice-detail'); layout.append(list, detail); main.append(layout);
  list.append(el('div', 'DEINE STIMMEN', 'eyebrow'));
  button('+ Neue Stimme', () => changeView(() => { voiceId = ''; }), list).classList.add('new-voice');
  for (const voice of state.voices) {
    const item = button('', () => changeView(() => { voiceId = voice.id; }), list); item.className = 'voice-item'; item.setAttribute('aria-current', String(voice.id === voiceId));
    const avatar = el('span', voice.name.trim().slice(0, 1).toUpperCase(), 'voice-avatar'); avatar.setAttribute('aria-hidden', 'true');
    const copy = el('span', '', 'voice-copy'); copy.append(el('strong', voice.name), el('small', voice.deletion ? 'Löschung offen' : voice.archived ? 'Archiviert' : voice.reference ? 'Referenz gespeichert' : 'Aufnahme fehlt'));
    const indicator = el('span', voice.reference && !voice.archived ? '●' : '○', 'voice-indicator'); indicator.setAttribute('aria-hidden', 'true'); item.append(avatar, copy, indicator);
  }
  if (!state.voices.length) list.append(el('p', 'Deine erste Stimme beginnt mit einer kurzen Aufnahme.', 'sidebar-hint'));
  const voice = state.voices.find((v: any) => v.id === voiceId);
  detail.append(el('div', voice ? 'REFERENZAUFNAHME' : 'LOS GEHT’S', 'eyebrow'));
  detail.append(el('h2', voice ? `Referenz für ${voice.name}` : 'Neue Stimme anlegen'));
  if (voice) renderVoiceDeletion(detail, voice);
  if (voice?.deletion) return;
  const form = el('article', '', 'profile-card'); form.append(el('h3', '1 · Profil und Zustimmung')); const name = field(form, 'Anzeigename', voice?.name ?? '');
  const consent = check(form, 'Die sprechende Person ist mit Generierung und Nutzung in unserer LAN-Runde einverstanden.', !!voice?.consentGenerate && !!voice?.consentLan);
  const more = el('details', '', 'profile-more'); more.append(el('summary', 'Weitere Profileinstellungen'));
  const publicUse = check(more, 'Öffentliche Weitergabe gesondert erlaubt (keine automatische Veröffentlichung).', voice?.consentPublic ?? false);
  const archived = check(more, 'Stimme archivieren und neue Generierungen sperren', voice?.archived ?? false); form.append(more);
  button(voice ? 'Profil speichern' : 'Profil anlegen', async () => { state = await api('voice', { id: voice?.id, name: name.value, consentGenerate: consent.checked, consentLan: consent.checked, consentPublic: publicUse.checked, archived: archived.checked }); voiceId = voice?.id ?? state.voices.at(-1).id; message('Profil gespeichert.'); render(); }, form).classList.add('primary');
  if (voice?.reference && voice.consentGenerate && voice.consentLan) {
    const profile = el('details', '', 'profile-settings'); const summary = el('summary', '1 · Profil und Zustimmung'); summary.append(el('span', 'Gespeichert', 'saved-label'));
    profile.append(summary, form); detail.append(profile);
  } else detail.append(form);
  if (!voice) return;
  const savedSource: ReferenceSource = voice.referenceSource === 'upload' || (voice.transcript && voice.transcript !== referenceText.text) ? 'upload' : 'script';
  if (!referenceInputs.has(voice.id)) referenceInputs.set(voice.id, { source: savedSource, transcript: savedSource === 'upload' ? voice.transcript ?? '' : '', filename: '' });
  const input = referenceInputs.get(voice.id)!;
  const record = el('article', '', 'recording-card'); record.append(el('h2', '2 · Referenz'));
  const modes = el('div', '', 'segmented'); modes.setAttribute('aria-label', 'Referenzquelle'); record.append(modes);
  for (const [source, label] of [['script', 'Vorlesetext aufnehmen'], ['upload', 'Eigene Datei + Text']] as const) {
    const b = button(label, () => changeView(() => { input.source = source; }), modes); b.setAttribute('aria-pressed', String(input.source === source));
  }
  const microphone = el('div'); microphone.hidden = input.source !== 'script'; record.append(microphone);
  microphone.append(el('blockquote', referenceText.text, 'reference-script'), el('small', 'Vollständig und wortgetreu vorlesen · Text wird automatisch übernommen'));
  const upload = el('div'); upload.hidden = input.source !== 'upload'; record.append(upload);
  const transcriptLabel = el('label', 'Gesprochener Text der Datei'); const transcript = el('textarea');
  transcript.value = input.transcript; transcript.maxLength = 5000; transcript.placeholder = 'Exakter Wortlaut des ausgewählten Ausschnitts …';
  transcript.oninput = () => { input.transcript = transcript.value; }; transcriptLabel.append(transcript);
  const inputStrip = el('div', '', 'input-strip'); microphone.append(inputStrip);
  const deviceLabel = el('label', 'MIKROFON'); const devices = el('select'); devices.setAttribute('aria-label', 'Mikrofon'); const defaultDevice = el('option', 'Standardmikrofon'); defaultDevice.value = ''; devices.append(defaultDevice); deviceLabel.append(devices); inputStrip.append(deviceLabel);
  void navigator.mediaDevices?.enumerateDevices().then(items => { for (const d of items.filter(d => d.kind === 'audioinput' && d.deviceId)) { const o = el('option', d.label || `Mikrofon ${devices.length}`); o.value = d.deviceId; devices.append(o); } });
  const meter = el('meter'); meter.min = 0; meter.max = 1; meter.setAttribute('aria-label', 'Mikrofonpegel'); const elapsed = el('span', '0 s', 'recording-time'); inputStrip.append(meter, elapsed);
  const recordButtons = el('div', '', 'row'); microphone.append(recordButtons);
  const sourceVoiceId = voice.id;
  const draftKey = `${sourceVoiceId}:${input.source}`;
  const cut = el('div', '', 'reference-cut'); cut.append(el('h3', '3 · Ausschnitt & Vorschau'), el('small', 'Empfohlen: 10–20 Sekunden · Ganzen Text erhalten')); record.append(cut);
  const editor = new WaveformEditor(cut, referenceDrafts.get(draftKey) ?? null,
    draft => referenceDrafts.set(draftKey, draft), text => message(explainError(new Error(text)), true)); referenceEditor = editor;
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
      recorder.onstop = () => { if (recording !== recorder) return; const blob = new Blob(chunks, { type: recorder.mimeType }); stopTracks(); recording = null; meter.value = 0; recordButton.disabled = false; editor.setLocked(false); void editor.load(blob).then(() => message('Aufnahme beendet. Wähle den Ausschnitt, höre ihn an und speichere die Referenz.')).catch(error => message(explainError(error), true)); };
      recorder.onerror = () => { if (recording !== recorder) return; stopTracks(); recording = null; recordButton.disabled = false; editor.setLocked(false); message('Aufnahme fehlgeschlagen. Bitte erneut aufnehmen.'); };
      const sample = new Uint8Array(analyser.fftSize);
      const tick = () => { if (recording !== recorder || recorder.state !== 'recording') return; analyser.getByteTimeDomainData(sample); meter.value = Math.max(...sample.map(x => Math.abs(x - 128))) / 128; elapsed.textContent = `${((performance.now() - began) / 1000).toFixed(1)} s`; if (performance.now() - began > 29000) recorder.stop(); else requestAnimationFrame(tick); };
      recorder.start(); tick();
    } catch (error) { stopTracks(); recording = null; throw error; }
    finally { recordingPending = false; if (!recording) editor.setLocked(false); }
  }, recordButtons);
  recordButton.classList.add('record-button');
  button('Stoppen', () => { if (recording?.state === 'recording') recording.stop(); }, recordButtons);
  const fileParent = input.source === 'script' ? microphone : upload;
  const file = field(fileParent, input.source === 'script' ? 'Vorlesetext als Datei importieren' : 'Referenzdatei hochladen', '', 'file'); file.accept = 'audio/*';
  if (input.source === 'upload') { if (input.filename) upload.append(el('small', input.filename)); upload.append(transcriptLabel); }
  file.onchange = async () => {
    if (recording || recordingPending || editor.busy) { message('Bitte zuerst Aufnahme oder Wiedergabe stoppen.'); return; }
    const selected = file.files?.[0]; if (!selected) return;
    try { await editor.load(selected); if (input.source === 'upload') input.filename = selected.name; }
    catch (error) { message(explainError(error), true); }
  };
  button('Referenz speichern & weiter', async () => {
    if (recording || recordingPending || editor.busy) throw new Error('Aufnahme oder Wiedergabe zuerst stoppen und Laden der Wellenform abwarten.');
    const draft = referenceDrafts.get(draftKey); if (!draft) throw new Error('Zuerst aufnehmen oder eine Datei wählen.');
    if (input.source === 'upload' && !input.transcript.trim()) { transcript.focus(); throw new Error('Gib den gesprochenen Text der Referenzdatei ein.'); }
    const { start, end } = draft.selection;
    const metadata = { source: input.source, ...(input.source === 'script' ? { referenceTextId: referenceText.id } : { transcript: input.transcript }) };
    recordingPending = true; editor.setLocked(true);
    try {
      const encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(draft.blob); });
      state = await api('reference', { voiceId: sourceVoiceId, audio: encoded, ...metadata, start, end });
    } finally { recordingPending = false; editor.setLocked(false); }
    referenceDrafts.delete(draftKey); tab = 'Produktion'; message('Referenz gespeichert.'); render();
  }, record).classList.add('primary');
  if (voice.reference) {
    record.append(el('p', `Gespeicherte Referenz · ${voice.referenceInfo.duration.toFixed(1)} s · ${voice.referenceInfo.warnings.join(' · ')}`)); audio(record, voice.reference);
    const savedText = el('details'); savedText.append(el('summary', 'Gespeicherter Referenztext'), el('p', voice.transcript)); record.append(savedText);
    button('Gespeicherte Referenz bearbeiten', async () => {
      if (recording || recordingPending || editor.busy) throw new Error('Aufnahme oder Wiedergabe zuerst stoppen.');
      input.source = savedSource; input.transcript = voice.transcript; render();
      const savedEditor = referenceEditor!;
      recordingPending = true;
      try {
        const response = await fetch(`/media/${encodeURIComponent(voice.reference)}?token=${token}`);
        if (!response.ok) throw new Error('Gespeicherte Referenz konnte nicht geladen werden.');
        await savedEditor.load(await response.blob());
      } finally { recordingPending = false; }
    }, record);
    button('Alle lokalen Referenzen löschen', async () => {
      if (recording || recordingPending || editor.busy) throw new Error('Aufnahme oder Wiedergabe zuerst stoppen.');
      state = await api('delete-reference', { voiceId: sourceVoiceId }); referenceDrafts.delete(`${sourceVoiceId}:script`); referenceDrafts.delete(`${sourceVoiceId}:upload`); referenceInputs.delete(sourceVoiceId); render();
    }, record).classList.add('danger');
  }
  detail.append(record);
  if (voice.reference) button('Weiter zu Texten & Voice-Lines →', () => changeView(() => { tab = 'Produktion'; }), detail);
}
function stopTracks() { recordingStream?.getTracks().forEach(track => track.stop()); recordingStream = null; void recordingContext?.close(); recordingContext = null; }
window.addEventListener('pagehide', () => { pageActive = false; if (recording?.state === 'recording') recording.stop(); stopTracks(); referenceEditor?.destroy(); referenceDrafts.clear(); });
window.addEventListener('pageshow', event => { pageActive = true; if (event.persisted && state) render(); });
async function saveSentenceDrafts(scope: string, sentenceId?: string) {
  for (const [key, draft] of sentenceDrafts) {
    if (!key.startsWith(`${scope}:`)) continue;
    const id = key.slice(scope.length + 1); if (sentenceId && id !== sentenceId) continue;
    state = await api('sentence', { ...draft, id, ...(scope === 'default' ? {} : { voiceId: scope }) });
    if (sentenceDrafts.get(key) === draft) sentenceDrafts.delete(key);
  }
}
function renderCatalog(main: HTMLElement, voice?: any) {
  const scope = voice?.id ?? 'default';
  const catalog = voice ? voice.catalog : state.catalog;
  const jobs = state.jobs.filter((j: any) => j.voiceId === voice?.id && !j.test);
  const canProduce = !!voice && productionProgress(voice, jobs, true).canProduce;
  const filters = el('div', '', 'catalog-filters'); filters.setAttribute('aria-label', 'Sprüche nach Anlass filtern');
  for (const [value, label] of [['all', 'Alle'], ...Object.entries(eventNames)]) {
    const b = button(label, () => changeView(() => { eventFilter = value; }), filters); b.setAttribute('aria-pressed', String(eventFilter === value));
  }
  main.append(filters);
  for (const [event, label] of Object.entries(eventNames)) {
    if (eventFilter !== 'all' && eventFilter !== event) continue;
    const sentences = catalog.filter((s: any) => s.event === event); if (!sentences.length) continue;
    const group = el('section', '', 'sentence-group'); group.append(el('h3', `${label} · ${sentences.length}`)); main.append(group);
    for (const sentence of sentences) {
      const key = `${scope}:${sentence.id}`; const initial = sentenceDrafts.get(key) ?? sentence;
      const card = el('article', '', 'sentence-card'); group.append(card);
      const edit = el('div', '', 'sentence-edit'); const listen = el('div', '', 'sentence-listen'); card.append(edit); if (voice) card.append(listen);
      const meta = el('div', '', 'take-meta'); const source = el('span', voice ? sentence.customized ? 'Eigener Text' : 'Standardtext' : 'Standardtext', 'status-badge');
      const dirtyBadge = el('span', 'Ungespeichert', 'status-badge attention'); meta.append(source, dirtyBadge); edit.append(meta);
      const textLabel = el('label', 'Text', 'sentence-text-label'); const text = el('textarea'); text.rows = 2; text.maxLength = 300; text.value = initial.text; textLabel.append(text); edit.append(textLabel);
      const options = optionalSection('Darbietung & Verwendung', `sentence:${key}`); edit.append(options);
      options.append(el('p', 'Action-Announcer · kraftvoll, klar und passend zum Spielanlass'));
      const hintLabel = el('label', 'Zusätzliche Regiehinweise'); const hint = el('input'); hint.value = initial.directionHint ?? ''; hint.maxLength = 300;
      hint.placeholder = 'Optional: z. B. das letzte Wort besonders betonen'; hintLabel.append(hint); options.append(hintLabel);
      const active = check(options, 'Im Katalog verwenden', initial.active);
      const actions = el('div', '', 'row'); edit.append(actions);
      const save = button('Text speichern', async () => { await saveSentenceDrafts(scope, sentence.id); message('Text gespeichert.'); render(); }, actions);
      const discard = button('Verwerfen', () => { sentenceDrafts.delete(key); render(); }, actions);
      if (sentence.customized && voice) button('Standard wiederherstellen', async () => {
        state = await api('sentence-reset', { voiceId: scope, id: sentence.id }); sentenceDrafts.delete(key); render();
      }, options);
      const lineJobs = jobs.filter((j: any) => j.sentenceId === sentence.id);
      const current = lineJobs.filter((j: any) => !j.stale);
      const pending = current.findLast((j: any) => ACTIVE_JOBS.includes(j.status));
      const latest = current.at(-1);
      const playable = current.findLast((j: any) => (j.status === 'review' && j.audio) || (j.status === 'failed' && j.raw))
        ?? lineJobs.findLast((j: any) => j.status === 'review' && j.audio);
      const audioStatus = el('span', '', 'status-badge'); listen.append(audioStatus);
      if (playable) {
        const oldText = el('p', playable.text, 'previous-text'); oldText.hidden = !playable.stale; listen.append(oldText);
        audio(listen, playable.status === 'review' ? playable.audio : playable.raw).setAttribute('aria-label', `Voice-Line: ${playable.text}`);
        if (playable.status === 'failed') listen.append(el('small', 'Rohfassung · unter Audio bearbeiten kürzen und erneut aufbereiten.'));
        const warnings = playable.audioInfo?.warnings ?? []; if (warnings.length) listen.append(el('small', warnings.join(' · '), 'warning'));
        if (!playable.stale && playable.status === 'review') button(playable.decision === 'rejected' ? 'Ins Paket aufnehmen' : 'Aus Paket nehmen', () => mutate('lan-selection', { id: playable.id, include: playable.decision === 'rejected' }), listen);
        const more = optionalSection('Audio bearbeiten', `audio:${key}`); listen.append(more);
        if (playable.raw) {
          const start = field(more, 'Anfang (Sekunden)', '0', 'number'); const end = field(more, 'Ende (Sekunden)', '', 'number');
          button('Schnitt speichern', () => mutate('trim', { id: playable.id, start: Number(start.value), end: end.value ? Number(end.value) : null }), more, playable.stale);
          const raw = el('details'); raw.append(el('summary', 'Original anhören')); audio(raw, playable.raw); more.append(raw);
        }
      } else listen.append(el('div', 'Noch keine Voice-Line', 'audio-empty'));
      if (latest?.error) listen.append(el('p', explainError(new Error(latest.error)), 'notice error'));
      const generate = voice ? button('', () => startGeneration({ voiceId: scope, sentenceId: sentence.id }), listen) : null;
      const update = () => {
        const dirty = sentenceDrafts.has(key); dirtyBadge.hidden = !dirty; save.hidden = !dirty; discard.hidden = !dirty;
        audioStatus.textContent = pending ? status[pending.status] : !active.checked ? 'Deaktiviert' : playable?.needsAnnouncer ? 'Für Action-Announcer neu erzeugen' : playable?.stale ? 'Veraltete Aufnahme' : dirty && playable ? 'Aufnahme vor Textänderung' : latest && ['failed', 'interrupted', 'cancelled'].includes(latest.status) ? status[latest.status] : playable ? playable.decision === 'rejected' ? 'Weggelassen' : 'Im Paket' : 'Noch nicht erzeugt';
        if (generate) { generate.textContent = dirty ? 'Speichern & erzeugen' : playable ? 'Neu erzeugen' : 'Voice-Line erzeugen'; generate.disabled = !canProduce || !!pending || !active.checked; }
      };
      const changed = () => {
        const draft = { text: text.value, directionHint: hint.value, active: active.checked };
        if (Object.entries(draft).every(([field, value]) => sentence[field] === value)) sentenceDrafts.delete(key); else sentenceDrafts.set(key, draft);
        update();
      };
      text.oninput = changed; hint.oninput = changed; active.onchange = changed; update();
    }
  }
}
function renderJob(parent: HTMLElement, job: any) {
  const card = el('article', '', 'take-card');
  const meta = el('div', '', 'take-meta'); const stateLabel = job.stale ? 'Überholt' : job.decision === 'rejected' ? 'Weggelassen' : job.status === 'review' ? (job.test ? 'Probe fertig' : 'Im Paket dabei') : status[job.status];
  const badgeKind = job.stale || job.decision === 'rejected' || ['failed', 'interrupted'].includes(job.status) ? 'attention' : job.status === 'review' ? 'ready' : 'pending';
  meta.append(el('span', job.needsAnnouncer ? 'FRÜHERE PRODUKTION' : 'ACTION-ANNOUNCER', 'eyebrow'), el('span', stateLabel, `status-badge ${badgeKind}`));
  card.append(meta, el('h3', job.text), el('p', job.needsAnnouncer ? 'Frühere Darbietung · bitte neu erzeugen' : job.directionHint || 'Kraftvoller Arena-Announcer', 'take-style'));
  if (job.error) card.append(el('p', explainError(new Error(job.error)), 'notice error'));
  if (job.stale) card.append(el('p', 'Regie, Klangrezept, Referenz oder Satz wurden geändert. Für das neue Paket diesen Take neu erzeugen.', 'warning'));
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
    button('Neue Exportfassung schneiden', () => mutate('trim', { id: job.id, start: Number(start.value), end: end.value ? Number(end.value) : null }), trim, job.stale);
  }
  button('Neu erzeugen', () => startGeneration({ voiceId: job.voiceId, ...(job.test ? { testId: job.sentenceId } : { sentenceId: job.sentenceId }) }), card,
    state.jobs.some((j: any) => j.voiceId === job.voiceId && j.sentenceId === job.sentenceId && !j.stale && ACTIVE_JOBS.includes(j.status)));
  const details = el('details'); details.append(el('summary', 'Produktionsnachweis'), el('pre', JSON.stringify({ productionVersion: job.productionVersion, processingVersion: job.processingVersion, controlInstruction: job.controlInstruction, legacyStyle: job.style, cloningMode: job.cloningMode, referenceRevision: job.referenceRevision, sentenceRevision: job.sentenceRevision, seed: job.seed, generator: job.generator, processing: job.audioInfo }, null, 2))); card.append(details); parent.append(card);
}
async function startGeneration(data: Record<string, unknown>) {
  if (!data.tests && !data.testId) await saveSentenceDrafts(String(data.voiceId), data.sentenceId as string | undefined);
  message('Generator wird geprüft. Die Aufträge starten anschließend automatisch.');
  state = await api('generate', { ...data, lan: true, start: true });
  message('Produktion läuft. Fertige Sprüche sind automatisch für das LAN-Paket ausgewählt.'); render();
}
function renderProduction(main: HTMLElement) {
  main.append(el('h2', 'Action-Announcer'), el('p', 'Ein fester cineastischer Sound für alle Stimmen: präsente Hauptstimme, satte Mitten, tiefer Bass und kurzer dichter Hall. Neue Produktionen sprechen kraftvoll und deutlich.'));
  const scopes = el('div', '', 'segmented catalog-scopes'); scopes.setAttribute('aria-label', 'Textkatalog'); main.append(scopes);
  for (const [value, label] of [['profile', 'Texte je Stimmprofil'], ['default', 'Standardkatalog']]) {
    const b = button(label, () => changeView(() => { catalogScope = value; }), scopes); b.setAttribute('aria-pressed', String(catalogScope === value));
  }
  if (catalogScope === 'default') {
    main.append(el('h2', 'Standardkatalog'), el('small', 'Vorlage für alle Profile · Eigene Profiltexte bleiben erhalten', 'catalog-caption'));
    renderCatalog(main); return;
  }
  const selector = el('label', 'Stimmprofil', 'profile-selector'); const filter = el('select');
  const none = el('option', 'Stimme auswählen …'); none.value = ''; filter.append(none);
  for (const v of state.voices.filter((v: any) => !v.archived)) { const o = el('option', v.name); o.value = v.id; filter.append(o); }
  filter.value = voiceId; filter.onchange = () => changeView(() => { voiceId = filter.value; }); selector.append(filter); main.append(selector);
  const voice = state.voices.find((v: any) => v.id === voiceId);
  const jobs = state.jobs.filter((j: any) => j.voiceId === voiceId);
  const progress = productionProgress(voice, jobs, true);
  if (!voice) { button('Stimmprofil anlegen', () => changeView(() => { tab = 'Referenzen'; voiceId = ''; }), main); return; }
  if (progress.reason) { const missing = el('article', '', 'next-step'); missing.append(el('p', progress.reason)); button('Referenz vorbereiten', () => changeView(() => { tab = 'Referenzen'; }), missing); main.append(missing); }
  if (jobs.some((j: any) => j.needsAnnouncer) && !jobs.some((j: any) => !j.test && !j.needsAnnouncer)) {
    main.append(el('p', 'Die nächste Sammelproduktion erzeugt alle aktiven Sprüche mit Announcer-Regie neu. Frühere Aufnahmen und gespeicherte Pakete bleiben erhalten.', 'notice'));
  }
  const catalog = voice.catalog.filter((s: any) => s.active);
  const ready = new Map<string, any>();
  for (const j of jobs) if (!j.test && !j.stale && j.status === 'review' && j.audio && catalog.some((s: any) => s.id === j.sentenceId)) ready.set(j.sentenceId, j);
  const included = [...ready.values()].filter(j => j.decision !== 'rejected');
  const excluded = ready.size - included.length;
  const remaining = catalog.length - ready.size;
  const next = el('article', '', 'next-step production-bar');
  next.append(el('h3', `${included.length} / ${catalog.length} Voice-Lines im Paket`));
  if (excluded || progress.active) next.append(el('small', [excluded ? `${excluded} weggelassen` : '', progress.active ? `${progress.active} in Arbeit` : ''].filter(Boolean).join(' · ')));
  const bar = el('progress'); bar.max = Math.max(1, catalog.length); bar.value = ready.size; bar.setAttribute('aria-label', 'Fertige Spielsprüche'); next.append(bar);
  if (progress.active && state.paused) button('Produktion fortsetzen', () => mutate('resume', {}), next).classList.add('primary');
  else button(ready.size ? 'Fehlende Voice-Lines erzeugen' : 'Alle Voice-Lines erzeugen', () => startGeneration({ voiceId }), next, !progress.canProduce || progress.active > 0).classList.add('primary');
  if (included.length) {
    button(remaining > 0 || progress.active ? 'Fertige Sprüche ins Spiel übernehmen' : 'Ins Spiel übernehmen', async () => {
      if ([...sentenceDrafts.keys()].some(key => key.startsWith(`${voiceId}:`) || key.startsWith('default:'))) throw new Error('Offene Textänderungen zuerst speichern oder verwerfen.');
      state = await api('install-game', { voiceId });
      message('Ins Projekt übernommen. Jetzt npm run build ausführen, das Spiel neu laden und die Stimme unter PROFIL → STIMME auswählen.'); render();
    }, next).classList.add('primary');
  }
  if (voice.gamePackage) next.append(el('small', `Version ${voice.gamePackage.version} im Projekt · ${voice.gamePackage.clips} Voice-Lines`));
  main.append(next);
  renderCatalog(main, voice);
  const tests = optionalSection('Stimmproben', 'tests');
  button('Drei Stimmproben erzeugen', () => startGeneration({ voiceId, tests: true }), tests, !progress.canTest || progress.active > 0 || progress.testsAvailable === 3);
  tests.append(el('p', 'Drei Anlässe, ein Sound: Auftakt, Kill und Ultimate.'));
  const testGrid = el('div', '', 'test-grid');
  for (const id of TEST_IDS) { const job = jobs.findLast((j: any) => !j.stale && j.sentenceId === id); if (job) renderJob(testGrid, job); }
  tests.append(testGrid); main.append(tests);
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
  if (!state || deleting) return;
  const epoch = deletionEpoch;
  try {
    const latest = await api('state');
    if (deleting || epoch !== deletionEpoch) return;
    const changed = JSON.stringify(latest.jobs) !== JSON.stringify(state.jobs) || latest.paused !== state.paused
      || JSON.stringify(latest.voices.map((v: any) => [v.id, v.deletion])) !== JSON.stringify(state.voices.map((v: any) => [v.id, v.deletion]));
    const playing = [...document.querySelectorAll('audio')].some(a => !a.paused);
    if (changed && !recording && !recordingPending && !referenceEditor?.busy && !playing && !['INPUT', 'TEXTAREA', 'SELECT', 'CANVAS'].includes(document.activeElement?.tagName ?? '')) {
      state = latest;
      if (voiceId && !state.voices.some((v: any) => v.id === voiceId)) voiceId = state.voices[0]?.id ?? '';
      render();
    }
  } catch { /* Keep the editor when the service closes. */ }
}, 2500);
