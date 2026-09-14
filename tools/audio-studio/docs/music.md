# Musik im Audio Studio

Musik verwendet dieselben Katalog-, Job-, RAW-, Processing- und Freigabemodule
wie SFX. `medium` bleibt derselbe `ComfyUiGenerator` mit demselben festen
Workflow und direktem Prompt. Keine Prompt-Umschreibung und kein neues Modell.
Die offizielle [Medium-Modellkarte](https://huggingface.co/stabilityai/stable-audio-3-medium)
zeigt mehrminütige Musikgenerierung und Duration-Conditioning bis 380 Sekunden.

## Start nach dem Update

Den laufenden Studio-Prozess im ursprünglichen Terminal mit `Strg+C` beenden.
Das Schließen des Browserfensters beendet den Server nicht. Danach:

```powershell
cd C:\Fragdachse\tools\audio-studio
uv sync --locked --inexact
npm start
```

ComfyUI zusätzlich laufen lassen. Kein neues Modell herunterladen.
Das Tool installiert seine zusätzliche FFmpeg-Abhängigkeit separat vom Spiel.
Eine laufende alte Studio-Version muss vor `uv sync` beendet sein, weil Windows
den verwendeten `audio-studio.exe`-Startbefehl sperrt.

## Produzieren und vergleichen

1. Kategorie **Musik · Lobby & Arena** wählen. Unter **Bestand** den vorhandenen
   Track hören oder als unveränderte Arbeitskopie importieren.
2. Unter **Generieren** den eigenen Prompt prüfen. Neue Rezepte starten mit
   Lobby 90 s und Arena 120 s, jeweils zwei Kandidaten nacheinander. Zum
   Vergleichen genügt zunächst ein Kandidat. Musik erlaubt ganze Sekunden bis
   380 s; SFX bleibt bei 47 s und seinen bisherigen Modellwegen.
3. **Bearbeiten** auf einem RAW wählen. `music_loop` bleibt auf Loop-Wiedergabe.
   Ohne manuellen Schnitt bleibt die ganze musikalische Anordnung erhalten;
   die überlappenden Anfangs-/Endbereiche verkürzen die Datei um den Crossfade.
   Keine SFX-Onset-Erkennung und kein Herausschneiden einer kurzen Textur.
4. Start/Ende in Millisekunden oder per Maus setzen, Crossfade anpassen und
   **WAV & OGG erzeugen** wählen. Die Loop-Punkte gehören zum RAW. Die
   Dateigrenze des bearbeiteten Loops liegt innerhalb der Überblendung.
   Mit einem längeren Crossfade beginnen, bei rhythmischem Versatz manuell
   musikalisch passende Taktgrenzen auswählen. Ein Crossfade garantiert
   weder gleiche Harmonie noch passende Beat-Phase.
5. RAW, bearbeitetes WAV und finales OGG direkt im Ergebnisbereich vergleichen.
   Die Loop-Prüfdatei wiederholt das tatsächlich decodierte OGG dreimal.
   Messwerte, gewählte Schnittpunkte und Warnungen stehen im Rezept.
6. Genau die gewünschte OGG-Version auswählen, **Übernahme prüfen**, anhören
   und ausdrücklich freigeben. Erst dann schreibt der Adapter das Asset und
   ergänzt bei Bedarf deterministisch `SHIPPED_AUDIO_FILES`.

Neue Lobby-Musik ersetzt das aktuelle Ziel aus `MUSIC_ASSETS`; der bestehende
Track wird bis zur Freigabe nicht angefasst. Der bisherige Arena-Verweis zeigte
auf eine nicht vorhandene WAV. Als einmalige Projektvorbereitung verweist
die zentrale Konfiguration jetzt auf `music_arena.ogg`. Auch dort wird erst bei
Freigabe ein Track abgelegt. Laufender Tool-Betrieb ändert keine Zuordnungen,
Keys oder Lautstärken. Andere zukünftige Musikrollen bleiben außerhalb des
Produktionskatalogs; geteilte Musik-/SFX-Ziele blockieren die Veröffentlichung.

## Lautheit und musikalische Identität

`music_loop` richtet auf standardmäßig −16 LUFS aus und begrenzt auf −1 dBTP.
Gemessen wird mit dem gebündelten [FFmpeg-EBU-R128-Scanner](https://ffmpeg.org/ffmpeg-filters.html#ebur128)
einschließlich seiner True-Peak-Messung durch Oversampling. Bei fehlendem
Messwerkzeug schlägt das Musik-Processing verständlich fehl.
Musik wird mit FFmpeg als OGG/Vorbis exportiert. Die Messung umfasst zwei
Loop-Durchläufe und eine zusätzliche Reserve von 0,1 dB für die gerundete
Messausgabe; das Rezept nennt die effektive Grenze.
Die Pegelgrenze hat Vorrang vor der Ziel-Lautheit; dynamisches Material kann
deshalb leiser bleiben. Output Gain wird anschließend berücksichtigt, unter
derselben Schutzgrenze. Auch das decodierte OGG wird geprüft und bei Codec-
Überhöhungen mit geringerem Pegel erneut exportiert. Ein bereits im RAW
verzerrtes Signal kann dadurch nicht repariert werden.

`musical_identity` ist ein versioniertes Autorenfeld für die gemeinsame
Richtung, kein automatisch angehängter Prompt. Siehe
[musikalische Richtung](../catalog/music-identity.md). Die tatsächlichen Prompts
und Defaults stehen nur im bestehenden [Katalog](../catalog/sounds.json).
`sync` bewahrt Prompts, manuelle Defaults, Vorschläge und ausgeblendete Hinweise.
Neue Einträge erhalten einen leeren Prompt; die hier gelieferten beiden
Startprompts wurden ausdrücklich als Autorenentscheidung angelegt.

Lokale Generierungsnachweise und offene Hör-/Hardwareabnahme stehen in
[acceptance.md](acceptance.md).
