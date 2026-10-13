# From Dachs Till Dawn – GDD V2

Stand: 2026-10-13 (Meilenstein M0). V2 löst die offenen Punkte aus dem
[Gesamtkonzept V1](Fragdachse_From_Dachs_Till_Dawn_Gesamtkonzept_V1.md) auf. Die Vision aus V1 gilt
weiter; wo V2 abweicht, gilt V2. Alle Zahlen sind Defaults in authored JSON unter
`src/config/dawn/` und an jedem Gate tunebar. Diese Datei hält Designentscheidungen fest, keine
Implementierungschronik.

## 1. Kern-Loop

Endgame-Endlosmodus nach Map 20. Eine Runde dauert 8 Minuten und läuft von Morgen bis
Morgengrauen: Am Tag bergen die Spieler Schrott an Salvage-Sites, in der Dämmerung kehren sie zur
Basis zurück, nachts verteidigen sie die persistente Basis, im Morgengrauen ist die Runde
gewonnen. Mit Schrott kauft man beim Schrotthändler Expansion (größere Basis, höherer Threat),
Infrastruktur, Upgrade-Zweige, Boss-Punkte und Ausrüstung. Threat 1 entspricht dem Kampagnenende,
Threat 10 ist das Langzeitziel.

## 2. Festgelegte Entscheidungen (User, 2026-10-13)

| Thema | Entscheidung |
|---|---|
| Koop-Economy | Schrott, Expansion und Threat sind persönlich. Gesammelter Schrott wird allen berechtigten Teilnehmern gutgeschrieben (wie Shared-XP). Die Runde läuft auf Threat, Expansion und Infrastruktur des Hosts. |
| Niederlage | Basiskern zerstört: XP bleiben, 50 % des Rundenschrotts, keine Items, Basis-Rollback, Threat unverändert. |
| Nekromantie | Wandert aus der Kampagne zum Händler („Nekromantie-Forschung“). Die Migration entfernt vorhandene Stufen, die Boss-Punkte werden frei, ein einmaliger Lobby-Hinweis erklärt das. |
| Zusammenarbeit | Rückfragen gebündelt pro Meilenstein-Gate; dazwischen dokumentierte, umkehrbare Defaults. |

## 3. Design-Defaults und Abweichungen von V1

| Thema | V1 | V2-Default | Warum |
|---|---|---|---|
| Arenen | Kampagnen-Maps wiederverwenden | Eigene Dawn-Arenen mit Basis in der Mitte, Angriffen von allen vier Rändern und authored Salvage-Slots; Seed pro Runde | Kampagnen-Maps sind auf eine Front und Radius 6 gebaut; Dawn braucht Radius 15 und Fronten rundum |
| Arenen-Anzahl | offen | M0/M1: 1 („Lichtung“, ca. 140×96), ab M3 mindestens 4 | Erst den Loop beweisen, dann Vielfalt |
| Zeitplan | 3–4 min Tag, ~4 min Nacht | Tabelle in Abschnitt 4 | Nacht etwas länger als der Tag, damit die Verteidigung das Finale bleibt |
| Niederlage nachts | offen | Nur der Fall des Basiskerns verliert; Spieler respawnen an der Basis, nachts mit längerer Verzögerung | Kein Team-Wipe-Frust, Fokus auf Basisverteidigung |
| Expansion | Kosten steigen nichtlinear | Jede Expansion: Radius +1, Threat +1, Baukapazität +2; Radius 6 (Threat 1) bis 15 (Threat 10) | Ohne Kapazität nützt die Fläche nichts |
| Kampagnen-Maps | – | Bleiben auf Radius 6 begrenzt; Blueprints außerhalb ruhen und gehen nicht verloren | Kampagnenbalance unverändert |
| Reparaturdrohnen | Infrastruktur | Stellen nach einem Sieg zerstörte Konstruktionen wieder her | HP werden nicht persistiert; heute gehen zerstörte Bauten bei Sieg verloren |
| Threat-Eskalation | offen | Über Zusammensetzung: Fronten (1→4), Spezialgegner je Threat, ab M3 Elite-Affixe und Nacht-Modifikatoren (Blutmond, Nebel-, Bomber-, Brand-, Zugnacht); HP-Multiplikatoren kaum | Lesbare Eskalation statt Schwammgegner |
| Sichtbarer Threat | Salvage-Potenzial steigt | Site-Tiers (rostiger Schrott → Militärgerät → seltene Technik), Reward skaliert mit Entfernung und Tier | Höherer Threat sieht anders aus, nicht nur härter |
| Währung | Schrott + Crafting-Items | Eine Währung „Schrott“; der Rekalibrierungskern ist ein mit Schrott gekaufter Gegenstand. Händlerangebote pro Runde persistiert | Ein Wert, kein Reroll-Exploit per Reload |
| Händler | – | Lobby-UI-Eintrag „Upgrades \| Basis \| Items \| Händler“, dekorativer Stand in der LobbyWorld (begehbar nach LobbyWorld-L2), optionaler Händler-Schritt nach der Runde | Schneller Zugriff ohne Laufwege |
| Rundenzähler | „Day-Progression“ verworfen | „Tag N“ und Statistik (beste Serie) ohne Einfluss auf die Schwierigkeit | Erinnerung ja, Schwierigkeit nur über Threat |

## 4. Rundenstruktur (8:00)

| Phase | Rundenzeit | Uhrzeit im Spiel | Inhalt |
|---|---|---|---|
| Tag | 0:00–3:30 | 10:00 → 18:45 | Salvage-Sites, stiller Tagesdruck |
| Dämmerung | 3:30–4:15 | → 20:45 | Sites schließen, Rückkehr-Marker |
| Nacht | 4:15–7:45 | → 04:45 | 3 Wellen und ein Finale |
| Morgengrauen | 7:45–8:00 | → 06:15 | Sonnenaufgang, Sieg |

Eine reine Phasenfunktion leitet aus Zeitplan und Rundenzeit die Phase ab; die Tageszeit folgt
daraus. Zeitpläne liegen in `src/config/dawn/schedules.json`.

## 5. Basis, Expansion und Threat

- Persönlich gespeichert: `dawn.expansionLevel` 0–9, getrennt von der Kampagnenstufe 0–2.
  Threat = 1 + Expansionsstufe; er wird nicht separat gespeichert.
- Flächenstufe der Basis: 0 = 7×7-Quadrat, Stufe s ≥ 1 = Radius 4 + s (Kampagne bis 2,
  Dawn bis 11 = Radius 15).
- Jede Site hat eine Obergrenze: Kampagne 2, Lobby vorerst 6 (bis zum Lobby-Ausbau in M3),
  Dawn-Arenen 11. Der Host friert pro World `min(persönliche Stufe, Obergrenze der Site)` ein.
- Kapazitätsbonus: +2 Baukapazität je Stufe über der Kampagnenstufe, nach der eingefrorenen Stufe.

## 6. Salvage-Sites und Arenen

- Eine Dawn-Arena ist ein Template: World-Authoring im Coop-Map-Format, angebotene Fronten und
  Salvage-Slots in drei Distanzbändern (nah, mittel, fern), jedes Band in jedem Quadranten. Die Lichtung
  hat 140×96 Zellen und 16 Slots (nah 24–31, mittel 34–43, fern 45–55 Zellen).
- Eine Site wird aktiviert, sobald ein Spieler ihre Lichtung betritt; ihr Ziel läuft parallel zu
  anderen Sites und schließt in der Dämmerung. Wracks werden zerstört, Extraktoren 45 s gehalten.
- Pro Runde wählt der Host Slots, Archetypen und Tiers. Archetypen M1: Wrack (zerstören),
  Extraktor (halten); M3: Brutnest, Versorgung (tragen), Schrottsammler, verstreute Funde,
  Elite-Wrack.
- Sites schließen in der Dämmerung; ein Schrottscanner (M3) zeigt seltene, versteckte Sites.

## 6a. M3-Inhalte (Vertrag)

- **Archetypen** (IDs in `src/dawn/contracts/DawnContentIds.ts`): Wrack (zerstören, Varianten Drohne/Traktor/Lore),
  Extraktor (halten), Brutnest (feindlicher Spawner, zerstören; spawnt bis zur Zerstörung), Versorgung (Kiste aus der
  Kapsel zur Basis tragen), Schrotthaufen (verstreute Funde einsammeln), Schrottsammler (fliehender Gegner, Beute beim Abschuss).
- **Versteckte Sites** (`hidden`) zeigen ohne Schrottscanner (Infrastruktur `scrap-scanner`) keine Navigationsmarker.
- **Nacht-Modifikatoren** (`nightModifierId` im Activity-Plan): Blutmond, Nebelnacht, Bombernacht, Brandnacht; Chance steigt
  mit dem Threat, Wirkung über Komposition und Umgebung, Optik nach SELECTION.md.
- **Elites:** Der Host vergibt beim Spawn Affixe (flink, gepanzert, explosiv, regenerierend, schildend); der Gegner-Snapshot
  trägt nur die Affix-ID. Lesbarkeit: dezenter Bodenring plus Affix-Glyphe über dem Kopf, Form vor Farbe.
- **Lobby-Ausbau:** Die LobbyWorld trägt die volle Dawn-Basis bis Radius 15 (Stufe 11).

## 7. Economy-Modell (in M2 per Simulation kalibriert)

Die Simulation `src/dawn/economy/DawnEconomySimulation.ts` (Balance-Lab-Test `DawnEconomySimulation`, Bericht
`build/dawn/M2-economy.md`) mittelt den Produktionskomponisten über 1.024 Seeds je Threat. Annahmen: 6 Runden pro
Spielstunde, 85 % Siege, 80 % Site-Erfolg, alle Drops gesammelt, 60 % des Schrotts in Expansion, 40 % in andere Käufe
(Nekromantie zuerst).

| Threat | erreicht nach Runden | Stunden | Gutschrift/Runde | Expansion zum nächsten Threat |
|---|---|---|---|---|
| 1 | 0 | 0 | 71 | 80 |
| 2 | 2 | 0,3 | 84 | 300 |
| 3 | 8 | 1,3 | 126 | 600 |
| 4 | 16 | 2,7 | 153 | 1.000 |
| 5 | 27 | 4,5 | 245 | 2.650 |
| 6 | 45 | 7,5 | 283 | 3.750 |
| 7 | 67 | 11,2 | 378 | 6.100 |
| 8 | 94 | 15,7 | 459 | 8.800 |
| 9 | 126 | 21 | 563 | 13.200 |
| 10 | 165 | 27,5 | 613 | – |

Ziele erreicht: Threat 2 nach 2 Runden, Threat 5 nach 4,5 h, Threat 10 nach 27,5 h, Nekromantie-Forschung (100 Schrott)
in Runde 4. Händlerpreise siehe `src/config/dawn/merchant.json`.

## 7a. Händler (Vertrag M2)

Vier Bereiche: **Expansion** (Kosten in `economy.json`), **Infrastruktur** (Reparaturdrohnen Stufe 1–3,
Schrottmagnet), **Upgrades** (Zweig-Forschung wie Nekromantie, Boss-Punkte mit steigendem Preis) und **Ausrüstung**
(Item-Angebot pro Runde, Rekalibrierungskern). Katalog und Preise stehen in `src/config/dawn/merchant.json`;
Käufe sind persönlich und ändern nur den eigenen Fortschritt. Das Item-Angebot wird einmal pro abgeschlossener Runde
gewürfelt und als `dawn.shopOffer` gespeichert, damit Neuladen nichts neu würfelt. Gast-Entitlements reisen im
Loadout-Commit (`coopDefenseEntitlements`) zum Host. Die Preise sind per Simulation kalibriert (Abschnitt 7).

## 8. Multiplayer

- Der Host komponiert die Runde aus seinem Fortschritt (Threat, Expansion, Infrastruktur).
- Jeder Teilnehmer erhält den gesammelten Schrott gutgeschrieben, einmal pro Rundenrevision.
- Persönliche Entitlements (Zweige, gekaufte Boss-Punkte) gelten wie Boss-Punkte heute
  vertrauensbasiert; der Host prüft keine fremden Punktbudgets.
- Die Basis bleibt beim bestehenden Modell: Blueprints gehören dem jeweiligen Besitzer, der Host
  materialisiert und validiert.

## 9. Architekturentscheidungen

1. **Szenario-Transport über replizierte Plandokumente.** Der Host komponiert einen World-Plan
   (`WorldParameters.dawn`) und einen Activity-Plan (`ActivityDescriptor.parameters.dawn`). Jeder
   Peer löst beide mit demselben reinen Resolver auf (Plan → Coop-Config → genau eine
   Normalisierung → World/Activity). Ein Content-Hash über die Dawn-Registries bricht bei
   abweichendem Stand ab; nichts landet in der Kampagnenregistry.
2. **Ein Owner für Definitions-Lookups:** `src/world/WorldDefinitionResolution.ts`. Ein
   Architekturtest mit schrumpfender Allowlist hält direkte Lookups fest.
3. **Dawn ist ein Programm unter `coop_defense`**, kein neuer GameMode und kein neues
   ActivityKind. IDs `world:dawn:<template>` / `activity:dawn:<template>`; `toMapId()` liefert
   für sie `null`. Host-Key `cpg` wählt Kampagne oder Dawn.
4. **Salvage-Sites** sind normale ruhende World-Basen aus dem World-Plan; Ziele nutzen die
   vorhandenen destroy/hold/carry-Objectives mit Trigger `site-activated` (M1).
5. **Persistenz:** Progress-Schema 7 mit Unterdokument `coopDefense.dawn`; Migration V6→V7.
6. **Nachtwellen:** ein reiner Komponist setzt authored Wellenblöcke unter einem Threat-Budget
   zu expliziten Encountern des vorhandenen `scheduled`-Directors zusammen (M1).

## 10. Entscheidungslog

| ID | Datum | Entscheidung | Umkehrbar |
|---|---|---|---|
| D-01 | 2026-10-13 | User-Entscheidungen aus Abschnitt 2 | – |
| D-02 | 2026-10-13, präzisiert M1 | Eine Dawn-Activity ist nur gepaart mit ihrer Dawn-World gültig (`WorldLifecycle` lehnt ungepaarte Paare ab). Die World-Definition hängt nur vom World-Plan ab und ist allein daraus auflösbar (nötig beim Activity-Start); Coop-Config und Activity-Definition brauchen beide Pläne. Die Darstellung behandelt eine Dawn-World ohne Activity (Exit-Fade) wie eine World ohne Coop-Karte. | ja |
| D-03 | 2026-10-13 | Threat = 1 + Expansionsstufe, keine eigene gespeicherte Größe. | ja |
| D-04 | 2026-10-13 | M0-World-Plan trägt nur Template und Content-Hash; Site-Belegung kommt mit der Archetyp-Registry in M1. | ja |
| D-05 | 2026-10-13 | M0 beweist den Transport mit einer Welle als `repel-assault`; `defend-until-dawn` löst das in M1 ab. | ja |
| D-06 | 2026-10-13 | Reservierung = max(10, Radius der Site-Obergrenze) + 2. Kampagne und Lobby bleiben bei 12 (Fingerprints unverändert), Dawn 17. Jedes Dawn-Template muss Stufe 11 tragen (Validator). | ja |
| D-07 | 2026-10-13 | Content-Hash: 64-Bit-FNV-1a über die kanonische JSON-Form aller Dawn-Registries. | ja |
| D-08 | 2026-10-13 | Die aufgelöste Dawn-Config trägt `mapId = dawn:<template>` nur als Kompatibilitätsschlüssel; sie wird nie in der Map-Registry gesucht. | ja |
| D-09 | 2026-10-13 | Nekromantie-Hinweis nur, wenn die Migration tatsächlich Stufen entfernt hat. Unbekannte Zweig-IDs im Progress werden verworfen statt den Fortschritt abzulehnen. | ja |
| D-10 | 2026-10-13 | Händlerangebot (`shopOffer`) kommt in M2 als optionales Feld ohne Schema-Sprung. | ja |
| D-11 | 2026-10-13 | Erste Arena „Lichtung“ (M0): 112×80 Zellen, Basis mittig, 12 Salvage-Slots in drei Distanzbändern; mit D-15 auf 140×96 und 16 Slots vergrößert. Spike S1: 500/500 Seeds erzeugbar, alle Fronten mit Route zur Basis; Slots ohne Generator-Lichtung nur zu ~80 % erreichbar, daher Site-Lichtungen im Generator ab M1. | ja |
| D-12 | 2026-10-13 | Kapazitätsbonus +2 je Stufe über 2; verdrahtet wird er mit der Infrastruktur in M2, solange in M0/M1 niemand über Stufe 2 kommt. | ja |
| D-13 | 2026-10-13 | Dawn-Runden buchen keinen Kampagnenabschluss (`RoundState.coopDefenseMapId` bleibt leer, `RoundState.dawn` trägt Threat und Tag). | ja |
| D-14 | 2026-10-13 | Freischaltung ausschließlich über den Sieg auf der letzten Kampagnenkarte. | ja |
| D-15 | 2026-10-13 (G0) | Arena größer: Lichtung ca. 140×96 Zellen, Basis mittig; Distanzbänder mitskaliert (fern grob 45–55 Zellen). Reicht die Tagesphase für die längeren Wege nicht, wird der Tag maßvoll verlängert; die Runde darf dafür leicht über 8:00 gehen. | ja |
| D-16 | 2026-10-13 (G0) | Nach einer gewonnenen Dawn-Runde gibt es ein Item-Angebot (3 zur Wahl) mit Itemlevel nach Threat (Tabelle in den Threat-Kurven) über den vorhandenen Sieg-Item-Pfad; Händler-Items kommen in M2 zusätzlich. | ja |
| D-17 | 2026-10-13 (G0) | Nekromantie-Forschung ist früh erschwinglich, nach etwa 3–4 Runden (Preis im Economy-Modell, Umsetzung M2). | ja |
| D-18 | 2026-10-13 (G0) | „Beste Serie“ zählt nur aufeinanderfolgende Siege; eine Niederlage setzt die laufende Serie zurück. | ja |
| D-19 | 2026-10-13 (G0) | Late Join in laufende Dawn-Runden ist wie in der Kampagne erlaubt. | ja |
| D-20 | 2026-10-13 (M1) | Tag bleibt 3:30: Bei 280 px/s braucht der Weg zum fernen Band etwa 6–9 s; die Tagesphase wird von der Site-Arbeit bestimmt, nicht vom Laufen. Neu bewertet im G1-Spieltest. | ja |
| D-21 | 2026-10-13 (M1) | Sites aktivieren beim Betreten ihrer Lichtung, laufen gleichzeitig (eigenes Nebenziel-Flag `concurrent`) und schließen in der Dämmerung ohne Belohnung (`expiresAt`). Nachts respawnen Spieler mit 6 s statt 2 s. | ja |
| D-22 | 2026-10-13 (M1) | Threat eskaliert über Fronten (1 → 4), Spezialgegner, Nacht- und Tagesbudget, Site-Zahl (3 → 7) und Tiers; Itemlevel des Sieg-Angebots = Threat + 1. | ja |
| D-23 | 2026-10-13 (M1) | Extraktoren (Hold-Sites) lösen beim Betreten eine eigene Angriffswelle am Lichtungsrand aus (Budget je Tier), sonst wäre Halten trivial. Wracks bleiben ohne Begleitwelle. | ja |
| D-24 | 2026-10-13 (M1) | Schrott: Site-Abschluss = Tier-Belohnung × Threat-Multiplikator (abgerundet); Gegner-Drops nachts 18 %, sonst 4 %, 1–3 Schrott; Niederlage 50 % abgerundet; Expansion kostet laut Economy-Modell v0. | ja |
| D-25 | 2026-10-13 (M1) | Sites sind schon vor der Aktivierung sichtbar: eigener Präsentations-Owner (`DawnSitePropRenderer`) aus repliziertem World-Plan und Nebenziel-Zustand, Bauwerke 3×3 Zellen (96 px, Sprite statt Basis-Blobfläche, World-Feld `surface: none`). Vor der Aktivierung ohne Kollision, weil die Aktivierung beim Betreten der Lichtung greift, bevor man das Bauwerk erreicht. Asset-Keys: `construction_dawn_wreck_t1..t3`, `construction_dawn_extractor` (+ `_active`-Loop), `dawn_scrap_t1..t3`. | ja |
| D-26 | 2026-10-13 (M1) | Der Tag läuft 10:00–18:45 statt ab 07:00: 07:00–09:00 liegt im dichtesten Morgennebel-Keyframe und las sich wie Morgengrauen. Dämmerung 18:45–20:45, Nacht und Morgengrauen unverändert; die Uhr bleibt aus dem Phasenplan abgeleitet. | ja |
| D-27 | 2026-10-13 (M1) | Ansagen nur nachts: Tagesdruck und Site-Angriffe sind still (Encounter-Feld `announce: false`), gezählt werden die vier Nachtwellen als Gruppen (`announce.group`, letzte als „FINALE“). Zeit erscheint als Rundenzeit und Phasenkarte; das Hauptziel nennt nur das Ende („bis 06:15“). Aktive Wracks behalten ihre Farben, Treffer zeigen einen kurzen Flash. | ja |
| D-28 | 2026-10-13 (M2) | Händlervertrag: Katalog `merchant.json` (vier Bereiche, IDs `repair-drones`, `scrap-magnet`, Zweige aus `upgradeBranches.json`, Boss-Punkt-Preisliste mit Kaufgrenze), Item-Angebot pro Runde persistiert (`dawn.shopOffer`), Gast-Entitlements im Loadout-Commit; Nekromantie-Forschung v0 250 Schrott (früh, D-17). | ja |
| D-29 | 2026-10-13 (M2) | Kalibrierte Kosten aus der Economy-Simulation: Expansion 80/300/600/1.000/2.650/3.750/6.100/8.800/13.200, Nekromantie-Forschung 100 (statt 250, sonst erst Runde 8), Infrastruktur und Boss-Punkte rund 60 % der v0-Preise, Ausrüstung etwa zwei Drittel. Site-Belohnungen und Threat-Kurven unverändert. | ja |
| D-30 | 2026-10-13 (G2, User) | Händler-Button und Lobby-Stand bleiben vor Map 20 als Ausblick sichtbar; Käufe erst mit Freischaltung. | ja |
| D-31 | 2026-10-13 (G2, User) | Der Rekalibrierungskern würfelt alle Affixe eines Items neu (Slot, Seltenheit, Level, Grundwert bleiben). | ja |
| D-32 | 2026-10-13 (G2, User) | Reparaturdrohnen wirken nur nach einem Sieg. Heilen im Kampf kommt später als eigenes Infrastruktur-Upgrade „Feldreparatur“ (Backlog). | ja |
| D-33 | 2026-10-13 (G1, User) | G1-Spieltest: Sites sind auffindbar, Nacht-Dunkelheit und Economy passen vorerst. M3 korrigiert: Tag und Nacht deutlich schwerer (Anker Threat 1 ≈ Kampagnen-Maps 18–20, Eskalation über Komposition), Lichtung offener, Wracks/Extraktor nachts beleuchtet, einheitliches GPU-Marker-System für alle Marker inkl. Kampagne. | ja |
| D-34 | 2026-10-13 (M3) | Site-Archetypen M3: Brutnest (Spawner), Versorgung (Carry zur Basis), Schrotthaufen (verstreute Funde), Schrottsammler (fliehender Gegner); Wrack-Varianten Traktor/Lore als Plan-Feld `variant`; versteckte Sites (`hidden`) nur mit Schrottscanner markiert. | ja |
| D-35 | 2026-10-13 (M3) | Nacht-Modifikatoren Blutmond/Nebel/Bomber/Brand als Activity-Plan-Feld `nightModifierId`; keiner bei niedrigem Threat, Chance steigend. | ja |
| D-36 | 2026-10-13 (M3) | Elite-System: Host vergibt Affixe beim Spawn (Chance je Threat), Snapshot trägt nur `eliteAffixId`; Lesbarkeit über Bodenring + Affix-Glyphe (SELECTION.md). | ja |
| D-37 | 2026-10-13 (M3) | Lobby-Ausbau: LobbyWorld trägt die Dawn-Basis bis Stufe 11 (Radius 15); Händlerstand außerhalb der neuen Reservierung. | ja |

## 11. Offene Fragen für Gate G0 (an G0 beantwortet, siehe D-15 … D-19)

1. **Arenagröße:** Ist eine große Arena (Größenordnung 112×80, Basis mittig) gewünscht, oder
   lieber kompakter mit kürzeren Tageswegen? Beeinflusst Laufzeit, Generierung und Performance.
2. **Sieg-Belohnung:** Gibt es nach einer gewonnenen Dawn-Runde zusätzlich ein Item-Angebot
   (Itemlevel nach Threat), oder kommen Items nur über den Händler?
3. **„Beste Serie“:** Zählen nur aufeinanderfolgende Siege (Niederlage setzt zurück)?
4. **Nekromantie-Preis:** Soll „Nekromantie-Forschung“ früh erschwinglich sein (Zugang) oder ein
   spätes Ziel (ab Threat 3–4)?
5. **Late Join in laufende Dawn-Runden:** wie in der Kampagne erlauben (Default) oder sperren?

## 12. Meilensteine

Siehe Umsetzungsplan (`build/dawn/PLAN.md` im Worktree `dawn`): M0 Fundament, M1 spielbarer
Kern-Loop, M2 Händler und Progression, M3 Szenario-Vielfalt, M4 Politur und Release.
