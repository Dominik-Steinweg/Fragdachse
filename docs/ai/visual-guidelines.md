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

## Licht und Schatten

Es gibt drei getrennte Aufgaben, die nicht vermischt werden dürfen: statische Sonnen-/Mondschatten für die Tiefenwirkung (`ShadowSystem`), dynamische Beleuchtung und dynamische Lichtverdeckung (`LightingSystem`).

- **Phasers eingebautes Lighting ist für Gameplay-Licht nicht nutzbar.** Der Shader (`DefineLights.glsl`) ersetzt die Fragmentfarbe durch `ambient + Σ Lichter`, braucht Normal Maps, verlangt `setLighting(true)` pro Objekt (bricht Batches) und kennt **keine geometrische Verdeckung**; `selfShadow` ist nur ein Helligkeitstrick auf der eigenen Textur. Stattdessen komponiert `LightingSystem` eine halbauflösende Lightmap in einer `RenderTexture` und legt sie als ein einziges Overlay auf `DEPTH_LIGHTING` über die Welt – damit werden auch viele Gegner ohne Per-Objekt-Kosten beleuchtet.
- **Tag und Nacht sind derselbe Pfad.** Tag füllt die Lightmap schwarz und komponiert `ADD` (nur Zusatzlicht; hinter einem Felsen fehlt die Aufhellung, es wird aber nicht dunkel), Nacht füllt sie dunkel und komponiert `MULTIPLY`. Neue Lichtquellen nie gegen ein Profil bauen, sondern per Preset mit optionalen `day`/`night`-Overrides.
- **Sichtbarkeitsbedingungen für Lichter und Schatten kommen aus Sprite-Zustand, nicht aus `CombatSystem`.** Dessen Lebendzustand entsteht in `initPlayer()` und das läuft nur auf dem Host – auf Clients gilt dort jeder Spieler als tot. Der Lebendzustand steckt bereits in `sprite.visible`, das beide Seiten beim Tod setzen; `ShadowSystem.syncDynamicShadows()` ist die maßgebliche Vorlage für diese Prüfungen.
- **Lichtfarben sind deutlich weniger gesättigt als die Effektpartikel, die sie begleiten.** Unter dem MULTIPLY-Composite der Nacht begrenzt der schwächste Kanal, wie hell der Boden werden kann: ein sattes Feuerorange wie `0xff5f1e` (1.00/0.37/0.12) lässt Grün und Blau unten und liest sich selbst bei voller Intensität nur als farbiger Schleier. Wer ein Licht heller haben will, hebt zuerst die Kernfarbe an, nicht die Intensität – die ist auf 1 begrenzt. Starkes Flackern ist bei Intensität 1 kontraproduktiv, weil der Ausschlag nach oben abgeschnitten wird und das Licht im Mittel nur dunkler macht.
- **Lichtquellen melden sich in ihrem eigenen Renderer an**, mit `pulse()` für Einmaleffekte und `setLight(key, …)`/`releaseLight(key)` für Dauerlichter am bereits vorhandenen `Map<id, visual>`-Lebenszyklus. Verdeckung ist die Ausnahme (Explosionen, Taschenlampe) und hat ein hartes Frame-Budget; überzählige Lichter fallen auf den verdeckungsfreien Pfad zurück. Spieler und Gegner werden beleuchtet, blocken aber kein Licht.
- **`RockVisualHelper.refreshObstacleVisuals()` ist der einzige Trichter für geänderte Hindernisse.** Er zeichnet die statischen Schatten neu *und* invalidiert den Occluder-Index. Der Index ist reiner Cache über `arenaResult.rockObjects`, `arenaResult.trunkObjects` und `BaseManager.getObstacleRectangles()` – dieselben Referenzen, die `CombatSystem` für Line-of-Sight nutzt. Nie eine zweite Liste zerstörbarer Felsen anlegen. Basen tragen keinen solchen Trichter und werden über `BaseManager.getObstacleGeneration()` erkannt.
- **`DynamicTexture`-Befehle sind aufgeschoben.** An `draw()`/`erase()` übergebene Game Objects werden erst beim Flush ausgelesen, ein wiederverwendetes `Graphics`/`Image` würde also über mehrere Lichter hinweg aliasen. Deshalb besitzt jeder Verdeckungs-Slot eigene Objekte, und die Scratch-`RenderTexture`s laufen mit `setRenderMode('redraw')` knapp unter der Lightmap – die Display-List-Reihenfolge garantiert, dass sie vor ihr geleert werden.
- **Das Overlay liegt unter den Baumkronen, nicht darüber.** Der Schattenwurf gehört zum Baumstamm und darf optisch nicht auf der eigenen Krone landen; `DEPTH_LIGHTING` sitzt deshalb zwischen Stamm und Krone. Kronen liegen darüber und werden einzeln über `LightingSystem.resolveCanopyTint()` eingefärbt – unbeleuchtet auf Umgebungsniveau, unter Licht um `canopyLightFactor` gedämpft. Das nähert die Höhe der Krone über den bodennahen Lichtquellen an, ohne eine zweite Lightmap. Alles, was zur Grundszene gehört und von Licht aufgehellt werden soll (z. B. der statische Kronenschatten), muss unter `DEPTH_LIGHTING` liegen.
- **Verdeckung rechnet mit Blöcken, nicht mit Gitterzellen.** Felsen und Basiszellen sitzen zellgenau am Arena-Grid und werden per 47-Blob-Autotiling zu einem durchgehenden Block gezeichnet. `LightOccluderIndex` bestimmt deshalb je Zelle die freiliegenden Kanten; Kanten zwischen zwei belegten Nachbarzellen desselben Verbunds werfen keinen Schatten, sonst zeichnet sich das Gitter als Treppenmuster in den Block. Felsen und Basen sind getrennte Verbünde und behalten ihre gemeinsame Berührungskante.
- **Der Schatten beginnt an der beleuchteten Kante, nicht an der abgewandten.** Ab dort folgen zwei lückenlos aneinanderstoßende Zonen: ein weicher Verlauf über `OCCLUDER_SHADE_FALLOFF_PX` und dahinter der Vollschatten. Das gibt Hindernissen Volumen, ohne die Bodenschatten zu verschieben – ein Zurücksetzen entlang des Lichtstrahls verlässt den Strahl nicht, die seitliche Silhouette bleibt also unverändert.
- **Weiche Verläufe in Schattenpolygonen laufen über Gouraud-Dreiecke, nicht über gestapelte Alphastufen.** `Graphics.fillGradientStyle(...)` setzt `fillTint.TL/TR/BL`, die `FillTri` als Farbe der Ecken A/B/C übernimmt; zusammen mit dem ERASE-Blend ergibt das einen pro Fragment interpolierten, stufenfreien Übergang. Mehrere teiltransparente Löschdurchgänge sind sichtbar gestuft und multiplizieren sich in Überlappungen auf.
- **Kegellichter brauchen einen schmalen Öffnungswinkel und ein separates Nahfeld.** Ein weiter Kegel deckt am Strahlende mit seinem weichen Saum die halbe Bildhöhe ab und liest sich dann als flächiger Schein statt als Strahl. Ein in die Kegeltextur gebackenes Nahfeld ist zwangsläufig eine Halbscheibe und bricht an der Trägerlinie hart ab; das Nahfeld gehört deshalb als eigenes rundes Licht daneben (`flashlightSpill`).
- Die Lichtrichtung der statischen Schatten ist konstant: `ShadowSystem` berechnet daraus beim Modul-Load feste Bogentabellen. Ein Nachtprofil ändert nur Länge, Deckkraft und Weichheit (`SHADOW_PROFILES`), niemals die Richtung.

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
