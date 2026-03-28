# Character Design

## Style
Side-view chibi characters. ~22px tall in-game. Single visible eye (profile view).

## AI Agents
- **Head:** Circular, solid #D85A30 (coral-orange), #a04520 stroke
- **Antenna:** #7C50FF accent, glowing tip with pulsing opacity
- **Eye:** White sclera, #40C8E0 cyan iris, #0a2a3a pupil, white highlight
- **Body:** #c94b22 rounded rectangle with #7C50FF circuit accent
- **Legs:** #7a2e10 dark, walking animation = alternating leg swing
- **Hands:** #D85A30 circles

## Human Workers
8 skin variants, each with unique outfit color (bc), skin tone (sk), hair (hr):

| # | Outfit    | Skin    | Hair    |
|---|-----------|---------|---------|
| 0 | #3570B0   | #F4C7A3 | #3A2A1A |
| 1 | #4A4A4A   | #D4A574 | #2A2A2A |
| 2 | #C04878   | #F0D5C0 | #8B3A1A |
| 3 | #3A9080   | #C8A882 | #1A3A2A |
| 4 | #A83030   | #F0D0B0 | #5A2A1A |
| 5 | #8A5090   | #F0C8B0 | #5A2A3A |

- **Head:** Circular, skin-toned, hair as top-half semicircle
- **Eye:** White sclera, dark iris, small highlight, blink every ~200 frames
- **Mouth:** Subtle smile arc (normal), O-shape circle (surprised during invasion)
- **Body:** Outfit-colored rounded rectangle

## Player Distinction
When player takes over a character:
- **Glow:** Radial gradient aura in team color, 20px radius, pulsing 10-14% opacity
- **Label:** "▼ YOU" above head in team color, bold 7px monospace
- **Size:** Slightly larger rendering (18×26 vs 16×24)
- **Speed:** 2.2 vs NPC 1.1-1.3

## Animations
- **Walking:** Leg swing ±3px sine wave, arm counter-swing ±2.5px, body bob ±1.2px
- **Idle:** Very subtle sway (±0.5px sine at 0.3× frequency)
- **Carrying:** "+1" text floats above for 20 frames after grab
- **Surprised:** Wide eyes (larger ellipse), O mouth, raised arms
