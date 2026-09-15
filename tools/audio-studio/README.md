# Fragdachse Audio Studio

Eigenständiges lokales Audio-Unterprojekt zum [Konzept v1](../../docs/GDDs/Fragdachse_Audio_Studio_Konzept_v1.md). Catalog Builder über Codex/Astra und manuelle Weboberfläche verwenden dieselben Kernmodule. Das Spiel braucht weder Python noch Audiomodelle.

**Musik:** Lobby und Arena sind als eigene Kategorie integriert. Beide nutzen Medium über den vorhandenen ComfyUI-Workflow, mit längeren Generationen, `music_loop`, RAW-/WAV-/OGG-Vergleich und ausdrücklicher Übernahmefreigabe. Einrichtung und Bedienung: [Musik im Studio](docs/music.md).

**Stand:** Katalog, Studio, Jobs, Processor und kontrollierte Übernahme sind implementiert und ohne GPU getestet. **Small-SFX ist parallel über Python und ComfyUI auswählbar; Medium nutzt ComfyUI.** Alle Wege haben echte lokale Audiodateien erzeugt. Einrichtung und Vergleich: [ComfyUI/Python](docs/comfyui.md), [Python-Runtime](docs/model-setup.md). Ergebnisse und offene Hörabnahme: [Abnahme](docs/acceptance.md).

## Einrichtung und Start

Für Katalog/Studio: Node.js 20+, Python 3.11–3.13 und [uv](https://docs.astral.sh/uv/). Die separat installierte Modellruntime hat zusätzliche Torch-/CUDA-Anforderungen. Die Tool-Tests wurden mit Python 3.12.14 ausgeführt.

```powershell
cd C:\Fragdachse\tools\audio-studio
npm ci
uv sync --locked --inexact
npm start
```

Auf diesem Rechner sind die Small-SFX-Laufzeit und Gewichte eingerichtet.
Für **Medium (ComfyUI)** oder **Small-SFX (ComfyUI)** zusätzlich ComfyUI Desktop starten und laufen lassen;
die API nutzt standardmäßig Port 8188. Modelle und Nodes wurden dort erkannt.
Die [ComfyUI-Einrichtung](docs/comfyui.md) ersetzt den früheren direkten
Python-Medium-Setupweg. Bestehende Rezepte behalten ihre Modellvorgaben.

Für Small-SFX-Vergleiche im Dropdown zwischen **Python** und **ComfyUI** wechseln
und Prompt, festen Seed, Dauer, Schritte und CFG beibehalten. Die RAW-Historie
zeigt Herkunft und Parameter beider Kandidaten. `small-sfx` bleibt der bisherige
Python-Weg; `small-sfx-comfyui` ist die zusätzliche Option. Gleiche Seeds ergeben
wegen unterschiedlicher Sampler keine garantierten identischen Audiodaten.

`npm start` öffnet `http://127.0.0.1:8765` und startet genau einen Server. Ohne automatisches Browserfenster:

```powershell
uv run --inexact audio-studio serve --no-open
```

### Beenden und Neustarten

`Strg+C` beendet das Studio. Alternativ in einem zweiten Terminal im selben Ordner:

```powershell
npm stop
npm restart
```

`npm stop` funktioniert auch dann, wenn der HTTP-Port bereits geschlossen ist. Der Server
hat bis zu 15 Sekunden für den Shutdown; danach beendet ein Watchdog den eigenen Prozess,
damit eine blockierte Anfrage oder Modellbereinigung die Projektsperre nicht dauerhaft hält.
Ein bereits gestopptes Studio ist kein Fehler. Für einen festhängenden Windows-Prozess:

```powershell
npm stop -- --force
npm start
```

Der erzwungene Stop prüft Projekt, Instanz und Prozess-Erstellungszeit; andere Python-Prozesse
und ComfyUI werden nicht beendet. Fertige Kandidaten bleiben erhalten, unvollständige Jobs
werden beim nächsten Start als unterbrochen markiert. Die Lockdateien nicht manuell löschen:
Entscheidend ist die Betriebssystem-Sperre des laufenden Prozesses, nicht die Existenz der Datei.
Instanzen einer älteren Studio-Version ohne Prozessmetadaten müssen einmalig über ihr
ursprüngliches Terminal bzw. den identifizierten Studio-Prozess beendet werden.

Unter Linux/WSL dieselben Befehle im dortigen Checkout verwenden. Eine Windows-`.venv` funktioniert nicht unter Linux. WSL wurde auf diesem Rechner nicht verifiziert. Das Studio kann ohne Modell vorhandene Dateien zeigen und bearbeiten; erst **Generieren** benötigt dessen Laufzeit, Lizenzfreigabe und lokale Gewichte. `--inexact` erhält zusätzlich installierte Modellpakete, die ein gewöhnliches `uv sync` wieder entfernen könnte.

## Tool 1: Katalog mit Codex/Astra pflegen

```powershell
uv run --inexact audio-studio scan
uv run --inexact audio-studio sync
uv run --inexact audio-studio validate
uv run --inexact audio-studio schema
```

`scan` liest `AUDIO_ASSETS`, `SOUND_VOLUMES`, `MUSIC_ASSETS`, `SHIPPED_AUDIO_FILES` und Verwendungsstellen. Der TypeScript-Adapter wertet unterstützte AST-Strukturen aus und führt keinen Spielcode aus. Dynamische Zuordnungen bleiben unklar. `shot_flame` ist laut aktuellen `successKey`-Verwendungen ein Schussimpuls; der Name allein begründet keinen Loop.

`sync` ergänzt neue Game-Keys mit leerem Prompt, erneuert technische Fakten, erhält Autorenfelder und markiert entfernte Keys als verwaist. Änderungen an Ziel/Verwendung erzeugen separate Hinweise. Die 70 anfänglichen SFX-Rezepte liegen in [catalog/sounds.json](catalog/sounds.json); technische Snapshots darin sind abgeleitet, keine unabhängige Bedarfsliste.

Ein expliziter Patch enthält nur Autorenfelder, beispielsweise:

```json
{
  "intent": "Kurzer trockener Einzelschuss mit sofortiger Attacke.",
  "prompt": {
    "text": "A single compact submachine gun shot, sharp immediate attack, dry isolated recording, no music or ambience.",
    "source": "astra",
    "preserve_on_sync": true
  }
}
```

Patch als lokale JSON-Datei ablegen; die aktuelle `revision` kommt aus `validate`:

```powershell
uv run --inexact audio-studio edit shot_p90 .audio-workspace/prompt-patch.json --revision <SHA256>
uv run --inexact audio-studio edit shot_p90 .audio-workspace/prompt-patch.json --revision <SHA256> --propose
```

`--propose` speichert einen Vorschlag und bewahrt die aktuelle Entscheidung. Zwischenzeitliche Änderungen führen zum Konflikt. Editierbar sind `name`, `category`, `intent`, `musical_identity`, `playback`, `prompt`, `generation_defaults`, `processing`, `notes`, `needs_revision`. Keys, Ziele und Lautstärken gehören dem Spiel. Weitere Codex-Hinweise: [AGENTS.md](AGENTS.md).

## Tool 2: Produzieren, vergleichen, freigeben

1. **Bestand:** Sound suchen, Dateizustand/Whitelist/Kopie-Hinweis prüfen und Game-Datei anhören. Gemeinsame Ziele zeigen sämtliche betroffenen Keys.
2. **Generieren:** Prompt, Medium/Small-SFX, ganzzahlige Dauer und Anzahl wählen. Seed/Schritte stehen unter „Modellparameter & Katalogpflege“. „Speichern & generieren“ reiht einzelne Kandidaten ein. Fortschrittsbalken, Modellschritte, Fehler und Abschluss stehen direkt unter der Aktion. Beim Laden wird ein unbestimmter Balken angezeigt; 100 % gilt erst nach der RAW-Prüfung. Die feste Statusleiste führt zum aktiven Auftrag. Abbruch wartet gegebenenfalls auf den aktuellen Modellaufruf; fertige RAWs bleiben erhalten.
3. **Arbeitskopie:** Vorhandene Game-Datei ohne Generierung importieren. Favorisieren, Verwerfen und Übernehmen sind getrennte Entscheidungen.
4. **Bearbeiten & Ergebnis:** RAW mit „Bearbeiten“ wählen. Unter Schritt 3 stehen Quelle, Schnittwerkzeug und bearbeitete Versionen zusammen. Start/Ende werden in **Millisekunden** eingegeben. „Start“, „Ende“, „Fade-In“ oder „Fade-Out“ wählen und in der RAW-Wellenform klicken/ziehen; Pfeiltasten verschieben die gewählte Markierung um 1 ms, mit Umschalt um 10 ms. Leere Schnittfelder lassen die automatische Bereichserkennung zu. Jede Bearbeitung erzeugt eine eigene WAV-/OGG-Version samt Rezept.
5. **Hörvergleich:** Unter der Bearbeitungsaktion erscheinen die tatsächlich erzeugte WAV-Wellenform, WAV-/OGG-Player und Versionsauswahl. RAW und WAV nutzen dieselbe Amplitudenskala und jeweils eine beschriftete eigene Zeitachse. Änderungen an Schnitt/Fades erzeugen noch keine neue Audiodatei; ein Hinweis kennzeichnet das angezeigte Ergebnis als vorherigen Stand. „Einstellungen dieser Version laden“ setzt die Schnittfelder; erneute Bearbeitung geht immer vom RAW aus. Loop-Prüfdateien enthalten drei Wiederholungen des decodierten OGG. Bei Loops werden die One-Shot-Fade-Werkzeuge deaktiviert. Messwerte und Warnungen stehen beim Ergebnis.
6. **Übernahme:** Ein konkretes OGG je Ziel auswählen. Vorschau mit Ziel, Ersetzung, gemeinsamen Keys und Whitelist-Ergänzung prüfen. Erst die ausdrückliche menschliche Freigabe aller angezeigten OGGs veröffentlicht. Spätere Bearbeitungen ersetzen nie still die freigegebene Version.
7. **Im Spiel hören:** Spiel regulär neu laden/bauen und bei typischer Überlagerung/Entfernung beurteilen. Bereits geladene Phaser-Audiobuffer werden nicht automatisch ausgetauscht.

Die optionale Lautstärkevorschau wendet `SOUND_VOLUMES` nur bei der Wiedergabe an. Der Faktor wird nicht ins Asset eingebrannt. Profile sind Tuningvorschläge. Lade-/Swell-Sounds verwenden das schonende Profil; Loops erhalten keine One-Shot-Randfades. „Game Ready“ bedeutet aufbereitet, nicht klanglich freigegeben.

Manuell eingestellte Fade-In-Werte werden auf den gewählten Bereich angewendet;
automatische Profil-Fades schützen weiterhin die Attacke. Nach jeder Aktion
zeigen Rückmeldungen am betroffenen Schritt und eine sichtbare Statusmeldung
Beginn, Erfolg oder Fehler. Bei paralleler Katalogpflege verlangt das Studio das
erneute Laden eines inzwischen geänderten Rezepts, bevor es gespeichert wird.

### Rauschen bei kurzen RAWs

Die gepinnte Small-SFX-Version erzeugte in lokalen Vergleichstests bei Dauern mit
Nachkommastellen (z. B. 1,5 oder 2,1 Sekunden) starkes Rauschen bis hin zu massiver
Übersteuerung. Ein Neustart oder erneuter Modelldownload behebt diese Ursache
nicht. Dieselben Prompts und Seeds funktionieren mit ganzen Sekunden.

Seit der anschließenden Bedienungsüberarbeitung akzeptieren Katalog, API und
Modelladapter **nur ganze Sekunden von mindestens 1 s**; das Studio begrenzt
SFX-Rezepte auf 47 s. Alle 70 Presets wurden aufgerundet (15 × 1,5 s → 2 s).
Die frühere Aufrundungs-Infomeldung entfällt. Alte Produktionsnachweise bleiben
unverändert lesbar. Das vollständige RAW bleibt erhalten; einen kürzeren Sound
danach im Processing schneiden. Die Regel gilt für beide Modellwege; real auf
der GPU geprüft wurde Small-SFX.
Quellbelege und Kontrollläufe: [Abnahme](docs/acceptance.md#raw-rauschen-durch-dauer-conditioning).

Nach einem Codeupdate den laufenden Server im Startterminal mit `Strg+C` beenden,
`npm start` ausführen und die Seite neu laden. Ein geschlossenes Browserfenster
beendet den Python-Server nicht. Bereits fehlerhaft erzeugte RAWs bleiben in der
Historie und müssen neu generiert werden. Medium-Fehler wegen fehlender
Voraussetzungen treten vor dem Modellwechsel auf; Small-SFX bleibt dabei geladen.

## Grenzen und Wiederherstellung

### Unbenutzte RAWs gesammelt löschen

Unter **Bereinigen → RAWs ohne bisherige Bearbeitung** zeigt das Studio alle
Kandidaten ohne Bearbeitungsversion und den freigebbaren Speicherplatz.
Eine vorherige Markierung als „verworfen“ ist dafür nicht nötig. Favoriten,
übernommene Quellen, laufende Aufträge und bereits bearbeitete Kandidaten
bleiben erhalten; auch eine fehlgeschlagene Bearbeitung zählt als Bearbeitung.
Nachträgliche Änderungen machen eine alte Vorschau ungültig. Erst der
abschließende Löschknopf entfernt die angezeigten Audiodateien. Prompts,
Seeds und Produktionshistorie bleiben gespeichert.

Alternativ bleibt **Als verworfen markierte Kandidaten** verfügbar; diese
Auswahl kann auch deren Bearbeitungsversionen entfernen. Beide Wege betreffen
nur die Studio-Arbeitsdateien, keine Game-Assets, Modellgewichte oder zusätzlichen
Ausgabedateien im ComfyUI-Ordner.

### Veröffentlichungsgrenze

Spieländerungen laufen nur durch [adapter/index.mjs](adapter/index.mjs): freigegebenes OGG am aktuell vorgesehenen SFX- oder unterstützten Musik-Ziel und additive Pflege genau des Sets `SHIPPED_AUDIO_FILES`. Musik ist auf Lobby und Arena beschränkt. Keine Änderungen an Keys, Zuordnungen, Lautstärken, Gameplay, Build, Git-Commits oder Deployment. Medium spricht ausschließlich mit lokalem ComfyUI; kein LLM-Dienst, Prompt-Rewriting oder Cloud-Generierungsfallback.

Fingerprints binden die Freigabe an den überprüften Zustand. Ein Konflikt verlangt neuen Abgleich/neue Vorschau. Das gemeinsame Schreiblock koordiniert CLI und Studio; atomare JSON-Saves erkennen externe Katalogänderungen. Fremde Hosts, Browser-Origins und Schreibanfragen ohne Sitzungstoken werden abgewiesen.

Kurzzeitige Zugriffssperren beim Lesen von JSON-Dateien werden bis zu fünfmal
versucht, mit insgesamt höchstens 375 ms Wartezeit. Bleibt der Zugriff gesperrt,
zeigt die Oberfläche eine verständliche Meldung (HTTP 503); beim nächsten
Statusabruf wird erneut gelesen. Gesperrte Dateien gelten niemals als leere
Historie oder leerer Katalog. Dafür weder Auftragsdateien noch Lockdateien
löschen. Bei einer dauerhaften Sperre Dateiberechtigungen und sperrende
Programme prüfen.

Auch das atomare Ersetzen beim Speichern wiederholt kurzzeitige Zugriffssperren
(bis zu neun Versuche, insgesamt höchstens 1,375 Sekunden Wartezeit).
Die vorherige JSON-Datei bleibt bis zum erfolgreichen Austausch erhalten.
Konfliktprüfungen werden bei jedem Versuch erneut ausgeführt; dauerhafte
Zugriffsfehler und andere Schreibfehler werden nicht verschluckt.

Audio und TypeScript sind zwei Dateien. Jede Veröffentlichung schreibt Backups und einen Transaktionsnachweis unter `.audio-workspace/exports/`. Erfolg folgt erst nach Prüfung beider Änderungen. Mehrfachläufe arbeiten Ziel für Ziel; frühere erfolgreiche Veröffentlichungen bleiben bei einem späteren Fehler bestehen. Ungeklärte Transaktionen blockieren weitere Übernahmen in diesem Arbeitsbereich.

Bei Abbruch den Nachweis prüfen und die dortige `id` verwenden:

```powershell
uv run --inexact audio-studio recover <TRANSAKTIONS-ID>
```

Recovery stellt bekannte Vorzustände wieder her, wenn Dateien noch protokollierten Vor-/Nachzuständen entsprechen. Bei fremden Änderungen wird die Reparatur verweigert; Backup und Nachweis bleiben zum manuellen Vergleich erhalten. Unterbrochene Generierungen werden beim nächsten exklusiven Serverstart markiert und nicht heimlich wiederholt.

## Dateien und Aufbewahrung

| Bereich | Inhalt |
| --- | --- |
| `catalog/sounds.json`, `catalog/schema.json` | Versionierte Prompts, Defaults, Hinweise und Schema |
| `catalog/migrations/` | Herkunft der einmaligen byteidentischen Kopien |
| `catalog/model-lock.json` | Modell-/Quellrevisionen und Prüfnachweise, keine Gewichte |
| `catalog/generators.json`, `workflows/` | Modellrouting, feste ComfyUI-API-Workflows und Parameterbindungen |
| `audio_studio/`, `adapter/`, `frontend/` | Gemeinsame Module, schmale Spielanbindung, lokale Oberfläche |
| `.audio-workspace/runs/<id>/` | Lokale Metadaten, RAW und Bearbeitungen |
| `.audio-workspace/reviews/`, `exports/`, `backups/`, `cleanup/` | Lokale Freigaben, Transaktionen, Sicherungen, Bereinigungsnachweise |
| `.venv/`, `models/`, `.cache/` | Ignorierte Umgebung, Gewichte und Caches |

Alternativ `AUDIO_STUDIO_WORKSPACE` setzen oder `audio-studio --workspace <Ordner> ...` verwenden. Kein Arbeitsbereich in `public/`, `src/`, `dist/`, `.git/`, `node_modules/` oder dem Produktionskatalog. Externe Arbeitsordner werden unterstützt. Keine Arbeitsdateien oder Zugangsdaten in Game-Assets ablegen.

„Bereinigen“ zeigt verworfene, nicht favorisierte und nicht übernommene Kandidaten samt konkreten Dateien. Bestätigung prüft Schutzstatus und Hashes erneut. Metadaten und übernommene Quellen bleiben erhalten. Kopie-Hinweise werden nur durch „Hinweis dauerhaft ausblenden“ verborgen; Sync und neue Produktion reaktivieren sie nicht.

## Tests

```powershell
cd C:\Fragdachse\tools\audio-studio
npm test
# einzeln:
npm run test:adapter
uv run --inexact pytest
```

Die Tests brauchen weder GPU, Modelle noch Netzwerk: synthetische WAV-/OGG-Signale, temporäre Spiel-Repositories, API-Anfragen ohne Browser und injizierte Modellverträge. Sie prüfen Autoren-/Hinweisschutz, Abbruch, Codec-Roundtrips, Loop-/Attack-Verhalten, Freigabe, Konflikte, Transaktionen, Pfade und Bereinigung.

Der vorhandene Node-Testrunner prüft außerdem Mauskoordinaten, Millisekunden-
Umrechnung, Amplitudenskala und Fortschrittsberechnung (`npm run test:frontend`).
Der Python-Vertrag prüft echte bearbeitete WAV-Wellenformen und abgewiesene
Nachkommastellen auch ohne Oberfläche. Modell-Callbacks werden nie als Teil der
Generierungsparameter in JSON geschrieben.

Die actionbetonten Prompts bleiben je Sound unterschiedlich (Attacke, Körper,
Material und Ausklang). Vorherige Prompts und Dauern sind in
[action-recipes-20260914.json](catalog/migrations/action-recipes-20260914.json)
erhalten. Mehr Klangdruck ist eine Produktionsabsicht und bedarf weiterhin der
Hörabnahme; Lautstärkeänderungen im Spiel erfolgen dadurch nicht.

Das Spiel behält seine eigenen Befehle am Root: `npm ci`, `npm run check`. TypeScript umfasst weiterhin `src`; Vite baut Spiel und `public`. Der Game-Testrunner schließt das Unterprojekt aus. Die einmaligen Spieländerungen beschränken sich auf Katalog-/Fallback-/Testvorbereitung und Ausschlüsse laut Konzept.

Hardwareabnahme separat: `audio-studio doctor`, dann nach Modellsetup `audio-studio smoke --model medium` und `audio-studio smoke --model small-sfx`. Fehlgeschlagene Modelltests werden nicht durch synthetische Signale ersetzt. Aktuelle Ergebnisse: [docs/acceptance.md](docs/acceptance.md).
