# Referenzimplementierungen

Diese Auswahl ist ein Einstieg, keine Vorlage zum blinden Kopieren. Vor Änderungen immer die konkrete Referenz und ihre Call-Sites lesen; visuelle Änderungen abschließend im betroffenen Spielzustand prüfen.

## Komponierte Hitscan-Wirkung

**Pfad:** `src/effects/AsmdPrimaryRenderer.ts`, Einstieg `playTracer()`

**Nutzen:** Referenz für energiereiche Hitscan-Waffen, Mündungsburst und Einschläge.

**Gelungen:** gestaffelte Beam-Segmente, Kern/Glow/Fringe, kurzlebige Arcs, getrennte Player-/Environment-Impacts, farbbasierte Palette und explizites Tween-/Emitter-Cleanup. Die Sequenz verbindet Mündung, Flug und Impact zu einer lesbaren Wirkung.

**Nicht blind kopieren:** Anzahl der Layer und pro Schuss erzeugten Objekte ist für schnellere Feuerraten oder schwächere Waffen zu teuer und visuell zu dominant.

## Explosionen und Kamera-Feedback

**Pfad:** `src/effects/EffectSystem.ts`, Einstieg `playExplosionEffect()`

**Nutzen:** Referenz für zeitliche Komposition von Standard-, Holy-, Energy-, Rocket- und Nuke-Explosionen.

**Gelungen:** Schadensradius als visuelle Basis, schneller Flash, Blast/Halo, mehrere Shockwaves, stilabhängige Partikel, Fullscreen-Flash und abgestuftes Kamerashake; alle temporären Objekte besitzen End-Cleanup.

**Nicht blind kopieren:** Die Methode ist bereits groß und variantenreich. Neue eigenständige Effektfamilien besser in einen fokussierten Renderer auslagern; Nuke-/Holy-Partikelzahlen nicht auf häufige Explosionen übertragen.

## Kontinuierliche Projektilvisualisierung

**Pfad:** `src/effects/RocketRenderer.ts`, Einstiege `createVisual()`, `updateVisual()`, `destroyVisual()`

**Nutzen:** Referenz für Projektile mit Körper, Glow, Antrieb, Exhaust und Residual-Smoke.

**Gelungen:** klare Create/Update/Destroy-Phasen, Geschwindigkeitsvektor als einzige Ausrichtungsbasis, korrekt rückwärts versetzter Antrieb/Trail und zentrale Bereinigung der Map sowie verbleibender Smoke-Puffs.

**Nicht blind kopieren:** Die per Puff erzeugten Images sind kein allgemeiner Pool. Bei deutlich höheren Spawnraten Pooling oder einen begrenzten Emitter prüfen.

## Synchronisierte Pickups und Asset-Nutzung

**Pfad:** `src/powerups/PowerUpRenderer.ts`, Einstieg `sync()`/`syncPedestals()`

**Nutzen:** Referenz für replizierte Weltobjekte, die vorhandene PNGs mit prozeduralen Glow-/Partikellayern kombinieren.

**Gelungen:** Container bündeln Visuals, deterministische Phasenoffsets vermeiden gleichförmiges Pulsieren, Spawn-/Materialize-Sequenzen sind getrennt, Tweens stoppen über Destroy-Events und `container.destroy(true)` räumt Kinder auf.

**Nicht blind kopieren:** Filter/Glow hängen von Renderer-Fähigkeiten ab; Fallbackpfad und feste Weltgröße beibehalten statt UI-Icons unkontrolliert hochzuskalieren.

## Round-Lifecycle

**Pfad:** `src/scenes/arena/ArenaLifecycleCoordinator.ts`, Einstiege `buildArena()` und `tearDownArena()`

**Nutzen:** Referenz für neue Round-Systeme und jede Ressource, die nur in `ARENA` existiert.

**Gelungen:** zuverlässige Build-Gates, defensiver vorheriger Teardown, zentraler Reset von Cache/Resolvern/Callbacks und explizites Nullsetzen aller Round-Abhängigkeiten.

**Nicht blind kopieren:** Keine neue Verdrahtung wahllos in die bereits große Coordinator-Datei legen. Fachlogik bleibt im jeweiligen System; der Coordinator verbindet und beendet sie nur.

## Niedriglatenter Command-/Event-Kanal

**Pfad:** `src/network/GameplayTransportChannel.ts` mit `tests/GameplayTransportChannel.test.ts`

**Nutzen:** Referenz für transportagnostische, testbare Netzwerklogik.

**Gelungen:** injizierte Abhängigkeiten, validierte Parser, Epoch-/Sequenzmodell, Deduplizierung, Acks, Resend, Altersgrenze, RPC-Fallback und Metriken sind voneinander klar getrennt.

**Nicht blind kopieren:** Dieser Kanal ist bewusst auf wenige zeitkritische Commands und kurzlebige Events begrenzt. Große Snapshots oder neue persistente Zustände gehören nicht automatisch hinein.
