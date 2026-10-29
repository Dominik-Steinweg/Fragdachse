# Fragdachse – GDD Demon Badger V1

- Version: 1.0
- Datum: 2026-10-28
- Status: umgesetzt (Verhalten, Netz, Effekte; Produktionsmodell `db-v2-r2` mit Hitzezonen, Clips
  `idle`/`burst`/`spit`, Emissions-Sheet und Schattenmesh `enemy-mesh-db-v2-r2`); Feintuning nach Spieltest offen
- Spielmodus: Coop Defense (Kampagne, From Dachs Till Dawn)
- Name: Dämonen-Dachs / Demon Badger
- Gegner-ID: `demon-badger` (Registry-Position und Wire-Kind-Index 1 unverändert)

## 1. Ziel und Spielerlebnis

Ein Schwarmgegner, der sich beim Laufen mit Hitze auflädt und sie als Void-Explosion um sich herum
entlädt. Je heißer er wird, desto schneller läuft er und desto stärker glühen Hörner, Schwanz, Wirbel und
Platten – erst dunkelrot, dann hell, kurz vor voller Ladung kippt die Glut ins Void-Violett. Die rote
Gefahrenzone kündigt die Explosion an und wandert mit dem weiterrennenden Dachs mit. Ein Rudel explodiert
nie gleichzeitig, sondern rollend nacheinander. Zwischendurch spuckt er kurze, kräftige Void-Flammenstöße
auf Spieler und Gebäude; erlöschende Flammen setzen den Boden in Brand, Basen fangen Feuer.

## 2. Hitzezyklus

| Phase | Verhalten (Startwerte, alle in `src/config/coopDefenseEnemies.json`, Block `heatBurst`) |
|---|---|
| Laden (4,8–5,2 s, je Dachs fest aus der ID) | Hitze 0 → 1; Tempo ×1,0 → ×1,6 (Hitze^1,6); Laufanimation läuft im selben Verhältnis schneller |
| Halten | voll geladen, wartet auf seinen Kaskaden-Slot oder darauf, dass ihn jemand sieht; Höchsttempo, violettes Flimmern |
| Warnung (0,9 s) | rote Zone r 110 px folgt dem Dachs; er rennt mit Höchsttempo weiter, wendet aber höchstens 75°/s; kein Biss, kein Spucken |
| Explosion | 20 Schaden in der Mitte bis 6 am Rand; Rückstoß nur für Spieler; Köder voll; Basen, Bauwerke ×0,5, Zug ×0,3; nie Felsen, nie andere Gegner; 4 brennende Brocken (Void-Bodenfeuer 2,6 s) |
| Abklingen (0,4 s) | Hitze 0, Normaltempo, dann neuer Zyklus |

- **Erster Zyklus:** frühestens 1,5 s nach dem Erscheinen plus Ladezeit.
- **Rollende Kaskade:** Explosionen liegen auf einem gemeinsamen Raster von 450 ms (±60 ms je Dachs und
  Zyklus). Zwei Dachse innerhalb von 420 px teilen nie einen Slot; neu erscheinende Dachse kommen frühestens
  einen Schritt nach den Nachbarn auf volle Hitze. So rollt ein Rudel in Spawn-Reihenfolge durch seine
  Explosionen. Pro Slot explodieren weltweit höchstens drei Dachse (begrenzt die Effektlast großer Wellen).
- **Sichtbarkeit:** Ein voller Dachs, den kein Spieler sehen kann (jenseits des Sichtfelds samt Randband),
  hält seine Ladung und bucht erst, wenn er in Sicht kommt. Verlässt er vor dem Start der Warnung jede
  Sicht, verfällt die Buchung; eine laufende Warnung endet immer in der Explosion.
- **Fairness (Vertragstest):** `telegraphMs ≥ 250 ms + (Radius + 16) / 280 px/s` für jede authored
  Konfiguration. Seitlich aus der Bahn treten reicht; geradeaus vor einem Dachs auf derselben Route
  wegzulaufen nicht (Relativtempo nur ca. 56 px/s).
- **Tod:** Ein geladener Dachs (Hitze ≥ 0,25) verpufft beim Tod nur klein (r 20–48 px nach Hitze), ohne Schaden.
- **Verbündete (Nekromantie):** laden und explodieren auch, aber nur, wenn ein feindlicher Gegner in 140 px
  ist; Schaden nur an Gegnern, Farben in der Verbündeten-Palette, keine rote Zone.

## 3. Void-Flammenstoß

| Wert | |
|---|---|
| Waffen | `DEMON_BADGER_VOID_SPIT` (Spieler, Nebenangriff auch während der Belagerung) und `DEMON_BADGER_VOID_SPIT_SIEGE` (Basen, bewaffnete Bauwerke; gleiche Werte per `baseId`) |
| Stoß | Salve aus 5 Flammen im Abstand von 45 ms, danach 1,7 s Pause – kein Dauerstrahl |
| Reichweite | ca. 170 px, große Start-Hitbox, schneller Abfall: kompakte Stichflamme |
| Schaden | 3,5 je Flamme plus Void-Brand |
| Bewegung | bremst beim Spucken auf 35 % |
| Brand | Erlöschende Flammen hinterlassen Void-Bodenfeuer (2,2 s); eine Basis darin fängt über `BaseVoidFireSystem` Feuer |
| Klaue | Biss wie bisher, nachrangig: Felsen und Hindernisse; Waffen ohne Felsschaden wählen nie Felsen als Ziel |

## 4. Darstellung

- Warnung: weiche rote Zone aus dem gemeinsamen Gegner-Gefahrenrenderer (`EnemyClawRenderer`, mitlaufend);
  Rot ist Telegraph, Void-Violett Gefahr, kein Gelb, kein weißer Kern.
- Glut: Emissions-Sheet der Hitzezonen (nur Hitze-Material, Augen ausgenommen), additiv knapp über der
  Lichtkarte, eingefärbt nach Hitze; dazu ein weicher Hitzehalo unter dem Körper und ab mittlerer Hitze ein
  Bodenlicht. Modell bleibt der bestehende gehörnte Dachs, mit Glutrillen an Hörnern, Schwanz, Wirbeln,
  Schulter- und Flankenplatten sowie einer Kehlnaht für den Flammenstoß.
- Explosion: Stil `demon_burst` – leichter Void-Energieausbruch in der Fraktionspalette, rote Funkengarbe und
  aufsteigende rote Funken; brennende Brocken als Void-Feuer. Getötet: Stil `demon_fizzle`.
- Clips: `idle`, `move`, `claw`, `burst` (Ruck beim Ausbruch), `spit` (Kopfstoß, Kiefer auf).

## 5. Technik

- Host-System `CoopDefenseEnemyHeatBurstSystem` (Activity), replizierter `EnemyHeatBurstState`
  (Snapshot-Feld `FIELD_HEAT_BURST`, Protokoll 57): Zeitstempel für Laden, Voll, Warnung und Explosion; Phase
  und Hitze leiten Host und Clients aus der Zeit ab, kein Pro-Tick-Verkehr.
- Tempo über `EnemyEntity.setAbilitySpeedFactor`; Sichtbarkeit über die Sichtfeld-Geometrie (`viewGap`) der
  KI-Detailstufen, nie über die Stufe selbst.
- Schaden über den Gegner-Flächenport (`heatBurst`) nach dem Mörser-Muster, Quelle
  `enemy.demon-badger.heat_burst` („Höllenglut“), Brocken `enemy.demon-badger.heat_fire` („Dämonenbrand“).
- Präsentation `EnemyHeatBurstPresentation`, Glutmodell `enemyHeatGlowModel`, Emissions-Manifest
  `src/assets/manifests/enemy-emission.json`.

## 6. Begegnungen

Einführung auf Karte 2 (Zweite Front), danach in vielen Kampagnenwellen (bis 24 auf Karte 8) und Dawn-Blöcken.
Testkarte 0: Encounter `demon-badger-gate-1` (acht Dachse, gestaffelt).
