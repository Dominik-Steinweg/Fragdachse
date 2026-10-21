# Sprengbare Brücken V1 – dynamische Laufwege

Stand: 2026-10-21, Branch `bridges`. Plan: `C:\Users\domin\.claude\plans\ich-m-chte-folgendes-im-mellow-mountain.md`.

## Ziel

Spieler verändern im Rahmen einer Mission die Welt und damit die Laufwege der Gegner. Erstes Element:
Holzbrücken über Wasser, die Spieler und Gegner normal begehen. Wer eine Dynamitkiste zur Brücke trägt,
kann per Shift eine Sprengladung anbringen. Nach fünf Sekunden Zündschnur stürzt die Brücke ein; danach
müssen alle einen anderen Weg nehmen, die Basis wird z. B. nur noch über zwei statt drei Flanken
angegriffen. Einführung in Map 12 „Gegenschlag“, zentral in From Dachs Till Dawn (tagsüber sprengen →
nachts leichter verteidigen; der eigene Weg zu Sites jenseits des Flusses fällt dafür weg).

## Entscheidungen des Users (2026-10-20/21)

1. Zerstörung nur durch **getragenen Sprengstoff** (vorhandenes Trage-System), nie durch Beschuss.
2. Anbringen per **Shift an der Brücke**: mit Kiste „Sprengladung anbringen“, ohne Kiste Hinweis
   „Sprengstoff fehlt“.
3. Einsturz: **alle auf dem Deck stürzen ab** (Spieler und Gegner); die Explosion schadet Gegnern.
4. Kampagne: **Map 12** – der feste Südübergang bleibt, eine Brücke kommt dazu; Sprengstoff aus einem
   **Lager im Feld**.
5. Dawn: **neues Fluss-Template und Brücken in bestehenden Templates**; Sprengstoff aus einem neuen
   Site-Typ **Sprengstofflager**.
6. Draft-Optik zuerst, HQ-Asset später; Zwischen-Gates übernimmt Claude, User-Abnahme am Ende.

## Regeln (umgesetzt)

- **Authoring:** `bridges: [{ id, axis, gridX, gridY, spanCells 2..12, deckWidthCells 2..4 }]` als
  World-Feld. Decks liegen auf Wasser, Widerlager auf trockenem Land; dieselbe Reservierungsprüfung wie
  Wasser (Basen, persistente Basis, Felswände, Barrieren, Checkpoints, Schienen), dazu keine Wasser-
  Spawnzonen, kein Kraken-Habitat, keine Überlappung. Jede World verbindet ihr Land auch ohne Brücken.
- **Geometrie:** Kollisionswasser = authored Wasser minus Decks stehender Brücken. Ein Einsturz macht
  das Deck wieder zu Wasser; Spieler gleiten am Ufer, Schwimmer schwimmen durch, die Navigation rechnet
  neu (Kosten wie ein zerstörter Fels).
- **Zustand:** `standing → charged (Zündschnur 5 s) → collapsed`, World-scoped, Slice `bg`. Eine neue
  World (jede Runde) beginnt mit stehenden Brücken.
- **Sprengstoff:** Carry-Ziel mit `carry.item: 'explosive'` ohne Abgabezone; `targetGoal` ≤ Anzahl
  Brücken. Anbringen verbraucht die Kiste und zählt als Fortschritt; mit dem Ziel verschwinden
  Reservekisten.
- **Einsturz:** Wer mit dem Mittelpunkt auf dem Deck steht, stirbt (Killfeed „Brücke gesprengt“);
  getötete Gegner zählen für den Zünder. Ausnahmen: Schwimmer, eingegrabene/abgetauchte Gegner; Bosse
  verlieren nur 35 % ihrer maximalen HP. Explosion: 112 px, 140 Schaden nur gegen Gegner.
- **Shift:** Kandidat nur, wenn in der Runde Sprengstoff existiert, sonst bleiben Brücken normaler Boden
  (Shift bleibt Eingraben). Reichweite 56 px um das Deck.

## Entscheidungslog (Claude, reversible Defaults)

| Datum | Entscheidung | Grund |
|---|---|---|
| 2026-10-21 | Interaktionsradius 56 px statt 40 px | 40 px verlangte, praktisch auf dem Widerlager zu stehen; 56 px greift beim Heranlaufen |
| 2026-10-21 | Bosse 35 % maxHP statt Tod | Sofort-Boss-Kill wäre ein Exploit |
| 2026-10-21 | Zündsignal: Airstrike-Countdown beim Zünden und 1,6 s vor dem Knall | vorhandener Klang, klare Warnung zum Verlassen des Decks |
| 2026-10-21 | Eigene Aufnahme `sfx_explosion_bridge` (Mischung aus Detonation, Holzbruch, Wasserplatscher) | Audio-Vertrag verlangt eine eigene Aufnahme pro Quelle |
| 2026-10-21 | Map 12: Brücke `east-river-bridge` bei x77–80, y20–22 (engste Stelle des Ostflusses), ohne Wasseränderung | Fluss ist dort schon 4 Zellen schmal; Südübergang bleibt unverändert |
| 2026-10-21 | Map 12: Feldlager `field-cache` (64,22, r 3) zwischen Mittelbasis und Fluss, 2 Kisten, Ziel 1 Brücke, `concurrent` | liegt auf dem Weg der Westwellen, also umkämpft; das Halteziel der Nebenbasis behält den Fokus |
| 2026-10-21 | Gleichzeitige (`concurrent`) Nebenziele sind von der Fenster-Überlappungsprüfung ausgenommen | sie belegen per Vertrag keinen Fokus-Slot |
| 2026-10-21 | Dawn: Archetyp `demolition-cache` (`carryItem: explosive`, `selectionWeight` 0) wird nie gezogen, sondern genau bei Templates mit Brücken eingeplant (eigener Seed-Stream `demolition`, freier Nah-/Mittel-Slot) | Sprengstoff soll tagsüber geholt werden, solange die Brücken noch zu den anderen Sites führen; Templates ohne Brücken behalten exakt ihre Pläne |
| 2026-10-21 | Lager: eine Kiste je Template-Brücke, Ziel = alle Brücken, Tiers 1–3 mit 15/25/35 Schrott und Angriffswelle (18/30/44) nach 3 s | Lager ist umkämpft und belohnt vollständiges Sprengen nur leicht; der eigentliche Lohn ist die leichtere Nacht |
| 2026-10-21 | Neues Template `riverbend` (140×96): U-Fluss um die Basis (West, Nord, Ost), nach Süden offen, drei Brücken; alle Sites jenseits des Flusses | ohne Brücken bleibt nur der lange Weg um die Flussenden; tagsüber sind die Brücken der kurze Weg zu den Sites |
| 2026-10-21 | `pondland`: Kanal vom Ostteich zum Südrand mit einer Brücke | östliche Angreifer haben zwei Wege um den Teich, nach dem Sprengen nur noch den nördlichen |

## Offene Punkte

- Shift-Plakette und Marker überlagern sich am Brückenende (Marker-Layout).
- HQ-Asset (Blender) für Deck, Widerlager, Ruine, Kiste und Ladung; die Draft-Ruine ist zu unscheinbar.
- Dawn-Nacht im Dev-Szenario nicht live angesehen (`dawnSkip` verweigerte nach Teleports); Erreichbarkeit aller Fronten
  und Sites mit gesprengten Brücken sichern `test:stress:dawn` und der Sweep.
