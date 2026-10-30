# Grufttitan V1 – erster Boss als echter Koloss

Status: auf `main` (2026-10-30), HQ-Produktion `gt-v2-r3` mit Grab-Leuchtschicht (`emission-grave`) und
Schattenmesh `enemy-mesh-gt-v2-r3`; Playtest-Feedback 1 bis 4 eingearbeitet. Maßgeblich ist der Code; Werte sind
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
  und Treffer zählen auf dem ganzen Körper. Andere Gegner halten zusätzlich einen persönlichen Abstand
  von einem halben Körperradius, weichen ihm stärker aus und lassen ihm immer den Vortritt. Spieler laufen wie bei allen Gegnern hindurch: Ihre
  Bewegung wird lokal vorhergesagt, ein Wegschieben durch den Host würde sie ruckeln lassen. Die Regel
  gilt für jeden Boss, dessen Gliedmaßen über `size` hinausreichen.
- Er dreht sich träge (`turnRateDegPerSec` 72) und beginnt den frontalen Schlag gegen ein Bauwerk erst,
  wenn er sich bis zum Treffer zum Ziel drehen kann.
- Er marschiert stur zum Vorposten bzw. zur Basis; Spieler lenken ihn kaum ab: Salve und Stampfer
  drehen ihn nie, ein abkühlender Stampfer hält ihn nicht an, und für Spieler dreht er sich nicht
  zum Schlag.
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
| Stampfer | Spieler im Umkreis 360 und Basen ab 210 Abstand (`structureReachPx`), Vorrang vor dem Schlag | 1,5 s | 360° bis 360, 200 Schaden auch an Basen, 6 s Cooldown |
| Prankenschlag | Spieler nur, wenn sie schon im Kegel stehen (`turnsOnlyForStructures`); Bauwerke und Felsen ab 210 Abstand | 1,3 s | 110°-Kegel bis 280, 100 Schaden auch an Basen, bricht Felsen |

- Beide dürfen auch während der Plasma-Pause zuschlagen. Ein Rundumschlag reagiert auch während der
  Belagerung auf jeden in seiner Reichweite.
- Bauwerke: Die Navigation tritt 40 px näher heran als die Angriffe brauchen, soweit Mauern es zulassen.
- Schlag: Aufrichten auf die Hinterbeine und Fallen mit Schwung wie ein Bär; Stampfer: Vorderkörper hoch und niederstampfen.
- Warnung in der roten Gefahrenfamilie, deckungsgleich mit Trefferzone und Dunst: eine Zone mit weichen
  Rändern, die sich bis zum Treffer von innen bis zum Rand füllt, beim Stampfer rund, beim Schlag als
  Kegel. Die weichen Flanken des Kegels liegen mittig auf der Trefferkante, so wirkt er so breit wie
  der Dunstfächer.
- Treffer: der Void-Dunst des Rabid Rabbit in Grablicht-Grün. Beim Stampfer läuft eine feine
  Dunst-Druckwelle vom Körperrand bis zum Rand der Zone. Beim Schlag quillt eine dichte Wolke an den
  Pranken auf, und ein Dunstfächer rollt bis zum Rand des Kegels, ohne über dessen Flanken zu reichen.
  Dazu Staub an den Füßen, grüner Lichtstoß, Bildschirm-Druckwelle und schweres Kameraschütteln.
- Wucht: Halten der Aufprall-Pose, Körper wächst beim Aufrichten zur Kamera.

## Plasma: Grablichter als Munition

- Die Salve verhält sich wie zuvor (10 Schüsse, Takt, Homing, Schaden, 10 s Pause), bekommt aber
  eine Sammelphase von 1,6 s davor (`salvo.chargeMs`, replizierter Volley-Zustand).
- Sammelphase und Salve halten und drehen den Körper nicht (`aimsWithoutTurning`): Er läuft mit
  halbem Tempo auf seiner Route weiter und schlägt zu, was in Reichweite ist; die Kugeln steigen von
  seinem Rücken auf und fliegen in jede Richtung.
- Eine angekündigte Salve fliegt auch los, wenn Deckung ihr Ziel verbirgt, und bricht dann an der
  Deckung; im Rauch zielt sie auf die letzte gesehene Position. Stirbt ihr Ziel, nimmt sie das
  nächste, und beim Queren der Gleise läuft sie weiter. Nur ohne jedes Ziel in Reichweite verpufft sie.
- Es gibt nur eine Art Glühwürmchen: 30 normale umschwärmen ihn, jedes mit eigener Trägheit, je drei
  sind die Munition eines Schusses.
- Sammelphase als filmischer Ablauf: Grabdunst strömt in die Krone, die Glühwürmchen fliegen ein und
  glühen auf, dann verschmelzen je drei zu einer Kugel, die fließend auf die Größe des Schusses
  anschwillt. Die zehn Kugeln kreisen pulsierend unter einer grünen Aura; der Titan hebt den Kopf,
  die Spalten glühen auf.
- Jeder Schuss ist seine Kugel, die die Krone verlässt, und endet in einer Seelen-Verpuffung.
- In der Pause steigen die Glühwürmchen einzeln und wieder dunkel aus den Laternenlöchern.

## Map 5: die Grabinsel

- Die Karte ist nach Westen auf 131 × 37 Zellen erweitert. Der Titan erhebt sich auf einer
  felsfreien Grabinsel (`titan-grave`, Lichtung `grave-island`) mitten in einem See, der mit dem
  Südteich verschmilzt. Ein 8 Zellen breiter, ebenfalls felsfreier Damm (`grave-causeway`) führt nach
  Osten zum Schlachtfeld; eine Kette von Lichtungen (`titan-march-1` bis `-5`) hält von dort bis zum
  Vorposten auf jedem Seed einen Marschweg in Körperbreite frei.
- Der Boss erscheint immer: Wäre seine Zone doch einmal durch Fels von den Basen abgeschnitten,
  erhebt er sich trotzdem und bricht sich durch, statt die Mission ohne Boss hängen zu lassen.
- Bis zum Vorposten sind es rund 56 Zellen statt 13; Vorposten, Gleise (Spalte 99) und Hauptbasis
  stehen weiter im Osten, damit die Spieler den Titan unterwegs bekämpfen können. Ohne Störung
  erreicht er den Vorposten nach gut 40 s.
- Steht ein Gegner in der Gleiszone fest, weil Fels oder Basis seine Querung blockieren, gibt die
  Zugwachsamkeit ihn nach 0,7 s wieder an seine Route und seine Angriffe frei. So kann sich auch der
  Titan an den Gleisen durch Felsen schlagen.

## Intro „Friedhof erhebt sich“

- Größeres Gräberfeld (30 Grabsteine), Kamera-Zoom 1,15, längeres Halten.
- Der Titan gräbt sich vor dem Spawn sichtbar aus: Kopf und grabende Vorderpranken zuerst; die
  verlangsamten Frames werden weich ineinander geblendet.
- Die Intro-Glühwürmchen tauchen in ihn ein und kommen als Grablichter wieder heraus.
- Der Durchbruch brüllt mit grünem Bloom.

## Offen

Playtest (Gefühl, Fairness der tödlichen Treffer, Kampfdauer: HP 1800 → 2100 geschätzt, nicht
gemessen), Sounds (Platzhalter aus dem Bestand), Mehrspieler-Test des Volley-Zustands.
