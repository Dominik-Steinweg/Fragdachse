# Map 16 – Spinnensteig (V1)

Status: umgesetzt am 2026-10-17 (`src/config/coopDefenseMaps/16-spinnensteig.json`). Ersetzt den
Prototyp „Zeitzünder“ (104×40, fünf gleichförmige Hinterhalte). Playtest und Balancing stehen aus.

## 1. Rolle in der Kampagne

- Vormarsch-Map (`advance`): Das Team erreicht mit begrenzten Respawns eine Extraktion, ähnlich wie
  auf Map 7, aber deutlich schwerer und mit vielfältigeren Überfällen.
- Führt die Kabummtula ein. Sie ist das Leitmotiv, tritt aber fast nie allein auf.
- Fortschritt: Die geplanten Gegner bringen rund 1340 XP. Das deckt den Schritt von Level 15 auf
  Level 16 (1140 XP) ab. Der XP-Pool wird geteilt und nicht mit der Spielerzahl skaliert.
- Belohnung bleibt der Wachturm (`base_watchtower`) und ein Item-Angebot.

## 2. Aufbau

- 264×150 Zellen. In der Mitte liegt ein großer See. Ein Abfluss nach Süden trennt die Startregion
  im Südwesten von der Zielregion im Südosten.
- Die Route führt **im Uhrzeigersinn** um den See: im Westen nach Norden, quer über den Norden nach
  Osten und im Osten hinab zur Extraktion rechts unten. Das ergibt lange Nord-Süd-Wege statt eines
  starren Links-Rechts-Laufs.
- Bäche fließen radial vom See zum Kartenrand. Jede Querung ist eine kurze Furt mit einer geraden,
  einzelligen Sperre, die sich nach dem Überfall davor öffnet (Map-1/7-Prinzip: Wasser plus kleine Sperre).
- Vier weitere Seen füllen die Sackgassen neben der Route und lenken so die Richtung, ohne die Route
  einzuengen: Startweiher östlich der Basis, Schilfsee unter der Schlucht, Ostsee am Kammabstieg und
  Brutsee vor der Brutgrube. Aus jedem steigen in „seinem“ Überfall Mini-Kraken auf.
- Abschnitte:
  - Wiese vor der Basis
  - Felshang mit geschwungenem Aufstieg
  - Waldlichtung
  - Sumpfufer
  - Lagune mit zwei Wegen (Gabelung)
  - Kamm
  - Rodung
  - Senke vor der Extraktion
- Lockeres organisches Felsfeld mit breiten, geschwungenen Korridoren und Lichtungen, ohne gerade
  Felsbänder. Es bleibt Raum zum Ausweichen.
- Gegner erscheinen 27–40 Zellen von ihrem Checkpoint entfernt, im selben Takt wie auf Map 7.
  So bleibt Zeit zu reagieren.

## 3. Regeln

- 3 Respawns je Spieler. Jeder zweite Überfall-Checkpoint verlegt den Respawnpunkt.
- Persistente Basis nur am Start, damit der Inspector Turmkopien u. Ä. nutzen kann.
- `enemyTargeting: "players"`: Keine Basis ist Navigationsziel. Belagerer (Zombies, Dämonen,
  Sporenpanzer, Quacksalber, Mini-Kraken) jagen die Spieler. Die Kabummtula sucht keine
  Basis-Kamikaze. Basen werden nur noch als Hindernis angegriffen.
- Sonnenaufgang: 06:00 bis 07:30 über 20 Minuten Missionszeit, mit Bodennebel.
- Drei Versorgungsposten mit Health-Podesten.

## 4. Überfälle

| # | Name | Identität |
|---|---|---|
| 1 | Erster Biss | stille Lehrstunde: erst eine, dann zwei, dann drei Kabummtulas aus dem Nebel; Zombies von hinten; zuletzt drei Mini-Kraken aus dem Startweiher |
| 2 | Furt der Brut | Mini-Kraken steigen bachauf und bachab aus dem Wasser, Dämonen von der Flanke |
| 3 | Steilhang-Zange | Schild-Anstürmer von oben, Rabids von unten, Kabummtulas von den Kanten, Mini-Kraken aus dem Schilfsee |
| 4 | Netzwald | drei Ringwellen nur aus Kabummtulas (5, 6, 8 von allen Seiten) |
| 5 | Sumpfufer | Stinkmütter, Mini-Kraken aus der Bucht, heilende Quacksalber |
| 6 | Seegabel | Alien-Dachse am Uferweg, Leerenpirscher am Außenweg, Dämonen vom Ufer, Mini-Kraken aus der Lagune zwischen beiden Wegen |
| 7 | Bomberkamm | Bomberanflug entlang des Kamms, danach Sporenpanzer, Zombies und Kabummtulas |
| 8 | Brandrodung | Void-Feuer schließt den Rückweg, Pyros und ein Werfer halten die Lichtung, Kabummtulas stürmen, Mini-Kraken aus dem Ostsee |
| 9 | Brutgrube | Finale in drei Wellen: Kabummtula-Zange, Anstürmer plus Brutsee-Kraken plus Alien, Spinnenring plus Pirscher plus Stinkmutter plus Kraken-Nachschub |

Mörser- und Brandstifter-Dachse werden erst auf Map 18 und 19 eingeführt und fehlen hier bewusst.

## 5. Authoring-Hinweise

- Überfälle werden über `after-checkpoint` gestartet. Wellen hängen per `after-encounter` aneinander.
  Checkpoints schließen über `completeOn: after-encounter` ab.
- Wasser-Spawns (`medium: "water"`, `cluster: true`) liegen tief genug im Wasser.
- `tests/stress/CoopDefenseArenaGeneration.test.ts` prüft über mehrere Seeds die Erreichbarkeit.
  Wasser-Spawns gelten dort als erreichbar, wenn ihr Gewässer an erreichbares Land grenzt.
