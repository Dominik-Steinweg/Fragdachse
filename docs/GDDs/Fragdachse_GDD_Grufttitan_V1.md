# Grufttitan V1 – erster Boss als echter Koloss

Status: umgesetzt im Branch `grave-titan` (2026-10-29/30), HQ-Produktion `gt-v2-r2` mit Grab-Leuchtschicht
(`emission-grave`) und Schattenmesh `enemy-mesh-gt-v2-r2`. Maßgeblich ist der Code; Werte sind Ausgangswerte für
den Playtest.

## Ziel

Der erste Boss (Map 5) soll sofort wie ein heftiger Boss wirken, nicht wie ein großer Gegner:
deutlich größer, düster und böse, mit langsamen, tödlichen Nahkampfangriffen, einer angekündigten
Plasma-Salve und einem Intro, das zur Größe passt. Der Kraken (Map 20) bleibt als letzter Boss
sichtbar größer.

## Größe und Erscheinung

- Kollisionsradius 56 (`size` 112, Kraken 64); Leinwand 336 px bei 1:1-Export (Kraken 384/432 px).
- Ein Vierbeiner, dessen Rücken eine Gruft ist: großer Bogengrabstein mit grün leuchtendem
  Kreuzriss in der Mitte, je Flanke drei schräg liegende Grabsteine, Schultermonolithe, Geröll und
  Wirbelsteine. Alle Steine sind eingewachsen, Fleisch wölbt sich über ihre Kanten.
- Geschwärzter Schädel mit Stirnwülsten hinter grünen Augen, Fangzähnen, freiliegenden Rippen und
  Knochendornen. Dunkle Palette; nur Augen, Kreuzriss, Spalten und Laternenlöcher leuchten.
- Die Fußspuren liegen unter den echten Pranken (`pawSpan`).

## Nahkampf: langsam und tödlich

| Angriff | Wann | Ausholen | Wirkung |
|---|---|---|---|
| Stampfer | Spieler dicht am Körper (Reichweite 150) | 1,1 s | 360°, 400 Schaden |
| Prankenschlag | Ziel auf Reichweite 230 | 1,3 s | 110°-Kegel, 400 Schaden, bricht Felsen, Basisdruck wie früher der Biss |

- Beide töten auch Spieler mit voller Rüstung und dürfen auch während der Plasma-Pause zuschlagen.
- Schlag: Aufrichten auf die Hinterbeine und Fallen mit Schwung wie ein Bär; Stampfer: Vorderkörper hoch und niederstampfen.
- Warnung: rotes Gefahrenfeld; zusätzlich kriechen während des Ausholens glimmende Haarrisse durch
  die Trefferzone. Beim Treffer zünden sie, reißen auf und vernarben (Fächer bzw. Stern).
- Wucht: Halten der Aufprall-Pose, Körper wächst beim Aufrichten zur Kamera, Staubring,
  Lichtstoß, Druckwelle, schweres Kameraschütteln.

## Plasma: Grablichter als Munition

- Die Salve verhält sich wie zuvor (10 Schüsse, Takt, Homing, Schaden, 10 s Pause), bekommt aber
  eine Sammelphase von 0,8 s davor (`salvo.chargeMs`, replizierter Volley-Zustand).
- Zehn Grablichter kreisen über dem Rücken. In der Sammelphase ziehen sie sich zu einer Krone über
  dem Grab zusammen, der Titan hebt den Kopf und die Spalten glühen auf.
- Jeder Schuss fliegt sichtbar aus einem Grablicht und endet in einer Seelen-Verpuffung.
- In der Pause steigen die Lichter einzeln wieder aus den Laternenlöchern.

## Intro „Friedhof erhebt sich“

- Größeres Gräberfeld (30 Grabsteine), Kamera-Zoom 1,15, längeres Halten.
- Der Titan gräbt sich vor dem Spawn sichtbar aus: Kopf und grabende Vorderpranken zuerst.
- Die Intro-Glühwürmchen tauchen in ihn ein und kommen als Grablichter wieder heraus.
- Der Durchbruch brüllt mit grünem Bloom.

## Offen

Playtest (Gefühl, Fairness der tödlichen Treffer, Kampfdauer: HP 1800 → 2100 geschätzt, nicht
gemessen), Sounds (Platzhalter aus dem Bestand), Mehrspieler-Test des Volley-Zustands.
