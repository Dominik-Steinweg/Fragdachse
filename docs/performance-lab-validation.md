# Performance-Lab: Abnahme und Grenzen

Die ausführbaren Fälle und die Bedienung stehen in [performance-lab.md](performance-lab.md).
Diese Datei dokumentiert praktische Prüfungen; sie ist kein Vertrag der Projektarchitektur.

## Messzuordnung und Auswertung: Abnahme von Profil v6

Die Überarbeitung vom 17. September 2026 verwendet Spielreport-Schema 9,
`frameCapture.version: 2`, Summary-/Vergleichsformat 2 und Sampling-Belegformat 3.
Die folgenden kurzen Läufe wurden über `perf:chrome` mit sichtbarem Chrome,
frischem Profil, 1920 × 1080 CSS-Pixeln, DPR 1 und hoher Grafikqualität vollständig abgelegt.
Während der Aufnahmen liefen keine Builds oder Tests.

Die beiden abschließenden Läufe verwenden denselben unveränderlichen Quellhash
`3346fecef96d827f08e9237bde51988d3e9eff96d39c11a71736b85d541ee6a3` und Standardprofil v6:

| Lauf | Beobachtung im erzeugten Bericht |
|---|---|
| [utility.smoke](../build/performance-results/2026-09-17T21-11-16.867Z-dddc9e96/cases/utility.smoke.md) | 199,9 ms Frame-Abstand; zugehöriger Callback 198 ms, davon 189 ms in `POST_UPDATE`. Sampling zeigt 186,59 ms in `_completeProgram`; die Aufrufkette enthält den archivierten Projektaufrufer `SmokeSystem.renderFrame`, Zeile 108. Host-/Render-Teilzeiten allein erklären diesen Hänger nicht. |
| [combat.day](../build/performance-results/2026-09-17T21-09-27.355Z-f79e4093/cases/combat.day.md) | Vier Wellen. Erster/letzter Zeitabschnitt: 93,52 → 42,50 FPS, medianer Frame-Abstand 12,1 → 24,2 ms, medianer Gegnerbestand 42 → 151, medianer Projektilbestand 23 → 70. Einzelhänger, Verschlechterung und Dauerlast erscheinen gemeinsam im Kurzbericht. |

Der Smoke-Bericht hält das vorbereitungsübergreifende Intervall von 60,5 ms vollständig fest;
nur 35,8 ms davon überlappen das aktive Fenster. Es geht nicht in dessen Frame-Percentile ein.
Der echte Erstverwendungshänger innerhalb des Fensters bleibt dagegen erhalten. Die unabhängig
zugeordneten CPU-Bereiche zeigen auch enthaltene Teilaufrufe eines grenzüberschreitenden Callbacks.
Die Reporttabellen nennen ihre jeweiligen Stichprobengrößen und warnen vor dem Verrechnen
unterschiedlicher Percentile oder verschachtelter Bereiche.

Die GL-Zählung liefert im abschließenden Smoke-Fenster einen Median von 133 Aufrufen je
vollständig enthaltenem Callback, davon 118 mit Offscreen-Framebuffer. Im Kampffenster sind
es 206 beziehungsweise 190. Diese Werte zählen native API-Submissions, keine erfolgreichen
GPU-Pixel oder sichtbaren Objekte. Unterstützte Nullwerte und fehlende/ungültige Messungen
werden getrennt behandelt.

Ein früherer Lauf derselben Instrumentierung,
`2026-09-17T21-04-22.356Z-3f15bc45`, zeigte einen 260,5-ms-Smoke-Hänger mit 249 ms in
`POST_UPDATE`. Danach wurden ausschließlich Darstellung und Abschnittsbildung nachgebessert.
Der [CLI-Vergleich beider Smoke-Läufe](../build/performance-results/comparison-1789679636229/comparison.md)
erzeugte Zeit- und Zählerdifferenzen und wies die tatsächlichen Lastunterschiede aus.
Die unterschiedliche Hängerdauer ist kein Optimierungsnachweis. Ein
[Vergleich mit der älteren v5-Aufnahme](../build/performance-results/comparison-1789679636402/comparison.md)
kennzeichnete die inkompatible Messsemantik und berechnete dafür keine Messwertdifferenzen.

Aktuelle automatisierte Prüfung:

- `npm run check`: 3825 Core-Tests bestanden, dieselben zwei bereits bei der V1-Erstabnahme
  belegten Fehler in `TrainMapEvent.test.ts`; dadurch stoppt das kombinierte Gate vor Build/Architecture.
- Abschließende gezielte Suite: 36 Tests bestanden, einschließlich zweier anschließend ergänzter
  Regressionstests. Geschützt sind Phasengrenzen, ungekürzte lange Hänger, Erstverwendung in
  `POST_UPDATE`, GPU-Submission-Zuordnung, Verlaufstabellen, GL-/Instancing-/Offscreen-Zählung,
  ungültige Hooks, Wiederherstellung und der Phaser-Scene-Start.
- Separat: 492 Integrationstests und 35 Architecture-Tests bestanden.
- Öffentlicher Build und der durch den Runner erstellte Lab-Build erfolgreich.

Verbleibende Grenzen: Bereichszeiten sind Wall-Zeiten einschließlich möglicher GC-, Treiber-
und Schedulingkosten. Die GPU-Abfrage umfasst weiterhin nur `PRE_RENDER` bis `POST_RENDER`;
früheres Offscreen-Rendering wird über CPU-Bereiche und GL-Zähler sichtbar, ist aber nicht in
diesem GPU-Zeitwert enthalten. Sampling und überlappende Worker-/GC-Aktivität sind keine
alleinigen Ursachenbeweise. Der zusätzliche Instrumentierungsaufwand wurde hier nicht isoliert
quantifiziert; die alten Gegenmessungen unten gelten für die damalige Instrumentierung.
Ein neuer zehnminütiger Gesamtlauf war nicht Teil dieser gezielten Folgeabnahme.

## V1-Erstabnahme: Messkette

- Das Grund-Lab wurde dreimal mit unverändertem Quellhash
  `8d99d5861e1aafd36739e5fa7ed48b676c845bf9ebe5b452e76564f357929391` ausgeführt.
  Die drei Läufe erzeugten jeweils 43 Glock-Aktionen; Median 7,4 ms, p95 7,5 ms und
  p99 7,5–7,6 ms. Das belegt eine plausible Wiederholbarkeit dieses Grundfalls auf diesem Rechner.
- Ein gezielt auf 600 Sekunden verlängertes aktives Fenster wurde vollständig aufgezeichnet:
  80.976 Frames, 20.244 GPU-Messungen und rund 384 MB ursprüngliche Chrome-Daten.
  Es trat kein gemeldeter Datenverlust oder Ringpufferüberlauf auf.
- Diese ersten Läufe gehören zu einer früheren Grund-Lab-Version. Die anschließend korrigierte
  Zeitbasis nutzt den tatsächlichen rAF-Framebeginn und ordnet GPU-Werte anhand der auslösenden
  Frame-ID zu. Eigene Tests schützen lange Hänger, verzögerte GPU-Ergebnisse und Phasengrenzen.
- Eine Gegenmessung ohne Chrome-JS-Sampling wurde als separates Aufnahmeprofil gespeichert.
  Daraus folgt keine pauschale Aussage, dass Instrumentierung kostenlos wäre.
- Die erzeugten Berichte ließen sich ohne nachträgliche Skriptausführung bis zu archivierten
  TypeScript-Dateien verfolgen, darunter `cloneCoopDefenseUpgradeProfile` sowie Funktionen
  des Flowfield-Workers. Die Berichte liefern Untersuchungsansätze, keine bewiesenen Ursachen.

## Praktische Mechanikprüfungen

Die Prüfungen verwenden sichtbares Chrome, eine frische Browserumgebung und den Lab-Runner.
Frühe Fehlversuche blieben ausdrücklich erfolglose Läufe. Zu den beobachteten Nachweisen gehören:

| Mechanik | Beobachtung |
|---|---|
| Umgebung | Elf Wegpunkte, alle drei Seen, fahrender sichtbarer Zug, 72 Bäume und 247 Umgebungstiere |
| Gegner | Feste Starts mit 40, 120 und 240 Gegnern; produktive Folgespawns erzeugten in den Einzelabnahmen Spitzen bis 439 Gegner |
| Nuke | Reguläres Pickup und Zielwahl; 320 zerstörte Felsen im eigenen Feld; freigeräumte Route durchlaufen |
| BFG | Reguläres Pickup und Aufladen; etwa 230 zerstörte Felsen; eigenes Feld und freigeräumte Route |
| Konstruktionen | Zwei Raketen-Türme, zwei Mauern, Turmgeschosse und tatsächlicher Schaden an Konstruktionen |
| Waffen | Alle zehn Waffenfälle einzeln bestanden; Mini-Raketenwerfer und Shotgun erzeugten Spitzen über 60 gleichzeitig aktiven Projektilen |
| Molotov/Smoke | Brennender Boden und Brandschaden beziehungsweise aktive Rauchwolken |
| Tesla/Flammenwerfer | Kettenschaden beziehungsweise direkte Treffer und Brandschaden bei gehaltenem Input |
| Armageddon | Meteore, Einschläge, Schaden und auslaufende Bodeneffekte |
| Tag/Nacht | Je vier feste Wellen; nach Dauerkalibrierung 86 Glock-Aktionen; Wasser im Bild, nachts bis zu 200 gerenderte Lichtquellen |
| Einzelne Erholung | Neue Angriffe beendet; Meteore und Bodeneffekte liefen vollständig aus |

Konkrete Bestände und Spitzen können durch produktive Gegnerreaktionen, Zufall und Timing
variieren. Die Lastdaten jedes einzelnen Berichts sind maßgeblich; ein Seed ist kein Replay.
Der Vergleich prüft deshalb zusätzlich Szenariodaten, Presets, Browser, Hardware und Auflösung.

## Kalibrierung des Gesamtablaufs

Der erste vollständige Parcours des Kandidaten 2 erreichte alle Kampf- und Umgebungsfälle,
scheiterte aber korrekt an der abschließenden Erholungsprüfung: Bereits fliegende Brutprojektile
erzeugten nach der ersten Gegnerentfernung zwei weitere Gegner. Kandidat 3 entfernt solche
verspäteten Spawns vor dem nächsten Host-Kampfschritt und protokolliert sie ausdrücklich als
`lateRecoveryEnemiesRemoved` und semantisches Ereignis. Die vorhandenen Projektile und Effekte
bleiben zum Auslaufen erhalten.

Die normalen World-Neustarts verlängerten den ersten Parcours auf ungefähr 13 Minuten.
Für Kandidat 3 wurden deshalb die festen aktiven Fenster kürzer kalibriert; die zehn Waffenfälle
laufen beispielsweise jeweils sieben Sekunden. Die Karte, Startgegnerzahlen, Ziel-HP und
Upgrade-Presets bleiben gleich. Tag und Nacht behalten vier Wellen mit je 40 Gegnern bei,
nun im festen Abstand von 7,5 Sekunden. Längere Einzeltests bleiben über `--duration-seconds`
verfügbar. Während eines Laufs findet weiterhin keinerlei FPS-abhängige Lastanpassung statt.

Die Abnahme prüft zudem explizit Explosionen, Ketten- oder Brandschaden der entsprechenden
Waffen und Gegner-Treffer mit Turmherkunft. Allgemeine Treffer oder fremde Projektile können
diese verlangten Folgeeffekte nicht ersetzen.

Zwei weitere Gesamtläufe wurden nach Chrome-Rendererabstürzen im Nacht- beziehungsweise
Shotgun-Abschnitt verworfen; die Browserkonsole enthielt keine Ursache. Ab Aufnahmeprofil v4 ergänzt der Runner grobe
Speicherbeobachtungen im Manifest. Daraus allein darf keine Speicherleck- oder GPU-Diagnose
abgeleitet werden.

Der vollständige Kandidat-3-Parcours mit reduziertem Aufnahmeprofil v4 wurde im Lauf
`2026-09-17T01-46-21.946Z-116512c0` erfolgreich aufgezeichnet und ausgewertet. Alle 25 Fälle
bestanden einschließlich der Erholung derselben Nacht-Welt. Vom Boot-Marker bis zum
abschließenden Lobby-Reveal vergingen 623,1 Sekunden, also ungefähr 10 Minuten 23 Sekunden.
Der komprimierte Chrome-Trace umfasst rund 85 MB; alle fünf Pflichtdateien und Fallberichte
sind vorhanden. Dieser Lauf enthält absichtlich kein JS-Sampling und ersetzt dessen Abnahme nicht.

Der vollständige Standardlauf mit JS-Sampling und Aufnahmeprofil v5 wurde anschließend
erfolgreich abgeschlossen: `2026-09-17T02-04-20.143Z-069f5232`, Quellhash
`8afe1cf4781cf1fb3ac8881c998875ba6d0e2fa2c61e1fcf78792c2b537d76ec`.
Alle 25 Fälle bestanden; Spielstart bis abschließende Lobby benötigten 634,8 Sekunden
(10 Minuten 35 Sekunden). Der Runner verarbeitete 3.542.361 CPU-Samples, rund 569 MB
unkomprimierte Chrome-Daten und erzeugte einen vollständigen komprimierten Trace von rund
124 MB. Der überwachte Trace-Puffer erreichte höchstens 23,5 Prozent. Chrome beendete sich
regulär; Manifest, beide Traces, Zusammenfassungen, Fallberichte und Source-Map-Belege
wurden vollständig abgelegt. Einschließlich Übertragung und Auswertung dauerte der Befehl
rund 13 Minuten 17 Sekunden ohne erneuten Build.

Profil v5 folgt der begrenzten Speicherstrategie der Chrome DevTools und aktiviert
JS-Sampling über dessen Trace-Kategorie. Der erfolgreiche Gesamtlauf bestätigt die praktische
Verwendbarkeit dieses Profils auf dem Abnahmerechner, beweist aber nicht die Ursache der
vorherigen nativen Chrome-Abstürze.

Die gezielte Folge `combat.day-night` einschließlich Erholung wurde mit Profil v4 vollständig
abgelegt: Lauf `2026-09-17T01-34-55.683Z-85779281`. Ein verspäteter Brut-Spawn wurde protokolliert
und entfernt. Beide Kampffenster führten vier Wellen und 86 Glock-Aktionen aus; der Nachtfall
belegte 510 Schadensereignisse mit Turmherkunft und bis zu 200 gerenderte Lichtquellen.
Die erzeugten Berichte lösen unter anderem `EnemyLocomotion.solve` auf
`src/systems/navigation/EnemyLocomotion.ts:40` und den getrennt erfassten Worker-Aufruf
`computeIntegrationField` auf `src/systems/flowfield/FlowFieldKernel.ts:619` auf.
Das ist ein lesbarer Untersuchungsansatz, keine automatische Ursachenbehauptung.

## Wiederholbarkeit und Vergleich des Abschlussstands

Drei unveränderte `weapon.glock`-Läufe verwendeten denselben oben genannten Quellhash,
Szenariokandidaten 3 und Standardprofil v5:

| Lauf | Median ms | p95 ms | p99 ms | Aktionen | Treffer |
|---|---:|---:|---:|---:|---:|
| `2026-09-17T02-02-48.907Z-5acf2835` | 7,4 | 7,5 | 14,8 | 28 | 15 |
| `2026-09-17T02-18-42.470Z-9341c292` | 7,4 | 7,5 | 14,9 | 28 | 12 |
| `2026-09-17T02-19-22.848Z-a168ae37` | 7,4 | 7,5 | 14,8 | 28 | 16 |

Die feste Aktionszahl und die Frame-Verteilung wiederholten sich plausibel. Unterschiede bei
Treffern und Projektilen bleiben in den Lastdaten sichtbar. Zwei CLI-Vergleiche erzeugten
Markdown und JSON, ohne Abweichungen der festgelegten Messbedingungen zu melden.

Die Gegenmessung `2026-09-17T02-20-04.181Z-feeab3f3` verwendete denselben Build mit Profil
`reduced` v5. Sie führte ebenfalls 28 Aktionen aus; Median 7,6 ms, p95 8,1 ms, p99 8,5 ms.
Der Median der Render-Submission betrug 3,1 ms gegenüber 3,6–3,7 ms in den Standardläufen.
Das zeigt weder kostenlose Instrumentierung noch einen verlässlich bezifferten Gesamtoverhead:
Frame-Abstände, Arbeitszeiten und tatsächliche Last müssen getrennt beurteilt werden.
Der CLI-Vergleich kennzeichnete das abweichende Aufnahmeprofil und die anderen Trace-Kategorien
korrekt als unterschiedliche Messbedingungen. Es erfolgte kein Signifikanztest.

## Automatisierte Prüfungen der V1-Erstabnahme

- Core: 3819 Tests bestanden; zwei bestehende Fehler in `TrainMapEvent.test.ts`.
- Integration: 492 Tests bestanden, einschließlich Diagnose-Abschluss, World-Wechsel,
  Kamera während der verdeckten Vorbereitung und vollständigem Lobby-Reveal.
- Architecture: 35 Tests bestanden.
- Balance-Lab: 102 Tests bestanden; drei bestehende Fehler in
  `CoverageReportRegression.test.ts` und `GlockProgressionAndBurn.test.ts`.
- Öffentlicher Build erfolgreich; seine Source-Maps enthalten keine Performance-Lab-Module.
  Der Lab-Runner baut zusätzlich die Variante mit aktivierter Messkette und Source-Maps.

Alle fünf fehlgeschlagenen Tests wurden separat gegen einen unveränderten Export von Git-HEAD
erneut ausgeführt und schlugen dort identisch fehl. Die Zugtests erwarten veraltete Startwerte,
die Balance-Tests einen Glock-DPS-Wert von 13,4 statt der aktuell berechneten 20,1.
`npm run check` ist deshalb trotz bestandener Lab-Tests kein grünes Gesamt-Gate.
Die bestehenden Erwartungen und das Spiel-Tuning wurden für dieses Feature nicht geändert.

## Noch menschlich zu prüfen

Die abschließende Relevanzkalibrierung erfordert eine normal gespielte Vergleichsrunde.
Dabei prüfen, ob die im Lab auffälligen Mechaniken auch dort relevant sind und ob die
gewählten Gegnerbestände und Ziel-HP sinnvolle Untersuchungsfälle bilden. Die Szenarioversion
bleibt bis zu dieser Entscheidung ein ausdrücklich benannter Kandidat.
