import { readVoicePreferences, saveVoicePreferences, voiceLibrary } from '../voice/VoiceLibrary';
import type { VoiceAudioChannel } from '../voice/VoiceAudioChannel';
import { getLocale } from '../i18n';

/** Production lives in the workshop; listening volume lives in the options. */
export function appendVoiceProfileControls(parent: HTMLElement, channel: VoiceAudioChannel | null, onSelect: (checksum: string | null) => void): () => void {
  let disposed = false;
  let playing = false;
  const de = getLocale() === 'de';
  const section = document.createElement('section');
  section.className = 'profile-voice';
  const label = document.createElement('label');
  label.textContent = de ? 'Stimme' : 'Voice';
  const row = document.createElement('div');
  row.className = 'profile-voice-row';
  const select = document.createElement('select');
  select.setAttribute('aria-label', label.textContent);
  label.append(select);
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.textContent = de ? 'Hörprobe' : 'Preview';
  const feedback = document.createElement('small');
  feedback.setAttribute('role', 'status');
  row.append(label, preview);
  section.append(row, feedback);
  parent.append(section);
  const updatePreview = () => { preview.disabled = playing || !select.value || !channel; };
  const refresh = () => {
    if (disposed) return;
    select.replaceChildren();
    const off = document.createElement('option');
    off.value = ''; off.textContent = de ? 'Keine' : 'None'; select.append(off);
    for (const pack of voiceLibrary.packages.values()) {
      const option = document.createElement('option');
      option.value = pack.checksum; option.textContent = pack.manifest.name + ' · v' + pack.manifest.version;
      select.append(option);
    }
    select.value = readVoicePreferences().checksum ?? '';
    if (select.selectedIndex < 0) select.value = '';
    if (voiceLibrary.cleanupWarning) feedback.textContent = de ? voiceLibrary.cleanupWarning : 'Deleted voices are disabled, but their browser copies could not be fully removed. Allow browser storage and reload the game.';
    updatePreview();
  };
  select.onchange = () => {
    saveVoicePreferences({ ...readVoicePreferences(), checksum: select.value || null });
    onSelect(select.value || null);
    updatePreview();
    feedback.textContent = de ? 'Gespeichert. Gilt ab der nächsten Lobby-/Rundenphase.' : 'Saved. Applies at the next lobby/round boundary.';
  };
  preview.onclick = async () => {
    const pack = voiceLibrary.packages.get(select.value);
    if (!pack || !channel || playing) return;
    if (!readVoicePreferences().enabled) {
      feedback.textContent = de ? 'Sprache ist aus. Erhöhe die Sprachlautstärke in den Optionen für eine Hörprobe.' : 'Voice is off. Increase voice volume in Options to hear a preview.';
      return;
    }
    playing = true; updatePreview(); feedback.textContent = '';
    try { await channel.preview(pack); }
    catch { if (!disposed) feedback.textContent = de ? 'Hörprobe konnte nicht abgespielt werden. Bitte erneut versuchen.' : 'Could not play the preview. Please try again.'; }
    finally { playing = false; if (!disposed) updatePreview(); }
  };
  void voiceLibrary.load().then(refresh); refresh();
  return () => { disposed = true; section.remove(); };
}
