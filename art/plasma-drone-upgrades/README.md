# Plasmabrenner und Angriffsdrohne: Upgrade-Artwork

18 einzeln mit dem eingebauten Imagegen-Tool generierte Motive, einschließlich beider Freischaltungen. Die Prompts und Referenzen stehen in [prompts.json](prompts.json); die transparenten Originale liegen in `source/`.

Die Freischaltungen orientieren sich an den tatsächlichen Pipeline-Sprites. Die Illustrationen verwenden auf ausdrücklichen Wunsch eine Dreiviertelperspektive. P90- und Maschinengewehrturm-Icons dienen als Stilreferenz. Die alten Platzhaltersymbole wurden nicht als Referenz verwendet.

Export vom Repository-Root:

```sh
node art/plasma-drone-upgrades/export.mjs
```

Das exportiert die PNGs mit 64 × 64 Pixeln nach `public/assets/sprites/Loadout/UPGRADE_<ID>.png` und erzeugt `overview.png` mit Ansichten in 144, 32 und 64 Pixeln. Die PNG-Transparenz bleibt erhalten. Die 32-Pixel-Ansicht entspricht der Icongröße im Upgrade-Menü.

Für diese Motive den Export aus den Originalen verwenden; `scripts/attack-drone-icons.mjs` enthält den früheren Platzhaltergenerator.
