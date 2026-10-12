# Zphone Icon

The square artwork and transparent foreground are the master assets. Run
`npm run build:icons` to regenerate web, tray, Windows ICO and Android assets.
Generated PNGs omit source metadata. The Android foreground preserves the
adaptive mask safe zone; the notification icon uses only the mark's alpha.

To replace both masters, pass their paths to `npm run build:icons -- square.png
foreground.png`. This changes artwork only, not installed application identity.
