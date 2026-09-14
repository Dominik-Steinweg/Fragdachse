# Umsetzungs- und Abnahmestand

Geprüft am 14. September 2026 gegen das vollständig gelesene Konzept v1 und den lokalen Quellcode. **Die Implementierung ist keine bestandene Klang-/Hardwareabnahme.**

## Aktuell: Lobby- und Arena-Musik über Medium/ComfyUI

Lobby und Arena werden aus der zentralen `MUSIC_ASSETS`-Konfiguration in den
bestehenden Katalog aufgenommen. Neue Musikrezepte verwenden Medium, Loop und
`music_loop`; die Startprompts wurden per CLI mit Revisionsschutz angelegt.
Vorhandene SFX-Autorenfelder und ausgeblendete Kopie-Hinweise wurden dabei
auf unveränderten Inhalt geprüft. Die gemeinsame `musical_identity` ist ein
Autorenhinweis ohne automatische Prompt-Erweiterung.

Nur ein Spieleintrag wurde vorbereitet: Der Verweis auf die nicht vorhandene
`music_arena.wav` zeigt jetzt auf `music_arena.ogg`. Es wurde kein generierter
Track ins Spiel übernommen; Lobby-Musik wurde nicht ersetzt.

**Echte lokale Generierung ausgeführt:** ComfyUI 0.35.1, vorhandenes Medium,
derselbe feste Workflow, 8 Schritte, CFG 1. Beide WAVs sind endlich, nicht leer,
Stereo und 44.100 Hz. Gemessen wurde die API-Laufzeit einschließlich Import;
dies ist kein Kaltstart-Benchmark.

| Rolle/Test | Angefordert / RAW | Seed | Laufzeit |
|---|---|---|---|
| Lobby-Prompt | 60 s / 60,000363 s | 190914 | 13,45 s |
| Arena-Prompt | 120 s / 120,000726 s | 190915 | 16,66 s |

Lokale Nachweise, einschließlich unverändertem Prompt, Graph und Datei-Hashes:

- `.audio-workspace/smoke/music-medium-60s-205f27c090f0489f9842a794fa5ce8ca/`
- `.audio-workspace/smoke/music-arena-medium-120s-de58ac4b265e456083b48ae4df0b0b01/`

Diese Arbeitsdateien werden nicht versioniert. Beide RAWs erreichen 0 dBFS;
Loop-Übergang, musikalische Eignung und mögliche bereits erzeugte Verzerrungen
müssen gehört werden. Processing kann vorhandene Verzerrung nicht reparieren.

**Processing an beiden echten RAWs bestanden:** `music_loop`, 2.000 ms
Equal-Power-Crossfade, Ziel −16 LUFS / −1 dBTP, zusätzliche 0,1 dB Messreserve.
Die exportierten OGGs sind 58,000363 s bzw. 118,000726 s lang. Beide messen
−16,1 LUFS und −2,1 dBTP, einschließlich zweier Wiederholungen zur Messung des
Loop-Übergangs. Die WAVs messen −16,0 LUFS. RAW-Hashes blieben unverändert;
WAV, OGG, drei OGG-Wiederholungen und Rezept liegen jeweils unter
`music-loop-v2/` in den obigen Nachweisordnern.

Der erste echte Langtest deckte einen nativen libsndfile/Vorbis-Prozessabbruch
auf, den kurze Testsignale nicht zeigten. Musik exportiert deshalb mit dem
gebündelten FFmpeg in einem geprüften Unterprozess; der SFX-Pfad bleibt
soundfile-first. Ein GPU-unabhängiger 60-s-Stereotest schützt den Langexport.
Die erste unvollständige Arbeitsversion bleibt als Fehlversuch liegen und
wurde weder veröffentlicht noch als Erfolg gewertet.

**Spielprüfung:** `npm run check` bestanden: 3.629 Core-Tests,
33 Architekturtests und Produktionsbuild. Keine Tool-Module oder Arbeitsdaten
im Build; das Spiel bekommt keine Python-/FFmpeg-/Modellabhängigkeit.

**Abschließende Tool-Prüfung:** `npm test` bestanden: **131 Python +
16 Adapter + 9 Frontend = 156 Tests**, zwei bekannte Deprecation-Warnungen.
Enthalten sind der gemeinsame ComfyUI-Workflow mit langem Musik-Conditioning,
Medium-/SFX-Grenzen, Prompt-/Identitätserhalt, lange Schnittpunkte, echter
Vorbis-Export, True-Peak-Messung, fehlendes Messwerkzeug und menschliche Freigabe.
WAV-Ziele werden vor der Exportvorschau abgewiesen, sodass keine wirkungslose
Freigabe den Kandidaten sperrt. Der Testlauf verwendete `UV_NO_SYNC=1`, um den
Startbefehl der laufenden Studio-Instanz nicht zu ersetzen; Abhängigkeiten
und Lockdatei sind aktualisiert. JS-Syntax, Schema-Parität und `git diff --check`
wurden ebenfalls geprüft.

**Nicht ausgeführt / offen:** Browser-Sicht-/Mausprüfung (kein Browserauftrag),
subjektive Hörfreigabe einschließlich Loop-Takt/Harmonie und SFX-Überlagerung,
echte Veröffentlichung eines Musiktracks (erfordert menschliche Auswahl),
maximale 380-s-GPU-Generierung und erneuter GPU-Wechseltest zwischen Small/Python
und ComfyUI. Die vorhandenen Generatoren und Workflowdateien blieben unverändert.
Die laufende Studio-Instanz wurde nicht beendet oder zusätzlich gestartet.
Nach Abschluss im eigenen Terminal stoppen, `uv sync --locked --inexact`,
`npm start` und die Studio-Seite neu laden; siehe [Musikbedienung](music.md).

## Vorheriger Stand: Small-SFX über beide Pipelines vergleichen

Auf Folgeauftrag stehen gleichzeitig **Small-SFX (Python)** (`small-sfx`) und
**Small-SFX (ComfyUI)** (`small-sfx-comfyui`) zur Verfügung. Medium bleibt separat
auf ComfyUI. Der vorhandene Python-Generator blieb bytegleich. Es wurden keine
Produktionsprompts, Hinweise oder vorhandenen Modellvorgaben automatisch migriert;
während der Arbeit extern geänderte Katalogdaten wurden nicht überschrieben.

Der neue Weg ist ausschließlich ein zusätzlicher Registry-Eintrag und ein fester
nativer Workflow. Die vorhandene ComfyUI-HTTP-Anbindung und die Jobs-/RAW-/Processing-
Module werden geteilt. Modellauswahl, CLI und Autorenschema verwenden die Registry.
Kandidaten und Historie kennzeichnen Pipeline, Seed, angeforderte Dauer, Schritte
und CFG; auch die Processing-Quellenauswahl unterscheidet die beiden Wege.

**Lokale Einrichtung:** Vorhandener Small-SFX-Checkpoint von
`E:\Fragdachse-Audio\models\small-sfx\model.safetensors` unverändert nach
`D:\Comfy-Desktop\ComfyUI-Shared\models\checkpoints\stable_audio_3_small_sfx.safetensors`
kopiert (2.270.384.940 Bytes). Quelle und Kopie stimmen mit der SHA-256 aus dem
Modell-Lock überein:
`ed9cf1b6172f1a8c2921a9560c21109ff3239524563ced9dce6dcdef41e2f515`.
Keine neuen Downloads, keine Custom-Nodes und kein Eingriff in die Python-Runtime.
Das versionierte Script `scripts/prepare_comfy_small.py` reproduziert die Kopie.

**Realer GPU-Test bestanden:** ComfyUI 0.35.1, RTX 3080, native Small-Inferenz,
2 Sekunden, Seed 1701, 8 Schritte, CFG 1, Prompt „A single dry metallic impact,
isolated sound effect, no music or speech.“ Workflow mit LCM/simple und direktem
Prompt. Job `f5f14c95-b25d-4e19-9ffb-0c92211848a6` lieferte FLAC und erfolgreich
importierte RAW-WAV: Stereo, 44.100 Hz, 90.112 Frames / 2,043356 Sekunden,
API-/Importlaufzeit ca. 3,72 Sekunden. RAW-SHA-256:
`204a2584713b81e3af76ccc138880003c8e876010549ec70072717137084f3db`.
Lokaler Nachweis unter
`.audio-workspace/smoke/small-sfx-comfyui-c2fdc6a6de0d485a86f244199620bc6c/`.
Vorher wurden Studio- und ComfyUI-Queue geprüft; laufende Nutzeraufträge wurden
nicht beendet, keine Studio-Instanz zusätzlich gestartet und nichts veröffentlicht.

**Tests:** `npm test` bestanden: **118 Python + 13 Adapter + 7 Frontend = 138**,
zwei unveränderte Deprecation-Warnungen. Darunter identischer Parametertransport
an die zwei Small-Wege, parallele Registry-Einträge, ursprüngliche Python-Auswahl,
Schema-Parität, unabhängige RAW-/Processing-Ergebnisse beider Comfy-Workflows,
korrekte Herkunft historischer Läufe und geprüfte Checkpoint-Kopie ohne Überschreiben.
JS-Syntax und CLI-Auswahl für alle drei Optionen geprüft.

**Noch offen:** menschlicher A/B-Hörvergleich mit gleichem Prompt/Seed und Profil,
mehrfacher Wechsel zwischen beiden Prozessen bei knappem GPU-Speicher sowie
längere Small-Läufe/Loops. Small-Python wurde in diesem Ergänzungsschritt nicht
erneut auf der GPU ausgeführt; frühere reale Nachweise und unveränderte native
Vertragstests bleiben bestehen. Die Sampler und Ausgabelängen unterscheiden sich;
identische Seeds garantieren keine identischen Samples. Keine Browserprüfung
(kein Browserauftrag) und kein erneuter Game-Build (nur Tool-Code geändert).

Nutzung nach Studio-Neustart: [Small-SFX vergleichen](comfyui.md#small-sfx-vergleichen).

## Aktuell: Medium über ComfyUI (14. September 2026)

Auf ausdrücklichen Folgeauftrag ersetzt für **Medium** eine lokale ComfyUI-API
den zuvor vorgesehenen direkten Python-Weg. Small-SFX bleibt auf Python;
`audio_studio/models.py` blieb in dieser Erweiterung bytegleich (SHA-256
`b8dd22f91f1c0fd67bbd6d5e0bf6508e208ba7cb421b4760b5b1a2cb0fdd4868`).
Einrichtung und Betrieb: [comfyui.md](comfyui.md).

Die vom Nutzer gestartete ComfyUI-Desktop-Instanz wurde unter Port 8188 erreicht:
Version **0.35.1**, PyTorch **2.12.1+cu130**, RTX 3080. Checkpoint und T5Gemma
sowie die nativen Nodes wurden anhand von `/object_info` geprüft. Der feste
Workflow verwendet direkten Prompt, explizites Dauer-Conditioning, LCM/simple,
tiled VAE und FLAC-Ausgabe; kein Qwen/Prompt-Rewriting.

**Tatsächlich ausgeführt:**

- CLI-Smoke mit 2 Sekunden, Seed 1702, 8 Schritten und CFG 1: erfolgreiche
  Stereo-RAW-WAV, 44.100 Hz, 90.112 Frames / 2,043356 Sekunden. Nach zuvor
  geladenem Modell ca. 1,63 Sekunden API-/Importlaufzeit. Job-ID
  `7a0be547-2c92-4cbe-9d31-1481666fa182`; RAW-SHA-256
  `0d821737cc4d5e46b737b55a0c792b05259616d4df7b30d01ad37edba0d95e63`.
- Vollständiger Studio-Job für `sfx_explosion_mini_rocket`, **unveränderter
  vorhandener Prompt**, 3 Sekunden, Seed 1703, 8 Schritte, CFG 1: RAW erfolgreich
  erzeugt und mit dem vorhandenen Explosion-Profil zu WAV und OGG verarbeitet.
  Stereo, 44.100 Hz, 2,972154 Sekunden tatsächliche Modellausgabe;
  API-/Importlaufzeit ca. 2,63 Sekunden. Run
  `ada67465494d43bf81c9184a4c39ba3f`, Job-ID
  `f8b41ca4-7dbf-4cba-bfb7-3df2a8d10e5f`. RAW-SHA-256
  `932ba57e64b4f9acdf069e0e18dd5b3326ca6ed829f766e844c915cecb5c7ff9`.
  Der Kandidat samt Ergebnis ist nach Studio-Neustart im vorhandenen Arbeitsbereich
  sichtbar. **Nicht angehört oder veröffentlicht.**
- Vorangegangener Versuch erreichte Sampling/Decoding, scheiterte aber am
  zunächst falsch serialisierten V3-Formatparameter. Der installierte Comfy-Code
  bestätigt `inputs.format = "flac"`; Comfy normalisiert diesen String intern.
  Workflow korrigiert und danach real erfolgreich ausgeführt. Ein weiterer
  Vorversuch wies `2.0` fälschlich ab; der Vertrag akzeptiert jetzt wie der
  Katalog alle numerisch ganzen Sekunden und lehnt Nachkommastellen ab.

Nachweise liegen lokal unter `.audio-workspace/smoke/` und
`.audio-workspace/comfyui-acceptance-20260914.json`. Die vollständige erzeugte
Audiolänge wird übernommen; der Import verändert weder Samples noch Rate.
FLAC und WAV wurden im GPU-unabhängigen Integrationstest samplegenau verglichen.
Der echte Mini-Raketen-Test bestätigte unveränderte Katalog- und RAW-Hashes nach
dem Processing. Keine Spiel-SFX oder Whitelist wurden dabei geändert.

**Automatisch geprüft:** `npm test` bestanden: **113 Python + 13 Adapter +
6 Frontend = 132 Tests**, weiterhin zwei bekannte Deprecation-Warnungen.
Abgedeckt sind insbesondere echte API-Schemaformen, direkter Prompt, Bindings,
Seed/Parameter, eigene Job-IDs, unbestimmter Fortschritt, kein Doppelstart bei
unklarer POST-Antwort, fehlender Server/Workflow/Node/Checkpoint, Timeout,
Dateigrößen-/Pfad-/RAW-Schutz sowie der gemeinsame RAW-/Processing-Ablauf.

**Offen / in diesem Durchlauf nicht ausgeführt:** Hörabnahme der Medium-Ergebnisse,
reale längere Jobs/Loops, mehrfacher Wechsel Small-SFX ↔ Medium bei knappem VRAM,
erzwungener GPU-OOM und Abbruch eines laufenden GPU-Jobs. Diese Fälle sind nicht
durch Hardwaretests abgenommen; Fehler-/Abbruchverträge sind mit Doubles geprüft.
Keine Browser-/Sichtprüfung (kein Browserauftrag). Kein erneuter Game-Build:
Diese Erweiterung ändert ausschließlich `tools/audio-studio/`; frühere
Spielprüfungen sind weiter unten als historische Ergebnisse dokumentiert.

Die folgenden älteren Versuchsabschnitte dokumentieren den ursprünglichen
Python-Setupweg. Fehlendes Flash Attention im Studio blockiert den jetzt aktiven
ComfyUI-Medium-Weg nicht.

| Phase | Implementiert / geprüft | Offen |
| --- | --- | --- |
| P0 – Machbarkeit/Vorbereitung | Small-SFX über Python und Medium über ComfyUI erzeugen echte Audiodateien auf der RTX 3080. Zugriff und vom Nutzer bestätigte Lizenzfreigabe dokumentiert. Drei byteidentische Kopien samt SHA-256-Provenienz; fehlende SFX-WAV-Ziele auf OGG umgestellt. | Umfangreiche Hardware-/Hörabnahme gemäß aktueller Liste oben. |
| P1 – Katalog | AST-Adapter, 70 initiale Rezepte, Schema, inkrementeller Abgleich, Vorschläge, Autoren-/Hinweisschutz und CLI. Fakten aus dem Spiel abgeleitet. | Fachliche/klangliche Feinabstimmung der Startprompts. |
| P2 – Studio/Generierung | Oberfläche, Rezepte, Einzelworker, persistierte Runs, Abbruch zwischen Kandidaten, Modellwechsel/Entladen. Gemeinsamer Generatorvertrag mit Python-/ComfyUI-Routing. Beide Wege haben reale RAWs erzeugt. | Hörqualität, Wechsel zwischen beiden echten Modellruntimes und realer CUDA-OOM-Fall. |
| P3 – Processing | One-Shot-Onset, Frühtransient, manuelle Cuts/Fades, schonendes Profil, Loop-Bereich/Crossfade und decodierte OGG-Prüfung. Codec-/Signaltests bestanden. | Hörabnahme für Rauschvorlauf, Ladeeffekte, Explosionstails und Loop-Nähte. |
| P4 – Übernahme | Vorschau/Freigabe, gemeinsame Ziele, aktuelle Hashes, Backups, additive Whitelistpflege, Recovery und geschützte Bereinigung. End-to-End-Test mit echtem OGG in temporärem Repository. | Menschlich freigegebenes Modellresultat im echten Spiel hören. |

## Tatsächliche Modellversuche

Nach der vom Nutzer erledigten Lizenz-/Zugriffsfreigabe und lokalen Anmeldung
wurden die Modellpakete installiert. Große Streaming-Downloads stockten auf
diesem Host; fortsetzbare HTTP-Teilstücke mit abschließender offizieller
SHA-256-Prüfung funktionierten. Die Gewichte liegen wie vom Nutzer gewählt unter
`E:\Fragdachse-Audio\models`, außerhalb des Repositories.

- **Small-SFX erfolgreich:** offizieller CLI-Smoke-Pfad, 2 Sekunden, Seed 1701,
  44.100 Hz, Stereo, 88.200 Frames. Gemeldete Adapterlaufzeit einschließlich
  Modellladen: 14,08 Sekunden. RAW-SHA-256:
  `8e5c5e6f2b8f7eca605e68d49aed2fce9ddab0c214a4775ac831e8f3d8be9bc0`.
- Zwei weitere Generationen im selben Prozess (Seeds 1702/1703) verwendeten
  dieselbe Modellinstanz. Gemeldete Laufzeit 11,36 Sekunden beim ersten und
  0,54 Sekunden beim zweiten Aufruf; nachgelagerte Provenienz-Hashes zählen nicht
  zu diesem Timer. CUDA-Spitze: 2.284.434.432 Bytes allokiert und 2.745.171.968
  Bytes reserviert. Nach Entladen: 8.519.680 Bytes allokiert. Diese Werte sind
  PyTorch-Zähler, keine Messung des gesamten Desktop-VRAMs.
- Runtime: Python 3.12.14, Torch/Torchaudio 2.7.1+cu126, Stable Audio 3 0.1.0 an
  Commit `779434a908193105335fd8d833418603625b2859`, Transformers 5.17.0.
  `uv pip check` meldet alle 53 installierten Pakete als kompatibel.
- Der erste echte RAW-Testton wurde zusätzlich durch das gemeinsame
  `impact`-Profil verarbeitet: dekodierbares Vorbis-OGG mit 44.100 Hz Stereo,
  53.166 Frames, endlichen Samples und ohne Processor-Warnungen. Dies ist eine
  technische Codec-/Pipelineprüfung, keine Hörfreigabe.
- Small-SFX-Revision `ae12755283df9d62ca39a9b050a39a0b607b8c20` und
  Textencoder-Revision `97ea9b7e92738bb57437867277ae38e65345b8d7` sind vorbereitet.
  Für Medium sind Revision, Konfiguration und erwarteter Gewichts-Hash
  festgehalten; die 9,22-GB-Datei bleibt gemäß Nutzerwunsch ein manueller Download.
- **Medium-Hardwaretest nicht ausführbar:** Flash Attention 2 und Medium-Gewichte
  fehlen. WSL wurde nicht installiert. Small-SFX benötigt Flash Attention nicht.
- **Keine Hör-/Browser-/Spielabnahme behauptet.** Die echten RAW-Dateien und
  lokalen Messprotokolle liegen ausschließlich im ignorierten Workspace unter
  `.audio-workspace/smoke/` und `.audio-workspace/runs/`; keine dieser Dateien wurde ins Spiel übernommen.

## RAW-Rauschen durch Dauer-Conditioning

Am 14. September meldete der Nutzer brauchbare Mini-Raketenexplosionen, fehlerhafte
ASMD-Schüsse und stark beschädigte Biss-RAWs. Vergleichsläufe mit gleichem Prompt,
Seed und Modell isolierten Dauern mit Nachkommastellen als Auslöser. Der laufende
Server war bereits tatsächlich neu gestartet worden. Die gescheiterten
Medium-Aufrufe wurden wegen fehlender Voraussetzungen vor dem Entladen von
Small-SFX abgewiesen. Eine spätere Wiederholung der ursprünglichen Raketenexplosion
ergab identische Audiosamples; es gab keinen Hinweis auf einen vergifteten Modellzustand.

Beim Biss mit Seed `1838078139` ergaben sich folgende RAW-Messwerte:

| Modelldauer | RMS (linear) | Samples an der Vollaussteuerungsgrenze |
| --- | --- | --- |
| 1,5 s | 0,56965 | 19,46 % |
| 1,9 s | 0,29621 | 2,52 % |
| 2 s | 0,01056 | 0 % |
| 2,1 s | 0,89825 | 71,63 % |

Auch 1 und 3 Sekunden ergaben Impulse mit anschließender Ruhe; 3,5 Sekunden
ergaben anhaltendes Rauschen ohne Clipping. Eine reine Clipping-Prüfung würde
den Fehler deshalb nicht zuverlässig erkennen. ASMD und Raketenexplosion zeigten
denselben Unterschied zwischen 1,5 Sekunden und ganzen Sekunden.

Die offizielle [Datenvorbereitung am gepinnten Commit](https://github.com/Stability-AI/stable-audio-3/blob/779434a908193105335fd8d833418603625b2859/stable_audio_3/data/utils.py)
setzt `seconds_total` mittels `math.ceil` auf ganze Sekunden; die
[offizielle Oberfläche](https://github.com/Stability-AI/stable-audio-3/blob/779434a908193105335fd8d833418603625b2859/stable_audio_3/interface/diffusion_cond.py)
verwendet für diesen Wert Schrittweite 1. Die öffentliche Python-Schnittstelle
akzeptiert dagegen Floats. Das ist eine durch lokale Versuche belegte
Kompatibilitätskorrektur unseres Adapters, keine upstream bestätigte Fehlerbehebung.

Der Adapter verwendet jetzt `ceil(requested_duration)` für den vollständigen
Modellaufruf. `arguments.duration_seconds` bleibt der Wunschwert,
`actual_arguments.duration` enthält den tatsächlichen Wert und `duration_policy`
kennzeichnet die Regel. RAWs werden nicht nachträglich auf den Wunschwert gekürzt.
CLI und Weboberfläche nutzen denselben Adapter; Autorenfelder bleiben erhalten.

**Mit korrigiertem Server und echter GPU erneut geprüft:**

- Biss, angefordert 1,5 s → Modell 2 s: 88.200 Frames, Peak 0,25342, kein Clipping.
- ASMD-Primärschuss, angefordert 1,5 s → Modell 2 s: 88.200 Frames, Peak 0,54932, kein Clipping.
- Mini-Raketenexplosion, angefordert 3 s → Modell 3 s: 132.300 Frames, Peak 0,91504, kein Clipping.

Alle drei Ergebnisse besitzen samplegenau dieselben Audiodaten wie ihre jeweiligen
Kontrollläufe mit ganzen Sekunden. WAV-Dateihashes können wegen Container-Metadaten
abweichen. Die neuen Kandidaten stehen in der Studio-Historie; der lokale Nachweis
liegt unter `.audio-workspace/smoke/duration-fix-20260914/evidence.json`.
**Die subjektive Hörabnahme der neuen Kandidaten bleibt beim Nutzer.**
Medium ist weiterhin mangels Gewichten und Flash Attention 2 nicht ausführbar.

## Noch manuell abzunehmen

### Bedienungsüberarbeitung und Action-Prompts

Die folgende Weiterentwicklung ersetzt die oben beschriebene automatische
Aufrundung für **neue Eingaben**: Katalog, API, Job-Einreichung und Modelladapter
akzeptieren nur ganze Sekunden. 70 Presets sind ganzzahlig, davon wurden 15 von
1,5 auf 2 Sekunden aufgerundet. Historische Runs werden unverändert gelesen.
Alle 70 Prompts wurden auf kräftigere, je Ereignis unterscheidbare Action-SFX
überarbeitet; frühere Prompts/Dauern stehen im versionierten
`catalog/migrations/action-recipes-20260914.json`. Modelle, sonstige Autorenfelder
und ausgeblendete Hinweise wurden bei dieser Migration erhalten.

Der Produktionsablauf hat drei Schritte: Bestand, Generieren, Bearbeiten &
Ergebnis. Modellschritte und Kandidatenfortschritt stehen bei der Generierung;
unbekannte Ladezeiten bleiben unbestimmt. Fehler und abgeschlossene Aktionen
erscheinen lokal und als sichtbare Statusmeldung. Bearbeitete Versionen und
WAV/OGG-Player stehen unter dem Schnittwerkzeug. Die tatsächliche WAV-Wellenform
wird über den vorhandenen, hashgeprüften Medienpfad geladen. Beide Wellenformen
verwenden dieselbe Amplitudenskala, jeweils mit eigener Millisekunden-Zeitachse.
Maus-/Tastaturmarkierungen und Millisekundenfelder steuern Start, Ende und Fades.
Explizite Fade-In-Werte dürfen die Attacke bewusst formen; automatische
Profil-Fades behalten den bisherigen Attack-Schutz.
Ein vorhandenes Ergebnis wird bei neuen Einstellungen als vorheriger Stand
gekennzeichnet. Die explizite OGG-Freigabe bleibt bestehen.

Zusätzliche Absicherung: Formulare behalten ihre geladene Katalogrevision.
Hintergrund-Polling darf einen fremden Katalogstand nicht zur Freigabe eines alten
Formulars verwenden. Die ausgewählte OGG-Version bleibt auch beim Betrachten
anderer Versionen in der Fußleiste und beim Ergebnis erkennbar.

**Ohne Browser technisch geprüft:** Start und Navigation, RAW-Auswahl,
Maus-Schnitt, Umrechnung in den Processor-Vertrag, Ergebnisanzeige,
Veraltet-Hinweis, Ganzzahlvalidierung und Konflikt mit externer Rezeptänderung
in einem lokalen DOM-Testdouble. Das ersetzt keine Sicht-/Mausprüfung in einem
echten Browser. Die normalen Tool-Tests prüfen zusätzlich Modellfortschritt,
Abbruchzustände und tatsächliche bearbeitete WAV-Daten.

Abschließendes `npm test`: **76 Python-, 13 Adapter- und 5 Frontend-Tests
bestanden (94 insgesamt)**. Ein früherer Durchlauf traf beim atomaren Rename
einer temporären Exportdatei auf eine Windows-Sperre; Einzelwiederholung und
abschließender Gesamtlauf bestanden. Weiterhin zwei bekannte Deprecation-Warnungen.
JS-Syntax, Schema-Parität und Whitespace-Prüfung bestanden. Eine während der
Arbeit manuell geänderte ASMD-Promptfassung wurde zusätzlich erhalten.

**In diesem Durchlauf nicht ausgeführt:** Browser-Sichtprüfung (kein opt-in),
neue GPU-/Hörabnahme der überarbeiteten Prompts (die bestehende Studio-Instanz
führte einen Nutzerauftrag aus und wurde nicht unterbrochen), Medium-Test
(Gewichte/Flash Attention weiterhin nicht nachgewiesen) und erneuter Game-Build
(ausschließlich Tool-Dateien geändert). Nach dem aktuellen Auftrag den Server
im eigenen Terminal mit `Strg+C`, anschließend `npm start`, neu starten und
die Studio-Seite neu laden. Es wurde keine weitere Hintergrundinstanz gestartet.

1. Medium-Datei gemäß [Modell-Setup](model-setup.md#manually-downloaded-weights) manuell ablegen und mit `-LocalWeights` prüfen.
2. Flash Attention 2 für Medium einrichten, vorzugsweise in einer eigenen WSL2/Linux-Umgebung; hier noch nicht nachgewiesen.
3. Small-SFX-Ergebnisse anhören; Medium tatsächlich ausführen und messen. Wechsel zwischen beiden echten Modellen, laufenden Jobabbruch und CUDA-Fehlerfall prüfen.
4. Oberfläche im Browser prüfen: Suche, Rezeptpflege, RAW/WAV/OGG, Schnittfelder/Wellenform und Vorschau-Faktor. **Browser-/Sichtprüfung mangels Browserauftrag nicht ausgeführt.**
5. Schuss, große Explosion, Lade-/Swell-Sound und Loop mit aktuellem Bestand vergleichen; OGG-Naht über mehrere Durchläufe hören.
6. Ein angehörtes OGG freigeben, Spiel neu laden und das richtige Ereignis mit Überlagerung/Entfernung prüfen. Game-Audiodateien wurden hier nicht durch Modellresultate ersetzt.

## Automatisierte Prüfung

`npm test` im Unterprojekt umfasst Node-Adapter und Python-Suite. Reale Vorbis-Dateien und temporäre Repositories prüfen den gesamten Ablauf; injizierte Upstream-Doubles prüfen getrennt den Modellvertrag. Keine GPU-/Netzwerkpflicht.

Ergebnis des Setup-Folgedurchlaufs: **13 Node-Tests und 53 Python-Tests bestanden**. Zusätzliche Tests sichern externe Modellpfade, Einzelmodell-Setup, manuellen Gewichtsimport, Offline-Textencoder, Runtime-Diagnose und fortsetzbare HTTP-Downloads. Zwei Deprecation-Warnungen stammen aus Starlette/httpx/AnyIO; keine Testfehler. Wegen der eingeschränkten Desktop-Testumgebung wurden `UV_CACHE_DIR` und ein eigener pytest-`--basetemp` unter `.cache/` gesetzt. `npm ci` im Unterprojekt und `npm start -- --help` wurden ebenfalls ausgeführt; dabei wurde kein Browser gestartet.

Nach der Dauer-Korrektur: **64 Python- und 13 Node-Tests bestanden**, einschließlich
Aufrundung, Erhalt der angeforderten Dauer, vollständigem RAW und Modellgrenzen für
beide Modelle. `node --check frontend/studio.js` bestanden. Keine neue Browser-
oder Spielprüfung erforderlich: geändert wurden ausschließlich Adapter zur
Modellruntime, Studio-Hinweise, Tool-Tests und Tool-Dokumentation. Die früheren
Spielprüfungen unten wurden in diesem Fehlerbehebungsschritt nicht wiederholt.

`npm run check` am Root umfasst Core, Architektur und Build. `GameContentValidation` akzeptiert bekannte ungeshippte fehlende SFX, prüft aber weiterhin Referenzen und ausgelieferte Dateien einschließlich Armageddon. Kopienachweise stehen unter `catalog/migrations/initial-audio.json`.

Ergebnis: **3.629 Core-Tests, 33 Architekturtests und Produktionsbuild bestanden**. Im Build sind keine Audio-Studio-Module/Arbeitsdaten enthalten. Die Prüfung hat keine Python-/Modellabhängigkeit des Spiels eingeführt.
