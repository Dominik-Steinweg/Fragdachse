# Visuelle Leitlinien

Diese Regeln sind für sichtbare Gameplay-Arbeit verbindlich. Ergänzend immer eine passende bestehende Referenz und die relevanten offiziellen Phaser-Skills prüfen.

## Zielplattform und Qualitätsmaßstab

Fragdachse richtet sich an leistungsfähige Desktop-PCs und Desktop-Browser des Jahres 2026. Optisch ansprechende, produktionsnahe Ergebnisse sind der Standard. Ohne ausdrücklichen Prototyp-Auftrag nicht bei rudimentären Platzhaltern stehen bleiben.

Performance bleibt Teil der Abwägung, auch wenn der typische Engpass eher Netzwerk/Simulation als reine Darstellung ist. Bevorzugen:

- GPU-freundliche Phaser-4-Mechanismen und vorhandene Effekt-/Renderer-Infrastruktur.
- Pooling oder Wiederverwendung bei häufig erzeugten Objekten; klar begrenzte Burst-Objekte vollständig abbauen.
- Moderne Partikeleffekte, maßvolle Additive-Layer und nachvollziehbare Depth-Reihenfolge.
- explizites Lifecycle- und Cleanup-Verhalten für Emitter, Tweens, Timer, Filter und Game Objects.

## Verbindliche Perspektive

Die Gameplay-Kamera ist orthografisch und steht 90° senkrecht über der Spielfläche, grob vergleichbar mit der Gameplay-Perspektive von Hotline Miami. Der Vergleich beschreibt ausschließlich die Kamera, nicht Stil, Farben oder konkrete Gestaltung.

Für Gameplay-Grafiken und PNGs gilt:

- direkte Ansicht von oben;
- keine isometrische, Dreiviertel-, schräge oder oblique Perspektive;
- kein Horizont, keine Fluchtpunkte und keine perspektivische Verjüngung;
- keine unbeabsichtigt sichtbaren Objektseiten;
- Maßstab, Orientierung und Lichtlogik müssen zu vorhandenen Assets passen.

Spieler- und Gegner-Quellbilder zeigen nach Norden. `PlayerEntity` und `EnemyEntity` addieren `Math.PI / 2`, weil Phaser-Aimwinkel 0 nach rechts zeigt. Neue rotierende Figurensprites an diese Nordausrichtung anpassen; den Sprite-Rotationsoffset nicht in Gameplay-Aimwinkel oder Mündungsberechnungen einmischen.

## Effekte als Sequenz

Effekte als zeitlich komponierte, gegebenenfalls mehrschichtige Sequenz planen. Je nach Gameplay-Funktion prüfen:

- Antizipation oder initialer Flash;
- primäre, sofort lesbare Form und Hauptwirkung;
- sekundäre Partikel, Debris, Shockwave oder Trail;
- Glow-, Licht-, Filter- oder Kamerareaktion;
- Residual-Effekt, sauberes Abklingen und vollständiges Cleanup.

Nicht jedes Element ist immer sinnvoll. Telegraphen priorisieren Lesbarkeit und korrekte Fläche; Impact-Layer dürfen spektakulär sein, sollen aber Ziele und Gefahren nicht unnötig lange verdecken. Kamerashake nach Reichweite, Bedeutung und Häufigkeit dosieren.

## Offsets und Ausrichtung

Weltpositionen, Aimwinkel und visuelle Anhänge nicht mit Sprite-Frame-Offsets vermischen.

- Die kanonische Mündungslogik liegt in `getTopDownMuzzleOrigin()` und `getTopDownMuzzleOriginFromVector()` in `src/config.ts`: Weltursprung plus normalisierte Schussrichtung mal `MUZZLE_FORWARD_OFFSET` (`PLAYER_SIZE * 0.7`). Hitscan, lokale Prediction, Aim-Telegraphen, Audio und Mündungsfeuer teilen diese Logik.
- `MuzzleFlashRenderer` erwartet bereits die berechnete Mündungsposition. Dort keinen zweiten Vorwärts-Offset hinzufügen.
- Wenn ein Client beim ersten Projektil-Snapshot keine Owner-Position hat, rekonstruiert `ProjectileManager` einen Ursprung durch Backtracking entlang der Geschwindigkeit und wendet danach denselben Mündungsoffset an. Diesen Fallback nicht durch stilabhängige Ad-hoc-Offets ersetzen.
- Trails/Exhaust werden aus der normalisierten Flugrichtung relativ zum Projektilzentrum berechnet, etwa in `RocketRenderer` und `GrenadeRenderer`. Lokale Offsets zuerst in Richtungs-/Normalenvektoren umrechnen, dann in Weltkoordinaten anwenden.
- Grid-Assets verwenden `ARENA_OFFSET_X/Y + grid * CELL_SIZE + CELL_SIZE / 2`; absichtliche Decal-Jitter kommen erst danach hinzu (`ArenaVisualFactory`).

## Assets

Neue Grafiken vor Verwendung mit realen Dateien unter `public/assets/sprites/` vergleichen:

- Perspektive und Nordausrichtung;
- native Auflösung und Pixel-/Detailgrad;
- Maßstab zum 32-px-Spieler und 32-px-Grid;
- transparenter Hintergrund und saubere Alphakanten;
- Lesbarkeit auf Gras, Dirt, Effekten und Teamfarben.

Loadout-/Upgrade-Icons liegen unter `public/assets/sprites/Loadout/` und werden über Konfigurations-IDs geladen. Weltassets, UI-Icons und prozedural erzeugte Runtime-Texturen nicht ohne Prüfung austauschbar behandeln. Neue Assets nur erzeugen, wenn der Auftrag dies verlangt oder der Nutzer vorher zustimmt; generierte Gameplay-Assets ausdrücklich gegen die 90°-Top-down-Regeln validieren.
