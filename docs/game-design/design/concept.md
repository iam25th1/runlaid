# RUNLAID.exe v2 — Core Concept

## The Pitch

A satirical workplace turf war that auto-plays while Claude works. AI agents invade a workplace and fight human workers over who controls the jobs. You pick a side or just watch.

## Why Turf War?

v1 was an endless runner — too active, required constant input. The turf war format lets you:
- **Watch passively** — the battle plays itself (observe mode)
- **Engage lightly** — click items when you want, ignore when you don't
- **Go competitive** — actively race NPCs for every item

The satire hits differently when you're *participating* in the displacement rather than running from it.

## Core Loop

```
Items spawn on desks/floor → Characters walk to grab them → Score shifts tug-of-war bar → Zone transitions → Winner declared
```

## Side Selection

After the intro/invasion sequence, players choose:
- **JOIN AS AI** — You take control of an AI agent. Click items to absorb them for the machine.
- **JOIN AS HUMAN** — You take control of a human worker. Click items to save them for humanity.
- **OBSERVE** — Watch the NPC battle unfold passively. Zero input required.

Choosing a side doesn't spawn a new character — you take over an existing team member (squad stays 3v3). Your character gets a speed boost, a glowing aura, and a "▼ YOU" label.

## Duration

The game runs as long as Claude is streaming. Progress bar is controlled externally by the streaming detection layer. When Claude finishes, progress hits 100% and the winner is declared. A 30-second response = 30-second game. A 3-minute response = 3-minute game.
