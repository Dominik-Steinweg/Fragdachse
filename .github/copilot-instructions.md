# Fragdachse – Copilot Instructions

## Projekt

Fragdachse ist ein Multiplayer-Top-Down-Shooter mit TypeScript (strict), Phaser 4, PlayroomKit und Vite.

## Interaktion

- **Stelle Fragen, bevor du Code schreibst.** Klaere Anforderungen, Randfaelle und gewuenschtes Verhalten, bevor du eine Implementierung vorschlaegst.
- Bei Mehrdeutigkeit: Rueckfragen stellen statt Annahmen treffen.
- Schlage bei nicht-trivialen Aenderungen 2–3 Alternativen mit Tradeoffs vor und lass den User entscheiden.
- Pruefe vor jeder Aenderung, ob bestehender Code bereits die gewuenschte Funktionalitaet abdeckt.

## Architektur

| Verzeichnis | Rolle | Namenskonvention |
|---|---|---|
| `src/systems/` | Host-Side Simulation, Gameplay-Regeln, Callbacks, `getSnapshot()` | `{Domain}System` |
| `src/effects/` | Visuals: Partikel, Canvas-Texturen, Post-FX (kein Gameplay-State) | `{Effect}Renderer` |
| `src/entities/` | Entity-Lifecycle, Batch-Operationen, Network-State-Sync | `{Domain}Manager` |
| `src/scenes/arena/` | Round-Lifecycle, Update-Loops, RPC-Dispatch (Coordinators) | `{Domain}Coordinator` |
| `src/ui/` | HUD-Panels, Overlays, Eingabe-Handler | `{Region}HUD` / `{Region}Panel` |
| `src/network/` | PlayroomKit-Bridge, RPC, State-Snapshots | — |
| `src/config.ts` | Zentrale Konstanten: DEPTH, COLORS, Gameplay-Werte | CAPS fuer Konstanten |
| `src/types.ts` | Shared Interfaces und Typ-Definitionen | PascalCase |

- `ArenaContext` ist der Dependency-Container – nutze ihn, statt Systeme manuell zu verdrahten.
- Scenes bleiben schlank und orchestrieren nur. Feature-Logik gehoert in Systems, Renderers oder Managers.

## Code-Conventions

### Naming

- Klassen: PascalCase (`AirstrikeSystem`, `FlameRenderer`).
- Konstanten: UPPER_SNAKE_CASE (`PLAYER_SIZE`, `DEPTH_FLAME`).
- Texture-Keys: Prefix `__` (`'__bullet_body_default'`).
- Private Felder: `private` Keyword (kein `#`-Prefix).

## Wiederverwendbarkeit

1. **Vor jeder neuen Abstraktion pruefen**, ob ein bestehendes System, Manager oder Renderer die Aufgabe bereits abdeckt.
2. Gameplay-Konstanten in `src/config.ts` zentralisieren – keine Magic Numbers im Code.
3. Filter- und FX-Logik ueber `src/utils/phaserFx.ts` – keine eigenen Wrapper.
4. Kleine, fokussierte Methoden bevorzugen. Eine Methode = eine Aufgabe.

## Phaser-spezifisch

- Fuer Phaser-API-Fragen die lokalen Skills unter `.github/skills/` konsultieren.
- Es wird die sehr neue Phaser 4 Version verwendet – keine Phaser 3 APIs oder Patterns verwenden.
- Falls Skills fehlen oder veraltet sind: `npm run copilot:sync-phaser-skills`.
- Keine Phaser-3-APIs verwenden – bei Unsicherheit `phaser-v3-to-v4-migration` und `phaser-v4-new-features` Skills pruefen.
