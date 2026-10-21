# Portal-Generator der Gegner – GDD V1

Stand: 2026-10-21, umgesetzt auf dem Branch `portal-generator` (M1–M5). Maßgeblich ist der Code.

## Idee

Die Gegner betreiben einen zerstörbaren **Portal-Generator**. Er baut eine Portalverbindung auf. Gegner überbrücken damit einen sonst langen, durch Fels oder Wasser abgetrennten Weg und greifen die Basis über eine zusätzliche Flanke an. Spieler zerstören den Generator:
- in der Kampagne als Nebenmission,
- in From Dachs Till Dawn als Tagesmission.

Danach kann niemand mehr das Portal benutzen, weder Gegner noch Spieler.

## Spielregeln

- **Aufbau:**
  - Der Generator steht ab Missionsbeginn. Bis zur Öffnung baut er sichtbar auf: Ladering an beiden Endpunkten, flackernder Riss am Ausgang, pulsierende Energieleitung.
  - Map 08 lädt 75 s, Dawn 40 % des Tages (≈ 54 s).
- **Offen:**
  - Das Portal bleibt offen, bis der Generator fällt; in Dawn höchstens bis zum Morgen.
  - Gegner planen es als Abkürzung ein. Spieler, Geschosse und Hitscan gehen ebenfalls hindurch.
  - Bosse, unbewegliche Gegner und Körper über 20 px Radius gehen nicht hindurch.
- **Wachtrupp:** Er rückt an, sobald jemand die Generator-Lichtung betritt oder den Generator trifft. In der Kampagne ist er ein stiller Neben-Encounter außerhalb der Angriffskette, in Dawn die übliche Stätten-Welle.
- **Zerstörung:**
  - Das Portal kollabiert für immer, mit einer violetten Implosion. Gegner nahe beider Endpunkte werden verlangsamt und angezogen.
  - Wer gerade draußen steht, muss zu Fuß zurück. Das ist gewollte Spannung.
- **Belohnung:**
  - Kampagne: 150 XP.
  - Dawn: 20 / 35 / 50 Schrott je Tier. Die Expansionskosten ab Bedrohung 3 sind dafür um das Mehreinkommen angehoben, sodass die Progression Runde für Runde gleich bleibt.

## Kampagne – Map 08 „Dimensionsbruch“

- Generator im Westen (23/13, 3000 HP), in einer ruhigen Tasche südlich der Hauptroute der West-oben-Welle.
- Eingang bei 25/9, Ausgang hinter der Basis bei 100/18.
- Nebenziel `destroy-portal-generator` (gleichzeitig mit dem Halten der Bastion).
- Wachtrupp `portal-guard` aus der Zone West-oben.

## Dawn

- **Archetyp** `portal-generator`:
  - ab Bedrohung 3, Chance 35 %, je Stufe +5 %, höchstens 60 %;
  - HP 2400 / 3600 / 5000.
- **Platzierung** (eigener Kompositionsschritt, höchstens einer je Runde, nicht Teil von `siteCount`):
  - Generator auf einem mittleren oder fernen Bergungsplatz Richtung Hauptfront.
  - Ausgang auf einem freien nahen Platz an einer Seite, von der in dieser Runde nicht angegriffen wird.
  - Beide Lichtungen liegen auf Land.
- **Zerstörbar** bleibt der Generator die ganze Runde.
- **Debug-Menü:** „DAWN: PORTAL-GENERATOR ERZWINGEN“.

## Architektur (Kurzfassung)

| Zustand | Owner | Scope |
|---|---|---|
| Endpunkt-Anker `portalAnchors` (freie Lichtungen) | Authoring | World |
| Verbindung `portalLinks` (Generator, Aufbau, Radius, Größengrenze, Kollaps) | Authoring, Defaults in `coopDefensePortalLinks.ts` | Activity |
| Lebenszyklus `waiting → charging → open → collapsed` | `PortalLinkSystem` (Host) | Activity |
| Akteur-Sprünge, Gates, zusammengeführte Paare | `WorldPortalTransport` (einziger Akteur-Transport) | World |
| Navigations-Links | `FlowFieldCoordinator.setPortalLinks`, nur aus offenen Links | Activity |

- **Replikation:** Key `cpl` mit Phasen und Missionszeiten je Link-ID. Peer-Protokoll 42, Dawn-Plan v2 (`portalExitSlotId`), Dawn-Content-Schema 3.
- **Darstellung:** `VoidPortalRenderer` mit Generator-Asset „Resonanzkessel“ (Konzept A) samt Emissive-Ebenen, Licht-Preset `voidPortal`, GPU-Effekt `VoidPortal`, Marker-Glyph `portal` am Ausgang und HUD-Statuszeile.

## Entscheidungslog

| ID | Datum | Entscheidung |
|---|---|---|
| PG-1 | 2026-10-21 | Dawn: Aufbau, dann offen (Nutzer). |
| PG-2 | 2026-10-21 | Kampagnen-Pilot ist Map 08 (Nutzer). |
| PG-3 | 2026-10-21 | Durchgang wie beim Translokator, ohne Bosse und große Körper (Nutzer). |
| PG-4 | 2026-10-21 | Generator mit Wachtrupp und Kollaps-Implosion (Nutzer). |
| PG-5 | 2026-10-21 | Der Aufbau startet zu einer festen Missionszeit (`chargeStartMs`), nicht über die allgemeinen Mission-Trigger. Das ist einfacher und reicht für Map 08 und Dawn. |
| PG-6 | 2026-10-21 | Der Dawn-Ausgang nutzt freie, schon validierte Bergungsplätze statt neuer Template-Anker. Der Eingang rückt näher an den Generator, bis seine Lichtung trocken ist. |
| PG-7 | 2026-10-21 | Dawn-Belohnung 20 / 35 / 50 Schrott, Expansionskosten ab Bedrohung 3 neu kalibriert (Nutzer: „kleine Belohnung + neu kalibrieren“). |
| PG-8 | 2026-10-21 | Generator-Asset: Konzept A „Resonanzkessel“ (Nutzer). |
| PG-9 | 2026-10-21 | Map 08: Generator von 19/6 nach 23/13 verschoben. Auf 19/6 stand er direkt auf der Route der West-oben-Welle, allein war er nicht erreichbar. Der Eingang bleibt an der Route bei 25/9. Der HUD-Titel heißt „GENERATOR ZERSTÖREN“, der Status „PORTAL NN %“ bzw. „PORTAL OFFEN“, damit nichts gekürzt wird (Nutzer: „Lage + HUD-Titel anpassen“). |

## Offen

- Spieltest von Map 08 und Dawn: Stärke der Flanke, Aufbauzeit, Lage von Generator und Ausgang, Lesbarkeit bei Nacht.
- Feinlage der Map-08-Anker im Map-Editor (heute nur JSON).
- Der Durchbruchsplaner kennt Portale nicht (dokumentierte Grenze, siehe [Navigationsstatus](../navigation-implementation-status.md)).
