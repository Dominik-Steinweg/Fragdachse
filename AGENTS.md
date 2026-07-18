# Fragdachse: Arbeitsregeln

## Kontext sparsam einsetzen

- Zuerst mit `rg` nach Symbolen, Imports und vorhandenen Tests suchen. Nur relevante Dateiausschnitte lesen; große Dateien nicht vollständig laden.
- Für kleine, klar begrenzte Änderungen keine Subagenten, langen Pläne oder vollständigen Repository-Audits starten.
- Repository-Fakten selbst ermitteln. Nur bei einer echten, folgenreichen Produktentscheidung nachfragen.
- Dokumentation nur ändern, wenn sich Verhalten, Bedienung oder eine Architekturregel ändert.
- `docs/architecture.md` nur bei bereichsübergreifenden Änderungen an Netzwerk, Arena-Lifecycle oder Systemgrenzen lesen.

## Projektkarte

- `src/systems/`: hostseitige Simulation und Gameplay-Regeln.
- `src/effects/`: Darstellung, Partikel und visuelle Effekte; kein autoritativer Gameplay-State.
- `src/entities/`: Entity-Lifecycle, Manager und Netzwerk-Synchronisierung.
- `src/scenes/` und `src/scenes/arena/`: schlanke Orchestrierung, Round-Lifecycle und Update-Koordination.
- `src/ui/`: HUD, Overlays und UI-Eingaben.
- `src/network/`: PlayroomKit-Bridge, RPC und Snapshots.
- `src/loadout/`, `src/config/`, `src/types.ts`: Ausrüstung, Konfiguration und gemeinsame Verträge.

## Invarianten

- Das Projekt verwendet Phaser 4. Keine Phaser-3-APIs oder -Muster übernehmen. Phaser als `import * as Phaser from 'phaser'` importieren.
- Nur `src/network/NetworkBridge.ts` importiert `playroomkit` direkt. Gameplay bleibt host-autoritativ; Clients senden Eingaben und stellen Snapshots/Ereignisse dar.
- `ArenaContext` trennt Scene-Lifetime von Round-Lifetime. Round-Systeme sind außerhalb einer aktiven Runde `null`, werden in `buildArena()` gesetzt und in `tearDownArena()` bereinigt.
- Scenes orchestrieren. Gameplay-Logik gehört in Systems, Visuals in Effects/Renderer und Entity-Lifecycle in Manager.
- Vor neuen Abstraktionen bestehende Systeme, Manager, Renderer und Utilities prüfen. Gameplay-Konstanten nicht als Magic Numbers verteilen.

## Proportionale Prüfung

| Änderung | Erforderliche Prüfung |
|---|---|
| Nur Markdown, Agentenanweisungen oder Kommentare | Keine Tests |
| Kleine isolierte TypeScript-Änderung | `npm run typecheck` |
| Änderung an einem getesteten Modul | Passende Testdatei, z. B. `npm test -- tests/RoomQualityMonitor.test.ts` |
| Mehrere Module, Netzwerk, Lifecycle oder Build-Konfiguration | `npm run check` |
| Sichtbare Phaser-/UI-Änderung | `npm run build`; visuell nur bei tatsächlich geändertem Verhalten prüfen |

- Nicht automatisch `npm ci`, Build und vollständige Tests für jede Kleinigkeit ausführen.
- Vor `npm run build` nicht zusätzlich typechecken; der Build enthält TypeScript bereits.
- Keine Tests nur für Abdeckungszahlen erzeugen. Im Abschluss ausschließlich tatsächlich ausgeführte Prüfungen knapp nennen.
- Keine Linux-/CI-, Playwright-, Coverage-, ESLint- oder Modell-Konfiguration ergänzen, sofern die Aufgabe dies nicht ausdrücklich verlangt.

## Browser-Verifikation

- Der Browser ist keine Standardprüfung. Nur für sichtbar geänderte Phaser-/UI-/Scene-Darstellung und einmal am Ende verwenden.
- `npm run dev:browser` starten. Vor dem Öffnen muss `Invoke-WebRequest -Uri 'http://127.0.0.1:8080/' -UseBasicParsing -TimeoutSec 5` Status 200 liefern; dann exakt diese URL öffnen.
- Höchstens einen Verbindungs- und einen Seitenlade-Wiederholungsversuch. Blockiert Playroom den Boot, abbrechen und als Umgebungsblocker melden.
- Nur den betroffenen Modus/Zustand prüfen; Konsole und Netzwerk nur bei konkreter Diagnose. Browser und Server danach beenden.
- Bekannte Phaser-Meldungen `Failed to process file ... image ...` für noch fehlende Loadout-, Upgrade- und Gegnerfähigkeits-Sprites ignorieren. Sie sind nicht testentscheidend und werden nicht untersucht, solange das Zielbild rendert.
