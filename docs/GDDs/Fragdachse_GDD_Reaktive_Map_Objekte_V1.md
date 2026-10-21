# Fragdachse – GDD Reaktive Map-Objekte V1 (Explosive Fässer)

- Version: 1.1
- Datum: 2026-10-21
- Status: umgesetzt auf `main` (Produktion `barrel-r3`, Standard Rostfass); offen: Playtest, Freigabe des Explosionstons im Audio-Studio
- Spielmodus: Coop-Kampagne, From Dachs Till Dawn, PvP-Arenen (Deathmatch, Team-Deathmatch, Capture the Beer)
- Kind-ID: `explosive_barrel`; Varianten `rusted` (Rostfass) und `toxic` (radioaktives Fass)

## 1. Ziel und Spielerlebnis

Die Karten reagieren auf Beschuss. Ein Fass ist eine Hommage an Doom, Quake und Half-Life: Schon ein
Streifschuss setzt es in Brand, es brennt hörbar und sichtbar herunter, die bekannte rote Gefahrenzone
kündigt den Knall an, dann explodiert es heftig, schleudert Feuerbrocken und lässt brennenden Boden zurück.
Fässer stehen gezielt an Engstellen, durch die Gegner kommen: Sie werden zu Fallen, Kettenreaktionen und
taktischen Werkzeugen statt zu Deko.

## 2. Entscheidungen (User, 2026-10-20/21)

| # | Entscheidung |
|---|---|
| E1 | Einsatz: Coop-Kampagnenkarten (Map-JSON und Map-Editor-Ebene), PvP-Arenen (prozedural gestreut), Dawn-Arenen, Testkarte 00. Nicht in der Lobby. |
| E2 | Die Explosion gehört dem letzten Schadensverursacher. Sie trifft nur dessen Gegner, nie Teammates (kein Friendly Fire); der Kill zählt für ihn; er selbst bekommt 25 % Eigenschaden (wie eigene Raketen). Hat in Coop ein Gegner zuletzt getroffen, trifft der Knall die Spieler. |
| E3 | Fässer haben keinen Respawn; jede Runde beginnt mit vollem Bestand. Aufladen ist für Pilzsporen und Bienenstock eingeplant (siehe §8). |
| E4 | Zwei rein optische Varianten zum A/B-Vergleich: leicht verrostetes Blechfass und radioaktives Fass in klassischem Giftgrün. |
| E5 | Kleine Props tragen **ein** großes, klar lesbares Symbol statt vieler Kleinteile (Rückmeldung zum ersten Rostfass-Entwurf). |
| E6 | Rückmeldung zum Review (2026-10-21): Fässer nur auf einem Teil der Karten, dort strategisch an Engstellen auf den Gegnerrouten. Die Warnung nutzt das bekannte Muster der Gegner-Nahkampfangriffe. Gruppen wirken nicht wie ein Raster, Fässer überlappen nie (feste Körper). Rostfass ist Standard. Der Explosionston entsteht im Audio-Studio über ComfyUI. |

## 3. Verhalten

| Phase | Auslöser | Darstellung |
|---|---|---|
| Ruhe | – | Fass-Sprite; das radioaktive Fass glüht (nachts kräftig, tagsüber schwach). |
| Brennt | Jeder Schaden > 0, auch von Waffen ohne Felsschaden (Flammenwerfer, manche Raketen) | Flammen auf dem Deckel, Treffer-Aufhellung. Das Fass verliert selbst 15 HP/s. |
| Warnung | HP < 30 % | Rote Gefahrenzone im gemeinsamen Muster der Gegnerangriffe (wie Nahkampf, Krötenlandung, Kabummtula) über dem Explosionsradius. Sie füllt sich bis zum geschätzten Knall; ein weiterer Treffer zieht sie vor. |
| Scharf | HP 0 (Treffer oder Brand) | Zone schlägt zu, 120 ms Zündschnur; Ketten-Fässer zusätzlich 80–220 ms Versatz. |
| Explodiert | Zündschnur abgelaufen | Eigener Explosionsstil `barrel` (Kamerastoß mittel, Druckwelle), eigene Aufnahme, Blechsplitter; das Hindernis verschwindet. |

Gegner greifen Fässer nie gezielt an und benutzen sie nicht als Durchbruchziel; Streutreffer und
Explosionen von Gegnern zünden sie trotzdem. Spieler spawnen nie direkt neben einem Fass.

## 4. Tuning (Startwerte, `src/config/reactiveProps/reactivePropKinds.json`)

| Wert | Start |
|---|---|
| HP / Brand | 60 HP, 15 HP/s (ein Pistolentreffer → Explosion nach ≈ 3,4 s) |
| Explosion | Radius 150 px, 85 → 20 Schaden, Knockback 1500, `selfDamageMult` 0.25, Felsschaden 1 |
| Brennender Boden | Radius 64 px, 3 Schaden/Tick, 3,5 s, Nachbrand 2 s × 0,5 |
| Feuerbrocken | 10 Brocken, Suchradius 150 px, Flug 450 ms, Boden 3 s |
| Streuung PvP | DM/TDM 3, CTB 4 Gruppen à 1–3 Fässer auf freiem Boden, Mindestabstand 9 Zellen |
| Kampagne | Karten 03, 06, 08, 11, 12, 13, 16, 18: 3 Engstellen-Gruppen (08 und 16: 4) à 2–3 Fässer, Mindestabstand 12 Zellen; Testkarte 00 mit Ankern |
| Dawn | Arenen `oldwood` und `rockbasin`: 3 Engstellen-Gruppen à 2–3 Fässer |

## 5. Platzierung

- **Anker** (`reactiveProps.anchors`): feste Zelle, optional Variante. Der Generator hält die Zelle wie
  eine kleine Lichtung felsfrei; Basis-, Gleis- und Podestreservierungen lehnen einen Anker ab.
- **Streuung** (`reactiveProps.scatter`) mit eigenem Zufallsstrom, damit Felsen, Bäume und Decals
  unverändert bleiben:
  - `placement: "chokepoints"` (strategisch, Standard im Map-Editor): Der Generator verfolgt die
    Gegnerrouten von den Spawnquellen zur Basis (ohne Basis zu den Missionszielen) und sucht Engstellen
    mit höchstens drei Zellen Abstand zum nächsten Hindernis, nicht direkt an Basis oder Spawn. Die
    Gruppe steht an der Wand neben der Engstelle, nie auf der Route und nie direkt daneben, und darf die
    begehbare Fläche nicht zerteilen.
  - `placement: "open"` (Standard ohne Angabe): Gruppen auf freiem Boden mit freiem 3×3-Umfeld.
- PvP-Arenen streuen offen nach den Modus-Defaults der Kind-Registry, Coop- und Dawn-Karten authoren selbst.
  Nicht jede Karte bekommt Fässer: Sie sind ein gezieltes Element der Karte, keine Grundausstattung.
- Map-Editor: Ebene „Explosive Fässer“ mit Anker setzen, verschieben, Variante wählen, löschen und
  Streuung ein-/ausschalten; gestreute Fässer zeigt die Vorschau schreibgeschützt.

## 6. Darstellung, Audio, Lesbarkeit

- 90°-Draufsicht, Fass ≈ 27 px auf einer 32-px-Zelle. Blender-Rezept `reactive-barrel`, Produktion
  `barrel-r3` (Quelle 128 px, angezeigt 32 px).
- Gruppen: Nachbarn rücken zusammen, jedes Fass ist leicht versetzt und gedreht (deterministisch je
  Zelle), damit keine Rasterreihe entsteht. Fässer sind feste Körper: Mitten mindestens 28 px
  auseinander, sie berühren sich höchstens. Kontaktschatten folgen derselben Lage.
- **Rostfass:** oxidrotes Fass, rostiger Falz, großes cremefarbenes Gefahrenschild mit dunkler Flamme.
  Liest sich im Wald hervorragend (Rot gegen Grün).
- **Radioaktives Fass:** olivgrünes Fass mit aufgerissenem Deckel, giftgrüner Pool mit hellem Kern,
  eine schmale Überlaufspur. Nachts deutlich sichtbar (Glühen über der Lightmap plus kleines Licht).
  Risiko: Giftgrün liegt nahe an Verbündeten-Jade und Stinkwolke.
- Farbregel: Rot bleibt Telegraph (Gefahrenzone), Violett bleibt Void-Gefahr.
- Audio: `sfx_explosion_explosive_barrel`, Rezept im Audio-Studio (`tools/audio-studio/catalog/sounds.json`,
  ComfyUI Stable Audio). Bis zur Freigabe eines Kandidaten im Studio spielt ein synthetischer Platzhalter.

## 7. Technische Leitplanken

- Reaktive Props belegen den gemeinsamen Hindernis-ID-Raum direkt hinter den authored Felsen
  (`[R, R+P)`, Runtime-Placeables ab `R+P`), stehen aber nicht in `layout.rocks`, `RockRegistry` oder
  `PlacementSystem`. Owner ist der World-scoped `ReactivePropRuntime`; der Welt-Schadenstrichter
  routet ihre IDs als `WorldObjectKind 'reactive_prop'`.
- Sie nehmen den vollen Treffer unabhängig vom `rockDamageMult` der Waffe (Radial, Hitscan, Melee,
  Projektil, Näherungsimpuls).
- `commitDamage` ändert nur Zustand; Entfernen und Explosion passieren in `hostAdvance` vor dem
  Explosions-Drain des Host-Frames.
- Replikation: Slice `rp` (Phase und Fortschrittsbyte je Objekt), Protokoll 44; Layout über
  Generator-Version 16. Die Phase `recharging` ist im Drahtformat bereits belegt.

## 8. Geplante Erweiterungen (nicht umgesetzt)

| Objekt | Auslöser | Wirkung | Danach |
|---|---|---|---|
| Pilzsporen | Treffer | AoE-DoT-Fläche des Auslösers | lädt in ca. 15 s wieder auf, bleibt stehen |
| Bienenstock | Treffer | Bienen jagen die Gegner des Schützen | lädt in ca. 15 s wieder auf, bleibt stehen |

Beide kommen als neue Union-Mitglieder (`effect: 'dot_zone' | 'swarm'`, `afterEffect: 'recharge'`)
ohne Änderung am Drahtformat dazu.

## 9. Abnahme

| Gate | Inhalt | Stand |
|---|---|---|
| G1 | Kern, Netz, Generator, Platzhalter | erledigt |
| GA1 | Form-Entwürfe beider Varianten | erledigt (Rostfass nach Rückmeldung mit großem Schild) |
| G2 | Optik: Brand, Gefahrenzone, Glühen, Schatten, Explosionsstil, Audio | erledigt; Ton: Kandidaten im Studio, Freigabe durch den User |
| G3 | Kampagne, PvP, Dawn, Map-Editor; strategische Engstellen-Platzierung | erledigt |
| G4 | Produktion `barrel-r3`, Rostfass Standard, Review-Paket, Merge nach `main` | erledigt; offen: Playtest, Tonfreigabe |
