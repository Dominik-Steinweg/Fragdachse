# Fragdachse – GDD Rabid Rabbit V1

- Version: 1.0
- Datum: 2026-10-28
- Status: umgesetzt (Produktion `rr-v1-r2` „Nightshade Tips“, Schattenmesh `enemy-mesh-rr-v1-r2`); Feel-Abnahme, Balance-Tuning (Dawn-Kosten, Map 3) und Endabnahme offen
- Spielmodus: Coop Defense (Kampagne, From Dachs Till Dawn)
- Name: Rabid Rabbit (DE und EN)
- Gegner-ID: `rabid-rabbit` (ersetzt den Prototyp `rabid-badger` an derselben Registry-Position, Wire-Kind-Index 2)

## 1. Ziel und Spielerlebnis

Ein kleiner, schneller, aggressiver Hase, der gezielt Spieler jagt. Er hoppelt im Sprunglauf heran, schlägt
dabei Haken und greift vor allem mit einem angekündigten Sprung an. Der Sprung ist deutlich gefährlicher
als der Hopser des Quacksalbers, aber immer ausweichbar: Wer die rote Zone liest und rechtzeitig die
Richtung wechselt, stoppt oder dasht, bleibt heil. Zwischen den Sprüngen läuft und beißt der Hase normal.

## 2. Kern

- **Primärangriff Sprung.** Der Hase bleibt stehen und zielt; ein leiser roter Hauch zeigt, wo er landen
  wird, wenn der Spieler seinen Kurs hält (volles Vorhalten). Beim Einrasten wird der Hauch ohne Blitz zur
  festen Marke, die sich bis zur Landung von innen füllt. Er springt auf einer festen Linie und trifft bei
  der Ankunft die angekündigte Fläche.
- **Sekundär Biss.** Zwischen den Sprüngen läuft er normal und beißt im Nahkampf (wie bisher).
- **Rudel.** Höchstens zwei Hasen zielen gleichzeitig auf denselben Spieler; ihre Sprünge starten
  gestaffelt. Weitere Hasen laufen und beißen.

## 3. Ablauf eines Sprungs

| Phase | Verhalten (Startwerte, alle in `src/config/coopDefenseEnemies.json`) |
|---|---|
| Start | Spieler 110–480 px entfernt, Sicht, freie Bahn, kein laufender Biss, Abklingzeit vorbei; erster Sprung frühestens 0,9 s nach dem Erscheinen |
| Zielen (0,45 s) | steht, schaut zum Zielpunkt, Void-Schein wächst leise; der Hauch gleitet dem vorhergesagten Landepunkt nach, sein Vorhalt schwenkt aber höchstens 400 px/s um (kein Hin- und Herspringen bei Richtungswechseln) |
| Einrasten (0,25 s) | Marke steht fest und füllt sich bis zur Landung; der Hase duckt sich, sein Void-Schein steigt; der Flug startet dort, wo er jetzt steht; Fluchtfenster beginnt |
| Flug (0,35–0,62 s, längenabhängig) | fester Flug zur Zone, nicht wegstoßbar, Treffer-Stagger wirkungslos |
| Landung | Flächenschaden r 64 px, 28 in der Mitte bis 14 am Rand, Rückstoß nur für Spieler; Köder nehmen Schaden, Bauwerke nicht |
| Erholung (0,45 s) | steht, kein Biss |
| Abklingzeit (2,4–3,2 s) | läuft und beißt normal |

Abbrüche: Stun, Eingraben, Teleport oder Wegstoßen um mehr als 72 px beim Zielen brechen den Sprung mit
kurzer Sperre ab; verliert der Hase den Spieler länger als 0,35 s aus der Sicht oder kommt er näher als 45 px,
beißt er stattdessen. Ist der Landepunkt blockiert, rückt er entlang der Bahn bis zur Mindestreichweite zurück. Stun oder Teleport
im Flug lassen ihn ohne Schaden dort landen, wo er ist. Verbündete Hasen (Nekromantie) springen nicht.

Fairness: Ab dem Einrasten bleiben mindestens 0,6 s bis zur Landung. Ein Spieler (280 px/s) braucht für
80 px Flucht aus der Zonenmitte ca. 0,29 s; eine 90°-Wendung bringt ihn rund 170 px vom Landepunkt weg.
Der Vertragstest prüft `lockMs + airMinMs ≥ Reaktion + (Radius + 16) / 280` für jede authored Konfiguration.

## 4. Bewegung

- **Größe:** Kollisions- und Darstellungsgröße 20 px (nach den ersten Spieltests von 22 px verkleinert; 20 ist die nächste ganze Größe zu −10 %).
- **Sprunglauf:** Tempo pulsiert pro Satz um ±18 % um das Grundtempo (209 px/s), der Mittelwert bleibt.
- **Haken:** Beim Anrennen auf einen Spieler (weiter als 140 px) alle 1,4–2,6 s ein scharfer Haken von
  30–45° für ca. 0,23 s, abwechselnd zur Seite; endet sofort, wenn die Seite blockiert ist.

## 5. Darstellung

- Eine Landemarke auf einer durchgehenden Zeitlinie aus dem gemeinsamen Gegner-Gefahrenrenderer
  (`EnemyClawRenderer.syncLandingMark`): leiser Hauch beim Zielen, ab dem Einrasten eine weiche Scheibe,
  die sich bis zur Landung von innen füllt; nichts reicht über den Trefferradius hinaus. Keine Bahn über
  den Boden: Den Absprung kündigt der Körper an (weicher additiver Void-Schein in Augenfarbe, kleines
  Licht für die Nacht, leichtes Ducken). Rot ist Telegraph, Void-Violett allgemeine Gefahr, kein Gelb.
- Flug mit Anhebung zur Kamera; Clients setzen den Körper auf die replizierte Fluglinie; Absprung- und
  Landespuren über den Bewegungsmodus `airborne`.
- Landung als GPU-Partikel (`PounceImpactGpuRenderer`, Explosionsstil `pounce_impact`): rund 120 feine Körner
  über die Trefferfläche, weicher Staub, der sich am Trefferrand absetzt, und feine Void-Funken in der Augenfarbe,
  die den Treffer auch nachts lesbar halten.
- Modell (GA1, Wahl des Users): schlanker Feldhase geduckt, lange Ohren 46° seitlich nach hinten
  (Pfeilsilhouette von oben), blau-schwarzes Fell mit violettem Fellrand, große violette Ringaugen und
  void-violett leuchtende Ohrspitzen; das Leuchten kriecht in Bewegung fast bis zur Ohrwurzel.
- Clips: `idle`, `move` (Halbsprung-Galopp), `claw` (Bisslunge), `windup` (Zielen, Schleife),
  `leap` (`launch`/`land`). Sheets ohne `leap` dehnen die `claw`-Lunge.

## 6. Technik

- Host-System `CoopDefenseEnemyPounceSystem` mit Configblock `pounce`; replizierter `EnemyPounceState`
  (Snapshot-Feld `FIELD_POUNCE`, seit Protokoll 54; Landeeffekt `pounce_impact` seit 55). Flugkern geteilt mit dem Quacksalber (`enemyFlight.ts`).
- Schaden über den Gegner-Flächenport (`pounceImpact`), Quelle `enemy.rabid-rabbit.pounce` („Tollwut-Sprung“).
- Präsentation `EnemyPouncePresentation`; Animation `EnemyPounceAnimation`.

## 7. Gates

GA1 Modellwahl (User, Prototyp-Board aus Blender, mehrere Formen und Farbwelten) → GC1 Feel (User, Dev-Szenario
`rabid-rabbit-gate-1`) → GC2 Optik und GA2 Entwurfsclips (Claude) → GA3 Produktion mit Schattenmesh (Claude) →
Cutover → Endabnahme (User).
