# Fragdachse – Social-Trailer „Neue Inhalte“ (Oktober 2026)

Fertige Videos (per `.gitignore` nicht versioniert) liegen in `output/trailer/`:
`Fragdachse_Trailer_Neu_2026-10_16x9.mp4` (1920×1080) und `…_9x16.mp4` (1080×1920), je 30 s, 60 fps,
H.264/AAC, −14 LUFS, plus kleinere `…_web.mp4`. Vorschaubild: `poster_16x9.jpg`.

## Neu erzeugen (alle Zwischenergebnisse landen ignoriert in diesem Ordner)
1. Dev-Server auf `http://127.0.0.1:8090` (`npm run dev:browser`).
2. `node shoot.mjs <shot>` nimmt einen 4K-Master nach `masters/` auf (Rezepte `shots.mjs`; Harness mit eigener
   Kinokamera, Spieluhr mit Zeitlupe und Sound-Protokoll in `harness.mjs`). Action-Shots sind „overcranked“
   (halbe Simulationsgeschwindigkeit); im Schnitt ist `speed: 2` Echtzeit.
3. `node music.mjs` erzeugt Musikbett und Akzente mit Stable Audio 3 über ComfyUI (:8188, feste Seeds).
4. `node titles.mjs` rendert die Titel (Chakra Petch, Spielpalette) für beide Formate.
5. Schnitt in `edl.mjs`; `node audio.mjs` mischt Musik, Akzente und protokollierte Spiel-Sounds;
   `node assemble.mjs 16x9|9x16` schneidet, graded, setzt Titel, Blitze und Kino-Balken und muxt den Ton.

Stolpersteine: `krakenMission` startet das Szenario mit Standardwerten neu (Optionen danach erneut setzen);
die Stachelsalve braucht ein Ziel außerhalb der Tintenreichweite; ein Land-Ausfall dicht am Ufer wird gestoppt;
ffmpegs `alimiter` braucht `level=0`, sonst hebt er die Lautheit wieder an.
