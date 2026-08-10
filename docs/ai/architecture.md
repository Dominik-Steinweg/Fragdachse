# Architektur

Nur bei Aufgaben lesen, die Systemgrenzen, Scene-/Round-Lifecycle oder mehrere Subsysteme berühren. Einzelne API-Details direkt im Code prüfen.

## Start und Hauptfluss

`src/main.ts` wartet zuerst auf `NetworkBridge.initializeLobby()`, aktiviert dann den Singleton aus `src/network/bridge.ts` und erzeugt erst danach `Phaser.Game`. `ArenaScene` ist die einzige Phaser-Scene; die Lobby ist `src/scenes/LobbyOverlay.ts` innerhalb dieser Scene, keine zweite Scene.

`src/scenes/ArenaScene.ts` lädt Assets, erzeugt Scene-Lifetime-Dienste und UI, assembliert `ArenaContext`, verdrahtet Renderer und delegiert den laufenden Betrieb:

- `ArenaLifecycleCoordinator`: Phasenwechsel, Arena-Aufbau/-Abbau und Rundenergebnisse.
- `HostUpdateCoordinator`: autoritative Simulation und Publikation.
- `ClientUpdateCoordinator`: empfangene Zustände, Interpolation und lokale Prediction.
- `RpcCoordinator`: fachliche RPC-Handler; der eigentliche Transportzugriff bleibt im Bridge-Modul.

`ArenaScene.update()` koordiniert diese Komponenten. Neue umfangreiche Regel- oder Effektlogik gehört nicht direkt in die Scene.

## Zuständigkeiten

- `src/systems/`: hostseitige Gameplay-Regeln, zeitlicher autoritativer State und Kollisionsergebnisse.
- `CoopDefenseMapDirector` ist ein Round-Lifetime-Hostsystem für endliche Encounter. Im
  zeitgeplanten A2-Modus delegiert er fällige Gruppen an den bestehenden `CoopDefenseWaveSpawner`;
  im `repel-assault`-Modus aktiviert er genau einen Encounter nach dem anderen und entscheidet
  Clear über die von diesem Spawnaufruf zurückgegebenen Enemy-IDs, gefolgt von `restAfterMs`.
  Legacy-`waves`, Spawnpunkt-Wellen und Boss-Spawns bleiben getrennt. Der Director meldet den
  Assault-Fortschritt nur an den `CoopDefenseRoundStateSystem`, der als einzige Instanz Sieg oder
  Niederlage abschließt.
- `CoopDefenseSurvivalSystem` ist ein separates host-only Round-System für bewusst konfigurierte
  `survive`-Maps. Es hält pro Round-Participant Budget, Lebensstatus und Eliminierung, während
  `CoopDefenseRoundStateSystem` nur den Team-Wipe als booleschen Regelinput abfragt. Der Zustand
  wird über den kleinen globalen Reliable-Key `csv` repliziert; die bestehende
  `RoundParticipationState`-Rolle bleibt bei Survival-Eliminierung unverändert.
- `src/entities/`: Entity-Lifecycle, Manager, Host-Objekte und Clientdarstellung replizierter Entities.
- `src/effects/`: nicht-autoritative visuelle Reaktion, Partikel und Renderer. Effekte entscheiden keinen Schaden.
- `src/arena/`: Layout-Erzeugung, Terrain, Registrys und statische/dynamische Arena-Objekte.
- `src/loadout/`: Waffen-, Utility- und Ultimate-Konfiguration sowie Ausführung.
- `src/ui/`: HUD, Overlays und lokale Eingabevisualisierung.
- `src/network/`: fachliche Netzwerkgrenze, WebRTC-Substrat unter `peer/`, Ping/Qualität, Transportdiagnose und Snapshot-Codecs.
- `src/config.ts`, `src/types.ts`: gemeinsame Konstanten und Wire-/Domänenverträge; Magic Numbers nicht verteilen.

Abhängigkeiten laufen grob von Scene/Coordinators zu Systems/Manager/Renderer. Gameplay-Module sprechen über die fachliche `NetworkBridge`-API, nie über das Transportsubstrat. Renderer lesen entschiedene Zustände oder Ereignisse und bleiben von autoritativer Logik getrennt.

## Zwei Lebensdauern

`src/scenes/arena/ArenaContext.ts` ist der ausdrückliche Vertrag:

- Scene-Lifetime: Manager, Kernsysteme, Audio, Eingabe und HUD bestehen ab `ArenaScene.create()` stabil.
- Round-Lifetime: Arena-Resultat, Registrys und Modus-/Host-Systeme sind außerhalb einer Runde `null`.

`ArenaLifecycleCoordinator.buildArena()` beginnt defensiv mit `tearDownArena()`, verwirft den Netzwerk-Merge-Cache, hydriert das vom Host veröffentlichte Layout und verdrahtet Round-Systeme. Im Coop-Modus wartet der Client zusätzlich auf den zuverlässigen `RoundState`, weil Map-ID und Spielerzahl Teil derselben Build-Baseline sind.

`tearDownArena()` zerstört dynamische Phaser-Objekte, leert Renderer/Manager, entfernt Callback-Sinks und Resolver und setzt alle Round-Referenzen zurück. Provider, die Round-Systeme schließen, müssen die Referenz erst beim Aufruf aus `ctx` lesen und `null` tolerieren; keine veraltete Round-Instanz dauerhaft capturen.

Die statische Kulisse entsteht über `ArenaBuilder.buildStatic()`. Runde-spezifische Inhalte werden separat gebaut und über `ArenaBuilder.destroyDynamic()` entfernt.

## Designraum und Renderauflösung

Gameplay, HUD und alle Konstanten rechnen ausschließlich im Designraum `GAME_WIDTH x GAME_HEIGHT` (1920x1080). Die Canvas rendert davon unabhängig in der Pixelzahl, die der Browser tatsächlich darstellt (`src/graphics/RenderResolution.ts`); `src/main.ts` setzt die Startgröße, ein Controller hält sie bei Fenster-, Vollbild- und Zoomwechseln nach. Die Umrechnung leistet allein der Kamera-Zoom in `ArenaScene.bindCameraToDesignSpace()`.

- Die Hauptkamera braucht dafür zwingend `setOrigin(0, 0)`. Phaser 4 bildet in `Camera.preRender` `Screen = zoom * (Welt - scroll * scrollFactor - originPx) + originPx` ab; nur ohne `originPx` behandelt der Zoom Weltobjekte und bildschirmfestes HUD (`scrollFactor 0`) gleich. Mit Phasers Default `originX = 0.5` driften beide bei `zoom != 1` auseinander.
- `clampX`/`clampY` gehen weiterhin von mittiger Verankerung aus und verrechnen `width` gegen `displayWidth = width / zoom`. `syncMainCameraBounds()` rechnet diese Differenz vorweg aus den Kamera-Grenzen heraus, sonst klemmt die Kamera oberhalb von Renderauflösung 1 dauerhaft versetzt fest.
- `camera.worldView` ist für diese Kamera unbrauchbar: Phaser setzt ihn auf `scroll + width / 2 - displayWidth / 2` und unterstellt damit `origin = 0.5`. Bei `origin = (0, 0)` ist der sichtbare Ausschnitt `[scroll, scroll + width / zoom]`, `worldView` liegt also um `(width - width / zoom) / 2` Weltpixel daneben — bei Renderauflösung 1 null, darüber mehrere hundert Pixel. Sichtbarkeitsprüfungen leiten den Ausschnitt selbst ab (`getVisibleWorldView()` in `src/ui/HostileBaseIndicator.ts`).
- `pointer.x`/`pointer.y` zählen Renderpixel. Wo roh damit gerechnet wird, ist `toDesignSpace()` nötig; `camera.getWorldPoint()` und die Treffererkennung interaktiver Objekte invertieren die Kameramatrix bereits selbst und brauchen nichts.
- `Text` rastert Glyphen in Designpixeln. `src/graphics/TextResolution.ts` überlagert `scene.add.text` (dasselbe Muster wie `GraphicsQualityController` bei `scene.add.particles`) und hebt `Text.setResolution()` an, sonst bleiben kleine Labels beim Hochskalieren weich.
- Die Obergrenze steht als `maxRenderScale` im Grafikqualitätsprofil: hochauflösende Monitore kosten quadratisch Fill-Rate, `low` bleibt deshalb beim Designraum.
- Die Canvas trägt bewusst kein `image-rendering: pixelated`. Es widerspricht dem `smoothPixelArt`-Shader und rastert krumme Skalierungsfaktoren hart statt gefiltert.

## Vollbild und DOM-Overlays

Vollbild läuft ausschließlich über `src/ui/fullscreen.ts`; der ScaleManager wird dafür nicht mehr direkt angesprochen.

- `#game-container` ist zugleich `parent` und `scale.fullscreenTarget`. Ohne gesetztes Ziel legt Phaser einen eigenen `<div>` an und verschiebt **nur die Canvas** hinein (`ScaleManager.getFullscreenTarget`); der Browser zeigt im Vollbild ausschließlich diesen Teilbaum, sodass jedes andere DOM-Element unsichtbar wird, obwohl es weiter im Dokument hängt.
- DOM-Overlays hängen sich deshalb an `getOverlayRoot()` statt an `document.body`. Sie positionieren sich per `position: fixed` am Viewport, der Elternwechsel ändert also nichts an der Darstellung.
- Browser-Vollbild (F11, Browsermenü) ist für die Seite nicht dasselbe wie API-Vollbild: `document.fullscreenElement` bleibt `null`, `fullscreenchange` feuert nicht, `exitFullscreen()` bleibt wirkungslos, und Chrome verlangt zum Verlassen ein langes ESC statt eines kurzen. Erkennbar ist es nur über `matchMedia('(display-mode: fullscreen)')`. Damit beide Wege denselben Zustand ergeben, fängt das Modul F11 ab und stellt stattdessen API-Vollbild her; nur wenn bereits Browser-Vollbild aktiv ist, bleibt F11 unangetastet, weil es dort der einzige Ausweg ist.
- UI, die den Vollbildzustand anzeigt, hört auf `onFullscreenChange()`, nicht auf `Phaser.Scale.Events.ENTER_FULLSCREEN`/`LEAVE_FULLSCREEN` – die kennen nur das API-Vollbild.
- Der Lobby-Vollbildbutton aktiviert weiterhin auf `pointerup` (Touch-/Browser-Geste), akzeptiert dieses Loslassen aber nur nach einem eigenen `pointerdown`. So kann ein modales Overlay, das sich auf `pointerdown` schließt, seinen nachfolgenden Klick nicht an den unsichtbaren Lobbybutton durchreichen.

## Nicht offensichtliche Entscheidungen

- Der Host publiziert vor `LOBBY → ARENA` Layout, Zeitbasen und Round-State zuverlässig; der Phasenwechsel ist das nachgelagerte Gate.
- Ein spät gestarteter Client kann bereits in `ARENA` eintreten. `initialize()` plant deshalb den Aufbau im nächsten Frame, nachdem Create-time-Callbacks und RPCs stehen.
- Bei Rundenwechseln muss `NetworkBridge.resetGameStateCache()` die Merge-Baseline von Delta-Slices verwerfen, sonst könnten unveränderte Werte aus der Vorrunde weiterleben.
- Phaser-4-WebGL verwendet hier keine `GeometryMask` für den Arena-Clip. `ArenaScene.ensureArenaClipMask()` lässt sie bewusst `null`; Bounds, Clamping und Sichtbarkeitslogik übernehmen die Begrenzung.
- Die Lobby-Musik ist ein bewusst verzögertes Scene-Lifetime-Asset: `preloadAllAudio()` lässt `music_lobby` aus, solange Musik beim Standardwert `0` bleibt. Erst ein positiver Musikregler lädt den Track über `GameAudioSystem`; das Optionen-Overlay visualisiert lediglich dessen veröffentlichten Ladezustand.
- Phaser lässt sich in den Vitest-Tests nicht importieren: `phaser.esm.js` greift beim Modul-Load auf das DOM zu und es gibt kein jsdom-Setup. Module, die testbar bleiben sollen, importieren Phaser deshalb nur als Typ (`import type * as Phaser`) und rufen Phaser-Funktionen ausschließlich über übergebene Objekte auf – siehe `src/effects/LightOccluderIndex.ts`.

## Testdesign und Balancing

> Teste Verhalten und Verträge, nicht den aktuellen Balance-Snapshot.

- Tests schützen technische Verträge, Berechnungslogik, Referenzintegrität, Schemas, Invarianten und bewusst festgelegte Designregeln.
- Veränderliche Balancing-Werte aus JSON- oder Konfigurationsdateien nicht als exakte Zahlen duplizieren. Erfordert eine legitime Balanceänderung nur dieselbe Zahlenänderung im Test, ist dieser in der Regel zu stark gekoppelt.
- Formeln und Modifier mit kleinen künstlichen Testdaten prüfen; produktive Konfigurationen vor allem auf Gültigkeit, Referenzen, Wertebereiche und semantische Beziehungen testen.
- Konkrete Produktionswerte nur festschreiben, wenn sie einen ausdrücklich benannten technischen oder fachlichen Vertrag bilden; die Ausnahme im Testnamen oder Kommentar als Design- beziehungsweise Balancevertrag kennzeichnen.
- Reine Balanceprüfungen dürfen keine Validierung bilden, die den Spielstart blockiert.
- Keine vollständigen Snapshots veränderlicher Map-, Waffen-, Gegner- oder Progressionswerte und keine exakten Registry-Anzahlen, sofern eine feste Anzahl nicht fachlich erforderlich ist.

## Wichtige Referenzpfade

- Boot: `src/main.ts`
- Orchestrierung: `src/scenes/ArenaScene.ts`
- Lifetime-Vertrag: `src/scenes/arena/ArenaContext.ts`
- Round-Aufbau/-Abbau: `src/scenes/arena/ArenaLifecycleCoordinator.ts`
- Renderer-Verdrahtung: `src/scenes/arena/RendererBundle.ts`
- Arena-Aufbau: `src/arena/ArenaBuilder.ts`
- Netzwerkgrenze: `src/network/NetworkBridge.ts`
