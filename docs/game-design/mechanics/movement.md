# Movement Mechanics

## Grounded Movement
- All characters are Y-axis locked to ground level (y = GY - characterHeight)
- Movement is X-axis only — no jumping, no flying
- Characters slide left/right with walking animation (leg swing, arm bob)

## Player Movement
- **Click anywhere** → character walks to that X position
- **Click near item** (within 45px) → character walks there AND targets item for pickup
- **Auto-pickup** → any ungrabbed item within 12px of player is auto-collected while walking
- Click during walk → immediately redirects to new position
- Player speed: 2.2 (faster than any NPC)

## NPC Movement
- NPCs scan for nearest ungrabbed floating item
- Walk toward target at their base speed × difficulty multiplier
- On arrival (within 6px), grab the item
- After grabbing, idle briefly then scan for next item
- AI NPCs ignore contention (don't check if others target same item)
- Human NPCs check contention 60% of the time (slower to commit)

## Bounds
- All characters clamped to X range [15, W-20]
- Items clamped to [15, W-25] horizontally, [10, GY-30] vertically
