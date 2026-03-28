# Power-Ups

Spawn as hexagonal pickups on desk surfaces. Click to activate.
Spawn rate: every ~500 frames, 40% chance.

## ⚡ OVERCLOCK
- **Duration:** 420 frames (~7 seconds)
- **Effect:** Item spawn rate drops from ~45 to 18 frames (2.5× more items)
- **Strategy:** More items = more opportunities for both sides. Best when you're faster.

## ❄ FREEZE
- **Duration:** 200 frames (~3.3 seconds)
- **Effect:** Opposing team's NPCs stop moving entirely
- **Strategy:** Grab everything while they're frozen. Huge tug-of-war swing.

## ◎ MAGNET
- **Duration:** 300 frames (~5 seconds)
- **Effect:** Ungrabbed items within 70px of player drift toward them at 2.5px/frame
- **Strategy:** Stand in item-dense areas and let them come to you.

## Visual Design
- Hexagonal shape (6-sided), 11px radius
- Subtle bob (±3px vertical sine wave)
- Pulse scale (±6% sine wave)
- Fill: team color at 33% opacity
- Stroke: team color at full, 1.2px
- Icon centered in hexagon
