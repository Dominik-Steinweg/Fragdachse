# Gegnerkontur: Sichtprüfung

Die Kontur liest den angezeigten Frame und Transform aus `EnemyVisualSource`. Ein
`SpriteGPULayer` pro Sheet/Tiefenband zeichnet beide Säume in einem NORMAL-Draw,
direkt unter den Körpern. Alpha-Abfragen bleiben im aktuellen Atlasframe; eine
zweiseitige Tangentenbrücke und radiale Außenmaske unterdrücken Kopf-/Pfoten-Innenkanten.
Es entstehen keine neuen Texturen, Objektfilter oder Render-Targets.

Tuning: `src/effects/EnemyReadabilityConfig.ts`. Startwerte: außen 1,4 Bildschirmpixel,
warmes Dunkelgrau mit Alpha 0,62; innen 1,0 Pixel, gedämpftes Elfenbein mit Alpha 0,38 (nach Claude-Sichtprüfung angehoben).
Die kamerabasierte UV-Schrittweite berücksichtigt Zoom, Drehung und Sprite-Skalierung.
Low zeichnet nur die dunkle Kante. Nachts beträgt die Stärke 25 %; der Übergang liest
denselben wolkenunabhängigen, zeitabhängigen Himmelszustand wie das übrige Präsentationslicht.
Die Körper samt Status-Tint und Alpha bleiben unverändert. Verdeckungen und Weltlicht
erfassen die Kontur; tote und unsichtbare Körper schreiben keine Instanz.

## Reproduzierbare Szene

Im bereits geöffneten Dev-Szenario, über die vorhandene Browser-Konsole:

```js
const dev = window.devScenario;
dev.run({ action: 'enemyReadabilityScene', timeOfDay: 720 });
await dev.whenReady();
dev.run({ action: 'enemyReadabilityArrange' });
dev.run({ action: 'panel', collapsed: true });
```

Map 1, Seed 12345, Zoom 1,4, Kamera 28/21. Acht Typen werden mit hoher HP gepinnt:
Zombie, Dämon, Tollwutdachs, Grabtitan, Sporenwächter, Seuchenmediziner, Void-Stalker,
Stink-Brutmutter. Das Rezept enthält Wiese, Erdweg, Laub, Fels und Kronennähe.
Felspositionen sind bewusste Dev-Pose-Overrides nach einem normalen Spawn; die
Gameplay-Kollisionsregeln ändern sich nicht. `dev.status().lastAction` enthält die
genauen Positionen. `enemyReadabilityArrange` entfernt zuvor erzeugte Szenario-Gegner.

Der echte Bahnkies liegt weit östlich dieser Waldansicht. Eine zweite Kamerastation
stellt dieselben acht Typen auf dessen Rand, ohne künstliche Untergrundbilder:

```js
dev.run({ action: 'enemyReadabilityArrange', surface: 'gravel' });
// Zurück in die Waldansicht:
dev.run({ action: 'enemyReadabilityArrange', surface: 'woodland' });
```

A/B und Uhrzeiten (Minuten: 06:00=360, 12:00=720, 19:00=1140, 00:00=0):

```js
dev.run({ action: 'options', values: { timeOfDay: 360 } });
dev.run({ action: 'renderDebug', disable: ['enemyContour'] });
dev.run({ action: 'renderDebug', disable: [] });
dev.status().enemyContour; // instances, draws, strength, low, suppressed
```

Für eingefrorene A/B-Bilder nach jedem Umschalten `dev.run({action:'step',frames:1})`
verwenden. Zusätzlich Zoom 0,5 / 1 / 1,4 / 2, Lauf- und Angriffsframes, Verbündete,
Hit-Flash, Brand/Void sowie Tod prüfen. Erwartungen: weicher schmaler Doppelrand,
keine Linien in Kopf-/Pfoten-Lücken, keine Atlas-Nachbarframes, keine Nachtsicht durch
Kronen. Sonnenflecken und Wolkenschatten ändern nur die gemeinsame Weltbeleuchtung.

## Kostenrahmen

100 Gegner benötigen 100 GPU-Mitglieder (ca. 16,8 KB Member-Daten pro Update), vier
Vertices je Instanz und einen Draw pro tatsächlich gezeichnetem Sheet/Tiefenband.
Bei acht gleichzeitig verwendeten Sheets sind das acht Draws, unabhängig von der
Gegnerzahl. Keine zusätzlichen Bilddownloads oder Farb-/Maskenziele.

Rechnerisch bei 100 normalen Dachsen, Zoom 1,4: ungefähr eine Million Quad-Fragmente.
Leeres Padding beendet die Abfrage nach maximal 27 Texturzugriffen, normalerweise 18;
die längere radiale Außenprüfung läuft nur an Kandidatenkanten. Größenordnung:
20–30 Millionen Alpha-Abfragen je Frame; große Bosse oder hoher Zoom erhöhen die
Füllkosten quadratisch. Low spart den hellen Saum. Das ist eine Arbeitsabschätzung,
keine gemessene GPU-Zeit. Das Ziel von höchstens 1 ms zusätzlichem p95 muss Claude per
`enemyContour`-A/B mit 100 sichtbaren Gegnern bestätigen. Erstmaliger Shaderaufbau
und Steady-State getrennt messen.
