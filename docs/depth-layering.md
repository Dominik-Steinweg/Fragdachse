# Tiefenstaffelung: R0-Vertrag und Referenzen

R0 beschreibt Ist-Zustand und Zielmodell aus `build/depth-analysis.md`, Kapitel 7–8.
Es ändert keine Depth, Blend-Faktoren, Lichtantwort oder Renderer-Lanes. Optikänderungen ab R1
benötigen eine eigene Freigabe.

## Daten und Vertrag

[EffectLayerContract.ts](../src/effects/EffectLayerContract.ts) enthält Typen, Profilgrenzen und
Befund-IDs; [EffectLayerContract.data.ts](../src/effects/EffectLayerContract.data.ts) die eingefrorenen
Definitionen; [EffectLayerContract.exceptions.ts](../src/effects/EffectLayerContract.exceptions.ts)
die explizite Allowlist. Tests: `tests/depthR0Contract.test.ts`, `tests/depthR0Reference.test.ts`,
AST-Lesehilfe `tests/depthSource.cjs`.

`height: ground | body | high` und `lighting: material | emissive | mixed` beschreiben die
beabsichtigte Kategorie, ausschließlich als Metadaten an Definitionen. Kein Spawn liest sie;
ein Test verbietet Produktionsimports. Ist-Depth/Blend/Kamera/Profile stehen separat daneben.
Der Katalog erfasst 40 GPU-Lanes, 86 GPU-Effektdefinitionen und 482 CPU-Depth-Selektoren aus
131 Ownern. GPU-Definitionen referenzieren ihre Lanes einschließlich additiver Varianten.
CPU-Ausdrücke werden gegen aktuelle Konstanten aufgelöst; `CPU_SOURCE_CONTRACTS.bindings`
nennt explizite Eingabedomänen, keine vollständige Simulation beliebiger Laufzeitargumente.
Generische Helfer (`role: delegate`) haben keine unabhängige globale Depth; ihre Aufrufer zählen.
Die Syntaxprüfung ersetzt keine Prüfung von Container-Vererbung, Materialshadern, Masken oder
PostFX. Interne GPU-/Renderpass-Helfer und die aktiven Character-/Shadow-Implementierungen sind
keine eigenständigen Effektdefinitionen dieses Katalogs. Bestehende Licht-/Schatten-/Fog-/Clarity-Tests bleiben maßgeblich.

| Profil | World-Depth | Sonne/Wolken | Lightmap | Nebel davor | Krone davor | World-PostFX |
|---|---|---|---|---|---|---|
| G | < 5,3 | ja | ja | beide Tiefen | ja | ja |
| M | 5,3 bis < 9,14 | ja | ja | nur 9,14 | ja | ja |
| K | 9,14 bis < 14,5 | ja | ja | nein | ja | ja |
| L | > 14,5 bis < 19,5 | nein | ja | nein | ja | ja |
| E | > 19,501 bis < 20 | nein | nein | nein | ja | ja |
| H | > 20 | nein | nein | nein | nein | ja |
| C | Clarity-Kamera | nein | nein | nein | nein | nein |

Profile folgen der Zeichenreihenfolge, sind keine Receiver-Masken. Eigene Materialbeleuchtung
kann zusätzlich bestehen. 14,5 ist ausdrücklich K/L, 20 E/H: Gleichstände hängen an der
Einfügereihenfolge. 19,5/19,501 sind reservierte Lightmap-/Bleed-Passgrenzen, markiert als L/E.

Die Allowlist enthält **487 Einträge für 436 Definitionen/Selektoren**, keine 487 unabhängigen
Fehler. Lanes und Effektdefinitionen können denselben visuellen Befund mehrfach repräsentieren.
`emission-under-lightmap` ist ein offener Balance-/Materialentscheid, kein automatischer Fehler.

| ID | Befund aus Kapitel 7 | Einträge |
|---|---|---:|
| D01 | Blut/Todesmaterial über Kronen/Licht | 19 |
| D02 | gewöhnliche Explosionskörper/-rauch über Kronen | 33 |
| D03 | Boden-/Körpermotiv im Vordergrund | 74 |
| D04 | Blutstain auf Gegnerdepth | 1 |
| D05 | Stink-Bodenanteil über Figuren | 1 |
| D06 | Material-/Projektilfamilie außerhalb Sonnenpass | 104 |
| D07 | Gleichstand Sonnenpass 14,5 | 1 |
| D08 | Gleichstand Kronen 20 | 3 |
| D10 | uneinheitlicher Emissionsvertrag | 238 |
| D11 | Welt-UI unter Licht-/Nebelbehandlung | 13 |

D09 (lokale Kronenöffnung), D12 (Schattenempfänger), D13 (Begründung hoher Effekte) und D14
(Inline-Beleuchtung) bleiben qualitative bzw. separate Verträge. Der Test verwirft neue und
veraltete Ausnahmen sowie Änderungen an Definitionen, Depth-/Blend-/Kameraselektoren.
Spätere Runden aktualisieren die konkrete Ist-Zuordnung und entfernen behobene Ausnahmen.
Den Katalog nicht automatisch regenerieren, um einen fehlgeschlagenen Test zu reparieren.

## Zielmodell für spätere Runden

| Motiv | Zielband / Regel |
|---|---|
| geerdete Decals | etwa 5,05–5,15; Sonne + Lightmap, Nebel darüber |
| Wasser | 5,2–5,25 erhalten; keine Landdecals über Wasser |
| Gelände/Bewuchs/Nebel | bestehende Bänder erhalten |
| Bodeneffekte auf Oberflächen | je Empfänger etwa 9,15–9,8, unter Figuren |
| Figurenschatten / Gegner / Spieler / Zug | nominal 9,92 / 9,95 / 10 / 11 erhalten |
| körperhohes Material | etwa 11,2–14,3; Sonne + Lightmap, unter Kronen |
| Sonne | 14,5 unverändert |
| Projektil-/Energiefamilien | bestehende 14,6–18,x zunächst erhalten, einzeln abstimmen |
| Lightmap / Bleed | 19,5 / 19,501 unverändert |
| selbstleuchtende Ergänzungen | etwa 19,55–19,9; bei Bedarf eigene Nebeldämpfung |
| Kronen | 20, eigenes Material |
| begründet hohe Effekte | etwa 20,2–26; Höhe befreit Material nicht von Beleuchtung |
| Gefahrenkontur / Weltinformation | eigenes Lesbarkeitsband, nicht ganze Motive hochschieben |
| Bildschirm-UI | Clarity |

Material und Glow gemischter Effekte getrennt behandeln. NORMAL kann selbstleuchtend sein,
ADD kann unter der Lightmap liegen. Phaser-ADD verwendet `(ONE, DST_ALPHA)`; der Sonnenpass
muss Ziel-Alpha erhalten. Schatten nur für begründete Körper, nicht pro Micro-Partikel.
Fog-Impulse sind unabhängig von Depth. Gefahrenlesbarkeit später durch begrenzte weiche
Kronenöffnung oder minimale Konturen lösen. Neue Gleichstände an 14,5/20 vermeiden;
R0 lässt die vorhandenen ausdrücklich unverändert.

## Referenzszenen und Aufnahme

URL: `http://127.0.0.1:8090/dev-scenario.html`. Map 1, Seed 12345, Zeiten 480/720/1140/0.

```js
const dev = window.devScenario;
await dev.run({action:'depthReferenceScene', scene:'canopyEdge', timeOfDay:720});
await dev.whenReady();
await dev.run({action:'depthReferenceScene', phase:'sample', frame:30});
```

Alle Ergebnisse auf `ok` prüfen. `lastAction.depthReference` enthält Plan, Seed, Frames,
Simulationsursprung und ausgeführte Befehle. Frame 0 ist das erste gerenderte Fixture nach
120 Aufwärmframes; 1000/60 ms pro Frame, Pause bleibt aktiv. Samples monoton aufsteigend;
derselbe Frame darf wiederholt werden. Rückwärts: erneut Prepare + `whenReady()`.
Fremdes Step/Resume zwischen Samples erfordert erneutes Prepare.

| scene | Aufbau / Auslöser (Frames) | Aufnahmeframes |
|---|---|---|
| canopyEdge | Woodland/Kronenrand 31/19, Rakete 1 | 0,1,12,30,60,90,120,180 |
| smallExplosion | HE bei 27/26, Frame 1 | 0,30,59,65,72,90,120,180 |
| deathBlood | gepinnter Gegner, 1 HP bei 27/28, HE 1 | 0,59,65,72,84,96,120,180 |
| flight | GLOCK 1, Rakete 30 Richtung 31/19 | 0,1,3,6,12,30,33,42,60 |
| gases | Stink 1, Rauchgranate 120, Molotow 300 | 0,60,120,240,300,420,540 |
| surface | Woodland, Buddeln 30/90 | 0,1,12,30,60,90,120,180 |
| train | unverwundbarer Zugstart 1, feste Kamera 130,4/20 | 0,60,180,360,600 |
| readability | statisches Woodland-/Gegnerfixture | 0,1,12,30,60,90,120,180 |
| extreme | Nuke 1 bei 27/26 | 0,60,120,180,240,300,360,480,600 |

Alle Auslöser verwenden bestehende Host-Aktionen. Spielersterben und Zugexplosion sind keine
versteckten Sonderpfade dieser Rezepte; vorhandene Labs/Spur-B-Aktionen ergänzen diese Fälle.

Playwright: frische Seite je Vergleich, gleicher Viewport/DPR/Quality. Direkt den Canvas aufnehmen:
`dev.capture()` schaltet bei Pause selbst einen Frame weiter und ist für diese Sample-Reihe ungeeignet.

```js
// Im bestehenden Playwright-Skript; fs = node:fs/promises, Seite bereits geöffnet.
const run = async command => {
  const r = await page.evaluate(c => window.devScenario.run(c), command);
  if (!r.ok) throw new Error(r.error);
};
await run({action:'depthReferenceScene',scene:'canopyEdge',timeOfDay:720});
const ready = await page.evaluate(() => window.devScenario.whenReady());
if (!ready.ok) throw new Error(ready.error);
await fs.mkdir('build/depth-reference/canopyEdge-720',{recursive:true});
for (const frame of [0,1,12,30,60,90,120,180]) {
  await run({action:'depthReferenceScene',phase:'sample',frame});
  await page.locator('canvas').first().screenshot({path:`build/depth-reference/canopyEdge-720/${frame}.png`});
  await fs.writeFile(`build/depth-reference/canopyEdge-720/${frame}.json`,
    JSON.stringify(await page.evaluate(() => window.devScenario.status()),null,2));
}
```

Commit-ID und Arbeitsbaumänderungen zusätzlich dokumentieren. Eingabeplan und `Math.random`
während Sampling sind fest; Wall-Epoch, Worker, Ambient-Animationen und GPU-Timer sind kein
bitweises Replay. Prepare allein ist kein Ressourcen-Neustart: neue Seite für belastbares A/B.
36 Rezeptkombinationen sind getestet; tatsächliche Einschlagframes, Sichtbarkeit und
Pixelgleichheit benötigen weiterhin Claudes Browserabnahme.
