# Fragdachse – Lokale SFX-Produktionspipeline

## Konzept v1.0

**Stand:** 14. September 2026  
**Zweck:** Grundlage für die anschließende technische Planung und Implementierung durch eine Coding-KI.  
**Repository:** `Dominik-Steinweg/Fragdachse`  
**Geprüfter Stand:** `main`, Commit `44d9bad51e075fa301e0a4cfada680af298b0a05`.

Dieses Dokument beschreibt den abgestimmten Funktionsumfang und die daraus abgeleitete Zielarchitektur. Konkrete Dateinamen, Befehlsnamen und Datenfelder für die neuen Tools sind Implementierungsvorschläge, keine bereits vorhandenen Schnittstellen. Die Repository-Anbindung wurde anhand des Quelltexts geprüft; Installation, Generierungsqualität und Laufzeit auf der lokalen Hardware müssen bei der Umsetzung getestet werden.

---

## 1. Ziel und verbindliche Entscheidungen

Für Fragdachse entsteht eine lokale Produktionspipeline für Soundeffekte. Astra bereitet im vorhandenen Codex-Arbeitsablauf den Soundkatalog mit Prompts und Voreinstellungen vor. Anschließend kann der Nutzer unabhängig von Astra über eine lokale Website Sounds erzeugen, anhören, nachbearbeiten, vergleichen und ausdrücklich zur Übernahme ins Spiel freigeben.

**Leitprinzip: Das Spiel definiert den Soundbedarf. Astra bereitet die Produktion vor. Der Nutzer entscheidet, welche Audiodateien veröffentlicht werden.**

| Thema | Festlegung |
|---|---|
| Bedienung | Zwei Tools: **Sound Catalog Builder** für Codex/Astra und **Local Audio Studio** für die manuelle Browser-Bedienung. |
| Kosten | Keine zusätzlichen kostenpflichtigen Modell-APIs, Abonnements oder Hosting-Dienste. Vorhandener Astra-/Codex-Zugang und lokale Hardware werden genutzt. Lizenzbedingungen bleiben Voraussetzung. |
| Hardware | NVIDIA RTX 3080 und 32 GB Arbeitsspeicher stehen zur Verfügung. |
| Generierung | Stable Audio 3 lokal, mit auswählbarem **Medium** und **Small-SFX**. Kein ComfyUI im Produktionspfad. |
| Umfang V1 | Nur SFX, einschließlich One-Shots und Loops. Musik bleibt unverändert und außerhalb des Tools. |
| Soundbedarf | Ausschließlich aus dem Spiel. Neue Sounds werden im Rahmen der Feature-Entwicklung bereits im Katalog und an der passenden Verwendungsstelle vorgesehen. |
| Prompts | Tool 1 ergänzt neue Prompts. Bestehende Prompts und manuelle Anpassungen bleiben erhalten; Änderungen werden nur vorgeschlagen. |
| Freigabe | Keine automatische Übernahme generierter oder nachbearbeiteter Sounds. |
| Schreibrechte von Tool 2 | Freigegebene Audiodateien am vorgesehenen Ziel ablegen/ersetzen und bei Bedarf **ausschließlich die zugehörigen Dateinamen in `SHIPPED_AUDIO_FILES` ergänzen**. |
| Bisherige Fallbacks | Einmalig eigene Zielpfade anlegen und die bisherigen Sounds unverändert dorthin **kopieren**, sodass sich zunächst klanglich nichts ändert. |
| Kopie-Hinweis | Tool 1 hinterlegt einen Hinweis auf die ursprüngliche Kopie. Tool 2 zeigt ihn an; der Nutzer kann ihn dauerhaft ausblenden. |
| Formate | Rohmaterial und Arbeitsdateien: WAV. Neue finale Game-Assets: **OGG/Vorbis**. |
| Aufbewahrung | Metadaten bleiben erhalten. Favoriten und übernommene Quellen werden geschützt; verworfene große Audiodateien sind gezielt bereinigbar. |

„Keine zusätzlichen Kosten“ bedeutet hier keine zusätzlichen Dienst- oder Lizenzgebühren bei erfüllten Lizenzbedingungen. Strom, Speicherplatz und die Nutzungskontingente des bereits vorhandenen KI-Zugangs bleiben reale Rahmenbedingungen.

## 2. Anschluss an das vorhandene Spiel

### 2.1 Verbindliche Quellen

Die zentrale Audiokonfiguration existiert bereits. Eine zweite, unabhängig gepflegte Liste benötigter Game-Sounds soll ausdrücklich nicht entstehen. [R1], [R2], [R3], [R4]

| Quelle | Bedeutung für die Pipeline |
|---|---|
| `src/audio/AudioCatalog.ts` → `AUDIO_ASSETS` | Verbindliche Sound-Keys und die vom Spiel erwarteten Dateipfade. |
| `AudioCatalog.ts` → `SOUND_VOLUMES` | Vorhandene Lautstärkefaktoren; werden gelesen, nicht durch Tool 2 geändert. |
| `AudioCatalog.ts` → `SHIPPED_AUDIO_FILES` | Freigabeliste für den bestehenden Audio-Loader. |
| `public/assets/sounds/` | Tatsächlicher Zielordner für Game-Assets. |
| `src/loadout/content/data/` und die daraus aufgebauten Registries | Fachlicher Kontext und konfigurierte Verwendungen, beispielsweise `shotAudio.successKey`. |
| Verwendungsstellen im Quelltext | Zusätzlicher Kontext, insbesondere One-Shot- und Loop-Nutzung. |
| `src/audio/GameAudioSystem.ts` | Bestehende Wiedergabe über `playSound`, `playLocalSound` und `startLoop`. |

Die im Spiel verwendete Adresse `./assets/sounds/p90.ogg` wird im lokalen Projekt zu `public/assets/sounds/p90.ogg` aufgelöst. Vorhandene Schreibweisen, einschließlich Groß-/Kleinschreibung wie bei `Gauss.ogg`, bleiben maßgeblich.

Die Whitelist wird **nicht entfernt**. Der Loader lädt aktuell nur katalogisierte, freigeschaltete Dateien; Wiedergabeversuche ohne geladenes Asset werden vom `GameAudioSystem` übersprungen. Eine noch fehlende Datei kann deshalb als geplanter Sound existieren, ohne dass sie bereits in der Whitelist stehen muss. [R1], [R2]

### 2.2 Wichtige Abgrenzung: Kandidaten sind keine Ingame-Varianten

Im geprüften Stand verweist ein Audio-Key auf genau einen Dateipfad. Die Wiedergabe enthält an dieser Stelle keine Auswahl aus einem Satz unterschiedlich generierter Samples. [R1], [R2]

Für V1 gilt daher als aus dem Repository abgeleitete Umfangsgrenze:

> Für einen Sound dürfen beliebig viele **Kandidaten** erzeugt, verglichen und favorisiert werden. Zur Übernahme wird jedoch genau **ein Kandidat pro vorgesehenem Zielpfad** gewählt.

Acht generierte P90-Samples bedeuten somit acht Auswahlmöglichkeiten für `p90.ogg`, nicht automatisch acht im Spiel zufällig abgespielte Varianten. Mehrere Sounds können in einem Übernahmelauf ausgewählt werden, sofern sie unterschiedliche bereits vorgesehene Ziele besitzen.

Ein echtes Ingame-Varianten-System benötigt eine separate Erweiterung von Katalog und Runtime. Es ist nicht Bestandteil dieser Pipeline und wird nicht durch zusätzliches Kopieren unreferenzierter Dateien vorgetäuscht.

## 3. Gesamtarchitektur und Zuständigkeiten

```text
                         TOOL 1
                 Sound Catalog Builder
                 über Codex / Astra
                           │
            deterministischer Repository-Scan
            + fachliche Anreicherung durch Astra
                           │
                           ▼
                  versionierter Soundkatalog
                  Prompts / Defaults / Hinweise
                           │
                           ▼
                         TOOL 2
                    Local Audio Studio
                 Browser + lokales Backend
                           │
               Sound und Einstellungen wählen
                           │
                    lokale Generierung
                           │
                       RAW anhören
                           │
                   AudioAssetProcessor
                           │
                 Ergebnis und OGG anhören
                           │
                   manuelle Freigabe
                           │
                           ▼
              public/assets/sounds/<ziel>.ogg
              + gezielte Whitelist-Ergänzung
```

Die zwei Tools sind zwei Bedienwege, nicht zwei unabhängig implementierte technische Plattformen. Sie teilen Datenformat, Repository-Adapter und Validierungsregeln.

**Tool 1** versteht mit Astra den Spielkontext und pflegt Produktionsbeschreibungen. **Tool 2** führt die gespeicherten Rezepte aus und verwaltet Auswahl, Nachbearbeitung und Veröffentlichung. Beide beziehen technische Fakten aus derselben Spielkonfiguration.

Astra ist kein ständig laufender Bestandteil des Audio Studios. Insbesondere gibt es dort keine versteckten LLM-Aufrufe, automatische Prompt-Umschreibungen oder kostenpflichtigen Cloud-Fallbacks.

## 4. Einmalige Vorbereitung im Spielprojekt

Diese Arbeiten gehören zur initialen Implementierung beziehungsweise zu einer separat geprüften Migration. Sie sind **keine erweiterten Schreibrechte für den späteren Alltagsbetrieb von Tool 2**.

### 4.1 Eigene Zielpfade für bisherige temporäre Fallbacks

Die folgenden Verknüpfungen sind im geprüften Katalog vorhanden. Bei der Migration erhalten die betreffenden Ereignisse eigene OGG-Dateien. [R1]

| Audio-Key | Aktuell verwendete Datei | Vorgesehene eigene Datei |
|---|---|---|
| `sfx_explosion_mini_rocket` | `sfx_explosion_he.ogg` | `sfx_explosion_mini_rocket.ogg` |
| `sfx_train_explode` | `sfx_nuke_explosion.ogg` | `sfx_train_explode.ogg` |
| `sfx_explosion_armageddon` | `sfx_nuke_explosion.ogg` | `sfx_explosion_armageddon.ogg` |

Dabei werden die Dateien **byteidentisch kopiert**, die jeweiligen Katalogpfade angepasst und die neuen Dateinamen zur Whitelist hinzugefügt. Lautstärkefaktoren, Audio-Keys und Gameplay-Verwendungsstellen bleiben gleich. Keine erneute Kompression, Normalisierung oder sonstige klangliche Bearbeitung in diesem Schritt.

Besondere Vorsicht gilt bei HE- und Raketenexplosion: Die Namen der aktuell zugeordneten Dateien sind im Katalog bewusst gegeneinander getauscht. Quelle ist deshalb immer der tatsächlich aufgelöste Katalogpfad, nicht eine aus dem Dateinamen vermutete Bedeutung. [R1]

Die Migration dokumentiert Quell-Key beziehungsweise Quellpfad, Ziel-Key, Zielpfad und Datei-Hash. Tool 1 übernimmt diese Herkunft in den Produktionskatalog. Eine zusätzliche Hash-Prüfung kann die Kopie bestätigen; bei mehreren identischen Quellen darf keine eindeutige Herkunft erfunden werden.

Bewusste Wiederverwendung bleibt bestehen. Beispielsweise müssen `sfx_options_preview` und der verwendete Countdown-Sound nicht allein deshalb getrennt werden, weil sie dieselbe Datei nutzen. Gleiches Audiomaterial ist nicht automatisch ein Fehler. [R1]

### 4.2 SFX-Zielpfade auf OGG vereinheitlichen

Noch fehlende SFX sind teilweise mit `.wav`-Zielpfaden eingetragen. Diese werden einmalig auf die später erwarteten `.ogg`-Pfade umgestellt. Dabei werden keine Audiodateien und keine Whitelist-Einträge für noch fehlende Sounds erfunden. [R1]

Sollte bei der Umsetzung tatsächlich ein verwendetes SFX in einem anderen Format vorliegen, erfolgt dessen Umstellung separat mit Backup und Hörvergleich. Bereits vorhandene OGG-Dateien bleiben unverändert. Musik wird weder umgestellt noch durch diese Migration verändert.

Das vorhandene `scripts/convert-audio.mjs` ist keine ungeprüft wiederverwendbare Exportfunktion: Es kann auch Katalogpfade ändern und Quelldateien verschieben. Der normale Tool-2-Export erhält deshalb eine eigene, eng begrenzte Implementierung. [R5]

### 4.3 Tests an bewusst noch fehlende Sounds anpassen

Der bestehende Test `GameContentValidation.test.ts` verlangt für alle referenzierten Shot-Sounds eine vorhandene Datei. Das widerspricht der vereinbarten Möglichkeit, einen Sound bereits im Spiel vorzusehen, bevor sein Asset produziert wurde. [R3]

Die initiale Projektanpassung soll daher präzise unterscheiden:

- **Unbekannter Key:** weiterhin Fehler.
- **Bekannter, noch nicht freigeschalteter Sound ohne Datei:** zulässiger Produktionsbedarf, sichtbar im Audio Studio.
- **Freigeschalteter Sound ohne gültige Datei:** weiterhin Fehler.

Bestehende ausdrückliche Verfügbarkeitsanforderungen bleiben bestehen. Insbesondere darf die Fallback-Migration den vorhandenen Armageddon-Sound nicht verschwinden lassen. Tests werden gezielt an diese Regeln angepasst, nicht pauschal abgeschwächt.

Ein weitergehendes Audio-Refactoring oder eine allgemeine Umstellung aller String-Typen ist keine Voraussetzung für diese Pipeline.

## 5. Tool 1 – Sound Catalog Builder

### 5.1 Bedienung und technische Form

Tool 1 wird in einer Codex-Sitzung mit Astra verwendet. Sinnvoll ist die Kombination aus einem kleinen deterministischen CLI-Werkzeug und einer projektbezogenen Agent-Anweisung beziehungsweise einem Skill.

Das CLI liest, vergleicht, validiert und speichert strukturierte Daten. Astra erstellt die fachlichen Beschreibungen und Prompts innerhalb der bereits vorhandenen Sitzung. Das Python- oder Node-Skript muss selbst kein zusätzliches LLM aufrufen.

### 5.2 Ablauf

1. **Inventar erfassen:** Alle SFX-Keys, Zielpfade, Lautstärkefaktoren, Whitelist-Zustände und tatsächlich vorhandenen Dateien lesen. Musik ausschließen.
2. **Verwendung zuordnen:** Konfigurierte und direkte Verwendungen suchen; One-Shot/Loop, Waffe, Utility oder Ereignis nachvollziehbar belegen.
3. **Bestand abgleichen:** Neue, bestehende, geänderte und nicht mehr katalogisierte Keys unterscheiden. Kopie-Herkunft und manuelle Hinweise berücksichtigen.
4. **Mit Astra anreichern:** Für neue Einträge Namen, Soundabsicht, englischen Prompt, Modellvorschlag, Generierungsdauer, Kandidatenanzahl und Processing-Profil vorbereiten.
5. **Validiert speichern:** Bestehende Autorenentscheidungen bewahren und Änderungsvorschläge separat ablegen.

Nicht jede Verwendung lässt sich aus einem einfachen Texttreffer eindeutig bestimmen. Unsichere oder dynamische Zuordnungen werden als solche markiert. Ein Name wie `shot_flame` beweist insbesondere nicht, dass der aktuelle Aufrufer einen Loop verwendet. Code und Konfiguration haben Vorrang vor alten Kommentaren.

### 5.3 Inkrementelle Aktualisierung

Technische Fakten wie Zielpfad, Dateiverfügbarkeit und Fundstellen dürfen aktualisiert werden. Bestehende Prompts, manuelle Defaults, Favoriten und ausgeblendete Hinweise dürfen nicht still überschrieben werden.

Ändert sich die Verwendung eines Sounds wesentlich, entsteht ein Hinweis mit einem optionalen Prompt-/Profil-Vorschlag. Der bisherige Produktionsdatensatz bleibt erhalten. Nicht mehr vorhandene Keys werden als verwaist markiert, nicht mitsamt ihrer Historie gelöscht.

Tool 1 erzeugt keine Audiodateien, veröffentlicht keine Game-Assets und verändert keine Gameplay-Verwendungsstellen. Neue Soundereignisse werden weiterhin bei der Feature-Entwicklung eingebaut, nicht vom Catalog Builder erfunden.

## 6. Gemeinsamer Soundkatalog

### 6.1 Datenhoheit

| Datenbereich | Maßgebliche Quelle | Änderungsverhalten |
|---|---|---|
| Keys, Zielpfade, Lautstärkefaktoren, vorhandene Aufrufstellen | Spiel-Repository | Automatisch einlesen; im Studio nur anzeigen. |
| Prompts, Soundabsicht, Modell- und Processing-Defaults | Versionierter Produktionskatalog | Initial Astra; danach geschützt und ausdrücklich editierbar. |
| Kopie-Herkunft | Migrationsprotokoll bzw. nachvollziehbarer Dateiabgleich | Herkunft erhalten; Sichtbarkeit des Hinweises separat verwalten. |
| Datei fehlt / vorhanden / geladen werden kann | Lokaler Projektstand | Bei Bedarf neu berechnen; kein manuell gepflegter Wahrheitswert. |
| Runs, Seeds, Bearbeitungsrezepte, Favoriten, Übernahmehistorie | Lokaler Arbeitsbereich | Von Tool 2 verwalten und dauerhaft nachvollziehbar halten. |

Für V1 genügt eine schema-validierte JSON-Datei für den Produktionskatalog sowie JSON-Metadaten neben den Arbeitsdateien. Eine separate Datenbankinstallation ist nicht erforderlich. Beide Tools schreiben über dieselben Validierungs- und Speicherregeln.

### 6.2 Beispiel eines Produktionsdatensatzes

```json
{
  "schema_version": 1,
  "entries": {
    "shot_p90": {
      "name": "P90 – Schuss",
      "category": "weapon",
      "intent": "Sofortiger, trockener und klar erkennbarer Einzelschuss.",
      "playback": "oneshot",
      "prompt": {
        "text": "A single compact submachine gun shot, sharp immediate attack, crisp mechanical action, punchy controlled low end, dry isolated recording, no music or ambience.",
        "source": "astra",
        "preserve_on_sync": true
      },
      "generation_defaults": {
        "model": "medium",
        "duration_seconds": 1.2,
        "candidate_count": 8
      },
      "processing": {
        "profile": "weapon_shot",
        "overrides": {}
      },
      "copy_notice": null,
      "suggested_changes": []
    }
  }
}
```

Der Game-Zielpfad wird absichtlich nicht als unabhängig editierbare Produktionsentscheidung gespeichert. Ein abgeleiteter Snapshot ist für Anzeige und Nachvollziehbarkeit erlaubt; vor einer Übernahme muss der aktuelle Repository-Pfad erneut aufgelöst werden.

Dauer und Kandidatenanzahl sind Vorschläge. Generierungsdauer, nachbearbeitete Dauer und Dateidauer werden getrennt geführt. Acht Kandidaten sind kein GPU-Batch mit acht gleichzeitig zu berechnenden Samples.

### 6.3 Kopie-Hinweis

Ein Kopie-Hinweis enthält mindestens Herkunft, Hash zum Zeitpunkt der Kopie, Begründung und einen separat gespeicherten Ausblendungszustand. Im Studio erscheint beispielsweise:

> Dieser Sound wurde zunächst aus `sfx_nuke_explosion.ogg` kopiert. Er besitzt bereits einen eigenen Zielpfad und kann unabhängig ersetzt werden.

Die Aktion **„Hinweis ausblenden“** verändert nur diesen Hinweis. Sie verändert weder Audiodatei noch Prompt, Katalogpfad oder Freigabestatus. Eine neue Generierung oder Übernahme blendet den Hinweis nicht ungefragt aus.

Ein ausgeblendeter Hinweis darf beim nächsten Scan nicht wieder erscheinen, nur weil die Dateien weiterhin identisch sind. Historische Kopie-Herkunft und ein aktueller technischer Duplikatbefund sind unterschiedliche Informationen. Nach einer tatsächlich neuen Kopieroperation kann ein neuer, separat identifizierter Hinweis entstehen.

## 7. Tool 2 – Local Audio Studio

### 7.1 Lokale Anwendung

Vorgeschlagen ist ein Python-Backend mit FastAPI, das zugleich ein kleines Browser-Frontend ausliefert. Die Oberfläche benötigt keinen externen Hosting-Dienst. Eine einfache Oberfläche genügt; ein umfangreiches Frontend-Framework ist nicht zwingend.

Der Server bindet standardmäßig nur an `127.0.0.1`. Es gibt keine öffentliche Freigabe, keinen Cloud-Tunnel und keine im Spiel ausgelieferte Verwaltungsoberfläche. Schreibende Anfragen werden gegen fremde Browser-Ursprünge abgesichert. Modelle, Python-Umgebung und lokale Zugangsdaten gehören nicht in das Repository oder in den Game-Build.

Ein Startbefehl öffnet die Anwendung. Das Durchsehen und Bearbeiten vorhandener Sounds muss auch ohne geladenes Audiomodell funktionieren.

### 7.2 Soundliste und Detailansicht

Die Liste zeigt SFX mit Suche und Kategorien. Produktionsbedarf, Dateizustand und manuelle Hinweise sind getrennte Eigenschaften statt eines einzigen mehrdeutigen Status.

Wichtige Anzeigen sind **Datei fehlt**, **Datei vorhanden**, **nicht in Whitelist**, **Prompt fehlt**, **Kopie-Hinweis**, **zur Überarbeitung markiert** und **Konflikt mit dem aktuellen Repository**. „Vorhanden“ bedeutet nicht automatisch „qualitativ geprüft“.

Die Detailansicht enthält aktuellen Sound mit Player, Audio-Key, tatsächlichen Zielpfad, nachvollziehbare Verwendung, Soundabsicht, Prompt, Modellwahl, Dauer, Kandidatenanzahl und Processing-Profil. Bei mehreren Nutzern desselben Dateipfads werden diese gemeinsam angezeigt.

Ein deterministischer Aktualisieren-Schritt kann neue Game-Keys auch ohne Astra erkennen. Fehlt deren Prompt, zeigt das Studio dies offen an. Der Nutzer kann Tool 1 erneut über Codex ausführen oder selbst einen Prompt hinterlegen; das Studio ruft dafür kein LLM auf.

### 7.3 Normaler Arbeitsablauf

| Schritt | Nutzeraktion | Ergebnis |
|---|---|---|
| Bestand prüfen | Sound auswählen und vorhandene Datei anhören | Entscheidung, ob Neuproduktion oder Nachbearbeitung sinnvoll ist. |
| Generieren | Gespeicherten Prompt verwenden; Modell, Dauer und Anzahl einstellen | Mehrere unveränderte RAW-Kandidaten mit Metadaten. |
| Vorauswahl | Kandidaten anhören und favorisieren | Gute Ausgangsdateien für die Bearbeitung. |
| Game Ready | Ausgewählte Kandidaten durch das passende Profil verarbeiten | Neue bearbeitete Versionen; RAW bleibt unverändert. |
| Prüfen | Bestehenden Sound, RAW, bearbeitetes WAV und finales OGG vergleichen | Auswahl eines konkreten Exportkandidaten pro Zielpfad. |
| Übernehmen | Ziel, Ersetzung und gegebenenfalls Whitelist-Ergänzung bestätigen | Geprüfte Datei wird veröffentlicht und die Aktion protokolliert. |

Vorhandene Game-Sounds dürfen außerdem als Arbeitskopie in den Processor übernommen werden, ohne vorher neu zu generieren. Der Produktionspfad bleibt dabei derselbe; bis zur Freigabe verändert sich die Game-Datei nicht.

### 7.4 Vorschau und manuelle Korrektur

Die Vorschau zeigt Wellenform, Dauer, gewählte Schnittpunkte und Fades. Start, Ende und Fade-Längen sollen einfach korrigierbar sein, mindestens durch genaue Zeitfelder und eine Vorschau. Ein vollständiger Audioeditor ist nicht vorgesehen.

Bei One-Shots stehen direkte A/B-Vergleiche im Mittelpunkt. Für Loops werden mehrere aufeinanderfolgende Durchläufe und der Übergang zwischen Ende und Anfang geprüft. Der Loop-Player soll präzise gepufferte Wiedergabe verwenden; alternativ dient eine aus dem decodierten Export gerenderte Mehrfachwiederholung als Prüfdatei.

Die Qualitätsprüfung muss die **tatsächlich zu exportierende OGG-Datei** einschließen, nicht nur das WAV vor der Kompression. Änderungen am Processing erzeugen eine neue Version und verlangen eine neue Freigabe.

Optional kann die Vorschau den konfigurierten Sound-Lautstärkefaktor berücksichtigen. Das ist keine vollständige Simulation von Entfernung, Überlagerung und Lautstärke im Spiel. Diese Faktoren werden nicht in die Audiodatei eingebrannt; der abschließende Ingame-Test bleibt sinnvoll.

## 8. Lokale Generierung

### 8.1 Backend und Modelle

Die offizielle Stable-Audio-3-Implementierung stellt eine direkte Python-Schnittstelle bereit. Medium und Small-SFX werden als lokale Backends unterstützt; ComfyUI ist dafür keine notwendige Zwischenschicht. [M1]

Medium ist die vorgeschlagene globale Startvoreinstellung entsprechend der geäußerten Präferenz. Small-SFX bleibt als spezialisierte Alternative auswählbar. Tool 1 kann pro Sound einen begründeten Default hinterlegen; die Oberfläche zeigt den tatsächlich gewählten Modellnamen eindeutig. Ein größerer Modellname ist keine Qualitätsgarantie für einen konkreten Effekt. Die Auswahl entscheidet der Hörvergleich.

Das Modell liefert Rohmaterial. Die Pipeline setzt weder perfekte Schnittpunkte noch nahtlose Loops als garantierte Modelleigenschaft voraus. Dokumentiert sind Text-to-Audio sowie weitere Bearbeitungsfunktionen; für V1 genügt Text-to-Audio. [M1], [M2]

### 8.2 Modelllebenszyklus und Jobs

Ein langlebiger lokaler Inferenz-Worker lädt ein Modell bei Bedarf und verwendet es für weitere Generierungen. Für V1 wird nur ein Modell gleichzeitig gehalten und nur ein GPU-Generierungsjob gleichzeitig ausgeführt. Mehrere Kandidaten werden zunächst nacheinander erzeugt.

Die Oberfläche bleibt währenddessen bedienbar und zeigt Warteschlange, Modell-Ladevorgang, erledigte Kandidaten und Fehler. Ein Abbruch erfolgt spätestens zwischen Kandidaten; ein nicht sofort abbrechbarer Modellaufruf wird nicht als bereits beendet dargestellt.

Ein Modellwechsel entlädt das bisherige Modell. Zusätzlich gibt es eine Möglichkeit, GPU-Speicher freizugeben. Ein einzelner Anwendungsstart darf nicht versehentlich mehrere Webserver-Worker mit jeweils eigener Modellkopie erzeugen.

Fehler wie Speichermangel, fehlende Gewichte oder eine unpassende Laufzeitumgebung führen zu einer verständlichen Fehlermeldung, nicht zu einem stillen Wechsel auf einen kostenpflichtigen Dienst oder ein anderes Modell.

### 8.3 Hardware- und Installationstest

Die RTX 3080 mit 32 GB RAM ist die Zielhardware. Verfügbarer VRAM, Treiber und Betriebssystem werden beim Setup tatsächlich geprüft, statt eine konkrete 3080-Speichervariante vorauszusetzen.

Die offizielle Medium-Implementierung verlangt aktuell CUDA und Flash Attention 2. Die veröffentlichten VRAM-Messungen stammen von anderer Hardware und ersetzen keinen lokalen Funktionstest. Vor dem vollständigen UI-Ausbau müssen deshalb kurze SFX mit Medium und Small-SFX erfolgreich erzeugt, abgespielt und auf auffällige Artefakte geprüft werden. [M1]

Bei Windows wird eine nachweislich funktionierende Umgebung dokumentiert; falls erforderlich ist WSL2/Linux ein möglicher lokaler Ausführungsweg. Das ist eine Setup-Entscheidung, keine zusätzliche Bedienoberfläche. Python-, Modell- und Laufzeitversionen werden festgehalten.

Nach dem initialen Download und einer eventuell erforderlichen Lizenz-/Zugriffsfreigabe soll der normale Produktionsbetrieb mit lokal vorhandenen Gewichten auskommen.

### 8.4 Lizenz- und Kostengrenze

Stable Audio 3 wird unter der Stability AI Community License angeboten. Kostenlose kommerzielle Nutzung ist an deren Bedingungen geknüpft; dazu gehören insbesondere die Umsatzgrenze und die Registrierung für kommerzielle Nutzung. Relevant ist nicht lediglich der Umsatz dieses Spiels, sondern der im Vertrag definierte Lizenznehmer einschließlich verbundener Unternehmen. [M3], [M4]

Vor der ersten produktiven Nutzung werden die Lizenz des tatsächlich verwendeten Checkpoints und die eigene Berechtigung geprüft und dokumentiert. Das Konzept setzt diese Berechtigung voraus und verspricht keine bedingungslose Gebührenfreiheit. Die Modelle werden nicht mit dem Spiel verteilt.

## 9. AudioAssetProcessor

### 9.1 Gemeinsamer, nicht destruktiver Verarbeitungskern

Es gibt einen Processor mit verschiedenen Profilen, keinen getrennten Loop- und One-Shot-Codepfad mit doppelt implementierten Grundfunktionen. Python übernimmt Analyse und Bearbeitungsentscheidungen; FFmpeg kann für Decodierung und OGG/Vorbis-Encoding eingesetzt werden. Klangeingriffe werden nicht zusätzlich noch einmal in einer zweiten Pipeline angewendet.

`oneshot` und `loop` sind Wiedergabearten. `weapon_shot`, `impact`, `explosion` oder `continuous_texture` sind Processing-Profile. Ein Satz mehrerer Kandidaten ist eine Sammlung solcher Assets, kein dritter Wiedergabemodus.

Jede Bearbeitung erzeugt eine neue Version mit dem vollständigen Rezept. Originale werden nicht überschrieben. Technische Prüfungen können kaputte Dateien und auffällige Pegel erkennen, ersetzen aber keine klangliche Freigabe.

### 9.2 One-Shots: direkter Beginn ohne abgeschnittene Attacke

Der Processor soll das bisherige manuelle Vorgehen insbesondere für Waffensounds nachbilden:

```text
RAW
 ↓
Signal und Anfang analysieren
 ↓
Stille sowie irrelevanten leisen Vorlauf entfernen
 ↓
kleinen Sicherheitsbereich vor der Attacke erhalten
 ↓
extrem kurzen Fade-In setzen, ohne die Attacke abzuschwächen
 ↓
relevanten Nachklang bestimmen, überflüssiges Ende entfernen
 ↓
kurzen Fade-Out anwenden
 ↓
Pegel kontrollieren und gegebenenfalls anpassen
 ↓
WAV-Arbeitsfassung + OGG-Exportfassung validieren
```

Der Beginn wird nicht allein über digitale Stille oder den lautesten Samplewert bestimmt. Vorgesehen ist eine Kombination aus relativer Pegelschwelle, kurzem Energiefenster und erkennbarem Anstieg. Ziel ist der Beginn des relevanten Ereignisses, nicht ein beliebiges Rauschen davor und auch nicht erst das Maximum des Schusses.

Folgende Werte sind **abzustimmende Startwerte**, keine universellen Anforderungen an jedes Sample:

| Parameter für `weapon_shot` | Ausgangspunkt |
|---|---|
| Sicherheitsbereich vor erkannter Attacke | Ungefähr 2–5 ms, sofern vorhanden und sinnvoll. |
| Micro-Fade-In | Ungefähr 0,5–1 ms; nicht über die wesentliche Attacke legen. |
| Fade-Out | Ungefähr 8–15 ms, angepasst an den verbleibenden Nachklang. |
| Pegelbezug | Relative Signalanalyse; keine alleinige starre dBFS-Schwelle. |
| Peak-Begrenzung | Beispielsweise maximal −1 dBFS im Arbeitsmaster; Export erneut prüfen. |

Ein ruhiger Ladebeginn, ein beabsichtigtes Anschwellen oder ein mehrphasiger Effekt darf nicht nach dem aggressiven Waffenprofil weggeschnitten werden. Explosionen erhalten ein entsprechend großzügigeres Tail-Profil.

Pegelkontrolle bedeutet nicht, jede Datei auf denselben Peak hochzuziehen oder alle Effekte auf eine identische Lautheit zu zwingen. Eine Vorschau-Gainanpassung beziehungsweise gespeicherte Output-Gain-Korrektur ist zulässig; `SOUND_VOLUMES` bleibt unangetastet. Auffällig laute neue Dateien müssen im Zusammenhang mit den bisherigen Sounds geprüft werden.

### 9.3 Loops: Übergang statt separater Randfades

Für Loops wird ein geeigneter stabiler Bereich aus einer längeren Rohgeneration gewählt. Anfang und Ende werden anhand von Pegel und Signalcharakter angeglichen und bei Bedarf überblendet. Crossfade-Länge und Kurve müssen zur Signalstruktur passen; Equal-Power ist nicht pauschal für jede korrelierte Wellenform vorgeschrieben.

**Ein fertiger Loop erhält nicht automatisch den normalen One-Shot-Fade-In und -Fade-Out.** Sonst könnten bei jeder Wiederholung hörbare Lautstärkelöcher entstehen.

Das finale Asset ist in V1 als gesamte Datei loopbar. Es darf nicht auf zusätzliche Loop-Marker angewiesen sein, die das bestehende Spiel nicht auswertet. Die derzeitige Runtime startet Loops über `loop: true`. [R2]

Ein nahtloser Wiederholungsübergang garantiert noch keinen knackfreien Start oder abrupten Stopp während des Spiels. Erforderliche Laufzeit-Hüllkurven wären eine separate Runtime-Verbesserung, keine versteckte Exportfunktion.

### 9.4 Validierung

Der Processor prüft mindestens Decodierbarkeit, nicht leeren Inhalt, plausible Dauer, endliche Samplewerte, Kanal-/Sampleraten-Konsistenz, Pegel und mögliche harte Schnittstellen. Zu starke oder unsichere Eingriffe werden angezeigt.

Für Loop-Exporte wird die Naht auch nach dem OGG-Encoding und erneuten Decodieren beurteilt. Technische Metriken können Warnungen auslösen; die Bezeichnung „Game Ready“ bedeutet „nach Profil aufbereitet“, nicht „automatisch klanglich freigegeben“.

## 10. Sichere Übernahme ins Spiel

### 10.1 Erlaubte Änderungen

Im normalen Betrieb darf Tool 2 nur:

1. die ausdrücklich freigegebene OGG-Datei am aktuell katalogisierten SFX-Ziel schreiben;
2. den zugehörigen Dateinamen bei Bedarf in `SHIPPED_AUDIO_FILES` ergänzen;
3. seine eigenen Produktionsmetadaten, Backups und Protokolle verwalten.

Nicht erlaubt sind automatische Änderungen an Keys, Zielpfadzuordnungen, Lautstärkefaktoren, Gameplay-Code, Musikdefinitionen oder Build-/Deployment-Konfiguration. Git-Commit, Push und Deployment werden nicht automatisch ausgelöst.

### 10.2 Übernahmeablauf

Vor dem Schreiben löst das Backend den Zielpfad erneut aus dem lokalen Spielkatalog auf. Es prüft SFX-Zugehörigkeit, `.ogg`-Endung, gültigen freigegebenen Kandidaten und einen sicheren Pfad innerhalb von `public/assets/sounds/`. Pfadmanipulationen und Symlink-Ausbrüche werden verhindert.

Anschließend zeigt es eine Zusammenfassung: alter Sound, neuer Sound, betroffene Keys, tatsächlicher Dateipfad und erwartete Whitelist-Ergänzung. Wird eine bewusst gemeinsam verwendete Datei ersetzt, muss der Nutzer diese gemeinsame Auswirkung ausdrücklich sehen und bestätigen.

Die bisherige Datei wird gesichert. Die neue Datei wird zunächst temporär geschrieben und geprüft, dann am Ziel ersetzt. Erst danach wird gegebenenfalls die Whitelist ergänzt. Die Quellen im Arbeitsbereich bleiben erhalten; „Übernehmen“ ist technisch kein destruktives Verschieben des einzigen Originals.

Audiodatei und TypeScript-Whitelist sind zwei verschiedene Dateien und nicht automatisch eine einzige atomare Transaktion. Ein kleiner Transaktionsnachweis mit Backup-/Rollback-Strategie muss einen Abbruch oder Teilfehler erkennbar und reparierbar machen. Eine Erfolgsmeldung erfolgt erst nach Prüfung beider Änderungen.

### 10.3 Deterministische Whitelist-Pflege

Die Änderung ist auf das konkrete Set `SHIPPED_AUDIO_FILES` begrenzt, idempotent und ohne Duplikate. Es werden nur veröffentlichte Dateien ergänzt; der Export entfernt nicht nebenbei andere Einträge.

Die Umsetzung darf weder das gesamte `AudioCatalog.ts` neu generieren noch fremde Werte umformatieren oder pauschal Strings ersetzen. Ein strukturierter Parser beziehungsweise eine klar validierte lokale Änderungsroutine prüft vor und nach dem Eingriff, dass ausschließlich das erlaubte Set verändert wurde.

### 10.4 Schutz vor veralteten Daten

Zwischen Katalogscan, Vorschau und Export kann sich das Repository ändern. Für Ziel-Datei und relevante Katalogdaten werden daher Fingerprints gespeichert und unmittelbar vor der Übernahme verglichen. Bei abweichendem Zielpfad, veränderter Datei oder widersprüchlichem Katalog wird zunächst eine Aktualisierung beziehungsweise erneute Bestätigung verlangt.

Die beiden Tools koordinieren ihre eigenen Schreibvorgänge mit einer lokalen Sperre und atomarem Speichern einzelner Metadatendateien. Parallele Änderungen durch Editor oder Coding-KI dürfen nicht durch einen alten vollständigen Dateistand überschrieben werden.

Bereits laufende Spielinstanzen können die alte Audiodatei im Cache halten. Zur abschließenden Kontrolle wird das Spiel neu geladen beziehungsweise regulär neu gebaut. Das Studio verspricht keinen automatischen Austausch eines bereits geladenen Phaser-Audio-Buffers. [R2]

## 11. Speicherung und Nachvollziehbarkeit

Eine mögliche Struktur:

```text
repo/
├─ src/audio/AudioCatalog.ts          # bestehende Spieldefinition
├─ public/assets/sounds/             # nur finale Game-Assets
├─ tools/audio-studio/               # versionierter Tool-Code
│  ├─ catalog/sounds.json            # Prompts, Defaults, dauerhafte Hinweise
│  ├─ catalog/migrations/            # kleine Herkunfts-/Migrationsprotokolle
│  ├─ backend/
│  ├─ frontend/
│  ├─ processor/
│  └─ tests/
└─ .audio-workspace/                 # lokaler, von Git ausgeschlossener Arbeitsbereich
   ├─ runs/<audio-key>/<run-id>/
   │  ├─ generation.json
   │  ├─ raw/
   │  └─ processed/
   ├─ exports/
   └─ backups/
```

Der Arbeitsbereich ist konfigurierbar. Modellgewichte und Python-Umgebungen liegen getrennt von Game-Assets und werden nicht versioniert. Keine Arbeitsdatei darf versehentlich unter `public/` landen.

Pro Generierung werden mindestens Prompt-Snapshot, Modell-ID und -Revision, Seed pro Kandidat, tatsächlich verwendete Parameter, Zeit, Softwarestand und Rohdatei-Hash gespeichert. Pro Bearbeitung kommen Quelle, Profilversion, konkrete Schnitt-/Fade-/Gain-Einstellungen, Encoding-Parameter und Ausgabe-Hash hinzu. Pro Übernahme werden Ziel, vorheriger Zustand, Kandidat, Whitelist-Änderung und Ergebnis protokolliert.

Das erlaubt Nachvollziehbarkeit und gezieltes erneutes Bearbeiten. Es ist keine Zusicherung bitidentischer Neugenerierung über unterschiedliche Hardware-, Bibliotheks- oder Modellversionen hinweg.

Metadaten werden nicht automatisch bereinigt. Favoriten und die RAW-/Bearbeitungsquellen übernommener Sounds bleiben geschützt. Verworfene Audiodateien können über eine separate Bereinigungsfunktion nach angezeigter Auswahl gelöscht werden; eine Automatik ist in V1 standardmäßig aus. Gelöschte Dateien bleiben in der Historie als bereinigt erkennbar.

## 12. Umsetzung ohne unnötige Doppelstrukturen

Die Python-Anwendung bündelt UI-Backend, Jobsteuerung, Modelladapter und Processor. Für den TypeScript-Katalog kann ein kleiner deterministischer Node-/TypeScript-Adapter eine JSON-Sicht erzeugen und die begrenzte Whitelist-Änderung durchführen. Das nutzt den vorhandenen Projektkontext, statt dieselbe TypeScript-Struktur in mehreren Python-Regulärausdrücken nachzubauen.

Dieser Adapter wird von beiden Tools verwendet. Er ist eine gemeinsame Hilfsfunktion und kein drittes manuell zu bedienendes Produkt. Die Projektdateien bleiben maßgeblich; exportierte Inventardaten sind nur abgeleitete Arbeitsdaten.

Für V1 werden weder ComfyUI-Workflows noch ein zusätzlicher Inferenzdienst, Redis, eine externe Jobplattform oder ein eigener Datenbankserver benötigt. Ein Hintergrund-Worker innerhalb der lokal gestarteten Anwendung ist eine Implementierungsoption; es soll keinen weiteren manuell zu startenden Dienst geben.

## 13. Vorgeschlagene Umsetzungsreihenfolge

| Phase | Ergebnis |
|---|---|
| **P0 – Machbarkeit und Projektvorbereitung** | Modell-/Lizenz-/Hardwareprüfung, kurze lokale Testgenerierungen; anschließend geprüfte Fallback-Kopien, SFX-OGG-Zielpfade und passende Tests. |
| **P1 – Gemeinsamer Katalog und Tool 1** | Verlässlicher Repository-Adapter, Datenformat, inkrementeller Abgleich, Astra-Arbeitsablauf und dauerhafte Kopie-Hinweise. |
| **P2 – Studio und Generierung** | Lokale Oberfläche mit bestehender Audiovorschau, gespeicherten Prompts, Modellwahl, Jobstatus und RAW-Kandidaten. |
| **P3 – Processing und Prüfung** | One-Shot-/Loop-Profile, manuelle Schnittkorrektur, Vergleich und Vorschau der finalen OGG-Datei. |
| **P4 – Übernahme und Absicherung** | Kontrollierter Datei-/Whitelist-Export, Backups, Konfliktprüfung, Bereinigung und vollständiger End-to-End-Test. |

P0 ist bewusst vor dem aufwendigeren UI-Ausbau angeordnet: Zuerst muss die lokale Generierung auf der tatsächlichen Maschine überzeugend funktionieren. Die Tool-Architektur bleibt auch dann verwendbar, wenn ein Modell später ausgetauscht wird.

## 14. Abnahmekriterien

Diese Kriterien sind bei der Implementierung zu erfüllen; sie wurden durch die Erstellung dieses Konzepts noch nicht ausgeführt.

| Bereich | Nachweis |
|---|---|
| Quelle der Wahrheit | Neue katalogisierte SFX werden erkannt; Musik bleibt ausgeschlossen. Keine zweite manuelle Bedarfsliste. |
| Prompt-Schutz | Ein erneuter Tool-1-Lauf erhält bestehende und manuell geänderte Prompts; Vorschläge sind getrennt. |
| Fallback-Migration | Neue eigene Dateien sind zunächst byteidentisch zur bisherigen Quelle. Key, Lautstärkefaktor und Verwendung bleiben gleich. |
| Kopie-Hinweise | Kopien werden gekennzeichnet. Ein manuell ausgeblendeter Hinweis bleibt auch nach erneutem Scan ausgeblendet. |
| Fehlende Sounds | Geplante ungeshippte Sounds ohne Datei sind erkennbar und zulässig. Ungültige Keys und fehlende freigeschaltete Dateien bleiben Fehler. |
| Unabhängigkeit | Nach vorbereiteten Prompts und lokalem Setup funktioniert der normale Studio-Ablauf ohne Astra oder Cloud-Generierung. |
| Modellbetrieb | Medium und Small-SFX werden auf der Zielhardware getestet; keine unbeabsichtigte Mehrfachbelegung der GPU. |
| One-Shots | Referenzfälle mit Stille, Rauschvorlauf und sehr früher Attacke werden verarbeitet, ohne den relevanten Beginn unnötig zu verzögern oder abzuschneiden. |
| Loops | Übergänge werden über mehrere Wiederholungen geprüft, einschließlich der decodierten OGG-Exportfassung. |
| Nicht destruktiv | RAW und vorhandene Game-Datei bleiben bis zur Übernahme unverändert; Verarbeitung ist wiederholbar. |
| Human Review | Favorisieren, Bearbeiten und Übernehmen sind getrennte Aktionen. Nur ein ausdrücklich gewählter Exportkandidat pro Ziel. |
| Exportbegrenzung | Ein normaler Export verändert ausschließlich vorgesehene SFX-Dateien und gegebenenfalls das Whitelist-Set. |
| Wiederholung und Fehler | Wiederholter Export erzeugt keine Whitelist-Duplikate. Fehler, Prozessabbrüche und veraltete Projektstände werden sicher behandelt. |
| Speicherung | Modelle, Rohgenerationen und Backups gelangen nicht in den Game-Build; Bereinigung schützt Favoriten und übernommene Quellen. |
| Spielintegration | Nach Neuladen/Build wird der freigegebene Sound am richtigen Ereignis abgespielt. |

## 15. Bewusst nicht Bestandteil von V1

Nicht vorgesehen sind Musikproduktion, Sprachsynthese, automatisches Erfinden oder Verdrahten neuer Soundereignisse, ein Ingame-Varianten-System, automatische KI-Qualitätsfreigabe, autonome Game-Code-Änderungen, Cloud-Provider-Fallbacks oder die Integration von ComfyUI in den Produktionsweg.

Auch komplexes Layer-Compositing, Training/Fine-Tuning, modellgestütztes Reparieren von Loop-Nähten und ein vollständiger Mehrspur-Audioeditor bleiben mögliche spätere Erweiterungen. Für den ersten produktiven Ablauf sind sie nicht erforderlich.

**Zielzustand:** Astra erstellt und pflegt den Produktionskatalog über Tool 1. Der Nutzer produziert und prüft SFX in Tool 2. Erst eine ausdrückliche Übernahme ersetzt die bereits vorgesehene Game-Datei und ergänzt bei Bedarf deterministisch die vorhandene Whitelist.

---

## Quellen und Prüfgrundlage

Die Repository-Quellen beziehen sich auf den oben genannten Commit. Externe Modelldokumentation und Lizenzinformationen wurden am 14. September 2026 überprüft. Bei der Implementierung werden der tatsächliche lokale Arbeitsstand und die installierten Modellrevisionen erneut abgeglichen.

### Repository

[R1]: https://github.com/Dominik-Steinweg/Fragdachse/blob/44d9bad51e075fa301e0a4cfada680af298b0a05/src/audio/AudioCatalog.ts
[R2]: https://github.com/Dominik-Steinweg/Fragdachse/blob/44d9bad51e075fa301e0a4cfada680af298b0a05/src/audio/GameAudioSystem.ts
[R3]: https://github.com/Dominik-Steinweg/Fragdachse/blob/44d9bad51e075fa301e0a4cfada680af298b0a05/tests/GameContentValidation.test.ts
[R4]: https://github.com/Dominik-Steinweg/Fragdachse/blob/44d9bad51e075fa301e0a4cfada680af298b0a05/src/loadout/content/GameContentValidation.ts
[R5]: https://github.com/Dominik-Steinweg/Fragdachse/blob/44d9bad51e075fa301e0a4cfada680af298b0a05/scripts/convert-audio.mjs

- [R1] — Zentraler Katalog, SFX-/Musiktrennung, Asset-Zuordnungen, Lautstärkefaktoren und Whitelist-basierter Loader.
- [R2] — One-Shot-/Loop-Wiedergabe, Cache-Prüfung und Verwendung der Sound-Lautstärkefaktoren.
- [R3] — Bestehende Dateiverfügbarkeitsprüfungen für Shot-Sounds und Armageddon.
- [R4] — Prüfung der konfigurierten Audio-Key-Referenzen gegen den Spielkatalog.
- [R5] — Bestehende OGG/Vorbis-Konvertierung mit darüber hinausgehenden Datei-/Katalogänderungen.

### Modell und Lizenz

[M1]: https://github.com/Stability-AI/stable-audio-3
[M2]: https://github.com/Stability-AI/stable-audio-3/blob/main/docs/guides/model-overview.md
[M3]: https://stability.ai/license
[M4]: https://stability.ai/community-license-agreement

- [M1] — Offizielle Stable-Audio-3-Implementierung: Modelle, Python-API, Installation und Hardwareanforderungen.
- [M2] — Offizielle Modellübersicht und dokumentierte Ein-/Ausgabe- sowie Bearbeitungsfunktionen.
- [M3] — Einordnung von Stable Audio 3 in die Stability-Lizenzangebote.
- [M4] — Volltext der Community License; insbesondere Bedingungen kommerzieller Nutzung und Registrierung.
