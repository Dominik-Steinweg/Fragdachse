# Death-Lab (C1)

Standalone-Werkbank fuer den bestehenden GPU-Todeseffekt; ohne Arena-/Netzwerkstart und ohne Mutation der Gameplay-Konfiguration.

## Start und Bedienung

Nach Freigabe fuer Browserpruefung: `npm run dev:browser`, dann http://127.0.0.1:8090/death-lab.html.
Lab-Build: `npx vite build --mode death-lab` nach `build/death-lab/`. Bestehende Assets am Server-Root `/assets/` erforderlich; copyPublicDir ist aus.

- Spieler, kleiner/mittlerer/grosser Gegner; stehender/laufender Snapshot mit Clip-Frame, Seed, Richtung/Rotation (Grad), Koerpergroesse, Zoom, Quality.
- Ebenen: Hauptmasse, Micro, Glows, Spieler-Geist, Kill-Hit-Gore-Spray, lokaler Death-PostFX. Keine permanenten Blut-Decals, kein Audio.
- Neutral dunkel/hell oder Waldboden-Textur; keine Arena-Sonne, Lightmap, Nebel oder Schatten.
- Pause, 25-ms-Schritt, Scrubber 0–1500 ms, Tempo 0.1/0.25/0.5/1. GPU-Layer, Pool, Geist und Death-PostFX nutzen dieselbe manuelle Zeit. Seeks leeren Pools und spielen mit identischem Seed neu ab.
- Phasenbaender zeigen theoretische Bereiche aus Lebensdauer/Morph-Streuung, der Strich die nominelle Grenze (keine gemessenen Partikelwechsel).
- Tuning und Atlas-Re-Bake nur bei Anwenden. chunkSizePx, referenceDisplaySizePx und das ungenutzte glowCount bleiben unveraenderlich; C2 kann den Template-/Rastervertrag erweitern.

## A/B und API

Erst Fixture/Ebenen einstellen, dann A einfrieren: 61 PNGs, 0–1500 ms in 25-ms-Schritten. Tuningwechsel erhalten A; Fixture-/Quality-/Hintergrund-/Ebenenwechsel verwerfen A.
Mit A rasten BEIDE Ansichten am selben Referenzzeitpunkt ein; angefragte und tatsaechliche Zeit stehen im Status. Ohne A sind beliebige Zeiten moeglich. Standardexport: 60 Frames, 0–1475 ms; 61 Frames schliessen 1500 ms ein.

Alle Befehle laufen seriell und validiert durch run(...); status() liefert Kopien.

```js
await window.deathLab.whenReady();
await window.deathLab.run({action:"configure", values:{
  fixture:"player", pose:"move", frameIndex:2, seed:12345,
  direction:30, rotation:45, size:32, quality:"high", background:"forest",
  layers:{main:true, micro:true, glows:true, ghost:true, gore:false, postfx:false}
}});
await window.deathLab.run({action:"freeze"});
await window.deathLab.run({action:"tuning", values:{
  fragmentedAt:0.30, dustAt:0.44, fineDustAt:0.54, hazeAt:0.64
}});
await window.deathLab.run({action:"seek", timeMs:480}); // Standard-A: 475 ms
await window.deathLab.run({action:"play", speed:0.25});
await window.deathLab.run({action:"play", playing:false});
await window.deathLab.run({action:"step", deltaMs:25});
const result = await window.deathLab.run({action:"export", frames:60, stepMs:25});
await window.deathLab.run({action:"tuning", reset:true});
await window.deathLab.run({action:"clearBaseline"});
```

status().tuning zeigt alle Werte. Zwischen normierten Morph-Grenzen mindestens 0.01 Abstand; Lebensdauern bleiben innerhalb des Lab-Zeitfensters.

## Export fuer Playwright

Kein Dev-Schreibendpunkt: export liefert PNG-Data-URLs einzeln und als Kontaktbogen sowie JSON-Metadaten. UI-Download: Kontaktbogen B, optional A, ein JSON mit allen PNGs (ggf. Browser-Downloadfreigabe). Automation schreibt die Rueckgabe selbst:

```js
// In einem bereits autorisierten Playwright-Skript; page zeigt das Lab.
import { mkdir, writeFile } from "node:fs/promises";
await page.waitForFunction(() => Boolean(window.deathLab));
await page.evaluate(() => window.deathLab.whenReady());
const result = await page.evaluate(() => window.deathLab.run({
  action:"export", frames:60, stepMs:25, includeBaseline:true
}));
const dir = "build/death-lab/export-" + Date.now();
await mkdir(dir, {recursive:true});
const png = data => Buffer.from(data.substring(data.indexOf(",") + 1), "base64");
for (const [label, value] of [["B", result], ["A", result.baseline]]) {
  if (!value) continue;
  await writeFile(dir + "/" + label + "-contact.png", png(value.contactSheet));
  for (const [i, frame] of value.frames.entries()) {
    await writeFile(dir + "/" + label + "-" + String(i).padStart(3,"0") + "-" + frame.timeMs + "ms.png", png(frame.png));
  }
  await writeFile(dir + "/" + label + "-metadata.json", JSON.stringify({
    ...value.metadata, timesMs:value.frames.map(frame => frame.timeMs)
  }, null, 2));
}
```

Metadaten: Seed, vollstaendiges Tuning, Snapshot/Fixture, Quality/Ebenen/Kontext, Zeiten, Phaser-/Renderer-/Spielversion, Build-Zeitstempel und SHA-256 relevanter Quelltexte sowie geladener Assets (auch Dirty-Worktree). Lokale Provenienz, keine Garantie GPU-uebergreifend identischer Pixel.

Exportzeiten muessen exakt in A vorhanden sein; sonst passende Baseline aufnehmen oder includeBaseline:false. Aufnahme stoppt Playback, wartet pro Sample auf einen Renderframe und stellt danach die ausgewaehlte Zeit wieder her. Ohne Renderframe nach 10 s Fehler; sichtbaren Browser-Pane verwenden.

## Pruefung und C2

C1 ohne Browser/Dev-Server geprueft. Erste Sichtpruefung: vier Fixtures, gleicher Seed vorwaerts/rueckwaerts, stabile Pause, 0/300/450/600/1000/1500 ms, Ebenen einzeln, Quality-Wechsel, Defaults nach Tuning, A/B und PNG/JSON-Export. Spaeter Arena-Pruefung mit Sonnen-Composite/Lightmap/Nebel.

Neue Tests wegen Schreibschutz des tests-Verzeichnisses als build/c1-tests.patch. Nach Anwendung:

```sh
npx vitest run tests/DeathLabC1.test.ts tests/DeathLabApi.test.ts --exclude "art/**" --exclude "build/**"
npx tsc --noEmit
npx vite build --mode death-lab
```

Spawn-Regressionen nutzen IEEE-754-Werte des urspruenglichen Renderers aus 7a859a9a (acht Spieler-/Gegnergroessen-Fixtures), inklusive Standardtuning und Ruecksetzen. C2-Defaultaenderungen bewusst behandeln, Goldenwerte nicht ungeprueft regenerieren. Weitere Tests: Phasenvalidierung, Default-Morphs, expliziter Re-Bake, manuelle GPU-/Poolzeit, Replay, A/B-Isolation, API-Validierung und Exportzeiten.

C2 kann das bestehende Morph-Verfahren gegen eingefrorenes A verfeinern. Noch keine neue Rauschmaske, Rasterprogression, Glow-Choreografie oder Fragment-/Staub-Uebergangslogik. Atlas-Re-Bake gilt fuer die isolierte Lab-Scene, nicht fuer parallel laufende produktive Scenes.
