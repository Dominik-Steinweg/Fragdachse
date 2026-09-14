# Stable Audio 3 über ComfyUI und Python vergleichen

Medium verwendet die lokale ComfyUI-API. Für Small-SFX bleiben **beide Wege
gleichzeitig auswählbar**: `small-sfx` über den unveränderten `StableAudioBackend`
und `small-sfx-comfyui` über die native ComfyUI-Inferenz. Alle liefern denselben
Generierungsvertrag an `Jobs`; RAW-Auswahl, Wellenform, Processing, OGG-Prüfung
und menschliche Veröffentlichung laufen anschließend durch dieselben Module.

## Auf diesem Rechner starten

1. **ComfyUI Desktop starten** und dessen Server laufen lassen. Die API wurde
   unter `http://127.0.0.1:8188` mit ComfyUI **0.35.1** erreicht. Medium,
   Small-SFX, T5Gemma und sämtliche erforderlichen Nodes sind eingerichtet;
   beide ComfyUI-Modelle haben echte RAW-WAVs erzeugt.
2. Nach diesem Codeupdate den alten Audio-Studio-Server im eigenen Terminal mit
   `Strg+C` beenden. Ein geschlossenes Browserfenster beendet keinen Server.
3. Im Studio-Verzeichnis Abhängigkeiten abgleichen und starten:

   ```powershell
   cd C:\Fragdachse\tools\audio-studio
   uv sync --locked --inexact
   npm start
   ```

4. Im Studio **Modellstatus** prüfen, dann den gewünschten Weg wählen:
   **Small-SFX (Python)**, **Small-SFX (ComfyUI)** oder **Medium (ComfyUI)**.
   Prompt, ganze Sekunden, Seed, Schritte und CFG werden direkt übertragen.
   Nach der Generierung RAW anhören und wie bisher bearbeiten.

ComfyUI muss vor einer ComfyUI-Generierung laufen; die Startreihenfolge der beiden
Oberflächen ist sonst egal. Das Studio startet oder beendet ComfyUI nicht.
Während der normalen Produktion ist keine Bedienung in der ComfyUI-Oberfläche
nötig. **Small-SFX (Python)** benötigt keinen laufenden ComfyUI-Server.

## Small-SFX vergleichen

1. Einen Sound und Prompt wählen; unter Modellparameter einen **festen Seed**
   eintragen. Für den ersten Vergleich einen Kandidaten verwenden.
2. Mit **Small-SFX (Python)** generieren.
3. Nur die Modellauswahl auf **Small-SFX (ComfyUI)** ändern. Prompt, Seed, Dauer,
   Schritte und CFG gleich lassen und erneut generieren.
4. Beide RAWs in der Historie vorhören. Modellweg, Seed, Dauer, Schritte und CFG
   stehen am Kandidaten; auch die Ausgangskandidaten-Auswahl im Processing zeigt
   den Modellweg und Seed. Beide Versionen bleiben unabhängig erhalten.

Die Wege sind parallel verfügbar; Kandidaten werden weiterhin nacheinander
berechnet. Bestehende `small-sfx`-Rezepte bleiben auf Python, ohne automatische
Umstellung. Für weitere Vergleiche die gleichen Processing-Einstellungen oder
zunächst ausschließlich RAW verwenden.

**Vergleichsgrenze:** Der direkte Python-Weg verwendet den offiziellen
RF-`pingpong`-Sampler samt eigener Dauer-/Padding-Behandlung. Der feste ComfyUI-
Workflow verwendet natives `KSampler` mit `lcm`/`simple`. Auch Decoder-Skalierung,
FLAC-Zwischenausgabe und tatsächlich erzeugte Länge können sich unterscheiden.
Gleiche Seeds/Schritte stellen deshalb keinen Nachweis identischer Samples dar.
Die Klangqualität und Verarbeitung beider Pipelines sind das Vergleichsziel.
Die Prompttexte werden auf beiden Wegen unverändert weitergegeben.

## Einrichtung auf einem weiteren Rechner

ComfyUI bleibt eine separat installierte lokale Anwendung mit eigener Runtime.
Die Studio-Umgebung benötigt für ComfyUI nur den HTTP-Client und ihre bestehenden
Audio-Abhängigkeiten. Die früher für den direkten Python-Medium-Pfad beschriebene
Flash-Attention-Installation im Studio ist für diesen Weg nicht erforderlich.

Die [offizielle ComfyUI-Anleitung für Stable Audio 3](https://docs.comfy.org/tutorials/audio/stable-audio/stable-audio-3)
nennt diese Dateien aus dem [Comfy-Org-Modellpaket](https://huggingface.co/Comfy-Org/stable-audio-3):

| Datei | ComfyUI-Modellordner |
| --- | --- |
| `stable_audio_3_medium.safetensors` | `models/checkpoints/` |
| `t5gemma_b_b_ul2.safetensors` | `models/text_encoders/` |

Medium Base ist ein anderes Modell. Für den ComfyUI-Textencoder die oben genannte
Datei verwenden; die Python-Hugging-Face-Encoderdatei ist nicht gleich aufgebaut.
Die Audio-Checkpoints selbst erkennt der installierte native Loader anhand ihrer
Tensorstruktur. Vorhandene Python-Gewichte und dessen Textencoder bleiben an ihrem
bisherigen Ort. Zusätzliche
ComfyUI-Modellpfade können in ComfyUI selbst eingerichtet werden. Modellgewichte
und ComfyUI-Arbeitsordner gehören außerhalb der versionierten Tool-Dateien.

Für Small-SFX wird der vorhandene offizielle `model.safetensors` aus dem
Small-SFX-Modellordner **byteidentisch** unter dem ComfyUI-Namen
`stable_audio_3_small_sfx.safetensors` bereitgestellt. Der vorhandene ComfyUI-
T5Gemma wird geteilt; kein neuer Encoder und keine Custom-Nodes nötig.
Vorbereitung ohne Download und ohne Änderung der Python-Dateien:

```powershell
uv run --inexact python scripts/prepare_comfy_small.py --comfy-models D:\Comfy-Desktop\ComfyUI-Shared\models
```

Das Script prüft Quelle und Kopie gegen `catalog/model-lock.json`, erhält eine
bereits passende Datei und überschreibt abweichende Zielgewichte nicht. Auf diesem
Rechner bereits ausgeführt: Quelle weiterhin auf E:, zusätzliche 2,27-GB-Kopie
im bestehenden ComfyUI-Modellordner auf D:. Es wurde nichts heruntergeladen.

Es werden weder Qwen noch Prompt-Rewriting-Nodes benötigt. Die vorhandene
menschliche Lizenzbestätigung in `catalog/model-lock.json` gilt auch für diesen
Modellweg; die Anbindung lädt keine Gewichte herunter.

## Konfiguration und Workflow

`catalog/generators.json` ordnet Modellnamen einem Generator und einem festen
API-Workflow zu. `workflows/stable-audio-3-medium.api.json` und
`workflows/stable-audio-3-small-sfx.api.json` enthalten ausschließlich
native Nodes für Modell/Encoder, direkte Texteingabe, Dauer-Conditioning,
Latent-Erzeugung, Sampling, Audio-Decoding und verlustfreies Speichern.
Quellen und Parameterbindungen stehen in [workflows/README.md](../workflows/README.md).

Die Dauer wird sowohl an die Latent-Erzeugung als auch an
`ConditioningStableAudio.seconds_total` übergeben. Der Prompt wird ohne
Erweiterung, Umschreibung oder LLM-Aufruf verwendet. Der negative Prompt ist leer.
Sampler und Scheduler sind Teil des versionierten festen Workflows; Schritte
und CFG stammen aus dem Studio-Rezept. Jeder Kandidat ist ein eigener API-Auftrag
mit eigener `prompt_id`, eigenem Seed und eindeutigem Ausgabepräfix.

Eine andere lokale Adresse vor dem Studio-Start setzen:

```powershell
$env:AUDIO_STUDIO_COMFYUI_URL = 'http://127.0.0.1:8188'
npm start
```

Zugelassen sind ausschließlich HTTP(S)-Adressen auf Loopback. Das Job-Zeitlimit
steht unter `comfyui.job_timeout_seconds` in der Generator-Konfiguration.
Der zusätzliche Small-SFX-Weg ist ein weiterer Modelleintrag mit eigenem festen
Workflow; Router, HTTP-Client, Jobs und Processing enthalten keine zweite
ComfyUI-Implementierung. CLI-Modellauswahl und Katalogschema leiten die verfügbaren
Namen aus derselben Generator-Konfiguration ab.

## RAW, Status und Fehler

Der offizielle Save-Audio-Node liefert FLAC. Das Studio liest die darin gespeicherten
Samples und schreibt sie ohne Normalisierung, Schnitt oder Resampling als FLOAT-WAV.
Die vollständige vom Modell gelieferte Länge bleibt erhalten; gewünschte kürzere
SFX werden anschließend geschnitten. Transport- und WAV-Hashes sowie der tatsächlich
gesendete Graph, Workflow-Hash, Serverversion und Job-ID bleiben im lokalen
Generierungsnachweis erhalten. Modellnamen und deklarierte Quellrevisionen ersetzen
keine SHA-Prüfung der von ComfyUI tatsächlich geladenen Gewichte.

Queue und History werden nach genau dieser Job-ID abgefragt. Während ComfyUI
arbeitet, zeigt das Studio einen laufenden Balken ohne erfundene Schrittprozente.
Abgeschlossen ist ein Kandidat erst nach Download und WAV-Prüfung. Der Abbruch
wartet wie bisher gegebenenfalls auf den aktuellen Modellaufruf und verhindert
weitere Kandidaten. Bei Timeout wird ausschließlich die eigene noch wartende
Job-ID aus der ComfyUI-Queue entfernt; ein bereits laufender Auftrag kann dort
weiterlaufen. Fremde Aufträge werden niemals global unterbrochen oder gelöscht.

| Meldung | Abhilfe |
| --- | --- |
| ComfyUI nicht erreichbar | ComfyUI starten, Serveradresse/Port prüfen und erneut generieren. |
| Workflow/Node fehlt oder inkompatibel | Versionierten Tool-Workflow wiederherstellen bzw. ComfyUI auf einen Stand mit nativen Stable-Audio-3-Nodes aktualisieren. |
| Modell/Encoder fehlt | Die oben genannten Dateien in ComfyUI bereitstellen und Modellstatus erneut prüfen. |
| Generation fehlgeschlagen | Angezeigten Node-/Laufzeitfehler prüfen; bei Speichermangel andere GPU-Aufträge beenden und mit kurzem Einzelkandidaten testen. |
| Keine gültige Ausgabe | Auftrag gilt als fehlgeschlagen; es wird kein defektes RAW als fertiger Kandidat angeboten. |
| Zeitlimit / Verbindung während des Auftrags verloren | Job-ID in ComfyUI prüfen, bevor ein neuer Auftrag gestartet wird; es erfolgt kein automatischer Doppelstart. |

Beim Wechsel zu Medium entlädt das Studio sein eigenes Python-Modell erst nach
erfolgreicher ComfyUI-Vorprüfung. ComfyUI verwaltet seinen GPU-Speicher selbst.
„Modell entladen“ im Studio gibt nur den eigenen Python-Modellspeicher frei.
Für den Wechsel zurück zu Small-SFX kann auf knappen GPUs die Freigabe des
ComfyUI-Modellcaches oder das Beenden von ComfyUI erforderlich sein.

ComfyUI behält seine Ausgaben unter `output/audio-studio/`. Die importierte
RAW-WAV ist eine eigenständige Studio-Arbeitskopie; Studio-Bereinigung löscht
keine ComfyUI-Dateien. Beide Arbeitsbereiche werden nicht versioniert.

## Prüfung

`npm test` prüft Routing, Original-Prompt und Parameter, Queue/History,
Fehlermeldungen, ausschließlich eigene Job-IDs und FLAC/WAV-Import mit synthetischen
Signalen und lokalen HTTP-Doubles. Diese Tests benötigen keine GPU und keinen Server.
Die unveränderte Python-Backend-Suite prüft weiter Small-SFX.

Für einen echten API-Test bei beendetem Studio-Server:

```powershell
uv run --inexact audio-studio smoke --model medium --duration 2 --seed 1701
uv run --inexact audio-studio smoke --model small-sfx-comfyui --duration 2 --seed 1701
uv run --inexact audio-studio smoke --model small-sfx --duration 2 --seed 1701
```

Das schreibt ausschließlich einen lokalen Smoke-Nachweis samt RAW unter
`.audio-workspace/smoke/`. Keine Übernahme ins Spiel. Ergebnisse und offene
Hardware-/Hörabnahmen stehen in [acceptance.md](acceptance.md).
