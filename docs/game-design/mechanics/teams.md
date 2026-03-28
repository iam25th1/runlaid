# Teams — 3v3 Squads

## Composition
- **3 Human Workers** — spawn during INTRO at desks
- **3 AI Agents** — march in during INVASION from right side
- Total: 6 characters. Never more, never less.

## Player Takeover
When the player selects a side, they take control of team member #0 (no 4th character spawns).

The taken-over character gets:
- Speed boost: 2.2 (vs NPC 1.1–1.3 base)
- Glowing aura: radial gradient in team color, pulsing
- "▼ YOU" label floating above head
- Click-to-walk control (NPCs use AI pathfinding)

## NPC Behavior

### AI Agents
- Base speed: 1.3
- Speed multiplier: 1.2× (effective 1.56)
- Reaction time: 15–20 frame idle, decreasing with zone
- Aggression: always targets closest item, ignores contention
- Points per grab: 0.7 base, scaling with difficulty

### Human Workers
- Base speed: 0.9–1.3 (random per character)
- Speed multiplier: 1.0×
- Reaction time: 15–40 frame idle
- Aggression: 60% chance to skip items another NPC is targeting
- Points per grab: 0.5 base

## Progressive Difficulty (AI scaling per zone)

| Zone | Speed Mult | Reaction (frames) | Points/Grab |
|------|------------|-------------------|-------------|
| 0    | 1.0×       | 20                | 0.70        |
| 1    | 1.25×      | 16                | 0.88        |
| 2    | 1.50×      | 12                | 1.05        |
| 3    | 1.75×      | 8                 | 1.23        |
| 4    | 2.0×       | 5                 | 1.40        |

Player always gets 1.5 pts per grab regardless of zone.
