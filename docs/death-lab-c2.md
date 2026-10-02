# C2 – Todes-Effekt: Uebergabe an Claude

C2 ist implementiert; keine Browserpruefung, kein Dev-Server, kein Commit. Die bisherigen Exporte base4/contact.png und dense-window.png bleiben erhalten.

## Ursache und Umbau

- Dunkle Platten: DeathFragmentTemplateCache mittelt Sprite-RGB alpha-gewichtet, uebergibt aber keine Blockdeckung. Der Renderer macht daraus nahezu deckende Fragmentmotive. Dunkle Fell-/Randbereiche werden so zu grauen Platten. Die Atlasmotive selbst sind weiss (auch bei Alpha null), die Hauptmasse liegt auf NORMAL. Der betrachtete Lab-Kontext hat keine Arena-Sonne/Lightmap/Nebel; die r03-Phasenuebersicht enthaelt keine solchen Fragmentplatten. Das spricht fuer den Materialpfad, nicht fuer Schattenrueckseiten oder einen neuen PMA-/ADD-Fehler.
- Gegenmassnahme: dunkle Materialfarbe bleibt erhalten, bekommt aber deutlich weniger Deckung. Maximaler RGB-Kanal vor dem bestehenden Kontrast-Lift bestimmt eine weiche Rampe: unter cutoff/2 die Mindestdeckung, ab cutoff volle Deckung. Keine harten Chunk-Drops, kein neuer RNG-Verbrauch.
- Compact/Frayed/Porous/Fragmented bleiben erhalten. Ab Fragmented wird dessen echte Alpha-Flaeche in feste 3x3-Texel-Zellen zerlegt. Aus deren alpha-gewichtetem Schwerpunkt entstehen persistente Koerner. Deterministische Rauschschwellen erodieren die vorhandene Masse progressiv; die ersetzenden Koerner und ihre weiche Materialhuelle erscheinen ueberlappend am selben Ort.
- Dust/FineDust/Haze verwenden dieselben Koernerzentren. Drift hat keinen mittleren Zusatzimpuls. Haze vergroessert diese Koerner kontinuierlich mit Flaechenkompensation der Alpha-Dichte. Keine neu platzierten grossen Kreise und kein Wechsel der GPU-Member, Farbe oder Trajektorie.
- Gebacken in die bestehenden 128 Frames (48x48), unveraenderte Atlasgeometrie, Frame-IDs, Lanes, Depth, Blend, Fragmentanzahl und Aufraeumwege. Arbeit pro Pixel nur beim Bake; keine CPU-Partikelupdates. Micro-Motes leben laenger, werden etwas schwaecher und stuetzen das Zerfallsfenster.
- Produktions-Renderer und initialer Atlasbau nutzen jetzt die C2-Defaults aus DeathTuning. config.ts bleibt als unveraenderte Basis/C1-Referenz bestehen; der Template-Analyser nutzt weiterhin sein festes Raster.

## Tuning (neue Keys / Defaults)

| Key | Default | Wirkung |
| --- | ---: | --- |
| dissolveWindowMs | 150 | Nominales Rausch-Zerfallsfenster vor dustAt; reale Streuung ca. 142–183 ms |
| grainRadiusPx | 1.25 | Radius der Detailkoerner in Atlastexeln |
| grainDriftPx | 2.4 | Obergrenze lokaler Korndrift in Atlastexeln; gewichteter Mittelwert null |
| grainAlpha | 0.82 | Detailkorn-Deckung |
| dustBodyAlpha | 0.45 | Dichte der weichen fragmentgebundenen Masse; danach Ruecknahme |
| dustBodyRadiusPx | 3 | Radius dieser Materialhuelle pro Korn in Atlastexeln |
| hazeGrowth | 1.7 | Kontinuierlicher Radiusfaktor FineDust -> Haze |
| hazeAlpha | 0.32 | Haze-Deckung vor Flaechenkompensation |
| darkFragmentAlpha | 0.08 | Mindestdeckung sehr dunkler Materialfarben |
| darkFragmentCutoff | 0.42 | Oberes Ende der Helligkeitsrampe; beginnt bei 0.21 |
| microAlpha | 0.75 | Multiplikator des bisherigen Micro-Alphas |
| legacyMorph | 0 | 1 aktiviert alte Motiv-Ueberblendung; fuer komplette C1-Werte das Preset verwenden |

Geaenderte bestehende Defaults: porousAt=.22, fragmentedAt=.30, dustAt=.44, fineDustAt=.54, hazeAt=.64, vaporAt=.875; frayedAt=.125 bleibt. morphDesyncMaxScale=1.16; microLifetimeMinMs=860, microLifetimeMaxMs=1120. Nominale Dauer bleibt 1350 ms.

Das Zerfallsfenster muss zwischen fragmentedAt und dustAt passen; Validator lehnt ungueltige Kombinationen atomar ab. 150 ms beziehen sich auf den nominalen Morph-Takt, nicht auf jeden zufaellig gestreckten Member. Nominal: Fragmented 405 ms, Zerfall etwa 444–594 ms, FineDust 729 ms, Haze 864 ms. Lebensdauerstreuung und Morph-Desynchronisierung bleiben wirksam. Alle Materialwerte sind im Lab als Zahlenfelder/JSON verfuegbar; ein neues Zeitband markiert dissolveStart.

## C3 im Lab

URL: http://127.0.0.1:8090/death-lab.html

```js
await deathLab.whenReady();
await deathLab.run({action:"configure", values:{zoom:4, background:"forest", follow:true}});
await deathLab.run({action:"tuning", preset:"c1"}); // auch als UI-Button
await deathLab.run({action:"freeze", frames:76, stepMs:20});
await deathLab.run({action:"tuning", reset:true}); // C2
await deathLab.run({action:"seek", timeMs:560});
const result = await deathLab.run({action:"export", frames:76, stepMs:20});
// Ohne A unveraendert moeglich: includeBaseline:false
```

follow ist standardmaessig false. true verfolgt die tatsaechlich zugelassenen Hauptfragmente nach initialer Materialmasse gewichtet; absolute Zeit statt frameabhaengigem Lerp. Die Kamera springt beim Retire nicht zurueck. Ohne Hauptfragmente bleibt sie am Ursprung. Fuer strenge Positionsvergleiche A/B follow:false nutzen: bei true zentriert jede Variante ihre eigene Materialverteilung. Ein Konfigurationswechsel verwirft A wie bisher.

Zuerst 380–950 ms in 20-ms-Schritten bei Zoom 4 vergleichen, dann 1x und alle Gegnergroessen/Quality-Stufen:
1. Hauptmasse allein: keine deckenden dunklen Platten; helle Fragmente sollen trotz dunklerer Haut-/Fellfarben lesbar bleiben.
2. 500–750 ms: keine abrupte Masse-Luecke; Koerner sollen aus den erodierenden Flaechen hervorgehen.
3. 700–1100 ms: Dunst waechst vor Ort ohne neue helle Ballen, ohne spaetes Aufleuchten.
4. Micro, Glows und Geist einzeln hinzuschalten; Micro darf am Ende nicht wieder als dominante Punktwolke auffallen.
5. Wenn zu duenn: dustBodyAlpha zuerst 0.45 -> 0.50; bei Balligkeit hazeGrowth 1.7 -> 1.4 oder hazeAlpha 0.32 -> 0.26. Bei zu wenig dunkler Silhouette darkFragmentAlpha vorsichtig 0.08 -> 0.12. A vor jedem Tuningvergleich einfrieren.
6. Abschliessend Arena-Kontext mit Beleuchtung/Composite/Nebel pruefen. C2 wurde hier nicht visuell abgenommen.

## Dateien und Pruefung

Geaendert: DeathTuning.ts, DeathMorphFrames.ts, GpuVfxAtlas.ts, CombatGoreGpuRenderer.ts; kleiner opt-in Spawn-Beobachter in GpuVfxSystem.ts; death-lab.html und Lab State/Scene/Controls/api. Neu: src/dev/deathLab/Follow.ts.

Tests als build/c2-tests.patch: neue DeathTransitionC2.test.ts und gezielte Anpassungen an DeathLabC1/GpuVfxAtlas/CombatGoreGpuRenderer. Die acht alten Spawn-Hashes bleiben unveraendert und testen explizit das C1-Preset; C2-Reset und Default sind separat gleichheitsgeprueft. Die vorhandenen Testdateien selbst wurden nicht angefasst. Patch vor Gesamtcheck anwenden; sonst pruefen die alten Tests noch C1 als Produktionsdefault.

Gezielte Laeufe: 125 Tests bestanden (124 zusammen, danach ein zusaetzlicher Atlas-Integrationstest mit allen acht C2-Tests gruen). Geprueft: direkte Fragment-Alpha-Uebernahme, keine alten Haze-Motiv-Reads im C2-Atlas, deterministischer Bake, kein neues Material aus leerer Quelle, Deckung/Frame-Kontinuitaet, lokale Schwerpunktbindung, Dunkel-Deckung, Validierung, Follow, C1-Preset/API sowie vorhandene GPU-/Renderer-/Geist-Vertraege.
npx tsc --noEmit und npx vite build --mode death-lab --emptyOutDir false bestanden. Das Build-Flag erhaelt vorhandene Exporte im Zielordner. Kein Gesamtcheck. Beide Patches mit git apply --check pruefbar.

C2-Doku liegt als build/c2-docs.patch vor. Langlebige Netzwerk-/Lifecycle-/Render-Vertraege wurden nicht geaendert. Hoehere Micro-Lebensdauer erhoeht temporaere Slot-Belegung bei gleichem Count; bestehende Quality-/Poolgrenzen bleiben aktiv.

Knowledge writeback: No durable project knowledge discovered.
