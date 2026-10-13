# Fragdachse – Social-Trailer „Neue Inhalte“ (Oktober 2026)

Fertige Videos (per `.gitignore` nicht versioniert) liegen in `output/trailer/`:
`Fragdachse_Trailer_Neu_2026-10_v2_16x9.mp4` (1920×1080) und `…_v2_9x16.mp4` (1080×1920), je 30 s, 60 fps,
H.264/AAC, −14 LUFS, plus kleinere `…_web.mp4`; Version 1 liegt ohne `_v2` daneben. Vorschaubild: `poster_16x9.jpg`.
Version 2 ergänzt den Schild-Anstürmer und überarbeitet Ton, Schnitt und Bild (Hook, engere Kamera,
feuernder Dachs, hellere Farbkorrektur, dynamischerer Mix).

## Neu erzeugen (alle Zwischenergebnisse landen ignoriert in diesem Ordner)
1. Dev-Server auf `http://127.0.0.1:8090` (`npm run dev:browser`). Nach vielen Code-Änderungen braucht der
   erste Seitenaufbau mehrere Minuten (Vite übersetzt neu); danach laufen die Aufnahmen normal.
2. `node shoot.mjs <shot>` nimmt einen 4K-Master nach `masters/` auf (Rezepte `shots.mjs`; Harness mit eigener
   Kinokamera, Spieluhr mit Zeitlupe und Sound-Protokoll in `harness.mjs`). Action-Shots sind „overcranked“
   (halbe Simulationsgeschwindigkeit); im Schnitt ist `speed: 2` Echtzeit.
   **Entwurf zuerst:** mit `DRAFT=1` entstehen 1080p-Master in `masters-draft/` (etwa 1 min pro Shot);
   `audio.mjs` und `assemble.mjs` schneiden mit `DRAFT=1` daraus einen Entwurf des ganzen Trailers.
3. `node music.mjs` erzeugt Musikbetten und Akzente mit Stable Audio 3 über ComfyUI (:8188, feste Seeds).
   V2 nutzt `beat-77` durchgehend ab dem Einsatz bei 3 s.
4. `node titles.mjs` rendert die Titel (Chakra Petch, Spielpalette) für beide Formate.
5. Schnitt in `edl.mjs` (120-BPM-Raster, Treffer auf Taktmarken; `TAIL` ist der Endkarten-Hintergrund);
   `node audio.mjs` mischt Musik, Akzente und protokollierte Spiel-Sounds auf getrennten Bussen
   (Akzente ducken die Musik, Dauerfeuer ist abgesenkt); `node assemble.mjs 16x9|9x16` schneidet, graded,
   setzt Titel, Blitze und Kino-Balken und muxt den Ton.

Stolpersteine: `krakenMission` startet das Szenario mit Standardwerten neu (Optionen danach erneut setzen);
die Stachelsalve braucht ein Ziel außerhalb der Tintenreichweite; ein Land-Ausfall dicht am Ufer wird gestoppt;
der Schild-Anstürmer dreht bewusst langsam – weit genug entfernt spawnen, sonst zeigt die Ankündigungsbahn schräg;
`C.cleanHits` blendet Blutwolken und „KRIT!“ nur in der Aufnahme aus – bewusst nur in den Kraken-Shots, wo
Dauerfeuer die rote Tentakel-Warnung zudeckt; sonst gehört Blut zum Spiel und bleibt sichtbar; Bot-Waffen müssen zum Slot passen
(`weapon1` Pistole, `weapon2` Primärwaffe); ffmpeg verlangt Dauern wie `0.03` statt `.03`;
`alimiter` braucht `level=0`, sonst hebt er die Lautheit wieder an.
