# Scoring & Tug-of-War

## Tug-of-War Bar
- Bottom of screen, full width
- Left half: AI (orange), Right half: Human (blue)
- Center marker at 50%
- Starts at 50/50, shifts as each side grabs items
- Percentages shown: "AI 62%" / "HUMAN 38%"

## Points Per Grab
- **Player grab:** 1.5 points to your side
- **AI NPC grab:** 0.7 × difficulty multiplier
- **Human NPC grab:** 0.5 points

After each grab, tug-of-war percentages are recalculated:
```
total = tugAI + tugHuman
tugAI = tugAI / total × 100
tugHuman = tugHuman / total × 100
```

## Winner
Whichever side has >50% when task completes wins.

## Personal Score
Separate from tug-of-war. Counts only YOUR grabs (player clicks). Shown in finished screen and share card.
