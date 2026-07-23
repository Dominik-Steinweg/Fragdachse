# Performance und Grafikqualität

Grafikqualität ist eine lokale, sofort wirksame Einstellung. `GraphicsQualityController` besitzt die Profile `high`, `medium` und `low`; `localPreferences` persistiert die Auswahl. Sie wird weder repliziert noch in autoritative Simulation, Physik, Trefferprüfung oder Netzwerktakt eingespeist. Ein Host hat deshalb weiterhin seine zusätzliche Simulations- und Netzwerkbelastung, unabhängig von der gewählten Darstellung.

## Visuelle Budgets

Die Profile steuern zentral:

- Partikelmengen und laufende Emissionsraten nach `critical`, `standard` und `decorative`;
- Lightmap-Auflösung, maximale Lichter und Verdeckungs-Slots;
- Dichte statischer Schatten-Layer und Projektilschatten;
- interne und externe Phaser-Filter.

Der Controller wird am Anfang von `ArenaScene.create()` an die Scene gebunden. Danach erzeugte ParticleEmitter werden automatisch als `standard` erfasst. Abweichende Bedeutung wird am vorhandenen Emitter gesetzt oder beim Effect-Helper angegeben. `critical` ist für Gameplay-Lesbarkeit reserviert, `decorative` für gefahrlos entfallende Atmosphäre. Neue Qualitätszweige dürfen keine Gameplay-Konfiguration duplizieren.

Filter werden über `utils/phaserFx.ts` registriert, damit ein Profilwechsel bestehende Handles sofort aktiviert oder deaktiviert. `LightingSystem` und `ShadowSystem` abonnieren das Profil und bauen nur ihre lokalen Renderressourcen neu auf; Spielzustand bleibt erhalten.

## Statischer Boden als gebackene RenderTexture

Der Dirt-Boden ist rein statisch und macht den Großteil der Display-Liste aus (mehrere tausend Kacheln). `ArenaBuilder.bakeDirt()` erzeugt die Kacheln mit Autotiling, backt sie einmalig in eine arenagroße RenderTexture (interne Kamera um den Arena-Offset gescrollt, damit weltpositionierte Bilder korrekt landen) und verwirft danach die Einzel-Images. So läuft pro Frame ein Objekt statt tausender durch Renderwalk und Transform-Schritt; die Kosten sind fix und qualitätsunabhängig. Zerstörbare Felsen bleiben bewusst außen vor und dynamisch.

`ArenaBuilderResult` führt deshalb `dirtLayer` (das gebackene Objekt, für Teardown) und `dirtStamps` (die Kachel-Geometrie) statt einer Image-Liste. Der `ArenaTerrainColorSampler` zeichnet seine CPU-Canvas aus `dirtStamps`, nicht aus Live-Objekten – wer weitere statische Layer backt, muss deren Geometrie ebenso für den Sampler erhalten.

## Lokaler Messworkflow

`T` öffnet die Performance-Diagnose. Die Live-Ansicht arbeitet ohne Telemetrie. Eine Aufzeichnung wird manuell gestartet und gestoppt, ist auf 30 Minuten begrenzt und kann danach als JSON heruntergeladen werden. Der Export enthält Browser-/Renderer-Metadaten und Qualitätswechsel, aber keine Raumcodes oder Spieler-IDs.

Messfenster trennen Frame-Delta, Scene-Update, CPU-Render-Abgabe, Netzwerk-Update/-Flush, Visuals sowie Host-Simulation beziehungsweise Client-Synchronisierung. Dadurch darf ein langsamer Host nicht vorschnell der Grafik zugeschrieben werden. Die Render-Abgabe misst CPU-Zeit zwischen Phasers Pre-/Post-Render-Ereignissen, nicht die vollständige GPU-Zeit, und stammt aus dem vorherigen Frame, weil `update` vor `render` läuft.

## Verträge des Report-Schemas

Nur Werte, die sich während einer Messung nicht ändern können, dürfen in den Reportkopf. `environment` wird deshalb bei `startRecording()` erfasst, nicht beim Export; Rolle, Qualität, Modus und Map stehen pro Fenster und gebündelt in `recordingScope`. Ein Kopf, der beim Klick auf Export gefüllt wird, beschreibt sonst den Zustand des Klicks und nicht den der Messung. `recordedWindows` überlebt den Export, ein zweiter Export derselben Messung ist also möglich und an gleicher `recordingId` sowie gleichem Dateinamen erkennbar.

`fps` folgt aus der mittleren Frame-Zeit und beschreibt nur die tatsächlich erfassten Frames. `record()` läuft ausschließlich im laufenden Spiel, ein Fenster sammelt aber weiter Wallclock-Zeit. Fenster ohne `coveragePercent` nahe 100 oder mit großem `maxSampleGapMs` sind Randfenster einer Runde und tragen keine belastbare Bildrate.

Phaser 4 führt für WebGL keinen Draw-Call-Zähler: `drawCount` gibt es nur am `CanvasRenderer`, und der `RenderNodeManager` bietet nur einen Debug-Graphen für einen Einzelframe. `drawCallCount` entsteht deshalb aus Wrappern auf den Zeichenmethoden des GL-Kontexts, die als eigene Eigenschaft die Prototyp-Methode verdecken. Sie liegen nur an, solange die Diagnose offen ist oder eine Aufzeichnung läuft, und werden per `delete` wieder entfernt; im normalen Spiel ist der Kontext unberührt. Ein Wert von 0 kann daher auch bedeuten, dass nicht gezählt wurde. Wie die Render-Abgabe beschreibt der Wert den vorherigen Frame.

Objekte pro Draw-Call ist die Kennzahl für Batching. Bricht sie ein, während die Objektzahl gleich bleibt, wechseln zu viele Texturen oder Blend-Zustände innerhalb der Szene; große statische Flächen gehören dann in eine gemeinsame Textur oder einen GPU-Layer.

Die Zeitschlüssel bilden zwei Ebenen: `deltaMs` zerfällt in `updateMs`, `renderSubmitMs` und `unaccountedFrameMs`; `updateMs` zerfällt in `roleStepMs`, die beiden Netzwerkposten, `visualStepMs`, `shadowStepMs`, `lightingStepMs` und `unaccountedUpdateMs`. `visualStepMs` zerfällt lückenlos in `visualCameraMs`, `visualEnemyMs`, `visualEffectsMs`, `visualAimMs` und `visualHudMs`. Die `fire*`-Werte sind Teilkosten von `roleStepMs` und dürfen nicht zum Update-Budget addiert werden.

Vergleiche nach Möglichkeit dieselbe Map, Rolle, Spielerzahl und Kampfsituation. Erst ein Profil wechseln oder Code ändern, dann ein neues Messfenster beziehungsweise eine neue Aufzeichnung erzeugen. P95/P99 und der Anteil langsamer Frames sind für sporadische Hänger aussagekräftiger als nur der Mittelwert.
