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

- **Primärangriff Sprung.** Der Hase bleibt stehen und zielt; eine weiche rote Zone zeigt, wo er landen
  wird, wenn der Spieler seinen Kurs hält (volles Vorhalten). Beim Einrasten blitzt sie auf und bleibt
  danach fest. Er springt auf einer festen Linie und trifft bei der Ankunft die angekündigte Fläche.
- **Sekundär Biss.** Zwischen den Sprüngen läuft er normal und beißt im Nahkampf (wie bisher).
- **Rudel.** Höchstens zwei Hasen zielen gleichzeitig auf denselben Spieler; ihre Sprünge starten
  gestaffelt. Weitere Hasen laufen und beißen.

## 3. Ablauf eines Sprungs

| Phase | Verhalten (Startwerte, alle in `src/config/coopDefenseEnemies.json`) |
|---|---|
| Start | Spieler 110–300 px entfernt, Sicht, freie Bahn, kein laufender Biss, Abklingzeit vorbei; erster Sprung frühestens 0,9 s nach dem Erscheinen |
| Zielen (0,45 s) | steht, schaut zum Spieler; die Zone folgt dem vorhergesagten Landepunkt |
| Einrasten (0,25 s) | Zone blitzt und bleibt fest; Fluchtfenster beginnt |
| Flug (0,35–0,48 s, längenabhängig) | fester Flug zur Zone, nicht wegstoßbar, Treffer-Stagger wirkungslos |
| Landung | Flächenschaden r 60 px, 28 in der Mitte bis 14 am Rand, Rückstoß nur für Spieler; Köder nehmen Schaden, Bauwerke nicht |
| Erholung (0,45 s) | steht, kein Biss |
| Abklingzeit (2,4–3,2 s) | läuft und beißt normal |

Abbrüche: Stun, Eingraben, Teleport oder deutliches Wegstoßen beim Zielen brechen den Sprung mit kurzer
Sperre ab; ist der Spieler beim Zielen näher als 70 px, beißt der Hase stattdessen. Stun oder Teleport
im Flug lassen ihn ohne Schaden dort landen, wo er ist. Verbündete Hasen (Nekromantie) springen nicht.

Fairness: Ab dem Einrasten bleiben mindestens 0,6 s bis zur Landung. Ein Spieler (280 px/s) braucht für
76 px Flucht aus der Zonenmitte ca. 0,27 s; eine 90°-Wendung bringt ihn rund 170 px vom Landepunkt weg.
Der Vertragstest prüft `lockMs + airMinMs ≥ Reaktion + (Radius + 16) / 280` für jede authored Konfiguration.

## 4. Bewegung

- **Sprunglauf:** Tempo pulsiert pro Satz um ±18 % um das Grundtempo (190 px/s), der Mittelwert bleibt.
- **Haken:** Beim Anrennen auf einen Spieler (weiter als 140 px) alle 1,4–2,6 s ein scharfer Haken von
  30–45° für ca. 0,23 s, abwechselnd zur Seite; endet sofort, wenn die Seite blockiert ist.

## 5. Darstellung

- Rote Zone und weiche Bahn vom Hasen zur Zone aus dem gemeinsamen Gegner-Gefahrenrenderer
  (`EnemyClawRenderer`); Rot ist Telegraph, Void-Violett allgemeine Gefahr, kein Gelb.
- Flug mit Anhebung zur Kamera; Clients setzen den Körper auf die replizierte Fluglinie; Absprung- und
  Landespuren über den Bewegungsmodus `airborne`.
- Modell (GA1, Wahl des Users): schlanker Feldhase geduckt, lange Ohren 46° seitlich nach hinten
  (Pfeilsilhouette von oben), blau-schwarzes Fell mit violettem Fellrand, große violette Ringaugen und
  void-violett leuchtende Ohrspitzen; das Leuchten kriecht in Bewegung fast bis zur Ohrwurzel.
- Clips: `idle`, `move` (Halbsprung-Galopp), `claw` (Bisslunge), `windup` (Zielen, Schleife),
  `leap` (`launch`/`land`). Sheets ohne `leap` dehnen die `claw`-Lunge.

## 6. Technik

- Host-System `CoopDefenseEnemyPounceSystem` mit Configblock `pounce`; replizierter `EnemyPounceState`
  (Snapshot-Feld `FIELD_POUNCE`, Protokoll 54). Flugkern geteilt mit dem Quacksalber (`enemyFlight.ts`).
- Schaden über den Gegner-Flächenport (`pounceImpact`), Quelle `enemy.rabid-rabbit.pounce` („Tollwut-Sprung“).
- Präsentation `EnemyPouncePresentation`; Animation `EnemyPounceAnimation`.

## 7. Gates

GA1 Modellwahl (User, Prototyp-Board aus Blender, mehrere Formen und Farbwelten) → GC1 Feel (User, Dev-Szenario
`rabid-rabbit-gate-1`) → GC2 Optik und GA2 Entwurfsclips (Claude) → GA3 Produktion mit Schattenmesh (Claude) →
Cutover → Endabnahme (User).
