# Fragdachse – GDD Reaktive Map-Objekte V1 (Explosive Fässer)

- Version: 1.0
- Datum: 2026-10-21
- Status: umgesetzt auf Branch `reactive-props` (Produktion `barrel-r3`); Wahl der Standardvariante durch den User offen
- Spielmodus: Coop-Kampagne, From Dachs Till Dawn, PvP-Arenen (Deathmatch, Team-Deathmatch, Capture the Beer)
- Kind-ID: `explosive_barrel`; Varianten `rusted` (Rostfass) und `toxic` (radioaktives Fass)

## 1. Ziel und Spielerlebnis

Die Karten reagieren auf Beschuss. Ein Fass ist eine Hommage an Doom, Quake und Half-Life: Schon ein
Streifschuss setzt es in Brand, es brennt hörbar und sichtbar herunter, ein roter Ring kündigt den Knall
an, dann explodiert es heftig, schleudert Feuerbrocken und lässt brennenden Boden zurück. Fässer werden
zu Fallen, Kettenreaktionen und taktischen Werkzeugen.

## 2. Entscheidungen (User, 2026-10-20/21)

| # | Entscheidung |
|---|---|
| E1 | Einsatz: Coop-Kampagnenkarten (Map-JSON und Map-Editor-Ebene), PvP-Arenen (prozedural gestreut), Dawn-Arenen, Testkarte 00. Nicht in der Lobby. |
| E2 | Die Explosion gehört dem letzten Schadensverursacher. Sie trifft nur dessen Gegner, nie Teammates (kein Friendly Fire); der Kill zählt für ihn; er selbst bekommt 25 % Eigenschaden (wie eigene Raketen). Hat in Coop ein Gegner zuletzt getroffen, trifft der Knall die Spieler. |
| E3 | Fässer haben keinen Respawn; jede Runde beginnt mit vollem Bestand. Aufladen ist für Pilzsporen und Bienenstock eingeplant (siehe §8). |
| E4 | Zwei rein optische Varianten zum A/B-Vergleich: leicht verrostetes Blechfass und radioaktives Fass in klassischem Giftgrün. |
| E5 | Kleine Props tragen **ein** großes, klar lesbares Symbol statt vieler Kleinteile (Rückmeldung zum ersten Rostfass-Entwurf). |

## 3. Verhalten

| Phase | Auslöser | Darstellung |
|---|---|---|
| Ruhe | – | Fass-Sprite; das radioaktive Fass glüht (nachts kräftig, tagsüber schwach). |
| Brennt | Jeder Schaden > 0, auch von Waffen ohne Felsschaden (Flammenwerfer, manche Raketen) | Flammen auf dem Deckel, Treffer-Aufhellung. Das Fass verliert selbst 15 HP/s. |
| Warnung | HP < 30 % | Roter, sich zusammenziehender Telegraph-Ring über der Lightmap, schneller pulsierend. |
| Scharf | HP 0 (Treffer oder Brand) | Ring eng und schnell, 120 ms Zündschnur; Ketten-Fässer zusätzlich 80–220 ms Versatz. |
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
| Streuung PvP | DM/TDM 4, CTB 6 Gruppen à 1–3 Fässer, Mindestabstand 9 Zellen |
| Streuung Kampagne/Dawn | 3–9 Gruppen je nach Kartenfläche, Mindestabstand 10 Zellen |

## 5. Platzierung

- **Anker** (`reactiveProps.anchors`): feste Zelle, optional Variante. Der Generator hält die Zelle wie
  eine kleine Lichtung felsfrei; Basis-, Gleis- und Podestreservierungen lehnen einen Anker ab.
- **Streuung** (`reactiveProps.scatter`): seeded Gruppen auf freiem Boden (3×3-Umfeld frei), mit eigenem
  Zufallsstrom, damit Felsen, Bäume und Decals unverändert bleiben. Jede Gruppe muss die Begehbarkeit
  erhalten, sonst wird sie verworfen und anderswo versucht.
- PvP-Arenen streuen nach den Modus-Defaults der Kind-Registry, Coop- und Dawn-Karten authoren selbst.
- Map-Editor: Ebene „Explosive Fässer“ mit Anker setzen, verschieben, Variante wählen, löschen und
  Streuung ein-/ausschalten; gestreute Fässer zeigt die Vorschau schreibgeschützt.

## 6. Darstellung, Audio, Lesbarkeit

- 90°-Draufsicht, Fass ≈ 27 px auf einer 32-px-Zelle. Blender-Rezept `reactive-barrel`, Produktion
  `barrel-r3` (Quelle 128 px, angezeigt 32 px).
- **Rostfass:** oxidrotes Fass, rostiger Falz, großes cremefarbenes Gefahrenschild mit dunkler Flamme.
  Liest sich im Wald hervorragend (Rot gegen Grün).
- **Radioaktives Fass:** olivgrünes Fass mit aufgerissenem Deckel, giftgrüner Pool mit hellem Kern,
  eine schmale Überlaufspur. Nachts deutlich sichtbar (Glühen über der Lightmap plus kleines Licht).
  Risiko: Giftgrün liegt nahe an Verbündeten-Jade und Stinkwolke.
- Farbregel: Rot bleibt Telegraph (Warnring), Violett bleibt Void-Gefahr.
- Audio: `sfx_explosion_explosive_barrel` (HE-Explosion tiefer gestimmt mit metallischem Fass-Klang).

## 7. Technische Leitplanken

- Reaktive Props belegen den gemeinsamen Hindernis-ID-Raum direkt hinter den authored Felsen
  (`[R, R+P)`, Runtime-Placeables ab `R+P`), stehen aber nicht in `layout.rocks`, `RockRegistry` oder
  `PlacementSystem`. Owner ist der World-scoped `ReactivePropRuntime`; der Welt-Schadenstrichter
  routet ihre IDs als `WorldObjectKind 'reactive_prop'`.
- Sie nehmen den vollen Treffer unabhängig vom `rockDamageMult` der Waffe (Radial, Hitscan, Melee,
  Projektil, Näherungsimpuls).
- `commitDamage` ändert nur Zustand; Entfernen und Explosion passieren in `hostAdvance` vor dem
  Explosions-Drain des Host-Frames.
- Replikation: Slice `rp` (Phase und Fortschrittsbyte je Objekt), Protokoll 42; Layout über
  Generator-Version 15. Die Phase `recharging` ist im Drahtformat bereits belegt.

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
| G2 | Optik: Brand, Warnring, Glühen, Schatten, Explosionsstil, Audio | erledigt; Ton nicht abgehört |
| G3 | Kampagne, PvP, Dawn, Map-Editor | erledigt |
| G4 | Produktion `barrel-r3`, Review-Paket | erledigt; offen: Variantenwahl des Users, Merge |
