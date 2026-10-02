# Lazy Lobby-Ansichten

Upgrade-, Items- und Reward-Ansicht behalten ihre Scene-Owner, bauen ihre Phaser-Objekte aber erst bei der ersten erfolgreichen Öffnung. Erneute Öffnungen verwenden den Aufbau weiter und lesen den aktuellen Meta-Zustand.

Die 24 Ausrüstungsbilder liegen in `ITEM_VIEW_ASSETS` (`src/ui/OverlayAssets.ts`) außerhalb von `ArenaScene.preload`. Die großen Dekorationen aus `DeferredAssets` werden bereits im initialen Preload hochgeladen, damit ihre Texture-Uploads hinter dem Boot-Schleier bleiben. Die zweite Ladephase verwendet den Cache und übernimmt fehlgeschlagene optionale Bilder sowie Musik. Vor dem ersten Aufbau müssen die benötigten Bilder vorhanden sein; fehlgeschlagene optionale Dekorationen werden bei Öffnung erneut versucht.

Der UI-Ladeowner wartet auf das Ende von `DeferredAssets` und arbeitet danach seriell mit dem Scene-Loader in kleinen Bildpaketen. Nach Lobby-Reveal startet ein verzögerter Prefetch, der keine Ansicht aufbaut. Ready, Host-/Client- und World-Barrieren werden durch UI-Downloads nicht erweitert. Dies ist kein allgemeiner World-/Activity-Paketlader.

Während des Ladens erscheint bei Bedarf ein kleiner DOM-Dialog am vorhandenen Fullscreen-Root. Abbrechen: Button, Escape, Enter/Leertaste oder A/B eines Standard-Gamepads; Tab bleibt im Dialog. Gehaltene Gamepad-Tasten schließen ihn nicht sofort. Nach Ende wird der vorige DOM-Fokus wiederhergestellt. Die eigentlichen Ansichten behalten ihre bestehende Bedienung.

Schließen verwirft die Öffnungsanforderung, nicht gemeinsame Downloads. Wiederöffnen nutzt laufende Downloads oder den Cache. Lobby-Verlassen, Verbindungsende und Scene-Shutdown verhindern verspätete Öffnungen. Rewards werden nach asynchronem Laden neu gelesen. Fehler zeigen eine Fehlermeldung statt Ersatzgrafiken; Abbrechen und Wiederöffnen versucht die fehlenden Bilder erneut.

## Prüfung und Messung

- Verhalten: `tests/OverlayAssets.test.ts`, `tests/LazyOverlays.test.ts`.
- Bestehende Verträge: BootPreparation, LobbyMusicLazyLoading, UpgradeMenuLayout, depthR0Contract; außerdem `npm run test:assets` und `npm run check`.
- Messung: `npm run perf:chrome -- --load --network 50mbps` (zusätzlich ohne Netzbegrenzung), mehrere kalte/warme Wiederholungen. Die UI-Bauarbeit verlagert sich zur Erstöffnung; aus der Bytezahl folgt kein garantierter Zeitgewinn.
- Manuell: sofortige Erstöffnung, Öffnung nach Prefetch, mehrfaches Schließen/Wiederöffnen, Tab/Escape/A/B, Reward inzwischen beansprucht, langsames Netz/404, Disconnect und Arenastart während Laden. Auch Fullscreen prüfen. Keine fehlenden Texturen; Ready-Verhalten unverändert.

Bei sehr langsamem Netz kann eine sofortige Erstöffnung noch auf die bestehende zweite Ladephase warten. Der Dialog bleibt abbrechbar; eine feste maximale Wartezeit wird nicht versprochen.
