# Angriffsdrohnenstation V2 – Abnahme und Messungen

Stand: 24.09.2026. Bezug: [GDD V2](../GDDs/Fragdachse_GDD_Angriffsdrohnenstation_v2.md).
Die GDD-Balancewerte wurden unverändert in `src/config/attackDrone.json` übernommen.

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
