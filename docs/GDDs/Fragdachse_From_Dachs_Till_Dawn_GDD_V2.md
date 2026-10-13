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
| Arenen-Anzahl | offen | M0/M1: 1 („Lichtung“), ab M3 mindestens 4 | Erst den Loop beweisen, dann Vielfalt |
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
| Tag | 0:00–3:30 | 07:00 → 18:30 | Salvage-Sites, Tagesdruck |
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
  12–16 Salvage-Slots in drei Distanzbändern (nah, mittel, fern).
- Pro Runde wählt der Host Slots, Archetypen und Tiers. Archetypen M1: Wrack (zerstören),
  Extraktor (halten); M3: Brutnest, Versorgung (tragen), Schrottsammler, verstreute Funde,
  Elite-Wrack.
- Sites schließen in der Dämmerung; ein Schrottscanner (M3) zeigt seltene, versteckte Sites.

## 7. Economy-Modell v0 (Zielkurve, in M2 per Simulation kalibriert)

Annahmen: etwa 6 Runden pro Spielstunde (8 min Runde plus Lobby), Schrott pro gewonnener Runde
wächst mit Threat um ca. 25 % je Stufe (Site-Tiers, Entfernung), etwa 60 % des Schrotts fließen
in Expansion, der Rest in Infrastruktur, Zweige und Ausrüstung.

| Schritt | Runden (kumuliert) | Spielzeit (kumuliert) | Schrott/Runde | Expansionskosten |
|---|---|---|---|---|
| T1→2 | 2 (2) | 0,3 h | 100 | 120 |
| T2→3 | 6 (8) | 1,3 h | 125 | 450 |
| T3→4 | 8 (16) | 2,7 h | 155 | 750 |
| T4→5 | 11 (27) | 4,5 h | 195 | 1.300 |
| T5→6 | 18 (45) | 7,5 h | 245 | 2.600 |
| T6→7 | 22 (67) | 11 h | 305 | 4.000 |
| T7→8 | 27 (94) | 16 h | 380 | 6.200 |
| T8→9 | 32 (126) | 21 h | 475 | 9.200 |
| T9→10 | 39 (165) | 27,5 h | 595 | 14.000 |

Zielwerte aus dem Plan: Threat 2 nach etwa 2 Runden, Threat 5 nach 4–5 h, Threat 10 nach 25–30 h.
Niederlagen (50 % Schrott) und Ausgaben außerhalb der Expansion verlängern die Kurve; die
M2-Simulation legt die tatsächlichen Kosten fest.

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
| D-02 | 2026-10-13 | Eine Dawn-World ist nur zusammen mit ihrer Dawn-Activity gültig (beide Pläne gepaart; `WorldLifecycle` lehnt ungepaarte Paare ab). Die Darstellung behandelt eine Dawn-World ohne Activity (Exit-Fade) wie eine World ohne Coop-Karte. | ja |
| D-03 | 2026-10-13 | Threat = 1 + Expansionsstufe, keine eigene gespeicherte Größe. | ja |
| D-04 | 2026-10-13 | M0-World-Plan trägt nur Template und Content-Hash; Site-Belegung kommt mit der Archetyp-Registry in M1. | ja |
| D-05 | 2026-10-13 | M0 beweist den Transport mit einer Welle als `repel-assault`; `defend-until-dawn` löst das in M1 ab. | ja |
| D-06 | 2026-10-13 | Reservierung = max(10, Radius der Site-Obergrenze) + 2. Kampagne und Lobby bleiben bei 12 (Fingerprints unverändert), Dawn 17. Jedes Dawn-Template muss Stufe 11 tragen (Validator). | ja |
| D-07 | 2026-10-13 | Content-Hash: 64-Bit-FNV-1a über die kanonische JSON-Form aller Dawn-Registries. | ja |
| D-08 | 2026-10-13 | Die aufgelöste Dawn-Config trägt `mapId = dawn:<template>` nur als Kompatibilitätsschlüssel; sie wird nie in der Map-Registry gesucht. | ja |
| D-09 | 2026-10-13 | Nekromantie-Hinweis nur, wenn die Migration tatsächlich Stufen entfernt hat. Unbekannte Zweig-IDs im Progress werden verworfen statt den Fortschritt abzulehnen. | ja |
| D-10 | 2026-10-13 | Händlerangebot (`shopOffer`) kommt in M2 als optionales Feld ohne Schema-Sprung. | ja |
| D-11 | 2026-10-13 | Erste Arena „Lichtung“: 112×80 Zellen, Basis mittig (Spike S1 bestätigt oder korrigiert die Maße). | ja |
| D-12 | 2026-10-13 | Kapazitätsbonus +2 je Stufe über 2; verdrahtet wird er mit der Infrastruktur in M2, solange in M0/M1 niemand über Stufe 2 kommt. | ja |
| D-13 | 2026-10-13 | Dawn-Runden buchen keinen Kampagnenabschluss (`RoundState.coopDefenseMapId` bleibt leer, `RoundState.dawn` trägt Threat und Tag). | ja |
| D-14 | 2026-10-13 | Freischaltung ausschließlich über den Sieg auf der letzten Kampagnenkarte. | ja |

## 11. Offene Fragen für Gate G0

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
