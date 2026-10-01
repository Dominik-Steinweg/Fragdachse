# Performance-Lab

## Kleiner Netzwerk-Test: P90 und TimeBubble

`npm run perf:network` öffnet den Host im Performance-Lab-Modus. Im kleinen Testpanel
„Client in zweitem Fenster öffnen“ wählen, dort „Client bereit“ anklicken und danach
beim Host „Messung starten“. Beide Fenster sichtbar halten, vor dem Start auf dieselbe
Auflösung bringen und während der Messung nicht bedienen. Chrome und ein erreichbarer
PeerJS-Signalisierungsserver werden benötigt. Der normale Produktionsbuild hat diesen
Testmodus nicht.

Genau ein Host und ein echter WebRTC-Client nehmen teil. Nur der Host
erzeugt die Last; die Anzahl der Schützen ändert sich zwischen Vergleichsläufen nicht.
Die vorhandene Referenzkarte, legalen P90-/TimeBubble-Upgrades, Zielsteuerung und der
Frame-Profiler werden mitgenutzt. Es gibt keine zusätzliche Gegnerwelle.

| Phase | Dauer | Last |
|---|---:|---|
| Warmup | 5 s | Welt und Darstellung einlaufen lassen |
| idle | 10 s | Verbindung und reguläre Zustandsübertragung |
| p90 | 20 s | P90 mit ihrem produktiven Cooldown |
| p90-bubble | 30 s | Dieselbe P90 plus TimeBubbles, sobald diese wieder verfügbar sind |
| recovery | 10 s | Keine neuen Schüsse oder Utility-Aktionen |

Der bestehende autoritative Arenastart und die synchronisierte Spieluhr bestimmen die
Phasen auf beiden Rechnern. Zu spät geladene Teilnehmer, versteckte/veränderte Fenster
und Verbindungswechsel brechen den Lauf ab. Nach 75 Sekunden auf **beiden** Seiten die
Ergebnisdatei herunterladen und zusammen auswerten:

```sh
npm run perf:network:report -- <host.json> <client.json>
```

Der Bericht zeigt Frame-, Spielschritt- und Renderzeiten, den Aufwand des Host-Publikationspfads,
Versandrate, native Sendepuffer, RTC-/Anwendungs-Ping, Client-Update-Lücken und tatsächlich
erreichte Last. Fehlende Daten, Treffer, TimeBubbles/Prismengeschosse oder zu wenige Schüsse
machen die Belastungsmessung ungültig. Ein erfolgreicher Lauf bedeutet nur vollständige
Messdaten; es gibt kein pauschales „lagfrei“-Urteil.

Für den ersten gezielten Vergleich beide Fenster schließen und den Host mit
`http://127.0.0.1:8090/?network-probe=low` neu öffnen. Der Client-Link übernimmt `low`.
Auflösung und Hardware gleich halten, jeden Grafikstand dreimal prüfen und Schusszahl sowie
Projektillast vergleichen. Sinkende Verzögerungen bei gleicher Last sprechen für einen Anteil
der lokalen Darstellung/Verarbeitung. Ändert sich die Last, ist das kein sauberer Grafikvergleich.
Weitere Werkzeuge oder Transportänderungen erst hinzufügen, wenn diese Messung einen konkreten
Verdacht liefert.

RTC/App im Bericht sind die bestehenden gleitenden Mediane am Phasenende. Sie sind keine
phasengenauen Perzentile oder exakte Eingabebestätigungszeiten. Transportwerte und
Projektillast werden einmal pro Sekunde abgetastet; kurze Pufferspitzen können fehlen.
Update-Lücken zeigen neu beobachtete Zustände und sind keine Einweg-Latenz. Für weitere
CPU-/GPU-Analyse enthält jede Datei den vorhandenen vollständigen Frame-Profiler-Export.
Das Skript archiviert keine Builds und erstellt keine neue Ergebnishistorie; den zugehörigen
Code-Stand bei Vergleichen selbst festhalten.

Zwei Instanzen auf einem Rechner teilen weiterhin CPU und GPU. Für einen zweiten Rechner
den Dev-Server bei Bedarf mit `npm run dev:browser -- --mode performance-lab --host 0.0.0.0`
im LAN starten und die Host-Adresse im Client-Link verwenden. Auf beiden Geräten denselben
Server und Testmodus verwenden. Reale Internet-/WLAN-Bedingungen sind damit noch nicht abgedeckt.

### Erste Messung des kleinen Tests (28.09.2026)

Je drei vollständige High-/Low-Läufe mit zwei Chrome-Instanzen ohne sichtbare Fenster auf
demselben Rechner, 1280 × 720 bei DPR 1, im Dev-Build. Alle sechs Messpaare erfüllen die
Last- und Vollständigkeitsprüfung. JSON-Exporte und Berichte liegen lokal unter
[`build/network-probe-validation/`](../build/network-probe-validation/); dieser Ordner wird
nicht versioniert. Es handelt sich um neue Messungen des kleinen Tests.

| Beobachtung über sechs Läufe | P90 | P90 + TimeBubble |
|---|---:|---:|
| Host-Versand | 63–68 KiB/s | 284–316 KiB/s |
| Host-Publikationspfad pro Snapshot, Mittelwert | 0,45–0,54 ms | 2,20–2,39 ms |

Mit TimeBubble steigt der Versand wiederholt auf etwa das Vier- bis Fünffache. Niedrige
Grafik verbessert häufig die Framezeiten, aber die Bereiche überlappen: Host-Frame-p95
High 18,3–24,3 ms, Low 18,2–24,2 ms; Client High 12,2–18,4 ms, Low 12,2–18,1 ms.
Die Bubble-Phase erreicht 126–130 Schüsse bei High und 130–131 bei Low sowie Spitzen
von 70–72 Projektilen. Damit ist die Last ähnlich, aber nicht exakt gleich.
Ein High-Lauf enthält außerdem eine lokale Client-Pause von rund 1,4 Sekunden am Übergang
zur Erholung; dieser Ausreißer bleibt in den Daten. Die übrigen Bubble-Phasen zeigen
maximale Client-Update-Lücken von rund 98–122 ms.

Der nächste gezielte Schritt ist derselbe Test auf zwei Rechnern, anschließend bei
reproduzierbarem Befund die Prüfung des bestehenden Projektil-Publikationspfads.
Der Anstieg belegt zusätzlichen Aufwand, aber weder dessen alleinige Verantwortung für
Lags noch eine behobene Verbindungsstörung. Die gemeinsame Hardware und der Dev-Build
begrenzen die Übertragbarkeit dieser ersten Messung.

## Aktueller Umfang

Der Solo-Parcours führt den normalen Host-Start, den Lobby-Reveal, die Audiofreigabe und drei
Sekunden Lobby aus. Erst danach lädt es seine Fallsteuerung. `standard` durchläuft den
Referenzparcours mit den Gegenständen des
[V1-Konzepts](GDDs/Fragdachse_Performance_Lab_Konzept_V1_Revision_3.md) und einem kleinen
Querschnitt ergänzender Mechaniken, anschließend erfolgt
die belohnungsfreie Rückkehr. Die Szenarioversion bleibt bis zur menschlichen
Relevanzprüfung als Kalibrierungskandidat gekennzeichnet.

## Bedienung

`--enemy-eyes on|off` schaltet ausschließlich Augen und deren Bodenlichter für einen
A/B-Vergleich; `--time-of-day HH:MM` fixiert die Tageszeit des Falls. Beide Werte stehen
im Run-Manifest und in der Umgebung. Für Vergleiche identische Uhrzeit, Fall, Build,
Aufnahmedauer und Capture-Profil verwenden. Beispiel:
`npm run perf:chrome -- --case enemies.medium --enemy-eyes on --time-of-day 00:00`.
Ohne Schalter gilt das normale Verhalten.

Die optische Einzelprüfung ist im vorhandenen Navigation-Lab möglich:
`/navigation-lab.html?kinds=all&count=14&autorun=1` oder eine kommaseparierte
Gegnerauswahl, etwa `kinds=zombie-badger,rabid-badger`. Diese Auswahl benutzt die normale
Spielkamera und einen engeren Spawn-Bereich; die Referenzszenarien bleiben unverändert.
`M` öffnet den lokalen Tageszeitregler. Pausieren und Einzelschritte helfen bei der
Positionsprüfung; solche Sichtprüfungen sind keine Performance-Aufnahmen.

Voraussetzungen: Projektabhängigkeiten installiert, lokal installiertes Google Chrome und
Netzwerkzugriff auf den normalen Signalisierungsserver des Spiels.

```text
npm run perf:chrome
npm run perf:chrome -- --case weapon.plasma
npm run perf:chrome -- --case destruction.bfg --duration-seconds 60
npm run perf:chrome -- --case combat.day-night
npm run perf:chrome -- --case hazards.void-fire
npm run perf:chrome -- --case weapon.glock --capture-profile reduced
npm run perf:compare -- <Ergebnisordner-A> <Ergebnisordner-B>
```

Mit `--build <sourceHash aus manifest.json>` lässt sich ein vollständiger archivierter Build
erneut messen, ohne Checkout-Wechsel oder Neubau. Ein fehlendes/unvollständiges Archiv ist
ein Fehler; der Runner ersetzt es nicht durch den aktuellen Quellstand. So sind abwechselnde
Vorher/Nachher-Wiederholungen unter ähnlichen Bedingungen möglich. `buildReused` zeigt im
Manifest die Wiederverwendung; `buildStorage` beschreibt die ursprüngliche Archivierung.
`perf:compare` stellt auch die einzelnen CPU-Bereiche gegenüber und warnt bei deutlich
abweichendem Lobby-Frame-Takt. Dieser Takt ist eine Beobachtung, keine Messung der Monitorfrequenz.
Die Frame-Zusammenfassung wird bereits vor der Chrome-Auswertung gesichert. Ein späterer
Fehler lässt den Lauf dennoch auf `failed`; er wird dadurch nicht vergleichbar. Die Offline-
Auswertung begrenzt Bereichssuchen auf überlappende Phasen und verwendet Profil-Aufrufketten
wieder, ohne Stichproben auszulassen oder Phasengrenzen zu kürzen.

Der Runner öffnet sichtbares Chrome mit einem frischen, isolierten Browserprofil. Das Fenster
muss während der Messung sichtbar und fokussiert bleiben. Die Spielauflösung beträgt
1920 × 1080 CSS-Pixel bei DPR 1 und hoher Grafikqualität. 120 FPS sind ein Bewertungsziel;
Spiel- und Bildschirmtakte werden nicht umgestellt. Nebenher keine Builds, Spiele oder
anderen Lasttests starten. Die Browserumgebung greift nicht auf das persönliche Chrome-Profil zu.

`--duration-seconds` verlängert das aktive Fenster eines Einzeltests. Vorbereitung,
produktive Cooldowns, vollständige geplante Aktionszahl und Nachlauf kommen hinzu.
Ausbleibende Aktionen werden auf späteren echten Frames ausgeführt; es gibt keine Nachholsalven.
`--timeout-seconds` setzt das technische Gesamtlimit einschließlich Build und Auswertung;
Standard sind 1500 Sekunden. Ein Fehler führt zu einem erfolglosen Lauf, nicht zu geringerer Last.
Der Runner reserviert mindestens 1 GiB freien Plattenplatz plus 128 MiB Sicherheitspuffer.
Er prüft vor Builds und größeren Schreibvorgängen sowie alle zwei Sekunden während des Laufs.
Chrome-Traces werden mit begrenztem Stream-Puffer direkt nach `.json.gz` geschrieben;
eine unkomprimierte Zwischenkopie entfällt. Bei Platzmangel wird abgebrochen und auf eine
zusätzliche Trace-Bergung verzichtet. Fehlgeschlagene Ergebnisordner tragen ihren Fehler im Manifest.
Bei einem Abbruch versucht der Runner, den noch verfügbaren Chrome-Puffer als
`chrome-trace.partial.json.gz` zu sichern. Dieser Diagnosebeleg bleibt ausdrücklich unvollständig;
das Manifest bleibt `failed`, und `perf:compare` akzeptiert ihn nicht als Vergleichslauf.

Nach Aufnahmeende wird der Spielbericht im Browser einmal als JSON serialisiert und in
begrenzten Textstücken übertragen. So muss Playwright nicht Millionen einzelner Messwerte
in einer einzigen Protokollantwort rekursiv verpacken. Die eigentliche Messung bleibt davon
unberührt; diese Arbeit erfolgt erst nach dem Stoppen des Chrome-Traces.

Ohne explizites `--capture-profile` verwendet der vollständige Parcours (`standard` als
Fallauswahl, auch ohne `--case`) das Profil `reduced`. Einzeltests und die kürzere Gruppe
`combat.day-night` verwenden weiterhin `standard` mit JS-Sampling. Ein explizites Profil
hat Vorrang; für Vorher/Nachher-Vergleiche muss es auf beiden Seiten gleich sein.

`reduced` schaltet ausschließlich Chromes JS-Sampling ab. Der Spielprofiler bleibt gleich;
die vollständigen Frame-, CPU-Abschnitts- und GPU-Messungen bleiben erhalten, gesampelte
JavaScript-Aufrufstapel fehlen. Es ist im Vergleich ausdrücklich eine andere Messbedingung.
Der lange Parcours mit JS-Sampling stürzte bei der Prüfung vom 26.09.2026 in Chrome 153
sowohl mit ursprünglichen als auch optimierten Renderern beim abschließenden Lobby-Rückweg
ab. Die Läufe ohne JS-Sampling waren vollständig. Die Absturzursache ist ungeklärt; der
Default begrenzt das beobachtete Problem, repariert aber keinen Chrome-Fehler. Für eine
vertiefte CPU-Analyse einzelne auffällige Fälle mit dem Standardprofil aufnehmen.

Aufnahmeprofil v6 verwendet einen begrenzten Chrome-Trace-Puffer von 1.200.000 KiB und aktiviert
JS-Sampling über die entsprechende Trace-Kategorie. Der Pufferfüllstand wird überwacht;
nahe der Kapazitätsgrenze scheitert der Lauf ausdrücklich. Die Speicherstrategie folgt dem
[TracingManager der Chrome DevTools](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/services/tracing/TracingManager.ts).
Sichtbare Gameplay-Last und Spieltakte ändern sich durch die Profilauswahl nicht.

## Fallauswahl und feste Last

| Fall-ID | Inhalt |
|---|---|
| `environment.route` | Elf Wegpunkte, drei Seen, sichtbarer fahrender Zug und globale Felsreserve |
| `environment.dawn` | Kurze Uferroute um 06:00 Uhr: Wasser, sichtbare Fische/Wildlife und reagierender Bodennebel |
| `destruction.single` | Einzelzerstörung mit Glock |
| `destruction.nuke`, `destruction.bfg` | Reguläres Pickup, Aktivierung/Aufladen, eigenes dichtes Felsfeld und freigeräumte Route |
| `enemies.low`, `enemies.medium`, `enemies.high` | Drei feste Gegnerbestände mit gleicher Artenmischung und Spielerbewegung |
| `hazards.void-fire` | Dauerhafte VoidFire-Front in der Größe des Endzustands von Map 14, danach 30 Sekunden volle Feuerlast |
| `weapon.glock`, `weapon.p90`, `weapon.plasma`, `weapon.mini-rockets`, `weapon.shotgun` | Baseline beziehungsweise explizit voll ausgebaute Waffen |
| `weapon.asmd`, `weapon.bite`, `weapon.rocket`, `weapon.tesla`, `weapon.flame` | Basis-Builds einschließlich gehaltener Waffen |
| `weapon.hydra` | Aufgerüstete Hydra gegen eine Felswand: tatsächliche Teilung und nachführende Split-Projektile mit Treffern |
| `utility.he`, `utility.molotov`, `utility.smoke` | HE-Basis sowie volle Molotov-/Smoke-Builds mit regulärem Werfen |
| `utility.time-bubble` | Ein regulär geworfenes Zeitfeld mit Fokus, Resonanz und Prismenspirale; sichtbare Blase, Prismengeschosse und Treffer erforderlich |
| `construction.defense` | Zwei Raketen-Türme und zwei Mauern über Bauaktionen, danach Angriff auf Konstruktionen |
| `ultimate.armageddon` | Basis-Ultimate mit echten Meteoren und Treffern |
| `combat.day`, `combat.night`, `combat.day-night` | Frische identische Welt, separat gemessener Tageszeitwechsel und Bauvorbereitung, vier feste Gegnerwellen |
| `recovery.idle` | Angriffe/Spawns stoppen und verbleibende Effekte beobachten; im Parcours bleibt die Nacht-Welt bestehen |

Einzeltests erstellen ihren Ausgangszustand selbst. Der einzelne Erholungstest aktiviert
zuvor Armageddon und unterbricht anschließend dessen Nachspawnen über den bestehenden
Aktions-Lifecycle. Beide Zerstörungstests erhalten unabhängig voneinander ein frisches Feld.
Die Gruppe `combat.day-night` enthält zusätzlich die anschließende Erholung derselben Nacht-Welt.
Jeder erfolgreiche Lauf prüft die tatsächlich ausgeführte Mechanik; fehlende Treffer,
Pickups, Effekte, Bauaktionen oder Umgebungsmerkmale lassen den Lauf scheitern.

Ab `reference-1-candidate.6` ist Bodennebel im Lab wie in der normalen hohen Grafikqualität
aktiviert. Ältere Lab-Builds hatten ihn grundsätzlich abgeschaltet und sind deshalb keine
direkte Gesamt-Baseline. Manifest/Umgebung nennen `groundFog: true`. Umgebung und Tag-/Nachtkampf
erfassen sichtbare Tierarten sowie Nebelaktivität im tatsächlichen Kameraausschnitt. Die
Morgenkarte lädt bereits mit ihrer authored Tageszeit; sie versteckt die Initialisierung
nicht in einem nachträglichen Zeitsprung. Hydra und Zeitblase ergänzen eigenständige Mechaniken
(Teilung/Homing und Zeitfeld/Prismenspirale), keine vollständige Waffen- oder Upgrade-Matrix.
Die drei zusätzlichen Fälle haben zusammen 38 Sekunden feste Mess-/Nachlaufzeit; normale
Lade- und Rückkehrphasen kommen hinzu.

Vorbereitung und erstes Gameplay bleiben getrennt messbar. Asset-Laden, Shader-Kompilierung,
GPU-Puffer und vorbereitbare Text-/Effektressourcen gehören in die normale Ladebarriere.
Die Projektilspuren bereiten ihren begrenzten Pufferpool über mehrere Ladeframes vor.
Das Lab verwirft keine ersten Gameplay-Frames als pauschales Warmup.

Die Referenzwelt hat 160 × 96 Zellen, drei Seen, feste Felsfelder, Vegetation und einen
unbewaffneten feindlichen Außenposten außerhalb der Messbereiche. Dieser aktiviert die normale
Coop-Komposition für Gegnerverhalten und Kartenereignisse. Eine persönliche persistente Basis
existiert dort nicht. Nuke/BFG folgen auch beim ersten Erscheinen ihrem regulären Spawn-Timer.
Der Zug erscheint nur im Umgebungstest, niemals in den Tag-/Nachtfenstern.

`hazards.void-fire` ist auch in `standard` enthalten. Seine eigene Referenzkarten-Variante
erzeugt über den regulären Ground-Hazard-Handler eine Front über 59 × 42 Kartenzellen,
also 9.912 Feuerzellen im 16-Pixel-Raster. Die Ausbreitung dauert fünf Sekunden statt der
90 Sekunden auf Map 14; sie zählt zur Vorbereitung. Erst die vollständig aktive Fläche
startet das Messfenster. Tageszeit ist wie auf Map 14 20:30 Uhr. Bäume, das untere Gewässer,
Pickups und die beiden inneren Felsfelder entfallen, damit die Feuerlast reproduzierbar
vollständig entsteht; die äußere Felsreserve bleibt bestehen. Es gibt keine Gegnerwellen.
Der Fall isoliert damit die hohe VoidFire-Last und bildet keine vollständige Map-14-Runde nach.
`expectedVoidFireCells`, `voidFireCellsMin` und `visibleVoidFireCellsMin` belegen Sollbestand,
kleinsten beobachteten Bestand und Sichtbarkeit während der Messung. Fehlende, abnehmende
oder vollständig unsichtbare Feuerlast lässt den Lauf scheitern.

Lastmengen, Ziel-HP und Mindestbestände stehen in `fixtures.ts`, die Karte in `referenceMap.ts`,
Zeiten und Fallverträge in `scenarios.ts`. `build-presets.json` hält die erlaubten Upgrade-IDs
und Level ausdrücklich fest. Es gibt keine Anpassung an die erreichten FPS und kein
automatisches Übernehmen neuer Upgrades. Pinning haltbarer Zielgegner, regelmäßige
Adrenalinversorgung und Spielerschutz sind ausgewiesene Diagnosehilfen; zusätzliche normale
Gegner liefern Bewegungs-, Treffer- und Todesmechaniken.

## Ergebnisse lesen

Die Ausgabe liegt unter `build/performance-results/<Run-ID>/`. Nur ein Manifest mit
`status: "complete"` kennzeichnet einen vollständigen, vergleichbaren Eingang für `perf:compare`.

| Datei | Zweck |
|---|---|
| `analysis.md` | Einstieg und Untersuchungsauftrag für eine KI, die nur Dateien lesen kann |
| `summary.md`, `summary.json` | Phasen, tatsächliche Frame-Statistik und priorisierte Beobachtungen |
| `cases/*.md` | CPU/GPU, Last, Hänger, Aufrufketten, Quellstellen und Wiederholungsbefehl |
| `evidence.json` | Ausführlichere, vorab aufbereitete Sampling-Belege |
| `manifest.json` | Quellstand, Build, Browser, Startparameter, Hardware und Aufnahmeprofil |
| `fragdachse-trace.json` | Ungeglättete Frames, asynchrone GPU-Werte und bestehende Diagnosezähler |
| `chrome-trace.json.gz` | Originalaufnahme für spätere Detailuntersuchungen |
| `console.json` | Browsermeldungen; Browserfehler verhindern einen erfolgreichen Abschluss |

Builds liegen unveränderlich unter `build/performance-builds/<Quellhash>/`. Ein Ergebnis
verweist relativ auf seinen Build, lesbaren Projektquellstand, Source-Maps und darin enthaltene
Abhängigkeitsquellen. Beim Weitergeben beide Verzeichnisse mit ihrer relativen Struktur erhalten.
Ein neuer Build überschreibt keine frühere erfolgreiche Aufnahme.

Unveränderte Build-, Asset- und Quelldateien teilen ihre Daten über Hardlinks auf private,
inhaltlich adressierte Kopien in `build/performance-objects/`. Arbeitsdateien werden niemals
direkt verlinkt: spätere Änderungen unter `src/` oder `public/` verändern kein Archiv.
Wo Hardlinks nicht verfügbar sind, wird die Datei kopiert. `build.json` und das Run-Manifest
nennen logische, neu gespeicherte und wiederverwendete Bytes; der Explorer kann bei Hardlinks
eine höhere logische Größe als die tatsächlich belegte Plattenkapazität anzeigen.
Build-Verzeichnisse bleiben eigenständig nutzbar und lassen sich normal weiterkopieren.
Frühere Aufnahmen und Builds werden nicht automatisch gelöscht.

Ab Profil v6 verwenden Spielreport-Schema 9, `frameCapture.version: 2`, Summary-/Vergleichsformat 2
und Sampling-Belegformat 3 eine ausdrücklich getrennte Messsemantik. Alte Aufnahmen bleiben
lesbar; `perf:compare` berechnet keine Zeitdifferenzen zwischen inkompatiblen Summary-Versionen.
Für einen Vorher/Nachher-Vergleich beide Quellstände mit derselben Messinstrumentierung aufnehmen.

Ein bei rAF-Zeit `t` beobachtetes Delta `d` beschreibt `[t-d, t]`. Die CPU-Arbeit dieses
Callbacks liegt danach. Die Aufnahme hält deshalb Frame-Intervalle und gemessene Callback-/
Bereichsgrenzen getrennt. Auch Ladeframes mit vorzeitigem Scene-Return werden am Callback-Eingang
erfasst. Frame-Statistik und FPS einer Phase verwenden nur vollständig enthaltene Intervalle.
Grenzintervalle stehen zusätzlich mit voller Dauer, Überlappungsdauer, Frame-ID und allen
betroffenen Phasen im Bericht. Dieselbe ID in zwei Berichten ist dasselbe Ereignis.
Hänger werden nicht gekürzt, anteilig umgerechnet oder als erste Frames pauschal verworfen.
Erstverwendungskosten bleiben anhand ihrer echten Bereichszeit sichtbar, auch wenn das
zugehörige Frame-Intervall eine Vorbereitungsgrenze überschreitet.

Die Kostenübersicht misst Wall-Zeit im Spiel-Callback, SceneManager, Arena-Scene-Systemen,
`Scene.update`, dem Host-/Client-Schritt, dem visuellen Update-Abschnitt, `POST_UPDATE`,
Renderer-Vorbereitung und Render-Submission. Die Elternbeziehung steht an jeder Zeile:
übergeordnete und enthaltene Zeiten niemals addieren. Die manuell getaktete Host-Physik ist
im Gameplay-Schritt enthalten; automatische Phaser-Physik gehört zu den Scene-Systemen.
`POST_UPDATE` umfasst visuelle Updates und weitere dort registrierte Systeme, einschließlich
Offscreen-Zeichnen und Shader-Erstinitialisierung. Der visuelle Update-Abschnitt enthält auch
UI, Bakes und den abschließenden Netzwerk-Flush; er ist kein reines GPU-/Effektmaß.
Der Rest von `Scene.update` und der nicht weiter aufgeteilte Callback-Rest werden ausdrücklich
ausgewiesen. Weitere Scenes liegen in der übergeordneten SceneManager-Zeit.
Jeder Bereich verwendet seine eigenen Zeitgrenzen: Ein Teilaufruf kann vollständig in einer
Phase liegen, während sein Elternaufruf die Grenze kreuzt. Die Stichproben können sich deshalb
unterscheiden; Maxima und Percentile verschiedener Zeilen ergeben keine Zeitbilanz.

Die Bereichszeiten schließen GC, Treiberwartezeit und OS-Unterbrechungen ein. Sie messen keine
CPU-Auslastung. Browserarbeit, andere Tasks und Scheduling außerhalb des Spiel-Callbacks sind
nicht durch diese Bereiche erklärt. Hängerberichte zeigen diese nicht abgedeckte Intervallzeit
und passende Chrome-Aufrufketten. Worker laufen parallel; überlappende Worker-/GC-Ereignisse
oder gesampeltes Idle allein beweisen keine Ursache. CPU-Sampling bleibt eine Schätzung.
Der frühe Boot besitzt vor Initialisierung des Spielprofilers ausschließlich Chrome-Daten.

GPU-Werte werden über Start und Ende des auslösenden CPU-Submission-Bereichs zugeordnet,
unabhängig vom späteren Ergebnisabruf. Die echte GPU-Ausführungszeitachse wird nicht rekonstruiert.
Der vorhandene asynchrone Timer erfasst weiterhin nur `PRE_RENDER` bis `POST_RENDER`;
frühere Offscreen-Arbeit liegt außerhalb dieses GPU-Maßes. Grenzübergreifende Queries werden
separat gespeichert. GPU-Zeit, Worker-Zeit, Callback-Wall-Zeit und Frame-Abstand sind nicht addierbar.

Renderzähler beobachten die nativen `drawArrays`-/`drawElements`-Aufrufe, WebGL2-Instancing
und gegebenenfalls ANGLE-Instancing des Spielkontexts. Aliasaufrufe zählen einmal. Ein
mitverfolgtes Draw-Framebuffer kennzeichnet Offscreen-Aufrufe; die Zählung beginnt vor dem
Scene-Update und umfasst damit auch `POST_UPDATE`. Sie zählt API-Submissions, keine sichtbaren
Objekte, Dreiecke oder erfolgreichen GPU-Pixel. Kein `getError`, `finish` oder `readPixels`
wird eingefügt. Nicht unterstützte Hooks, Kontextverlust und ersetzte Hooks liefern
„nicht verfügbar“; nur eine gültig beobachtete Null wird als 0 ausgegeben. Asynchrone Aufrufe
außerhalb des Spiel-Callbacks sind nicht Teil der phasenbezogenen Callback-Zähler.

Die Kurzberichte berücksichtigen abwechselnd Messprobleme, Einzelhänger, Verschlechterung
im Verlauf, Dauerlast und Lade-/Übergangskosten. Zweissekundenabschnitte zeigen FPS,
Frame-Verteilung und Gegner-/Projektilbestände; Abschnittsgrenzen schneiden keine Hänger ab.
Die separaten Projekt-Hotspots wählen Funktionen vor der Top-Limitierung anhand ihrer
archivierten Projektquellen aus. Damit verdrängen Engine-Aufrufe die Projektfunktionen nicht.
Eigenzeit und inklusive Zeit verwenden dieselben Samples und denselben Nenner wie die
gesamte Thread-Ansicht; die Ansichten sind nicht addierbar und ändern die Aufnahme nicht.
Die Verlaufsheuristik vergleicht ausreichend belegte Anfangs-/Endabschnitte, ohne Trendtest oder
Ursachenbehauptung. Bekannte Ursachen sind erst durch Prüfung von Aufrufketten und Quellcode
zu begründen. Die zusätzlichen Hooks existieren nur bei aktiver Diagnose, die Bereichsaufnahme
nur bei expliziter Frame-Aufzeichnung; es gibt keine Objekt-Scans und keine Zeitabfrage pro Draw Call.

`actions` zählt akzeptierte Aufrufe des produktiven Aktionspfads. Bei gehaltenen Waffen sind
darunter auch Aktualisierungen des Haltezustands; diese Zahl ist keine Schusszahl.
`damageEvents`, `projectilePeak`, Folgeeffekte und Kills belegen die tatsächlich erzeugte Mechanik.
`playerAttacksStopped` beschreibt den Spielereingang; laufende Gegner und Folgeeffekte bleiben
im Nachlauf absichtlich beobachtbar. Erst die Erholungsphase beendet zusätzlich die Gegnerlast.
Verspätet aus vorhandenen Brutprojektilen entstandene Gegner werden dort entfernt und als
`lateRecoveryEnemiesRemoved` protokolliert. Grobe Seitenheap- und freie Systemspeicherwerte
stehen ab Aufnahmeprofil v4 im Manifest; sie ersetzen keine Messung des gesamten Renderer-
oder GPU-Speichers und beweisen für sich allein keine Absturzursache.

Die KI liest zunächst die Zusammenfassung und die auffälligen Fallberichte, prüft deren
Quellstellen im archivierten Stand und entwickelt eine begründete Änderung mit gezieltem
Nachtest. Der Mensch führt diesen Test und den Vergleich aus. Der Vergleich meldet Änderungen
der Messbedingungen und der tatsächlichen Last, aber keinen automatischen Optimierungserfolg.
Ein zusätzlicher Hash erfasst Karte, Lastdaten, Presets und Fallaktionen, damit auch versehentlich
nicht hochgezählte Szenarioversionen als abweichende Messbedingung sichtbar werden.

## Erweiterung

- Fälle: `src/debug/performanceLab/scenarios.ts`; Lastdaten: `fixtures.ts`; Builds: `build-presets.json`.
- Laufsteuerung, Aktionsfristen, Abbruch und Cleanup: `PerformanceLabController.ts`.
- Produktive Spielaktionen und beobachtbare Ergebnisse: `gamePort.ts` und die vorhandenen Lab-Ports.
- Framedaten: opt-in über `ArenaRuntimeProfiler.startRecording`.
- Aufnahme, begrenzte Offline-Auswertung und Bericht: `scripts/performance/`.

Neue Fälle benötigen eine stabile ID, Version, legal aufgelöste Ausgangsdaten und mindestens
einen Nachweis der tatsächlich ausgeführten Mechanik. Bei geänderter Last das Szenario versionieren.
Änderungen an Messzeitbasis oder Instrumentierung versionieren das Aufnahmeprofil. Szenariodaten
werden erst nach dem frühen Lobbyfenster geladen und bleiben durch die statische Build-Konstante
aus dem öffentlichen Build ausgeschlossen. Keine Szenarien im normalen Updatepfad nachladen.

## Verifikation

Die passenden Tests liegen in `PerformanceLab*.test.ts`, `GraphicsQualityAndPerformance.test.ts`,
`WorldActivityAuthoring.test.ts` und `tests/integration/ArenaExitLifecycle.test.ts`.
Praktische Nachweise und verbleibende Grenzen stehen in [performance-lab-validation.md](performance-lab-validation.md).
Browserprüfungen erfolgen ausschließlich mit dem Lab-Runner. Die endgültige Lastkalibrierung
erfordert zusätzlich eine menschlich gespielte Vergleichsrunde: Sind dieselben auffälligen
Mechaniken betroffen, und sind Gegnerbestände, Ziel-HP und Zerstörungsgrößen praktisch relevant?
Erst danach wird die Kandidatenversion eingefroren. Messwerte verschiedener Kandidaten-Builds
sind anhand ihrer konkreten Lastdaten zu beurteilen.

Technische Referenzen: [CDP Tracing](https://chromedevtools.github.io/devtools-protocol/1-3/Tracing/)
und [Chromes CPUProfileDataModel](https://chromium.googlesource.com/devtools/devtools-frontend/+/9a696c4e723caa3c7e1f78886da353f1f06a79b0/front_end/core/sdk/CPUProfileDataModel.ts).


## Ladezeitmessung ohne Browser-Pane-Drosselung

Der bestehende Runner bietet einen separaten Lade-Modus. Er baut bzw. verwendet sein
archiviertes **performance-lab-Produktionsbundle**, keinen Vite-Dev-Server. Der normale
Host-Verbindungs-, Ready-/Start- und Discard-Pfad l?dt die echten Maps; Kampffixtures und
vollst?ndige Frame-/Chrome-Traces bleiben aus. Signalisierungszugriff und lokales Chrome
sind weiterhin Voraussetzungen. Keine parallel laufenden Builds/Lasttests.

```text
npm run perf:chrome -- --load --runs 5
npm run perf:chrome -- --load --runs 5 --network 50mbps
npm run perf:chrome -- --load --runs 5 --headless on
```

Ein Aufruf misst pro Wiederholung HTTP-kalten Boot bis Lobby-Reveal, danach einen warmen
Reload im selben Browserkontext und anschlie?end Lobby ? Map 1 ? Lobby ? Map 7 ? Lobby
? Map 15 ? Lobby. Die Maps nutzen Seed 12345 und ihren normalen Spawn, ohne Teleport oder
Layout-/Tageszeit-Override. Grafikqualit?t high, 1664?936 CSS-Pixel, DPR 1. Chrome erh?lt
`--disable-background-timer-throttling`, `--disable-renderer-backgrounding` und
`--disable-backgrounding-occluded-windows`. Der normale Trace-Modus bleibt unver?ndert.
`--runs` akzeptiert 1?100 (Standard 5), `--network` ist `local` oder `50mbps`
(50 Mbit/s je Richtung, CDP-Latenz 20 ms). `--timeout-seconds` begrenzt wie bisher den
Gesamtlauf inklusive Build (Standard 1500 s), jede Ladephase zus?tzlich auf maximal 300 s.
`--build <sourceHash>` verwendet einen archivierten Build mit Lade-API; ?ltere Archive ohne
`prepareLoad` werden abgelehnt. Trace-F?lle und visuelle Ablationen sind nicht kombinierbar.

Kalt bedeutet geleerten Chrome-HTTP-/Origin-Cache, **nicht** kalten Betriebssystem-,
Shader- oder GPU-Cache. Warm beh?lt Browserkontext und Cache und l?dt die Seite neu;
der Raum-Hash wird vorher entfernt, damit erneut ein Host startet. Der isolierte Server
liefert unver?nderliche Build-Dateien mit Cache-Control und ETag. Dies misst kontrollierte
Cachebedingungen, nicht die Header eines beliebigen Deployments. Headless ist eine eigene
Messbedingung und sollte nicht mit sichtbaren Chrome-L?ufen vermischt werden.

Ausgabe: `build/performance-results/<runId>/load-summary.json` und `load-summary.md`,
plus `load-<NN>-cold-lobby.json`, `warm-lobby` und `map-1/7/15` mit der vollst?ndigen
`__FD_BOOT__.timeline()`, Navigation-/Resource-Timings und rAF-Stichproben. Manifest und
Browserprotokoll bleiben beim vorhandenen Runner. Fehler sichern nach M?glichkeit
`load-failed-timeline.json`; schon geschriebene Stichproben bleiben erhalten.

Der Bericht trennt Navigationsbeginn ? Boot-Reveal (einschlie?lich initialer Module,
Verbindung und Fade), World-Aufbau ? lokale Ready-Barriere, World-Aufbau ? erste beobachtete
Reveal-Freigabe und Auftrag ? spielbar (einschlie?lich regul?rem Countdown). Reveal-Freigabe
wird bei Maps im 100-ms-Takt beobachtet; sie ist kein Screenshot und misst nicht das Ende
eines UI-Fades. Der rAF-Check endet nach Aufbau/Ready/Reveal-Freigabe, nicht erst nach dem
Countdown. Median-fps unter 20, verdeckte Dokumente, falsche Aufl?sung oder unvollst?ndige
Stichproben machen den Lauf ung?ltig: Rohdaten bleiben, alle Median/p95-Aggregate schlie?en
ihn aus, der Runner endet mit Fehlerstatus. Effektive FPS, Anfangs-/Endl?cken und Intervall-p95
helfen, l?ngere Einzelpausen zu erkennen, die der Median allein nicht zeigt.

Downloadgruppen enthalten Transfer-/HTTP-Bodybytes und Zeitspannen; warme Cachetreffer
k?nnen Transferbytes 0 melden. Map-Gruppen verwenden das A1-World-Aufbaufenster, Bootgruppen
die Navigation. Zus?tzlich liegen rohe Resource-Timings ab Ladeauftrag vor. Worker-interne
Imports bleiben au?erhalb der Hauptseiten-Resource-Timeline. CPU-, Worker- und verstrichene
Abschnitte k?nnen ?berlappen und d?rfen nicht zur Gesamtdauer addiert werden. Jede Phase
nennt ihre zuletzt erf?llten Barrieren. Ladeberichte werden ?ber ihre JSON-Phasen verglichen;
`perf:compare` bleibt f?r die bisherigen Trace-Berichte zust?ndig.

### Einordnung der Loader-Attribution

`loader-process/json/other` kann die beiden bereits als Objekt ?bergebenen Atlas-JSONs aus
`preloadHudFrameAssets` und `preloadRadialWheelAssets` betreffen. Phasers `JSONFile`
?berspringt daf?r JSON.parse; `MultiFile.pendingDestroy` meldet filecomplete erst nach dem
vollst?ndigen Atlas einschlie?lich PNG. A1 misst load ? filecomplete: somit Wartezeit auf
Partnerbild/Decode/Cache, keine isolierte JSON-Parsezeit. Der dritte Atlas `dachs_death`
l?dt dagegen externes JSON unter `assets/player`.

Die Desktop-Vorgabe von Phaser ist `loaderMaxParallelDownloads = 32`; das Spiel ?berschreibt
sie nicht. `LoaderPlugin.update` f?llt die Warteschlange im Scene-Update nach,
`nextFile` st??t die n?chste Downloadwelle nicht selbst an. 748 Spritebilder brauchen
somit rechnerisch mindestens 24 volle Wellen allein f?r diese Gruppe; andere Dateien teilen
die Queue. Ein gedrosselter Sekundentakt kann die beobachtete Streckung ?ber etwa 21 Sekunden
erkl?ren, beweist aber keinen entsprechenden Netzwerk- oder Decode-Aufwand im ungedrosselten
Spiel. Loader-Parallelit?t und Assets bleiben f?r diese Messrunde unver?ndert.
