# Game Flow — State Machine

## States

### INTRO (3 seconds, ~150 frames)
- 5 human workers appear at desks spread across the scene
- Workers have idle animation (subtle bob, arm typing motion)
- Work items begin spawning on desk surfaces every ~55 frames
- Text overlay: "Workers producing..."

### INVASION (2 seconds, ~110 frames)
- 3 AI agents march in from right side of screen
- March speed: 2.5px/frame toward target positions
- After 50 frames: human workers react with surprised expressions (wide eyes, O mouth)
- Items continue spawning
- Text overlay: "AI AGENTS INCOMING..." in AI orange

### CHOOSE (until click)
- Dark overlay (55% opacity) drops over scene
- Banner: "THE DISPLACEMENT HAS BEGUN"
- Three buttons: JOIN AS AI (orange) | JOIN AS HUMAN (blue) | OBSERVE (gray)
- NPCs continue grabbing items in background while waiting
- Tug-of-war bar active and updating

### PLAYING (until task completes)
- Full gameplay active
- Items spawn at dynamic rate (faster with overclock, scales with progress)
- All NPCs actively seeking and grabbing items
- Player character (if not observing) walks to clicked positions
- Zone transitions at 20%, 40%, 60%, 75% progress
- Powerups spawn every ~500 frames (40% chance)
- Progress bar shows task completion percentage

### FINISHED (overlay)
- Dark overlay (88% opacity)
- Winner announced: "AI WIN THE TURF WAR" or "HUMANS WIN THE TURF WAR"
- Player score shown (if not observing)
- Tug-of-war final percentages
- Two buttons: 🐦 SHARE ON X | 💾 SAVE CARD
- Game stays on this screen until extension hides the overlay
