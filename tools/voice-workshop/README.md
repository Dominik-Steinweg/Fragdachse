# Fragdachse Voice-Werkstatt

Eigenständige lokale Produktion persönlicher Spielerstimmen. Enthält Aufnahme/Import,
Referenzschnitt, drei Stimmtests, den editierbaren Startkatalog mit 24 Sätzen, serielle
VoxCPM2-Produktion mit festem Action-Announcer-Sound, Hörprüfung und unveränderliche `.fdvoice`-Pakete/LAN-Bundles.
Das Spiel benötigt weder ComfyUI noch die Werkstatt. Automatischer Lobby-Transfer
und Aufnahmen auf fremden Client-Rechnern sind spätere Ausbaustufen des Fachkonzepts.

## Start unter Windows

Node.js 24 und die installierten Projektabhängigkeiten verwenden. FFmpeg mit
`libvorbis`, `rubberband`, `afir` sowie den EQ-, Dynamik- und Lautheitsfiltern muss über PATH oder `VOICE_FFMPEG` verfügbar sein. ComfyUI separat
starten, VoxCPM2 samt `rh_voxcpm` lokal installieren und die tatsächlichen
gemeinsamen Ein-/Ausgabeordner konfigurieren. Beispiel für diese Installation:

```powershell
$env:VOICE_COMFY_URL = 'http://127.0.0.1:8188'
$env:VOICE_COMFY_INPUT = 'D:/Comfy-Desktop/ComfyUI-Shared/input'
$env:VOICE_COMFY_OUTPUT = 'D:/Comfy-Desktop/ComfyUI-Shared/output'
$env:VOICE_FFMPEG = 'C:/Pfad/zu/ffmpeg.exe'
npm run voice:workshop
```

Danach `http://127.0.0.1:8092/` öffnen. Der Befehl öffnet keinen Browser und startet
keinen Generator. Ohne laufendes ComfyUI bleiben Verwaltung, Hörprüfung und Export
nutzbar. `VOICE_PORT` ändert den Port, `VOICE_WORKSPACE` den privaten Datenordner.
Standard: `tools/voice-workshop/.voice-workspace` (Git-ignoriert). Keine privaten
Dateien in `public`, `dist` oder Git ablegen. Die Werkstatt bindet nur Loopback,
prüft Host/Origin und verlangt ein Sitzungstoken für API und Medien.

Alternativ lassen sich die Einstellungen einmalig in
`.voice-workspace/local-config.json` hinterlegen. Umgebungsvariablen haben Vorrang:

```json
{
  "comfyUrl": "http://127.0.0.1:8188",
  "comfyInput": "D:/Comfy-Desktop/ComfyUI-Shared/input",
  "comfyOutput": "D:/Comfy-Desktop/ComfyUI-Shared/output",
  "ffmpeg": "C:/Pfad/zu/ffmpeg.exe"
}
```

Nach einer Konfigurationsänderung den Werkstatt-Dienst neu starten. Die Datei bleibt
im privaten, ignorierten Arbeitsbereich und wird nicht als Paket exportiert.

## Ablauf und Action-Announcer

Die Oberfläche bietet einen direkten LAN-Ablauf: **Referenz → Produktion → ins Spiel übernehmen**.
„Stimmprofile“ enthält Aufnahme und Upload; „Texte & Voice-Lines“ zeigt Texte und
Audioplayer gemeinsam, nach Spielanlass gruppiert. Technische Werkstattaktionen
liegen unter „Werkstatt verwalten“; Darbietung, Audioschnitt, Stimmproben und frühere
Pakete sind aufklappbar.

1. Anzeigenamen und einmal die gemeinsame Zustimmung für Generierung und Nutzung
   in der LAN-Runde speichern. Öffentliche Weitergabe ist eine getrennte optionale
   Profileinstellung; bestehende Zustimmungen werden nicht automatisch erweitert.
2. Standardmäßig den **festen Vorlesetext vollständig und wortgetreu** aufnehmen oder
   eine Aufnahme desselben Texts importieren. Klar, selbstbewusst und mit Energie sprechen;
   vorhandene Referenzen bleiben nutzbar. Der Text wird automatisch als Transkript
   gespeichert. Alternativ **Eigene Datei + Text** wählen, eine Referenzdatei hochladen
   und den exakten gesprochenen Text des Ausschnitts eingeben. Beide Quellen behalten
   beim Umschalten ihre eigenen ungespeicherten Audioentwürfe.
   Start und Ende in der Wellenform ziehen, optional anhören und mit **Referenz
   speichern & weiter** direkt zur Produktion wechseln. Nur Pausen entfernen.
3. Unter **Texte je Stimmprofil** eine Stimme wählen und die Texte bei Bedarf direkt
   anpassen. **Standardkatalog** bearbeitet die Vorlage für alle unveränderten
   Profiltexte. **Standard wiederherstellen** entfernt die Anpassung eines Satzes.
   **Alle Voice-Lines erzeugen** startet den Profilkatalog ohne verpflichtende Stimmtests
   oder Hörfreigaben. Fertige aktuelle Sprüche werden automatisch fürs Paket
   ausgewählt. Ein erneuter Start erzeugt keine doppelten fertigen/wartenden Takes;
   bewusst weggelassene Sprüche bleiben weggelassen. Fehlgeschlagene Aufträge können
   erneut gestartet werden, fertige Ergebnisse bleiben erhalten.
4. **Ins Spiel übernehmen** erstellt die Paketversion und schreibt sie direkt nach
   `src/voice/bundled/<voiceId>.fdvoice`. Der lokale Dienst schreibt ausschließlich
   das validierte Laufzeitpaket, keine Referenzen oder Produktionsdaten. Eine neue
   Version ersetzt die bisherige Build-Quelle derselben Stimme; private Paketversionen
   bleiben erhalten. Bereits fertige Sprüche können als Teilpaket übernommen werden.
5. **npm run build** ausführen und den neuen Spielstand öffnen. Vite nimmt die
   Stimmen automatisch als eigene Datenmodule mit. Unter **PROFIL / STIMME** sind
   sie für alle Spieler auswählbar, ohne Dateiimport oder Werkstatt-Dienst. Laufende
   Runden behalten ihre Zuordnung bis zum Rundenwechsel. Bei einer neuen Paketversion
   die gewünschte Stimme erneut auswählen; Prüfsummen werden nicht still ersetzt.

Anhören ist optional und blockiert die Übernahme nicht. Direkt neben jedem Text
stehen der Audioplayer, der Paketstatus und die Einzelgenerierung. Darunter lassen
sich Sprüche aus dem Paket nehmen oder schneiden. Veraltete Aufnahmen bleiben mit
ihrem ursprünglichen Text anhörbar, kommen aber nicht ins neue Paket. Textentwürfe
bleiben beim Profilwechsel und bei Statusaktualisierungen erhalten; **Speichern &
erzeugen** speichert vor der Einzelgenerierung, die Sammelgenerierung speichert alle
offenen Texte des gewählten Profils. Die Auswahl ist keine behauptete Hörprüfung: Der LAN-Export setzt keine
Hörentscheidungen auf „angenommen“. Die strengere bestehende Review-API bleibt für
explizite Hörentscheidungen verfügbar. Stimmproben sind separat und kommen nie ins
Spielpaket; überholte und fehlgeschlagene Takes werden ebenfalls nicht exportiert.

Der Datei-/LAN-Bundle-Export bleibt unter den gespeicherten Paketen optional
verfügbar. Mitgelieferte Stimmen benötigen keine IndexedDB und können im Spiel
nicht als lokaler Import gelöscht werden. Die Dateien unter `src/voice/bundled/`
sind Spielinhalt und werden mit dem Build ausgeliefert.

Alle neuen Sprüche und Stimmproben nutzen **Controllable Cloning** mit einer festen
Announcer-Grundregie und passenden Nuancen je Spielanlass. **Zusätzliche Regiehinweise**
ergänzen optional die Betonung pro Satz; der kraftvolle, klare Grundstil bleibt verbindlich.
Der Zieltext wird unverändert und getrennt von der Regie übergeben. Die Oberfläche
bietet genau einen Sound, ohne Presetauswahl, Effektstärke oder alternative Cloning-Modi.
Eine Regievorgabe garantiert keine Modellqualität: Original und Exportfassung anhören.

Beim ersten Öffnen einer älteren Werkstatt bleiben Texte, Referenzen, Profilanpassungen,
Roh-Takes und gespeicherte Pakete erhalten. Alte Emotionsfelder werden privat als
`legacyDirection` aufbewahrt, nicht als neue Regie verwendet. Zusatzhinweise starten
leer. Frühere Produktionsversionen sind überholt: **Alle Voice-Lines erzeugen** produziert
alle aktiven Sprüche mit der neuen Regie neu, einschließlich früher weggelassener Takes.
Weitere Sammelstarts ergänzen nur fehlende Ergebnisse; neue bewusste Ausschlüsse bleiben
erhalten. Der Dienst startet keine Produktion von selbst.

Text- und Regiehinweisänderungen erhöhen die Satzrevision im jeweiligen Katalog.
Profilanpassungen bleiben von Änderungen am Standard unabhängig; geerbte Sätze
übernehmen diese Änderungen. Zurücksetzen auf den Standard entwertet ältere
Profil-Takes ebenfalls. Neue oder erneut geschnittene Referenzen erhöhen die
Referenzrevision. Betroffene Entwürfe gelangen nicht in neue Freigaben.
Jeder Auftrag friert Produktions-/Effektversion, vollständige Regie, Eingaben und Seed ein.
Alte Takes behalten ihren ursprünglichen Nachweis und lassen sich durch Nachschneiden
nicht wieder freigeben. Bereits veröffentlichte Pakete bleiben unverändert.

Der feste Text liegt versioniert in `reference-text.json`; Oberfläche und Backend
verwenden dieselbe Quelle. Ein alter Browserstand kann keinen abweichenden Text
unbemerkt hinterlegen. Vorhandene ältere Referenzen behalten ihre bisherigen
Transkripte und lassen sich als eigene Datei mit Text erneut bearbeiten. Eigene
Referenztexte bleiben zusammen mit der Audiodatei privat gespeichert. Neue
Controllable-Aufträge übertragen kein Referenztranskript an den Generator.
Die Wellenform prüft keine gesprochenen Wörter automatisch: bei Versprechern neu
aufnehmen und beim Schneiden den ganzen Text erhalten.

## Generator und Ressourcen

Der Adapter prüft die tatsächlichen ComfyUI-Node-Eingaben vor jedem Auftrag:
`RunningHub_VoxCPM_LoadModel`, `LoadAudio`, `RunningHub_VoxCPM_Generate`, `SaveAudio`.
Die verwendete Erweiterung muss Controllable Cloning mit separater Regie unterstützen;
siehe [VoxCPM2-Dokumentation](https://github.com/OpenBMB/VoxCPM#-controllable-voice-cloning). Die Werkstatt importiert
keine Module des Audio-Studios, lädt keine Modelle herunter und unterbricht keine
fremden GPU-Aufträge. Eine belegte Queue hält die Produktion an.

Pausieren lässt den eigenen laufenden Auftrag enden. Abbrechen verwirft sein
Ergebnis und stoppt wartende eigene Aufträge; es sendet keinen globalen Interrupt.
Nach einem Neustart werden offene Aufträge als unterbrochen markiert. Vor einem
erneuten Start den ComfyUI-Auftrag prüfen. Referenzkopien und ComfyUI-Ausgaben liegen
in eigenen UUID-Unterordnern. Nach Abschluss wird gezielt bereinigt; bei unklarem
Status bleibt der Bereinigungsnachweis erhalten. **Private ComfyUI-Kopien bereinigen**
versucht die Bereinigung erneut, sobald kein eigener Auftrag mehr läuft.

Referenzlöschung entfernt gespeicherte Referenzversionen und bereinigt vorgemerkte
ComfyUI-Kopien. Private Produktionsnachweise einschließlich Transkripten und eigene
Roh-Takes bleiben im Arbeitsordner; Referenzlöschung ist keine vollständige Löschung
aller Produktionsdaten. Bereits weitergegebene Pakete lassen sich nicht zurückrufen.

Das feste versionierte Rezept liegt in [announcer.json](announcer.json). FFmpeg
schneidet zunächst die Rohfassung und entfernt Randstille. Danach folgen EQ,
De-Esser und Kompression mit erhaltenem Stimmeinsatz. Die unverstimmte Hauptstimme
trägt den Klang. Eine vor und nach der Sättigung gefilterte Parallelspur verdichtet
die Mitten; eine präsente, unverzerrte Tiefoktave verstärkt Bass und untere Mitten.
Der kurze Faltungshall verwendet eine reproduzierbare Raumimpulsantwort aus einem
gedämpften, diffus gemischten Delaynetz. Er erhält nur die unverstimmte Stimme und
wird während der Wörter automatisch abgesenkt; in den Pausen kommt der Raum zurück.
Lautheitsabgleich und Limiter schließen die Kette ab. Das bleibt ein einziges festes
Rezept ohne Effektregler. Änderungen der Effektversion entwerten ältere Takes für
neue Pakete; bestehende Pakete und Originalaufnahmen bleiben erhalten.
Exportiert wird Mono-OGG/Vorbis mit 48 kHz ohne Quellmetadaten. Die tatsächliche Dauer
und der Spitzenpegel werden nach dem Encodieren überprüft; Vorschau und Paket
verwenden dieselbe Datei. Maximal 5,4 Sekunden geschnittene Sprache lassen Platz
für den Hall innerhalb der sechssekündigen Paketgrenze. Zu lange Takes kürzen oder
neu erzeugen; der Workshop schneidet keine Wörter für den Hall ab.

Referenzen werden ohne Announcer-Effekte gespeichert. Jeder erneute Schnitt arbeitet
wieder aus dem Roh-Take. Fehler beim Bearbeiten lassen die vorherige Exportfassung
und Auswahl bestehen. Fehlende FFmpeg-Filter werden vor einer neuen Produktion
mit einer konkreten Fehlermeldung angezeigt. Freigaben enthalten ausschließlich das streng
validierte Manifest und Audiodateien mit SHA-256-Prüfsummen. Referenzen, Transkripte,
Workflows und Zustimmungen werden nie exportiert. Paketgrenzen stehen im gemeinsamen
[Validator](../../src/voice/VoicePackage.ts).

## Stimmen endgültig löschen

Unter **Stimmprofile → Stimme löschen** den angezeigten Namen bestätigen und
**Stimme endgültig löschen** wählen. Die Produktion vorher pausieren und einen
laufenden Take beenden lassen. Die Löschung entfernt das Profil, seine Texte und
Produktionsnachweise, alle gespeicherten Referenzversionen, Roh-Takes, Exporte,
ältere Schnitte und Hörproben. Sie bereinigt auch `state.*.json`-/`state.*.bak`-
Datensicherungen im privaten Arbeitsordner sowie lokale Paketdateien. Andere
Stimmen in einem gemeinsamen Paket oder einer Sicherung bleiben erhalten.

Die zugehörigen ComfyUI-Auftragsordner und History-Einträge werden gezielt entfernt;
dafür muss ComfyUI erreichbar sein. Es gibt keinen globalen Interrupt oder eine
Löschung fremder Aufträge. Ein unvollständiger Löschvorgang bleibt am Profil sichtbar,
sperrt weitere Produktion/Exporte und lässt sich nach Fehlerbehebung über
**Löschung fortsetzen** wiederaufnehmen, auch nach einem Dienstneustart.

Die Spielquelle unter `src/voice/bundled/` und die eigenen Vite-Stimmmodule samt
Source-Maps in `dist/` und `build/` werden entfernt. Ein kleines Löschregister
`public/voice-deletions.json` enthält nur Stimm-IDs und Paketprüfsummen, keine Namen,
Texte oder Audiodaten. Es wird auch in vorhandene lokale Builds mit HTML-Einstieg
geschrieben. **Das Spiel anschließend neu laden:** Das Register sperrt auch gecachte
Spielpakete, löscht passende importierte IndexedDB-Pakete und setzt die betreffende
Profilauswahl zurück. Ein gelöschtes Paket kann nicht wieder importiert werden.
Ein beim Laden bekanntes Löschregister bleibt auch bei späterem Netzausfall gültig.

Das ist keine rechnerweite oder forensische Löschung: ursprüngliche Upload-Dateien
außerhalb der Werkstatt, frei gespeicherte Downloads, Browser-HTTP-Caches,
Git-Historie, externe Sicherungen und fremde Rechner sind nicht durch die Werkstatt
kontrollierbar. Solche Kopien gegebenenfalls dort separat entfernen. Bereits laufende
Spiele oder extern veröffentlichte alte Builds müssen neu geladen beziehungsweise
aktualisiert werden; ein entfernter Rechner wird nicht automatisch angesprochen.

## Spielintegration und Prüfung

Der Host entscheidet Sprecher, Kategorie und konkreten Clip für Ready, PvP-Kill,
stabilen Führungswechsel, bestätigte Ultimate-Aktivierung, relativen Schadens-Burst
und Sieg. Clients empfangen nur kurze Ereignisse; Audiodaten kommen aus dem Build
oder einem optionalen Dateiimport. Sprachlautstärke/Mute sind unabhängig vom Effektkanal und unterliegen
der Masterlautstärke. Auswahlwechsel werden an Lobby-/Rundengrenzen aktiv.

```powershell
npm run build:voice-workshop
npm run test:voice-workshop
npm test -- tests/VoiceDirector.test.ts tests/VoiceAudioChannel.test.ts
npm run test:integration
npm run test:architecture
npm run check
```

Die Werkstatt-Tests benötigen FFmpeg; sie nutzen synthetische Audiodaten und einen
Generatorersatz. Sie prüfen Announcer-Regie und Migration, Revisionen, Hörfreigabe, Oktave und
Hallausklang, sichere Pegel, echten Vorbis-Export, Paketvalidierung sowie den lokalen
HTTP-Zugang. Tuningwerte werden nicht als Testsnapshots festgeschrieben. Vor Produktiveinsatz
noch mit autorisierter Referenz real generieren und hören, Mikrofon/Browserablauf
prüfen sowie CPU/RAM und Sprechverhalten in einer Mehrspielerpartie messen.
