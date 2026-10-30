# Grufttitan V1 – erster Boss als echter Koloss

Status: auf `main` (2026-10-30), HQ-Produktion `gt-v2-r3` mit Grab-Leuchtschicht (`emission-grave`) und
Schattenmesh `enemy-mesh-gt-v2-r3`; Playtest-Feedback 1 eingearbeitet. Maßgeblich ist der Code; Werte sind
Ausgangswerte für den Playtest.

## Ziel

Der erste Boss (Map 5) soll sofort wie ein heftiger Boss wirken, nicht wie ein großer Gegner:
deutlich größer, düster und böse, mit langsamen, tödlichen Nahkampfangriffen, einer angekündigten
Plasma-Salve und einem Intro, das zur Größe passt. Der Kraken (Map 20) bleibt als letzter Boss
sichtbar größer.

## Größe und Erscheinung

- Kollisionsradius 56 (`size` 112, Kraken 64); Leinwand 336 px bei 1:1-Export (Kraken 384/432 px).
- Getroffen wird er auf dem ganzen Körper mitsamt Beinen: Trefferkreis 1,85 × Körperradius
  (`hitRadiusFactor`), bewegt wird er weiter mit dem Körperkreis.
- Er dreht sich träge (`turnRateDegPerSec` 55) und beginnt den frontalen Schlag erst, wenn er ungefähr
  zum Ziel schaut.
- Ein Vierbeiner, dessen Rücken eine Gruft ist: großer Bogengrabstein mit grün leuchtendem
  Kreuzriss in der Mitte, je Flanke drei schräg liegende Grabsteine, Schultermonolithe, Geröll und
  Wirbelsteine. Alle Steine sind eingewachsen, Fleisch wölbt sich über ihre Kanten.
- Geschwärzter Schädel mit Stirnwülsten hinter grünen Augen, Fangzähnen, freiliegenden Rippen und
  Knochendornen. Dunkle Palette; nur Augen, Kreuzriss, Spalten und Laternenlöcher leuchten.
- Die Fußspuren liegen unter den echten Pranken (`pawSpan`, Hinterbeine enger) und zeigen einen eigenen,
  großen Prankenabdruck mit drei Zehen und Krallen, der als eingedrückte, am Rand leuchtende Spur liest.

## Nahkampf: langsam und tödlich

| Angriff | Wann | Ausholen | Wirkung |
|---|---|---|---|
| Stampfer | Spieler im Umkreis 300 (Vorrang vor dem Schlag) | 1,5 s | 360°, 400 Schaden |
| Prankenschlag | Bauwerke und Felsen, erst ab 150 Abstand (`structureReachPx`) | 1,3 s | 110°-Kegel bis 220, 400 Schaden, bricht Felsen, Basisdruck wie früher der Biss |

- Beide töten auch Spieler mit voller Rüstung und dürfen auch während der Plasma-Pause zuschlagen.
- Schlag: Aufrichten auf die Hinterbeine und Fallen mit Schwung wie ein Bär; Stampfer: Vorderkörper hoch und niederstampfen.
- Warnung: nur das übliche rote Gefahrenfeld. Der Schlag tritt bis auf Kopflänge an die Basis heran,
  sein Feld reicht sichtbar über den Kopf hinaus.
- Treffer: der Void-Dunst des Rabid Rabbit in Grablicht-Grün. Beim Stampfer läuft eine feine
  Dunst-Druckwelle vom Körperrand bis zum Rand der Reichweite, beim Schlag ein Dunstfächer von den
  Pranken in den Kegel; dazu feiner Staub an den Füßen, ein grüner Lichtstoß und schweres Kameraschütteln.
- Wucht: Halten der Aufprall-Pose, Körper wächst beim Aufrichten zur Kamera.

## Plasma: Grablichter als Munition

- Die Salve verhält sich wie zuvor (10 Schüsse, Takt, Homing, Schaden, 10 s Pause), bekommt aber
  eine Sammelphase von 1,6 s davor (`salvo.chargeMs`, replizierter Volley-Zustand).
- Es gibt nur eine Art Glühwürmchen: 30 normale umschwärmen ihn, je drei sind die Munition eines
  Schusses. In der Sammelphase ziehen sie sich zu einer Krone über dem Grab zusammen und beginnen
  sichtbar zu glühen; der Titan hebt den Kopf, die Spalten glühen auf.
- Jeder Schuss fliegt sichtbar aus seiner Gruppe und endet in einer Seelen-Verpuffung.
- In der Pause steigen die Glühwürmchen einzeln und wieder dunkel aus den Laternenlöchern.

## Intro „Friedhof erhebt sich“

- Größeres Gräberfeld (30 Grabsteine), Kamera-Zoom 1,15, längeres Halten.
- Der Titan gräbt sich vor dem Spawn sichtbar aus: Kopf und grabende Vorderpranken zuerst; die
  verlangsamten Frames werden weich ineinander geblendet.
- Die Intro-Glühwürmchen tauchen in ihn ein und kommen als Grablichter wieder heraus.
- Der Durchbruch brüllt mit grünem Bloom.

## Offen

Playtest (Gefühl, Fairness der tödlichen Treffer, Kampfdauer: HP 1800 → 2100 geschätzt, nicht
gemessen), Sounds (Platzhalter aus dem Bestand), Mehrspieler-Test des Volley-Zustands.
