# Performance-Lab

## Aktueller Umfang

Das Lab führt den normalen Solo-Host-Start, den Lobby-Reveal, die Audiofreigabe und drei
Sekunden Lobby aus. Erst danach lädt es seine Fallsteuerung. `standard` durchläuft den
Referenzparcours mit allen 18 Gegenständen des
[V1-Konzepts](GDDs/Fragdachse_Performance_Lab_Konzept_V1_Revision_3.md), anschließend erfolgt
die belohnungsfreie Rückkehr. Die Szenarioversion bleibt bis zur menschlichen
Relevanzprüfung als Kalibrierungskandidat gekennzeichnet.

## Bedienung

Voraussetzungen: Projektabhängigkeiten installiert, lokal installiertes Google Chrome und
Netzwerkzugriff auf den normalen Signalisierungsserver des Spiels.

```text
npm run perf:chrome
npm run perf:chrome -- --case weapon.plasma
npm run perf:chrome -- --case destruction.bfg --duration-seconds 60
npm run perf:chrome -- --case combat.day-night
npm run perf:chrome -- --case weapon.glock --capture-profile reduced
npm run perf:compare -- <Ergebnisordner-A> <Ergebnisordner-B>
```

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
Vor dem Start muss mindestens 1 GiB frei sein; längere Aufnahmen benötigen zusätzlichen Platz
für den zunächst unkomprimierten Trace. Nach erfolgreicher Komprimierung bleibt nur die
vollständige `.gz`-Aufnahme erhalten. Fehlgeschlagene Ergebnisordner tragen ihren Fehler im Manifest.
Bei einem Abbruch versucht der Runner, den noch verfügbaren Chrome-Puffer als
`chrome-trace.partial.json.gz` zu sichern. Dieser Diagnosebeleg bleibt ausdrücklich unvollständig;
das Manifest bleibt `failed`, und `perf:compare` akzeptiert ihn nicht als Vergleichslauf.

`reduced` schaltet ausschließlich Chromes JS-Sampling ab. Der Spielprofiler bleibt gleich.
Dieses Profil dient einer groben Gegenmessung und liefert keine gesampelten Aufrufstapel.
Es ist im Vergleich ausdrücklich eine andere Messbedingung.

Aufnahmeprofil v6 verwendet einen begrenzten Chrome-Trace-Puffer von 1.200.000 KiB und aktiviert
JS-Sampling über die entsprechende Trace-Kategorie. Der Pufferfüllstand wird überwacht;
nahe der Kapazitätsgrenze scheitert der Lauf ausdrücklich. Die Speicherstrategie folgt dem
[TracingManager der Chrome DevTools](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/services/tracing/TracingManager.ts).
Sichtbare Gameplay-Last und Spieltakte ändern sich durch die Profilauswahl nicht.

## Fallauswahl und feste Last

| Fall-ID | Inhalt |
|---|---|
| `environment.route` | Elf Wegpunkte, drei Seen, sichtbarer fahrender Zug und globale Felsreserve |
| `destruction.single` | Einzelzerstörung mit Glock |
| `destruction.nuke`, `destruction.bfg` | Reguläres Pickup, Aktivierung/Aufladen, eigenes dichtes Felsfeld und freigeräumte Route |
| `enemies.low`, `enemies.medium`, `enemies.high` | Drei feste Gegnerbestände mit gleicher Artenmischung und Spielerbewegung |
| `weapon.glock`, `weapon.p90`, `weapon.plasma`, `weapon.mini-rockets`, `weapon.shotgun` | Baseline beziehungsweise explizit voll ausgebaute Waffen |
| `weapon.asmd`, `weapon.bite`, `weapon.rocket`, `weapon.tesla`, `weapon.flame` | Basis-Builds einschließlich gehaltener Waffen |
| `utility.he`, `utility.molotov`, `utility.smoke` | HE-Basis sowie volle Molotov-/Smoke-Builds mit regulärem Werfen |
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

Die Referenzwelt hat 160 × 96 Zellen, drei Seen, feste Felsfelder, Vegetation und einen
unbewaffneten feindlichen Außenposten außerhalb der Messbereiche. Dieser aktiviert die normale
Coop-Komposition für Gegnerverhalten und Kartenereignisse. Eine persönliche persistente Basis
existiert dort nicht. Nuke/BFG folgen auch beim ersten Erscheinen ihrem regulären Spawn-Timer.
Der Zug erscheint nur im Umgebungstest, niemals in den Tag-/Nachtfenstern.

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
