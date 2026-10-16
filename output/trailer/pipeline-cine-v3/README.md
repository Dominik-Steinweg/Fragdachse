# Fragdachse – Trailer „Neue Inhalte“ V3 (Oktober 2026)

Feature-Trailer über alles, was nach „Voices 3“ ins Spiel kam: Abyssal Kraken im violetten Void-Teich, Eier und
Mini-Kraken, Quacksalber, Schild-Anstürmer, Brandstifter, Mörser-Dachs, Alien-Energiefächer, Inspector-Turmkopien,
Holo-Offensive, Turmportale, Bombergeschwader, Wachturm, Void-Meteor (Boss-Intro Karte 10) und ein
Teaser für den Endlos-Modus „From Dachs Till Dawn“. Ca. 52 s, 1920×1080, 60 fps, −14 LUFS.
V3.2 ist taktgenau geschnitten (`seg(shot, beats, speed, { hit: [Masterzeit, Schlag] })` in `edl.mjs`, Musik `punch-347`
mit 120 BPM; Tempo- und Taktanalyse mit `beatgrid.mjs`, `kickphase.mjs`, `accents.mjs`). V3.1: Kraken-Block zuerst (Auftauchen, Tentakel, Eierwurf, Schlüpfen, Schwimmen, Angriff, an Land), dann Gegner,
Belohnung/Intro, Inspector-Arsenal, Schwarzbild, Dawn-Teaser, Endkarte „Bald im Koop-Modus“.

Veröffentlichte Fassung (per `.gitignore` nicht versioniert): `output/trailer/Fragdachse_Trailer_Neu_2026-10_v3.2_16x9.mp4`
(1920×1080, 60 fps, 52 s) und `…_web.mp4`. Die 4K-Master, Entwürfe und Titel-Frames wurden danach gelöscht; zum Neuschnitt
zuerst die Shots neu aufnehmen (`node shoot.mjs <shot>`). Die Musik-Stems in `music/` bleiben liegen.

## Neu erzeugen
1. Dev-Server `npm run dev:browser` (Port 8090). Nach Code-Änderungen braucht der erste Seitenaufbau länger.
2. `DRAFT=1 node shoot.mjs <shot>` nimmt einen 1080p-Entwurf nach `masters-draft/` auf (≈1 min), ohne `DRAFT` einen
   4K-Master nach `masters/` (≈2–4 min). Kontaktbogen: `review/<shot>[-draft].jpg`. Rezepte in `shots.mjs`.
   Schild-Anstürmer, Wachturm und Void-Meteor kommen als `v2:<shot>` aus `../pipeline-cine-2026-10/masters`.
3. `node music.mjs` erzeugt Musik und Akzente mit Stable Audio 3 über ComfyUI (:8188, feste Seeds); V3 nutzt
   `drive-117` (120 BPM) für den Action-Teil und `dawn-201` plus `tick` für den Teaser.
4. `node titles-anim.mjs [name…]` rendert animierte Titel als PNG-Sequenzen (30 fps, Dauer aus `edl.mjs`; ohne Sequenz
   fällt `assemble.mjs` auf die statischen Karten aus `titles.mjs` zurück), `node audio.mjs` mischt, `node assemble.mjs 16x9` schneidet
   (Schnitt, Belichtung `ev`, Kamera-Roll `roll`, Bewegungsunschärfe `blur`, Push-ins, Blitze, Kino-Balken und
   `IMPACTS` – Farbversatz und Kamerastoß – in `edl.mjs`; Bloom und Grade in `assemble.mjs`). Titel und Töne hängen
   über `T(tag, masterzeit)` an markierten Segmenten. Mit `DRAFT=1` aus den Entwürfen.

## Harness (`harness.mjs`)
Eigene Kinokamera (bleibt innerhalb der Karte), Spieluhr mit Zeitlupe, Sound-Protokoll. Für die Aufnahme ausgeblendet:
HUD, Zielhilfe, Statusring, HP-Balken, Marker, XP-Zahlen und Adrenalin-Essenz-Drops. Treffer auf Spieler und Bots
erzeugen kein Blut (Nebenangriffe im Testaufbau), Gegnerblut bleibt. Baumkronen werden nur um Fokuspunkte
(`canopyFocus`) halbtransparent, die Stammscheiben darunter ausgeblendet.

## Stolpersteine
- Auf Karte 4 greifen Mörser und Brandstifter die nächste Basis an; gepinnte Mörser feuern nicht (sie suchen erst eine
  Feuerstellung). Die Mörser-Kamera folgt deshalb den replizierten `mortarStrikes`.
- Mini-Kraken lassen sich nicht über `spawn` ins Wasser setzen (Freiprüfung); `spawnRaw` nutzt den Navigation-Port.
  Sie springen nur aufgetaucht und aus 110–280 px – der Dachs muss ein paar Zellen vom Ufer entfernt stehen.
- `krakenMission` ist dauerhaft in der Dämmerung (Map-20-Look); `calmKraken` stoppt neue Boss-Angriffe für Shots,
  in denen etwas anderes im Teich passiert.
- `dawnSkip` braucht die laufende Schleife und eine überlebende Basis: in Etappen vorspulen und Gegner räumen.
- `spawn hp` setzt aktuelle und maximale HP; zum Verwunden `wound()` (Host-Vitals) verwenden.
