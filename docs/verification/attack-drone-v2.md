# Angriffsdrohnenstation V2 – Abnahme und Messungen

Stand: 24.09.2026. Bezug: [GDD V2](../GDDs/Fragdachse_GDD_Angriffsdrohnenstation_v2.md).
Die GDD-Balancewerte wurden unverändert in `src/config/attackDrone.json` übernommen.
Die folgenden Messungen dokumentieren die Erstabnahme; die anschließende KI-Anpassung und ihre Nachprüfung stehen am Ende dieses Berichts.

## Umsetzung

- World-gebundene Host-Simulation mit einer Drohne je Station, getrennten Flug-/Geschützwinkeln, Magazin, Selbstlader, Stationsversorgung und Bombenlauf.
- Konstrukt- und Upgrade-Registries einschließlich beider Boss-Voraussetzungen, DE/EN-Texte, acht Icons und persistente Stationen. Laufzeitangriffe werden nicht gespeichert.
- Luftgeschosse im WorldProjectileRuntime; Bomben und Brandfolgen behalten ihre beim Angriff erfasste Attribution und Verstärkungen. Gemeinsame Auswahl offensiver Konstrukte für Fernsteuerung.
- Voll-/Dynamiksnapshots, Late Join, Resume, explizite Leerzustände und World-Revisionsschutz; Peer-Protokoll 22.
- Eigene Blender-Assets für Bodenstation, Quadrocopter und separat drehbares Geschütz; animierte Rotoren, Schatten, Besitzerfarbe, Versorgungssignal und begrenztes Schuss-/Explosionsaudio.
- Kurze E-Tastendrücke gehen bei der Bauplatzierung nicht mehr zwischen Frames verloren.

## Reproduzierbare Messmethode

`tests/balance-lab/AttackDroneBenchmark.test.ts` simuliert 60 Sekunden (0 einschließlich, 60.000 ms ausschließlich) in 25-ms-Schritten.
Drohne, Projektile, Kollision, stationäre Geschütze, Brandbrocken, Bodenbrand und Brandstapel verwenden Produktionsregeln.
Nur Physiktransport und neutrale, unsterbliche Empfänger werden durch bestehende Testadapter ersetzt.
Rüstung, Krit, HP-Rundung, Überkill und Missionsmodifikatoren sind ausgeschlossen: Die Werte sind **geometrieabhängiger Rohschaden pro Sekunde**, keine finalen HP-DPS im Spiel.

Der Besitzer steht bei (4016, 2000); Stationsdistanz liegt hinter ihm. Der Aufstellungsflug zählt zur Messzeit.
Standardgegner: Radius 12 px, Anfangsabstand 200 px. Große Gegner: Radius 32 px.
Bewegung: seitliche Sinusbewegung mit 80 px Amplitude und 2 rad/s (maximal 160 px/s).
200/400 px bezeichnen den Anfangsabstand; die Drohne verändert ihn im Angriff.
Dichte Gruppen haben 28 px Abstand, verteilte 95 px, Reihen 35 px.
Alle Schadenskanäle bleiben getrennt. Reisezeit enthält Anschluss- und Stationsrückflug; Bombenanflug zählt zur Angriffszeit.

`full` setzt alle Drohnenknoten auf Maximum. `post-boss` verwendet jeweils Stufe 1 in L1/L2/R1/R2 und den Bossknoten.
Varianten 0/1/2/3: keine Zusatzäste / BL1=3 / BR1=3 / beide=3.
Die vier MG-Vergleiche verwenden dieselbe Punktinvestition im entsprechenden MG-Baum und drei stationäre MGs bei 30 Kapazität.
Attrition und Blutung verwenden MgAttritionRuntime. Die unsterblichen Ziele lösen keine Todesübertragung aus; MG-BR1 wird in diesem Aufbau daher bewusst nicht ausgeschöpft.
Der Raketenturm ist eine Grundvergleichsgröße, kein behaupteter gleich teurer Post-Boss-Ausbau.

Maschinenlesbare Werte: [attack-drone-v2-measurements.json](attack-drone-v2-measurements.json).

| Szenario | Roh-DPS | Geschütz | Bomben/Referenzexplosion | Brockenlandung | Brand | MG-Blutung | Reise s | Versorgung s | Zyklen |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| base-station-400 | 12.79 | 767.20 | 0.00 | 0.00 | 0.00 | 0.00 | 2.65 | 7.50 | 3 |
| base-station-800 | 11.81 | 708.40 | 0.00 | 0.00 | 0.00 | 0.00 | 6.60 | 7.50 | 3 |
| rocket-reference | 15.41 | 186.00 | 738.78 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| three-mg-reference | 21.73 | 1304.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| single-r12-d200-static | 14.70 | 882.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.63 | 7.50 | 3 |
| single-r12-d200-moving | 9.38 | 562.80 | 0.00 | 0.00 | 0.00 | 0.00 | 0.63 | 7.50 | 3 |
| single-r12-d400-static | 13.67 | 820.40 | 0.00 | 0.00 | 0.00 | 0.00 | 1.05 | 7.50 | 3 |
| single-r12-d400-moving | 8.14 | 488.60 | 0.00 | 0.00 | 0.00 | 0.00 | 1.05 | 7.50 | 3 |
| single-r32-d200-static | 15.40 | 924.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.63 | 7.50 | 3 |
| single-r32-d200-moving | 14.98 | 898.80 | 0.00 | 0.00 | 0.00 | 0.00 | 0.63 | 7.50 | 3 |
| single-r32-d400-static | 15.33 | 919.80 | 0.00 | 0.00 | 0.00 | 0.00 | 1.05 | 7.50 | 3 |
| single-r32-d400-moving | 14.23 | 854.00 | 0.00 | 0.00 | 0.00 | 0.00 | 1.05 | 7.50 | 3 |
| full-2-dense | 15.80 | 947.80 | 0.00 | 0.00 | 0.00 | 0.00 | 0.53 | 3.00 | 3 |
| full-2-spread | 14.79 | 887.60 | 0.00 | 0.00 | 0.00 | 0.00 | 0.53 | 3.00 | 3 |
| full-2-line | 15.98 | 959.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.53 | 3.00 | 3 |
| full-4-dense | 31.79 | 1510.60 | 217.69 | 63.84 | 115.20 | 0.00 | 0.97 | 3.00 | 3 |
| full-4-spread | 23.46 | 1083.60 | 191.58 | 46.01 | 86.40 | 0.00 | 2.30 | 3.00 | 3 |
| full-4-line | 29.60 | 1393.00 | 232.07 | 59.93 | 91.20 | 0.00 | 1.23 | 3.00 | 3 |
| full-8-dense | 56.27 | 2612.40 | 426.83 | 130.32 | 206.40 | 0.00 | 1.35 | 3.00 | 3 |
| full-8-spread | 39.09 | 1736.00 | 367.17 | 88.47 | 153.60 | 0.00 | 1.25 | 3.00 | 3 |
| full-8-line | 43.78 | 1932.00 | 386.35 | 116.27 | 192.00 | 0.00 | 1.85 | 3.00 | 3 |
| supply-800-L1-0 | 11.81 | 708.40 | 0.00 | 0.00 | 0.00 | 0.00 | 6.60 | 7.50 | 3 |
| supply-800-L1-1 | 11.81 | 708.40 | 0.00 | 0.00 | 0.00 | 0.00 | 6.60 | 7.50 | 3 |
| supply-800-L1-2 | 11.81 | 708.40 | 0.00 | 0.00 | 0.00 | 0.00 | 6.60 | 7.50 | 3 |
| supply-800-L1-3 | 11.81 | 708.40 | 0.00 | 0.00 | 0.00 | 0.00 | 6.60 | 7.50 | 3 |
| supply-2400-L1-0 | 9.80 | 588.00 | 0.00 | 0.00 | 0.00 | 0.00 | 16.10 | 5.00 | 2 |
| supply-2400-L1-1 | 9.80 | 588.00 | 0.00 | 0.00 | 0.00 | 0.00 | 16.10 | 5.00 | 2 |
| supply-2400-L1-2 | 6.81 | 408.80 | 0.00 | 0.00 | 0.00 | 0.00 | 3.00 | 0.00 | 0 |
| supply-2400-L1-3 | 8.05 | 483.00 | 0.00 | 0.00 | 0.00 | 0.00 | 3.00 | 0.00 | 0 |
| post-boss-0 | 31.41 | 1687.00 | 197.42 | 0.00 | 0.00 | 0.00 | 1.48 | 6.00 | 3 |
| post-boss-1 | 35.29 | 1687.00 | 430.48 | 0.00 | 0.00 | 0.00 | 1.48 | 6.00 | 3 |
| post-boss-2 | 33.10 | 1687.00 | 197.42 | 39.28 | 62.40 | 0.00 | 1.48 | 6.00 | 3 |
| post-boss-3 | 40.92 | 1687.00 | 430.48 | 131.54 | 206.40 | 0.00 | 1.48 | 6.00 | 3 |
| three-mg-post-boss-0 | 44.57 | 2674.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| three-mg-post-boss-1 | 49.61 | 2674.00 | 0.00 | 0.00 | 0.00 | 302.63 | 0.00 | 0.00 | 0 |
| three-mg-post-boss-2 | 44.57 | 2674.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| three-mg-post-boss-3 | 49.61 | 2674.00 | 0.00 | 0.00 | 0.00 | 302.63 | 0.00 | 0.00 | 0 |

## Einordnung ohne Retuning

- Grunddrohne: 12,79 bei 400 px und 11,81 bei 800 px Stationsdistanz; Raketenturm 15,41, drei MGs 21,73. Die mobile Drohne ersetzt damit die ideale stationäre Verteidigung nicht.
- Kleine bewegliche Ziele reduzieren die Trefferquote deutlich stärker als große Ziele. Zunächst Fächer und Nachführung im echten Spiel bewerten; ein Schadensanstieg wäre erst die zweite Maßnahme.
- 2.400 px Stationsdistanz: L1/2 und L1/3 können in diesem 60-s-Aufbau schlechter abschneiden als L1/0. Die verbindliche 12-s-Prognose entscheidet lokal sinnvoll, maximiert aber nicht zwangsläufig den gesamten 60-s-Schaden. Empfehlung: vor einem Balanceentscheid zusätzliche Besitzerbewegung und längere Messfenster vergleichen; weder Prognosehorizont noch Regeneration wurden geändert.
- Vollausbau gegen acht dichte Ziele: 56,27 Roh-DPS. Bei vergleichbarer Punktinvestition erreichen Post-Boss-Drohne und MG-Ausbau unterschiedliche Rollen; MG-Todesübertragungen benötigen einen gesonderten sterblichen Gruppenaufbau.
- Der Geschützflug wurde nach gemessenen Fehlschüssen als kurzer radialer Anflug zum Ziel gestaltet. Ein voller seitlicher Lauf hatte die begrenzte Geschütznachführung überholt. Geschoss-, Flug-, Fächer- und Nachführungswerte bleiben unverändert.

## Automatisierte Prüfung

- `npm run check`: 4.299 Core-Tests und 54 Architekturtests bestanden; Spiel- und Map-Editor-Build bestanden.
- `npm run test:integration`: 601 Tests bestanden, einschließlich echtem FakeNetwork-Handshake, Late Join, Resume und erneut zugestelltem altem World-Snapshot.
- `npm run test:assets`: 108 Tests bestanden.
- `npm run test:balance-lab -- --maxWorkers=2`: 108 Tests bestanden. Zwei Worker vermeiden den bei gleichzeitiger Volllast beobachteten 5-s-Timeout einer fremden WeaponProgression-Prüfung.
- Drohnen-Stress: 3/36/48 Stationen bestanden, entsprechend einem Besitzer mit drei bzw. zwölf Besitzern mit drei/vier Stationen. 241 gemeinsame Zielsicht-Aktualisierungen über 60 s; eindeutige Drohnen-/Bombenidentitäten und vollständige Entfernung geprüft.
- Zusätzliche Grenzfälle: Teilmagazin ohne Einzelschuss-Tröpfeln, gebundener Rückflug trotz Regenerationsänderung, verschobene Rückflugstation und Bombenaufschub bei ungefähr 0,8 statt 1,2 s Rest-Cooldown (mit regulärer 250-ms-Zielbewertung). Minimale Regeneration verdrängt den gewählten Bombenangriff nicht.
- Gesamte Stress-Suite: 83 bestanden, 6 opt-in übersprungen, **1 bestehender Fehler** in `NavigationSpawns.test.ts`: Map 7, Seed 731, Encounter medic-3, 74 statt 77 Gegner.
  Derselbe Fehler wurde separat aus dem unveränderten Git-Stand `dd73d6a33a7043515d798c643b4e6e92e9470cb1` reproduziert. Die Navigation wurde für dieses Feature nicht verändert.
- Der Drohnen-Stresstest misst Simulation und Snapshotkodierung, keine 12 realen Browser/GPU-Instanzen und keinen vollständigen WebRTC-Durchsatz.

## Asset-Nachweis

Rezept: `scripts/asset-pipeline/recipes_v2/attack-drone.py`; Lauf `v2-attack-drone-a`.
Drei exportierte, geprüfte und importierte Assets; transparente RGBA-Ausgabe, orthografische 90°-Kamera und matte gemeinsame Materialien.
Quellarchive und Prüfberichte liegen im bestehenden, ignorierten Asset-Arbeitsbereich:
`art/poc/pipeline-v2/`.
Die archivierte Body-Quelldatei wurde unabhängig aus `source-bundle.zip` entpackt, in Blender 5.2 wieder geöffnet und erneut gerendert:
`art/poc/pipeline-v2/verification/v2-attack-drone-a/archive-reopened.json`.
Das Runtime-Manifest und die exportierten Spielsprites sind Bestandteil der Änderung.

## Browserprüfung

Sichtbarer In-App-Browser unter `http://127.0.0.1:8090/`, gestartet mit `npm run dev:browser`.
Geprüft: eigene Modelle im Asset-Viewer auf hellen/dunklen Untergründen, Rotoranimation, unabhängige Drehung, Upgradebaum, Freischaltung und Toolauswahl sowie drei gleichzeitig platzierte Stationen mit 90/100 Kapazität in Übungsplatz und Testkarte.
In der Kampfszene wurden Geschützfeuer, getrennte Flug-/Geschützausrichtung, Explosionen und nachfolgende Brandflächen beobachtet. Eine temporäre Testwelle wurde von acht auf 32 Zombies je 25 s erhöht, um Gruppenangriffe auszulösen. Die Ergänzung ist vollständig entfernt; `00-test.json` entspricht wieder dem Ausgangsstand.

Die sehr dichte, über mehrere Minuten angesammelte Gegnergruppe erreichte die vorhandenen dekorativen Poolgrenzen `gore-normal` (4.096) und `entity-burn` (2.048). Der Browser protokollierte verworfene Partikel, keine Laufzeitfehler. Die bereits vorhandenen Poolgrenzen wurden nicht erhöht. Die Trennung von Darstellung und autoritativen Angriffen bleibt erhalten.

Die temporäre Drohneninvestition wurde über die reguläre Kategorie-Rückerstattung entfernt. Inspector-Werkzeuge Raketenturm/HE/Translocator sowie die ursprünglich aktive Klasse Dachs Nukem mit Glock/P90/HE/Armageddon sind wiederhergestellt. Debug-Fortschritt steht wieder auf 20.000 XP, einem Bosspunkt und Map 1; vorhandene fremde Upgrades wurden nicht zurückgesetzt.

Zusätzlich wurden zwei reale Browserclients über den regulären Einladungslink verbunden. Auf dem gemeinsamen Übungsplatz platzierten beide Besitzer eigene Stationen; ein Besitzer ergänzte eine zweite Station. Alle drei Drohnen erschienen in beiden Ansichten. Besitzerfarbe, getrennte Flugbewegung sowie Rückkehr und Andocken beim Wechsel eines Besitzers in die Lobby wurden geprüft, während die Drohne des verbleibenden Besitzers weiterflog. Der zweite Client meldete keine Warnungen oder Laufzeitfehler. Das Versorgungspulsieren ist auf die Ladephase begrenzt; dauerhaft wartende Drohnen pulsieren nicht weiter. Farben und diese Phasengrenze sind zusätzlich durch einen Renderertest abgesichert.

Grenzen der Sichtabnahme: Die vollständige 12-Spieler-Last wurde simuliert, nicht mit zwölf sichtbaren Browsern geprüft. Die Kampfprüfung und der isolierte Andockvergleich ergänzen die automatisierte Versorgungskontrolle; eine manuelle Stoppuhrmessung der 1,0–2,5 Sekunden erfolgte nicht.

## Nachprüfung: Zielsuche, Bombenkoordination und linker Bildrand

24.09.2026, Anpassung auf Spielerfeedback:

- Die Zielerfassung umfasst 800 px um die Drohne sowie Bedrohungen innerhalb von 600 px um die letzte lebende Besitzerposition. Ohne direkt erreichbares Geschützziel fliegt die Drohne ein erreichbares Ziel gezielt an; Besitzerbedrohungen haben dabei Vorrang. Waffenreichweite, Schussregeln und Fluggrenzen bleiben erhalten. Die gemeinsame räumliche Zielsicht wird weiterhin höchstens alle 250 ms aktualisiert.
- Pro Besitzer ist ein Bombeneinsatz einschließlich Anflug, Teppich und Einschlagsauswertung aktiv. Nach dem letzten Einschlag folgen 500 ms zur Neubewertung (mindestens bis zur Brandbrockenlandung). Weitere Drohnen verwenden währenddessen ihr Geschütz. Erst im folgenden World-Update wird die Reservierung freigegeben, damit auch nach großen Zeitschritten die Treffer bereits verarbeitet sind. Abgeworfene Bomben halten die Reservierung nach Stationsentfernung; ein abgebrochener Anflug ohne Abwurf gibt sie frei. Andere Besitzer sind unabhängig.
- Die Drohnendarstellung verwendet `getVisibleWorldView()` statt Phasers um eine zentrierte Kamera berechnetem `worldView`. Das verhindert falsches Ausblenden am linken/oberen Bildrand bei veränderter Renderauflösung.

Prüfung: `npm run check` mit 4.312 Core-Tests, 54 Architekturtests und beiden Builds bestanden. Die gezielten Drohnen-, Renderer- und World-Binding-Tests bestehen (37 Tests). Zusätzlich bestehen die Drohnen-Netzwerk-, Stress- und Balance-Lab-Suites (6 Tests, 37 Messszenarien); der Lasttest umfasst 3/36/48 voll ausgebaute Stationen und weiterhin 241 gemeinsame Zielsicht-Aktualisierungen in 60 s. Neue Regressionstests schützen Anflug von hinter dem Spieler, unveränderte Waffenreichweite, überlebende/entfallene Bombenziele, mehrere Besitzer, Stationsentfernung, Activity-Teardown, große World-Zeitschritte sowie Sichtbarkeit und Wiedereinblenden bei Renderfaktoren 0,5/1/2.

Im unveränderten 60-s-Messaufbau steigt der Rohschaden einer Grunddrohne bei 400/800 px Stationsdistanz von 12,79/11,81 auf 13,51/12,23 DPS durch die bessere Zielaufnahme. Die voll ausgebauten Acht-Ziel-Szenarien `dense` und `spread` bleiben bei 56,27 bzw. 39,09 DPS. Diese Einzelstationsmessung quantifiziert keine Überkill-Ersparnis; diese wird durch die Mehrstations-Verhaltenstests mit beim Einschlag entfallenden Zielen geprüft.

Browsernachprüfung auf Port 8090: Zwei Stationen im Übungsplatz platziert; beide Drohnen bei 3840×2160 sichtbar, ausdrücklich auch links der früheren falschen Ausblendgrenze. Die tatsächliche Canvas-Auflösung wurde über das DOM geprüft; keine Browser-Laufzeitfehler. Die automatisierten Kamera-Grenztests ergänzen diese Sichtprüfung. Temporäre Testfreischaltung und Werkzeugauswahl wurden über die vorhandene UI zurückgesetzt; Browsergröße zurückgesetzt und Testtab geschlossen.

## Nachprüfung: Kampfbewegung während und zwischen Salven

24.09.2026, weitere Anpassung auf Spielerfeedback:

- Während der Feuerpause hält die Drohne ein erreichbares Ziel im Blick. Eine begrenzte Winkelbewertung im vorhandenen 250-ms-Takt bevorzugt Positionen, von denen mehr Gegner in den Geschützfächer passen. Flugstrecke, verbleibende Pausenzeit, Abstand zum Ziel und Besitzer-/Weltgrenzen fließen ein. Ohne erreichbare Feuerposition bleibt der gezielte Anflug aktiv. Zufällige Patrouillenpunkte werden bei bestehendem Kampfziel nicht verwendet.
- Während einer Salve korrigiert die Drohne ihren Abstand zum aktuellen Ziel und kann seitlich weiterfliegen. Die Grundrate ist über `combatStrafeDegreesPerSecond` konfigurierbar; Flug-Upgrades wirken innerhalb des Geschütz-Drehbudgets. Bei nachlaufendem Geschütz oder Verlust einer bereits erfassten Gruppe aus dem Fächer wird die seitliche Bewegung reduziert bzw. ausgesetzt. Der Mündungspunkt wird aus der bewegten Flugposition und der unabhängig nachgeführten Geschützausrichtung berechnet. Die Zielgruppe bleibt während der Salve gebunden.
- Geschützflug bleibt innerhalb des Besitzerbereichs, damit am Ende der Salve kein unnötiger Anschlussflug entsteht. Bombenanflüge und Versorgungsentscheidungen behalten ihren Vorrang. Schussanzahl, Salvendauer, Feuerpause, Schaden, Regeneration und Bombenregeln bleiben unverändert. Die vorhandenen Positions-/Winkelsnapshots übertragen auch diese Flugbewegung; zusätzliche Netzwerkzustände sind nicht erforderlich.

Automatisierte Prüfung: 44 gezielte Drohnen-/Renderer-/World-Binding-Tests bestanden. Neue Regressionen schützen späte Bewegung innerhalb der Salve, tatsächliche Mündungspositionen und Trefferwinkel bei Grund-/Ausbaugeschwindigkeit, gezielten Anflug in der Feuerpause, bessere Gruppenwinkel, Pausenfrist, Besitzerabstand und Weltgrenzen. Netzwerk-, Stress- und Balance-Lab-Suites bestehen mit 6 Tests und 37 Messszenarien. Der Lasttest mit 3/36/48 Stationen bleibt bei 241 gemeinsamen Zielsicht-Aktualisierungen in 60 s. `npm run check` besteht mit 4.321 Core-Tests, 54 Architekturtests sowie Spiel- und Map-Editor-Build.

Roh-DPS im selben 60-s-Messaufbau, unmittelbar vor und nach dieser Bewegungsänderung:

| Szenario | Vorher | Nachher |
|---|---:|---:|
| Grunddrohne, Station 400 px entfernt | 13,51 | 13,67 |
| Grunddrohne, Station 800 px entfernt | 12,23 | 12,79 |
| Bewegliches Einzelziel, Radius 12 px, Distanz 200 px | 9,64 | 10,87 |
| Bewegliches Einzelziel, Radius 12 px, Distanz 400 px | 8,26 | 10,62 |
| Vollausbau, acht dichte Ziele | 56,27 | 53,87 |
| Vollausbau, acht verteilte Ziele | 39,09 | 48,16 |
| Vollausbau, acht Ziele in einer Linie | 43,78 | 38,21 |

Die neue Positionierung verbessert insbesondere bewegliche Einzelziele und verteilte Gruppen. Bei kollinearen Zielen verliert die dynamische Flugbahn einen Teil der früheren idealen Durchschusslinie. Falls die Sicht-/Spielprüfung hier eine Korrektur nahelegt, wäre eine stärkere Gewichtung überlappender Trefferflächen bei der Winkelwahl gezielter als eine pauschale Schadensanhebung. Es erfolgte kein Schadens-Retuning. Vollständige Mess- und Prüfprotokolle liegen lokal unter `build/attack-drone-verification/combat-flight-special.log` und `combat-flight-check.log`.

Auf ausdrücklichen Wunsch wurde für diese Bewegungsänderung **keine Browserprüfung** durchgeführt. Die Sichtabnahme übernimmt der Benutzer; frühere Browsernachweise weiter oben gelten nicht als Abnahme dieser Flugbewegungen.

## Nachprüfung: Abstandshaltung, Beschleunigung und ruhiger Rumpf

24.09.2026, weitere Anpassung auf Spielerfeedback:

- Eine gemeinsame räumliche Nachbarsicht erfasst fliegende Drohnen aller Besitzer pro Simulationsschritt. Bei der Positionswahl werden bereits belegte und von Nachbarn geplante Feuerpositionen weniger attraktiv. Zusätzlich wirkt innerhalb des konfigurierten Abstands eine begrenzte Ausweichgeschwindigkeit. Auch exakt übereinander gestartete Drohnen erhalten reproduzierbare, unterschiedliche Ausweichrichtungen. Es gibt keine Kollisionskörper, Positionskorrekturen zwischen Drohnen oder garantierte Mindestdistanz; kurzzeitige Überlagerungen bleiben möglich.
- Jede Drohne besitzt eine Laufzeitgeschwindigkeit. Beschleunigung, Bremsung und weiches Ankommen ersetzen sofortige Geschwindigkeitswechsel. Eine Richtungsumkehr baut vorhandenen Schwung zunächst ab. Andocken und Activity-Teardown löschen die Geschwindigkeit. Weltgrenzen werden weiterhin eingehalten; die vorhandenen Netzwerksnapshots übertragen Position und Winkel ohne neue Protokollfelder.
- Der Rumpf folgt der tatsächlich zurückgelegten Bewegung mit begrenzter Drehrate. Sehr langsame Korrekturen, numerisches Zittern, blockierte Bewegung an der Weltgrenze und Updates ohne Zeitfortschritt ändern die Rumpfausrichtung nicht. Das Geschütz bleibt unabhängig davon nachgeführt.
- Nahe dem Andockpunkt und dem Beginn eines Bombenkorridors wird das Ausweichen ausgeblendet. Begonnene Bombenläufe behalten ihre feste Linie. Abwurfzeitpunkte werden aus dem tatsächlichen Streckenfortschritt des Simulationsschritts interpoliert, damit Beschleunigung und Bremsung die Bombenanzahl und Teppichgeometrie nicht verändern.

Neue Startwerte stehen in `src/config/attackDrone.json`: Beschleunigung 1.400 px/s², Bremsung 2.200 px/s², Anflugreaktion 180 ms, Rumpfdrehung höchstens 180°/s, Halten der Ausrichtung unter 12 px/s, weicher Abstand 64 px und maximaler Ausweichbeitrag 120 px/s. Waffen-, Salven- und Schadenswerte wurden nicht geändert.

Prüfung: 54 gezielte Flug-, Drohnen-, World-Binding- und Renderer-Tests bestanden. Neue Regressionen schützen Beschleunigung/Bremsung, Richtungsumkehr, ruhige Ausrichtung, räumliche Nachbarsicht, exakt überlagerte Starts, verschiedene Besitzer, belegte Feuerpositionen, Andocken trotz Überlagerung und korrekte Bombenzeitpunkte. Netzwerk-, Stress- und Balance-Lab-Suites bestehen mit 6 Tests und 37 Messszenarien. Der Lasttest umfasst weiterhin 3/36/48 Stationen und 241 gemeinsame Zielsicht-Aktualisierungen in 60 s. `npm run check` besteht mit 4.331 Core-Tests, 54 Architekturtests sowie Spiel- und Map-Editor-Build. `git diff --check` ist sauber.

Das Anfahren und Abbremsen verlängert Flugmanöver und verändert damit die Einsatzzeiten. Im bisherigen Einzelstations-Benchmark ergibt sich folgende Roh-DPS-Änderung gegenüber der unmittelbar vorherigen Kampfbewegung:

| Szenario | Vorher | Nachher |
|---|---:|---:|
| Grunddrohne, Station 400 px entfernt | 13,67 | 12,83 |
| Grunddrohne, Station 800 px entfernt | 12,79 | 12,25 |
| Bewegliches Einzelziel, Radius 12 px, Distanz 200 px | 10,87 | 10,08 |
| Vollausbau, acht dichte Ziele | 53,87 | 48,16 |
| Vollausbau, acht verteilte Ziele | 48,16 | 36,59 |
| Vollausbau, acht Ziele in einer Linie | 38,21 | 39,94 |

Die Abstandshaltung selbst wird durch Mehrdrohnen-Verhaltenstests geprüft; die DPS-Tabelle bildet weiterhin eine einzelne Station ab. Falls die längeren Manöver im Spiel zu träge wirken, sollten zuerst Anflugreaktion und Beschleunigungs-/Bremswerte beurteilt werden. Eine pauschale Schadensanhebung wurde nicht vorgenommen. Lokale Protokolle: `build/attack-drone-verification/flight-spacing-special.log` und `flight-spacing-check.log`.

Weiterhin **keine Browserprüfung**; die manuelle Sichtabnahme übernimmt der Benutzer.
