# Trailer-Pipeline (Fragdachse_Trailer.mp4)

Reproduzierbare Aufnahme über den Dev-Szenario-Modus. Voraussetzung: `npm run dev:browser` läuft auf Port 8090,
Chrome + ffmpeg sind installiert. Alle Befehle im Ordner `pipeline/` ausführen.

1. `node run.mjs cold_open rocket_drop negev turrets tesla boss holy shotgun flamer hydra armageddon airstrike mass_horde nuke`
   – headless Chrome (GPU), 4K-Rendering (DPR 2), frame-genaues Stepping, Downscale auf 1080p60 nach `shots/`.
   Sound-Events werden je Shot als `*.sounds.json` mitgeschnitten.
2. `node lobbyshot.mjs` – Lobby mit Fels-Schriftzug nativ in 4K (Kamerafahrt erfolgt in der Post).
3. `node audio.mjs` – Musikschnitt (music_arena, 120 BPM) + rekonstruierte Spiel-SFX, Master auf −14 LUFS.
4. `node render_overlay.mjs render 39.5` – Typografie/Letterbox/Blitze als Alpha-Ebene (`overlay.mov`).
5. `node assemble.mjs final` – Schnitt laut `edl.mjs`, Grading, Overlay, Audio → `Fragdachse_Trailer.mp4`.

Der Spielcode wird nicht verändert: Kamera, HUD-Ausblendung, Zeitlupe und Pickup-Utilities (Nuke, Heilige
Handgranate) werden zur Laufzeit über dieselben Vite-Modulinstanzen gesteuert (`harness.mjs`).
