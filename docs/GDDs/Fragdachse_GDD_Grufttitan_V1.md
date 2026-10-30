# Grufttitan V1 – erster Boss als echter Koloss

Status: auf `main` (2026-10-30), HQ-Produktion `gt-v2-r3` mit Grab-Leuchtschicht (`emission-grave`) und
Schattenmesh `enemy-mesh-gt-v2-r3`; Playtest-Feedback 1 und 2 eingearbeitet. Maßgeblich ist der Code; Werte sind
Ausgangswerte für den Playtest.

## Ziel

Der erste Boss (Map 5) soll sofort wie ein heftiger Boss wirken, nicht wie ein großer Gegner:
deutlich größer, düster und böse, mit langsamen, tödlichen Nahkampfangriffen, einer angekündigten
Plasma-Salve und einem Intro, das zur Größe passt. Der Kraken (Map 20) bleibt als letzter Boss
sichtbar größer.

## Größe und Erscheinung

- `size` 112 (Kraken 64) bestimmt die Darstellung: Leinwand 336 px bei 1:1-Export (Kraken 384/432 px).
- Der Körper umfasst die Beine: `bodyRadiusFactor` 1,75 ergibt einen Körperradius von 98. Felsen,
  Bäume und Basen halten ihn auf, die Wegfindung hält diesen Abstand, andere Gegner weichen ihm aus,
  und Treffer zählen auf dem ganzen Körper. Spieler laufen wie bei allen Gegnern hindurch: Ihre
  Bewegung wird lokal vorhergesagt, ein Wegschieben durch den Host würde sie ruckeln lassen. Die Regel
  gilt für jeden Boss, dessen Gliedmaßen über `size` hinausreichen.
- Er dreht sich träge (`turnRateDegPerSec` 72) und beginnt den frontalen Schlag erst, wenn er sich bis
  zum Treffer zum Ziel drehen kann.
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
| Stampfer | Spieler im Umkreis 400 und Basen ab 210 Abstand (`structureReachPx`), Vorrang vor dem Schlag | 1,5 s | 360° bis 400, 400 Schaden auch an Basen, 3 s Cooldown |
| Prankenschlag | Spieler im Kegel, Bauwerke und Felsen ab 210 Abstand | 1,3 s | 110°-Kegel bis 280, 200 Schaden, bricht Felsen, 35 % an Basen |

- Der Stampfer tötet auch Spieler mit voller Rüstung; beide dürfen auch während der Plasma-Pause
  zuschlagen. Ein Rundumschlag reagiert auch während der Belagerung auf jeden in seiner Reichweite.
- Bauwerke: Die Navigation tritt 40 px näher heran als die Angriffe brauchen, soweit Mauern es zulassen.
- Schlag: Aufrichten auf die Hinterbeine und Fallen mit Schwung wie ein Bär; Stampfer: Vorderkörper hoch und niederstampfen.
- Warnung in der roten Gefahrenfamilie, deckungsgleich mit Trefferzone und Dunst: beim Schlag der
  scharf umrandete Fächer (wie beim Alien-Kegel), beim Stampfer eine Rundzone, die sich bis zum Treffer
  von innen bis zum Rand füllt.
- Treffer: der Void-Dunst des Rabid Rabbit in Grablicht-Grün. Beim Stampfer läuft eine feine
  Dunst-Druckwelle vom Körperrand bis zum Rand der Zone. Beim Schlag quillt eine dichte Wolke an den
  Pranken auf, und ein Dunstfächer rollt bis zum Rand des Kegels, ohne über dessen Flanken zu reichen.
  Dazu Staub an den Füßen, grüner Lichtstoß, Bildschirm-Druckwelle und schweres Kameraschütteln.
- Wucht: Halten der Aufprall-Pose, Körper wächst beim Aufrichten zur Kamera.

## Plasma: Grablichter als Munition

- Die Salve verhält sich wie zuvor (10 Schüsse, Takt, Homing, Schaden, 10 s Pause), bekommt aber
  eine Sammelphase von 1,6 s davor (`salvo.chargeMs`, replizierter Volley-Zustand).
- Die Sammelphase hält den Körper nicht fest: Er läuft mit halbem Tempo weiter und schlägt zu, was in
  Reichweite ist; die Salve startet trotzdem pünktlich.
- Es gibt nur eine Art Glühwürmchen: 30 normale umschwärmen ihn, jedes mit eigener Trägheit, je drei
  sind die Munition eines Schusses.
- Sammelphase als filmischer Ablauf: Grabdunst strömt in die Krone, die Glühwürmchen fliegen ein und
  glühen auf, dann verschmelzen je drei zu einer Kugel, die fließend auf die Größe des Schusses
  anschwillt. Die zehn Kugeln kreisen pulsierend unter einer grünen Aura; der Titan hebt den Kopf,
  die Spalten glühen auf.
- Jeder Schuss ist seine Kugel, die die Krone verlässt, und endet in einer Seelen-Verpuffung.
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
