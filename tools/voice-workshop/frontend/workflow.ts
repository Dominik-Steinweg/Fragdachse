interface Voice { reference?: string; transcript?: string; consentGenerate?: boolean; consentLan?: boolean; archived?: boolean; referenceRevision: number; testedRevision: number }
interface Job { voiceId: string; sentenceId: string; status: string; stale?: boolean; test?: boolean; decision?: string | null }
export const TEST_IDS = ['test_neutral', 'test_dry', 'test_energy'];
export const ACTIVE_JOBS = ['waiting', 'checking', 'generating', 'processing'];
export function productionProgress(voice: Voice | undefined, jobs: Job[], lan = false) {
  const current = jobs.filter(j => !j.stale);
  const testsAccepted = TEST_IDS.filter(id => current.some(j => j.sentenceId === id && j.status === 'review' && j.decision === 'accepted')).length;
  const testsAvailable = TEST_IDS.filter(id => current.some(j => j.sentenceId === id && (ACTIVE_JOBS.includes(j.status) || (j.status === 'review' && j.decision !== 'rejected')))).length;
  const reason = !voice ? 'Wähle eine Stimme aus.' : voice.archived ? 'Die Stimme ist archiviert. Aktiviere sie im Bereich Referenzen.'
    : !voice.consentGenerate ? 'Speichere zuerst die Zustimmung zur Generierung im Bereich Referenzen.'
    : lan && !voice.consentLan ? 'Aktiviere im Profil die gemeinsame Zustimmung für Generierung und LAN-Nutzung.'
    : !voice.reference ? 'Nimm zuerst den Vorlesetext auf und speichere die Referenz.'
    : !voice.transcript ? 'Diese ältere Referenz hat keinen Vorlesetext. Bitte im Bereich Referenzen neu aufnehmen.' : '';
  const tested = !!voice && voice.referenceRevision > 0 && voice.testedRevision === voice.referenceRevision;
  return { reason, testsAccepted, testsAvailable, tested, canTest: !reason, canProduce: !reason && (lan || tested),
    active: current.filter(j => ACTIVE_JOBS.includes(j.status)).length,
    waiting: current.filter(j => j.status === 'waiting').length,
    failed: current.filter(j => ['failed', 'interrupted'].includes(j.status)).length,
    review: current.filter(j => j.status === 'review' && !j.decision).length };
}

export function explainError(error: unknown): string {
  const value = error as { name?: string; message?: string };
  if (value?.name === 'NotAllowedError') return 'Mikrofonzugriff wurde nicht erlaubt. Erlaube das Mikrofon in den Browser-Einstellungen für diese Seite und starte die Aufnahme erneut.';
  if (value?.name === 'NotFoundError') return 'Kein Mikrofon gefunden. Schließe ein Mikrofon an oder importiere eine Aufnahme des Vorlesetexts.';
  if (value?.name === 'NotReadableError') return 'Das Mikrofon ist belegt oder nicht erreichbar. Schließe andere Aufnahmeprogramme und versuche es erneut.';
  if (value?.name === 'EncodingError') return 'Diese Audiodatei kann der Browser nicht lesen. Importiere eine WAV-Datei oder nimm den Text hier neu auf.';
  const text = value?.message ?? String(error);
  if (/fetch|network|load failed/i.test(text)) return 'Die Verbindung zur Werkstatt ist unterbrochen. Starte den Werkstatt-Dienst und lade die Seite erneut. Gespeicherte Referenzen bleiben erhalten.';
  if (/VOICE_COMFY_INPUT|VOICE_COMFY_OUTPUT/.test(text)) return 'Die Ordner für den lokalen Generator sind noch nicht eingerichtet. Trage die ComfyUI-Ein-/Ausgabeordner gemäß Startanleitung ein und starte die Werkstatt neu. Danach kannst du den Test erneut starten.';
  if (/FFmpeg fehlt/.test(text)) return 'Die Audio-Aufbereitung ist noch nicht eingerichtet. Hinterlege FFmpeg gemäß Startanleitung und starte die Werkstatt neu.';
  if (/belegt|queue/i.test(text)) return 'Der Generator bearbeitet noch einen Auftrag. Warte auf dessen Abschluss und starte anschließend erneut.';
  return text;
}
