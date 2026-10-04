import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalJson, voiceHash, validateVoiceBundle, VOICE_EVENTS } from '../../src/voice/VoicePackage.ts';
import { VoxGenerator } from './generator.mjs';
import { processAudio } from './audio.mjs';
import { installGamePackage } from './game-packages.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REFERENCE_TEXT = Object.freeze(JSON.parse(await readFile(path.join(here, 'reference-text.json'), 'utf8')));
const ACTIVE = ['waiting', 'checking', 'generating', 'processing'];
const TESTS = [
  { id: 'test_neutral', event: 'ready', text: 'Na gut. Noch eine Runde.', style: 'Natürlich wie die Referenz', cloningMode: 'ultimate' },
  { id: 'test_dry', event: 'kill', text: 'Beschwerden bitte schriftlich.', style: 'Trocken-humorvoll, beiläufig', cloningMode: 'controllable' },
  { id: 'test_energy', event: 'ultimate', text: 'Jetzt wird es unvernünftig.', style: 'Energisch, deutlicher Zuruf', cloningMode: 'controllable' },
].map(sentence => ({ ...sentence, revision: 2, active: true }));
const requireValue = (value, message) => { if (!value) throw new Error(message); return value; };
const shortText = (value, max = 300) => requireValue(typeof value === 'string' && value.trim() && value.length <= max, 'Ungültiger Text.') && value.trim();

export class Workshop {
  constructor(root, generator = new VoxGenerator(), { gameVoiceRoot = null } = {}) { this.root = path.resolve(root); this.generator = generator; this.gameVoiceRoot = gameVoiceRoot; this.paused = true; this.saving = Promise.resolve(); }
  async initialize() {
    await mkdir(this.root, { recursive: true });
    await mkdir(path.join(this.root, 'media'), { recursive: true });
    await mkdir(path.join(this.root, 'packages'), { recursive: true });
    try { this.state = JSON.parse(await readFile(path.join(this.root, 'state.json'), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Werkstatt-Daten sind beschädigt; bestehende Dateien werden nicht überschrieben.');
      this.state = { schema: 1, voices: [], catalog: JSON.parse(await readFile(path.join(here, 'catalog.json'), 'utf8')), catalogVersion: 1, jobs: [], packages: [] };
    }
    // Preserve historical takes as controllable; never relabel an existing production.
    const defaults = JSON.parse(await readFile(path.join(here, 'catalog.json'), 'utf8'));
    let migrated = false;
    for (const sentence of this.state.catalog) if (!sentence.cloningMode) {
      sentence.cloningMode = defaults.find(s => s.id === sentence.id)?.cloningMode ?? 'controllable';
      sentence.revision++; migrated = true;
    }
    if (migrated) { this.state.catalogVersion++; for (const voice of this.state.voices) voice.testedRevision = 0; }
    for (const job of this.state.jobs) {
      job.cloningMode ??= 'controllable'; job.referenceTranscript ??= '';
      if (ACTIVE.includes(job.status)) { job.status = 'interrupted'; job.error = 'Dienst wurde beendet. Vor erneutem Start ComfyUI-Auftrag prüfen.'; }
    }
    await this.save();
  }
  save() {
    const text = JSON.stringify(this.state, null, 2);
    this.saving = this.saving.catch(() => {}).then(async () => {
      const temp = path.join(this.root, 'state.pending');
      await writeFile(temp, text); await rename(temp, path.join(this.root, 'state.json'));
    });
    return this.saving;
  }
  voice(id) { return requireValue(this.state.voices.find(v => v.id === id), 'Stimme nicht gefunden.'); }
  job(id) { return requireValue(this.state.jobs.find(j => j.id === id), 'Take nicht gefunden.'); }
  file(name) { requireValue(/^[a-zA-Z0-9_.-]+$/.test(name), 'Ungültiger Medienpfad.'); return path.join(this.root, 'media', name); }
  stale(job) {
    const voice = this.voice(job.voiceId); const sentence = [...this.state.catalog, ...TESTS].find(s => s.id === job.sentenceId);
    return !sentence || voice.referenceRevision !== job.referenceRevision || sentence.revision !== job.sentenceRevision;
  }
  view() { return { ...this.state, paused: this.paused, jobs: this.state.jobs.map(j => ({ ...j, stale: this.stale(j) })) }; }
  async action(action, data = {}) {
    switch (action) {
      case 'voice': {
        requireValue(typeof data.name === 'string' && data.name.trim() && data.name.length <= 80, 'Gib einen Anzeigenamen mit 1 bis 80 Zeichen ein und speichere das Profil erneut.');
        const name = shortText(data.name, 80);
        let voice = data.id ? this.voice(data.id) : null;
        if (!voice) { voice = { id: randomUUID(), referenceRevision: 0, testedRevision: 0 }; this.state.voices.push(voice); }
        Object.assign(voice, { name, language: 'de', consentGenerate: data.consentGenerate === true,
          consentLan: data.consentLan === true, consentPublic: data.consentPublic === true, archived: data.archived === true });
        break;
      }
      case 'reference': {
        const voice = this.voice(data.voiceId);
        requireValue(!this.state.jobs.some(j => j.voiceId === voice.id && ACTIVE.includes(j.status)), 'Zuerst laufende Produktion abschließen oder abbrechen.');
        requireValue(typeof data.audio === 'string' && data.audio.length < 40 * 1024 * 1024, 'Referenzdatei zu groß.');
        requireValue(data.referenceTextId === REFERENCE_TEXT.id, 'Vorlesetext hat sich geändert. Werkstatt neu laden und den vorgegebenen Text aufnehmen.');
        const revision = voice.referenceRevision + 1;
        const name = `${voice.id}-reference-${revision}-${randomUUID()}.wav`;
        const info = await processAudio(Buffer.from(data.audio, 'base64'), this.file(name), { reference: true, start: data.start ?? 0, end: data.end ?? null });
        Object.assign(voice, { reference: name, referenceRevision: revision, referenceInfo: info,
          referenceTextId: REFERENCE_TEXT.id, transcript: REFERENCE_TEXT.text, testedRevision: 0 });
        break;
      }
      case 'delete-reference': {
        const voice = this.voice(data.voiceId);
        requireValue(!this.state.jobs.some(j => j.voiceId === voice.id && ['checking', 'generating', 'processing'].includes(j.status)), 'Aktuellen eigenen Auftrag erst beenden lassen.');
        for (const j of this.state.jobs) if (j.voiceId === voice.id && j.status === 'waiting') j.status = 'cancelled';
        for (const job of this.state.jobs.filter(j => j.voiceId === voice.id && j.generator?.privateCopiesPending)) {
          await this.generator.cleanup(job); job.generator.privateCopiesPending = false;
        }
        const { readdir } = await import('node:fs/promises');
        for (const name of await readdir(path.join(this.root, 'media'))) if (name.startsWith(`${voice.id}-reference-`) && name.endsWith('.wav')) await unlink(this.file(name));
        voice.reference = null; voice.transcript = ''; voice.referenceTextId = null; voice.referenceRevision++; voice.consentGenerate = false; voice.testedRevision = 0;
        break;
      }
      case 'sentence': {
        const sentence = requireValue(this.state.catalog.find(s => s.id === data.id), 'Satz fehlt.');
        const cloningMode = data.cloningMode ?? sentence.cloningMode;
        requireValue(['ultimate', 'controllable'].includes(cloningMode), 'Unbekannter Cloning-Modus.');
        const style = cloningMode === 'controllable' ? shortText(data.style) : typeof data.style === 'string' ? data.style.trim().slice(0, 300) : '';
        Object.assign(sentence, { text: shortText(data.text), style, cloningMode, active: data.active === true, revision: sentence.revision + 1 });
        this.state.catalogVersion++;
        break;
      }
      case 'generate': {
        const voice = this.voice(data.voiceId);
        requireValue(voice.reference && voice.consentGenerate && !voice.archived, 'Referenz und Zustimmung zur Generierung erforderlich.');
        if (data.lan === true) requireValue(voice.consentLan, 'Aktiviere im Profil die Zustimmung für Generierung und LAN-Nutzung.');
        let sentences;
        if (data.testId) sentences = [requireValue(TESTS.find(s => s.id === data.testId), 'Stimmtest nicht gefunden.')];
        else if (data.tests === true) sentences = TESTS.filter(s => !this.state.jobs.some(j => j.voiceId === voice.id && j.sentenceId === s.id && !this.stale(j)
          && (ACTIVE.includes(j.status) || (j.status === 'review' && j.decision !== 'rejected'))));
        else if (data.sentenceId) sentences = [requireValue(this.state.catalog.find(s => s.id === data.sentenceId), 'Satz fehlt.')];
        else {
          requireValue(data.lan === true || voice.testedRevision === voice.referenceRevision, 'Zuerst drei Stimmtests anhören und bestätigen.');
          sentences = this.state.catalog.filter(s => s.active && !this.state.jobs.some(j => j.voiceId === voice.id && j.sentenceId === s.id && !this.stale(j) && ((j.status === 'review' && (data.lan === true || j.decision !== 'rejected')) || ACTIVE.includes(j.status))));
        }
        requireValue(this.state.jobs.filter(j => ACTIVE.includes(j.status)).length + sentences.length <= 80, 'Warteschlange voll.');
        requireValue(!sentences.some(s => s.cloningMode === 'ultimate') || voice.transcript?.trim(), 'Diese ältere Referenz hat kein Transkript. Unter Stimmen den vorgegebenen Text neu aufnehmen.');
        if (data.start === true) await this.generator.preflight();
        for (const sentence of sentences) this.state.jobs.push({ id: randomUUID(), voiceId: voice.id, sentenceId: sentence.id, sentenceRevision: sentence.revision,
          referenceRevision: voice.referenceRevision, reference: voice.reference, text: sentence.text, style: sentence.style, event: sentence.event,
          cloningMode: sentence.cloningMode, referenceTranscript: sentence.cloningMode === 'ultimate' ? voice.transcript : '',
          seed: randomInt(0, 2147483647), status: 'waiting', decision: null, test: data.tests === true || !!data.testId, createdAt: Date.now() });
        if (data.start === true) this.paused = false;
        break;
      }
      case 'tested': {
        const voice = this.voice(data.voiceId);
        requireValue(TESTS.every(s => this.state.jobs.some(j => j.voiceId === voice.id && j.sentenceId === s.id && !this.stale(j) && j.decision === 'accepted')), 'Alle drei aktuellen Stimmtests müssen angehört und angenommen sein.');
        voice.testedRevision = voice.referenceRevision; break;
      }
      case 'review': {
        const job = this.job(data.id);
        requireValue(job.status === 'review' && !this.stale(job), 'Nur aktuelle prüfbereite Takes freigeben.');
        requireValue(['accepted', 'rejected'].includes(data.decision), 'Prüfentscheidung fehlt.');
        if (data.decision === 'accepted') requireValue(data.listened === true, 'Exportfassung zuerst vollständig anhören.');
        job.decision = data.decision; break;
      }
      case 'lan-selection': {
        const job = this.job(data.id);
        requireValue(job.status === 'review' && !this.stale(job), 'Nur aktuelle fertige Sprüche auswählen.');
        requireValue(typeof data.include === 'boolean', 'Auswahl fehlt.');
        // Inclusion is a package selection, not a claim that someone listened.
        job.decision = data.include ? null : 'rejected'; break;
      }
      case 'trim': {
        const job = this.job(data.id); requireValue(job.raw && ['review', 'failed'].includes(job.status), 'Keine abgeschlossene Rohfassung vorhanden.');
        const audio = `${job.id}-${randomUUID()}.ogg`;
        const info = await processAudio(await readFile(this.file(job.raw)), this.file(audio), { start: data.start, end: data.end });
        job.audio = audio; job.audioInfo = info; job.decision = null; job.status = 'review'; job.error = null; break;
      }
      case 'cancel':
        for (const job of this.state.jobs) if ((!data.id || data.id === job.id) && ACTIVE.includes(job.status)) { job.cancelled = true; if (job.status === 'waiting') job.status = 'cancelled'; }
        this.paused = true; break;
      case 'cleanup':
        for (const job of this.state.jobs.filter(j => j.generator?.privateCopiesPending && !ACTIVE.includes(j.status))) {
          await this.generator.cleanup(job); job.generator.privateCopiesPending = false;
        }
        break;
      case 'pause': this.paused = true; break;
      case 'resume': this.paused = false; break;
      case 'release': return this.release(data.voiceId, data.partial === true);
      case 'lan-release': return this.release(data.voiceId, true, true);
      case 'install-game': {
        requireValue(this.gameVoiceRoot, 'Der Projektordner für Spielstimmen ist in diesem Werkstatt-Dienst nicht eingerichtet.');
        await this.release(data.voiceId, true, true);
        const entry = this.state.packages.filter(p => p.voiceId === data.voiceId).at(-1);
        const bundle = await this.bundle([entry.checksum]);
        this.voice(data.voiceId).gamePackage = await installGamePackage(this.gameVoiceRoot, bundle);
        break;
      }
      case 'remove-package': {
        const entry = requireValue(this.state.packages.find(p => p.checksum === data.checksum), 'Paket fehlt.');
        await unlink(path.join(this.root, 'packages', `${entry.checksum}.fdvoice`));
        this.state.packages = this.state.packages.filter(p => p !== entry); break;
      }
      default: throw new Error('Unbekannte Aktion.');
    }
    await this.save(); void this.pump(); return this.view();
  }
  async pump() {
    if (this.running || this.paused) return;
    this.running = true;
    try {
      while (!this.paused) {
        const job = this.state.jobs.find(j => j.status === 'waiting'); if (!job) break;
        try {
          const voice = this.voice(job.voiceId);
          requireValue(!this.stale(job) && voice.consentGenerate && !voice.archived, 'Stimme gesperrt oder Auftrag überholt.');
          job.status = 'checking'; await this.save();
          const bytes = await this.generator.generate(job, this.file(job.reference), async metadata => { job.generator = metadata; job.status = metadata.promptId === null ? 'checking' : 'generating'; await this.save(); }, () => job.cancelled);
          if (job.cancelled) throw new Error('Abgebrochen.');
          job.raw = `${job.id}.flac`; await writeFile(this.file(job.raw), bytes, { flag: 'wx' });
          job.status = 'processing'; await this.save();
          job.audio = `${job.id}.ogg`; job.audioInfo = await processAudio(bytes, this.file(job.audio));
          job.status = job.cancelled ? 'cancelled' : 'review';
        } catch (error) { job.status = job.cancelled ? 'cancelled' : 'failed'; job.error = error.message; this.paused = true; }
        await this.save();
      }
    } catch (error) {
      this.paused = true; console.error('Voice-Werkstatt: Produktion wegen eines Speicherfehlers angehalten.', error.message);
    } finally { this.running = false; }
  }
  releaseSummary(voiceId, lan = false) {
    const voice = this.voice(voiceId); const chosen = new Map();
    for (const job of this.state.jobs) if (job.voiceId === voice.id && !job.test && !this.stale(job) && job.status === 'review' && job.audio && (lan || job.decision === 'accepted')
      && this.state.catalog.some(s => s.id === job.sentenceId && s.active)) chosen.set(job.sentenceId, job);
    const jobs = [...chosen.values()].filter(j => !lan || j.decision !== 'rejected');
    return { jobs, missingEvents: VOICE_EVENTS.filter(event => !jobs.some(j => j.event === event)),
      bytes: jobs.reduce((n, j) => n + j.audioInfo.bytes, 0), seconds: jobs.reduce((n, j) => n + j.audioInfo.duration, 0) };
  }
  async release(voiceId, partial, lan = false) {
    const voice = this.voice(voiceId); requireValue(voice.consentLan && !voice.archived, 'Freigabe für den Teilnehmerkreis fehlt.');
    const summary = this.releaseSummary(voiceId, lan);
    if (lan) requireValue(summary.jobs.length, 'Noch keine fertigen Spielsprüche vorhanden. Starte zuerst die Produktion.');
    requireValue(summary.jobs.length && (!summary.missingEvents.length || partial), `Teilpaket ausdrücklich bestätigen. Fehlend: ${summary.missingEvents.join(', ')}`);
    const version = 1 + Math.max(0, ...this.state.packages.filter(p => p.voiceId === voiceId).map(p => p.version), voice.lastVersion ?? 0);
    const files = {}; const clips = [];
    for (const job of summary.jobs) {
      const bytes = await readFile(this.file(job.audio)); const file = `${job.id}.ogg`;
      files[file] = bytes.toString('base64');
      clips.push({ id: job.id, sentenceId: job.sentenceId, event: job.event, file, sha256: await voiceHash(bytes), bytes: bytes.length, duration: job.audioInfo.duration, codec: 'vorbis' });
    }
    const manifest = { schema: 1, catalogVersion: this.state.catalogVersion, packageId: voice.id, version, voiceId: voice.id, name: voice.name, language: 'de', missingEvents: summary.missingEvents, clips };
    const checksum = await voiceHash(canonicalJson(manifest));
    const bundle = await validateVoiceBundle({ format: 'fragdachse-voice', schema: 1, packages: [{ manifest, checksum, files }] });
    await writeFile(path.join(this.root, 'packages', `${checksum}.fdvoice`), JSON.stringify(bundle), { flag: 'wx' });
    voice.lastVersion = version;
    this.state.packages.push({ checksum, voiceId, name: voice.name, version, clips: clips.length, bytes: summary.bytes, missingEvents: summary.missingEvents });
    await this.save(); return this.view();
  }
  async bundle(checksums) {
    requireValue(Array.isArray(checksums) && checksums.length > 0 && checksums.length <= 10, 'Ein bis zehn Pakete auswählen.');
    const packages = [];
    for (const checksum of [...new Set(checksums)]) {
      requireValue(this.state.packages.some(p => p.checksum === checksum && !this.voice(p.voiceId).archived && this.voice(p.voiceId).consentLan), 'Paket ist nicht zur Weitergabe freigegeben.');
      packages.push(...JSON.parse(await readFile(path.join(this.root, 'packages', `${checksum}.fdvoice`), 'utf8')).packages);
    }
    return validateVoiceBundle({ format: 'fragdachse-voice', schema: 1, packages });
  }
}
