# C2b – organischer Kornzerfall

Umgesetzt im Arbeitsbaum, ohne Commit, Browser oder Dev-Server. C2b-Codepatch ist inkrementell gegen den zu Beginn vorgefundenen C2-Stand; nicht erneut auf diesen Arbeitsbaum anwenden. Test- und Doku-Patch sind noch anzuwenden.

## Ursache / Aenderung

C2 erzeugte einen Schwerpunkt pro fester 3x3-Texel-Zelle und spielte ein einziges Motiv fuer alle Fragmente ab. Radius und Drift konnten die regelmaessigen Kornpositionen nicht aufheben.

Der neue Bake verteilt Koerner deterministisch per Poisson-Abstand auf der wirklichen Fragment-Alpha-Flaeche. Positionen sind subpixelgenau, Radien variieren, Formen sind weich und leicht unregelmaessig; jedes Korn hat eigene Orientierung und Drehung. Vier unabhaengig gesaete Motive brechen die Wiederholung zwischen benachbarten Fragmenten auf.

Erosion folgt der Entfernung zur Materialkante (auch Loecher und getrennte Teilstuecke), gemischt mit Rauschen pro Texel. Erst franzt der Rand aus, danach loest sich das Innere. Verlorene Fragmentdeckung wird den zugehoerigen persistenten Koernern zugeteilt; deren Materialbudget bleibt unabhaengig von Punktdichte und Groessenvarianz. Randkoerner loesen sich frueher und driften weiter. Feinster Staub und Dunst bleiben an dieselben Koerner gebunden.

Der lokale Drift bevorzugt +X. Hauptfragmente werden fuer diesen Modus zur bestehenden Flugbahn orientiert; ihre spaetere GPU-Drehung bleibt erhalten. Vier Varianten werden aus vorhandenen, bereits gesaeten Spawn-Werten gewaehlt, ohne weitere RNG-Aufrufe. Memberanzahl, Flugpositionen, Lebensdauern, Farben, Dunkel-Deckung, Micro-Timing, Blend und Depth bleiben erhalten. Das C1-Preset bleibt mit den alten acht Spawn-Hashes bitgleich.

## Umfang und Kosten

Je Variante weiterhin 128 Frames, insgesamt 4x128. Drei Folgen werden hinter den bisherigen IDs angehaengt (220–603); vorhandene IDs 0–219 bleiben stabil. Der Atlas bleibt innerhalb der bestehenden 2048-Grenze, waechst von 1024x1024 auf 2048x2048 (RGBA-Basisflaeche +12 MiB, entsprechender Canvas-Speicher). Kein zusaetzlicher GPU-Member pro Korn, kein neuer Layer und keine CPU-Kornsimulation pro Renderframe. Mehr Bake-/Uploadarbeit nur beim initialen Atlasbau und expliziten Anwenden im Lab.

Vier vollstaendige Folgen erhalten die zeitliche Aufloesung; 128 Gesamtframes auf vier Varianten aufzuteilen wuerde den Uebergang auf 32 Zeitstufen vergröbern.

## Tuning

| Key | Default | Grenze / Bedeutung |
| --- | ---: | --- |
| grainOrganic | 1 | 0/1; 0 schaltet den C2-Gitterbake zur Referenz ein |
| grainSeed | 713 | Ganze Zahl 0–2000; Motiv-Seed, unabhaengig vom Todes-Seed |
| grainSpacingPx | 3.1 | 2–5 Atlastexel; Poisson-Mindestabstand |
| grainJitter | 1 | 0–1; subpixelgenaue statt auf Texelmitten beschraenkte Positionen |
| grainSizeVariance | 0.55 | 0–0.65; Default ca. 0.45–1.55x Radius |
| grainEdgeRelease | 0.7 | 0–1; Gewicht der Rand-nach-innen-Erosion gegenueber Rauschen |
| grainEdgeDrift | 0.6 | 0–1; staerkerer Drift der Randkoerner |
| grainFlowBias | 0.65 | 0–1; lokale Vorzugsrichtung entlang der Fragment-Flugbahn |
| grainRoughness | 0.18 | 0–0.4; leichte Abweichung von runden/elliptischen Koernern |
| grainDriftPx | 4.8 | jetzt 0–8 statt 0–4; Drift gedeckelt, Textrahmen bleibt eingehalten |

Alle anderen C2-Defaults einschliesslich Phase-Ankern, Dichte und Dunkelkorrektur bleiben. Alle neuen Werte stehen in Lab-Zahlenfeldern und JSON. Validierung erfolgt vor dem Re-Bake.

## C3-Vergleich

```js
await deathLab.whenReady();
// Gleiche Fixture, Seed und Ansicht fuer beide Varianten einstellen.
await deathLab.run({action:"tuning", reset:true});
await deathLab.run({action:"tuning", values:{grainOrganic:0, grainDriftPx:2.4}});
await deathLab.run({action:"freeze", frames:76, stepMs:20}); // C2-A
await deathLab.run({action:"tuning", reset:true});          // C2b-B
await deathLab.run({action:"seek", timeMs:600});
const result = await deathLab.run({action:"export", frames:76, stepMs:20});
// Alternativ unveraendert includeBaseline:false fuer Einzel-Exporte.
```

Zuerst 440/520/600/680/760/880 ms auf Waldboden, Zoom 4, Hauptmasse allein vergleichen. Danach Geist/Glows/Micro zuschalten, Zoom 1 und andere Figuren/Seeds pruefen. Augenmerk: kein periodisches Gitter, organischer werdender Umriss, keine neue Dichteluecke, kein spaetes Aufleuchten und keine abrupten Kanten am Textrahmen bei Drift 8. Auch die fruehe Fragmentorientierung pruefen: fuer gerichteten Korndrift folgt sie jetzt der Flugbahn.

Bei zu dichter Koernung grainSpacingPx vorsichtig erhoehen; bei zu starkem Auffaechern grainDriftPx reduzieren. Die Dichtekorrektur sollte vorerst bei dustBodyAlpha=.45 bleiben. follow:true bleibt verfuegbar; fuer strenge Positionsvergleiche follow:false nutzen.

## Dateien / Pruefung

Neu: src/effects/gpu/DeathGrainMaterial.ts.
Geaendert: DeathMorphFrames.ts, DeathTuning.ts, GpuVfxAtlas.ts, GpuVfxFrameAnimations.ts, GpuVfxRenderLanes.ts, CombatGoreGpuRenderer.ts, src/dev/deathLab/Controls.ts.
Keine A/B-Sperrbereiche, Netzwerk- oder Entity-Dateien bearbeitet.

- build/c2b-code.patch: bereits im Arbeitsbaum umgesetzter C2b-Code, inkrementell gegen C2.
- build/c2b-tests.patch: neuer DeathGrainOrganic-Test und Anpassungen an DeathTransitionC2, CombatGoreGpuRenderer, GpuVfxSystem. Vor Gesamtcheck anwenden.
- build/c2b-docs.patch: diese Uebergabe als neue docs/death-lab-c2b.md.

130 gezielte Tests bestanden; nach letzter Begrenzung des Formrauschens erneut 13 Materialtests bestanden. Pruefen Poisson-Abstand und fehlende 3px-Periodizitaet, Seed-/Variantenreproduzierbarkeit, Randprioritaet, Massentransfer, Deckung unter Extremwerten, vier registrierte Folgen, stabile IDs, unveraenderte Flugbahnen/Memberzahl und C1-Spawn-Bytes. Testkopien wurden temporaer unter .tmp ausgefuehrt; bestehende Tests selbst bleiben fuer den Patch unangetastet.
npx tsc --noEmit und npx vite build --mode death-lab --emptyOutDir false bestanden. Vorhandene Exportbilder bleiben erhalten. Optische Abnahme durch Claude steht aus; kein Gesamtcheck.

Knowledge writeback: No durable project knowledge discovered.
