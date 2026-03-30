# RUNLAID.exe — Game Registry Architecture

## Overview

Transform the single-game extension into a multi-game platform where new games are added by dropping a single function into a registry array. The streaming detection, overlay management, and Chrome extension layer remain untouched.

---

## Current Architecture (Single Game)

```
content.js (1 file, 1100 lines)
├── IIFE wrapper
├── Streaming detection (~190 lines) — polls DOM, triggers game
├── Overlay management (~70 lines) — creates container, positions above input
└── Game engine (~850 lines) — turf war, hardcoded
```

**Problem:** Game engine is welded to the infrastructure. Adding a second game means duplicating 850 lines or rewriting.

---

## New Architecture (Multi-Game Registry)

```
content.js
├── IIFE wrapper
├── Streaming detection (unchanged)
├── Overlay management (unchanged)
├── Game Registry
│   ├── GAMES[] — array of game descriptors
│   ├── pickGame() — random selection with history tracking
│   └── launchGame(descriptor) — creates canvas, calls factory, wires API
│
└── Game files (separate or inline):
    ├── game-turf-war.js
    ├── game-typing-race.js
    ├── game-tower-defense.js
    └── ...
```

---

## Game Descriptor Contract

Every game is a single object with this shape:

```javascript
{
  id: 'turf-war',                    // unique slug
  name: 'The Great Displacement',     // display name (shown in overlay header)
  version: '2.2',                     // game version
  factory: function(canvas, api) {    // creates and starts the game
    // canvas: HTMLCanvasElement (640×180, already in DOM)
    // api: { onProgress, onFinish }
    //
    // MUST return: { start, setProgress, getState, destroy }
  }
}
```

### Factory Function — Input

```javascript
function(canvas, callbacks) {
  // canvas.width = 640, canvas.height = 180 (fixed)
  // canvas is already appended to DOM
  //
  // callbacks: {
  //   onFinish: function() — called when game reaches FINISHED state
  // }
}
```

### Factory Function — Output (required)

```javascript
return {
  start: function() {},
  // Reset and begin gameplay. Called once after factory.

  setProgress: function(value) {},
  // value: 0-100. Called externally by streaming detection.
  // Game should map this to its internal progression.
  // Must handle: being called before start(), repeated same values,
  // jumping from 30 to 100, etc.

  getState: function() { return { state, score, prog }; },
  // state: 'INTRO' | 'PLAYING' | 'CHOOSE' | 'FINISHED' | (game-specific)
  // score: number (player's score)
  // prog: number 0-100 (current progress)

  destroy: function() {}
  // Cleanup. Stop animation loops, remove event listeners,
  // null out references. Called when overlay hides.
  // Game must be fully garbage-collectible after this.
};
```

---

## Game Registry Implementation

```javascript
// ═══ GAME REGISTRY ═══
const GAMES = [];
let lastPlayedIds = []; // track last N games to avoid repeats

function registerGame(descriptor) {
  if (!descriptor.id || !descriptor.factory) {
    console.error('[RUNLAID] Invalid game descriptor:', descriptor);
    return;
  }
  GAMES.push(descriptor);
}

function pickGame() {
  if (GAMES.length === 0) return null;
  if (GAMES.length === 1) return GAMES[0];

  // Filter out recently played (last 3, or half the library, whichever is smaller)
  const avoidCount = Math.min(3, Math.floor(GAMES.length / 2));
  const available = GAMES.filter(g => !lastPlayedIds.slice(-avoidCount).includes(g.id));
  const pool = available.length > 0 ? available : GAMES;

  // Random pick
  const picked = pool[Math.floor(Math.random() * pool.length)];

  // Track history
  lastPlayedIds.push(picked.id);
  if (lastPlayedIds.length > 10) lastPlayedIds.shift();

  return picked;
}
```

---

## Launch Flow (Updated)

```javascript
function launchGame() {
  const wrap = container.querySelector('#runlaid-canvas-wrap');
  if (!wrap) return;

  const descriptor = pickGame();
  if (!descriptor) return;

  // Update header with game name
  const titleEl = container.querySelector('#runlaid-title');
  if (titleEl) titleEl.textContent = 'RUNLAID.exe — ' + descriptor.name;

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'runlaid-c';
  canvas.width = 640;
  canvas.height = 180;
  wrap.appendChild(canvas);

  // Call factory
  const callbacks = {
    onFinish: function() { /* optional: auto-hide after delay */ }
  };

  _gameApi = descriptor.factory(canvas, callbacks);
}
```

---

## Destroy Flow (Updated hideGame)

```javascript
function hideGame(immediate) {
  // ... existing hide logic ...

  // Destroy current game
  if (_gameApi && _gameApi.destroy) {
    _gameApi.destroy();
  }
  _gameApi = null;

  // Remove canvas
  // ... existing DOM cleanup ...
}
```

---

## Game Template (Starter for New Games)

```javascript
registerGame({
  id: 'my-new-game',
  name: 'My New Game',
  version: '1.0',
  factory: function(canvas, callbacks) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    // ═══ STATE ═══
    let state = 'INTRO'; // INTRO → PLAYING → FINISHED
    let fr = 0, score = 0, prog = 0;
    let running = true;

    // ═══ EVENT LISTENERS ═══
    function onMouse(e) {
      e.preventDefault();
      e.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (W / rect.width);
      const my = (e.clientY - rect.top) * (H / rect.height);

      // Handle clicks based on state
      if (state === 'INTRO') { state = 'PLAYING'; }
      if (state === 'PLAYING') {
        // game-specific click logic
        score++;
      }
    }
    canvas.addEventListener('mousedown', onMouse);
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });

    // ═══ UPDATE ═══
    function update() {
      fr++;
      if (state !== 'PLAYING') return;
      // game logic here
      if (prog >= 100) state = 'FINISHED';
    }

    // ═══ DRAW ═══
    function draw() {
      ctx.fillStyle = '#0F0D1A';
      ctx.fillRect(0, 0, W, H);

      if (state === 'INTRO') {
        ctx.fillStyle = '#fff';
        ctx.font = '800 20px Syne, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('MY NEW GAME', W/2, H/2);
        ctx.font = '500 10px monospace';
        ctx.fillStyle = '#666';
        ctx.fillText('Click to start', W/2, H/2 + 20);
        ctx.textAlign = 'left';
      }

      if (state === 'PLAYING') {
        // draw game
      }

      if (state === 'FINISHED') {
        // draw results
      }

      // Scanlines
      ctx.globalAlpha = .02;
      for (let y = 0; y < H; y += 3) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, y, W, 1);
      }
      ctx.globalAlpha = 1;
    }

    // ═══ LOOP ═══
    function loop() {
      if (!running) return;
      update();
      draw();
      requestAnimationFrame(loop);
    }
    loop();

    // ═══ API ═══
    return {
      start: function() {
        state = 'INTRO';
        fr = 0; score = 0; prog = 0;
      },
      setProgress: function(v) {
        prog = Math.min(100, Math.max(prog, v));
      },
      getState: function() {
        return { state, score, prog };
      },
      destroy: function() {
        running = false;
        canvas.removeEventListener('mousedown', onMouse);
      }
    };
  }
});
```

---

## File Organization Options

### Option A: Single File (Current, up to ~20 games)
All games inline in content.js. Simple, no build step.

```
extension/
├── manifest.json
├── content.js        ← detection + overlay + registry + ALL games
├── icon48.png
└── icon128.png
```

**Pros:** Zero tooling, single file deploy, Chrome Web Store simple
**Cons:** File gets large (~20-30KB per game, 500KB+ at 20 games)
**When to switch:** When file exceeds ~500KB or ~20 games

### Option B: Multi-File (20-50 games)
Each game in its own file. Manifest lists all files.

```
extension/
├── manifest.json
├── content.js        ← detection + overlay + registry
├── games/
│   ├── turf-war.js
│   ├── typing-race.js
│   ├── tower-defense.js
│   └── ...
├── icon48.png
└── icon128.png
```

```json
// manifest.json
"content_scripts": [{
  "matches": ["https://claude.ai/*"],
  "js": [
    "content.js",
    "games/turf-war.js",
    "games/typing-race.js",
    "games/tower-defense.js"
  ],
  "run_at": "document_idle"
}]
```

**Pros:** Clean separation, each game is independent, easy to enable/disable
**Cons:** Manifest must list every file (no dynamic loading in MV3)
**When to switch:** When approaching 50 games

### Option C: Build Step (50-100 games)
Source files compiled into single content.js via simple concat or bundler.

```
src/
├── core/
│   ├── detection.js
│   ├── overlay.js
│   └── registry.js
├── games/
│   ├── turf-war.js
│   ├── typing-race.js
│   └── ... (100 files)
└── build.js          ← simple concat script

extension/              ← output
├── manifest.json
├── content.js          ← built file
└── icons/
```

**Pros:** Scales to any number, can tree-shake unused code, minification
**Cons:** Requires build step (npm script), harder for contributors
**When to switch:** When 50+ games make manifest listing impractical

### Recommendation: Start with Option A, move to B at 15-20 games.

---

## Random Selection Logic

### Simple Random (Current Plan)
```javascript
// Avoid repeats of last N games
const avoidCount = Math.min(3, Math.floor(GAMES.length / 2));
```

### Weighted Random (Future)
```javascript
// Weight by: freshness, user preference, completion rate
{
  id: 'turf-war',
  weight: 1.0,        // base weight
  minDuration: 10,     // seconds — skip if task likely short
  tags: ['action', 'competitive', 'ai-theme'],
}
```

### Streak Prevention
- Never play same game twice in a row
- Don't play same game more than 2x in last 10 sessions
- If user closes game early (< 30% progress), reduce weight for that game

---

## Shared Utilities (Available to All Games)

Games that follow the same visual style can import shared drawing functions:

```javascript
const RUNLAID_UTILS = {
  // Colors
  CL: { bg:'#0F0D1A', srf:'#1E1C30', acc:'#7C50FF', ai:'#D85A30',
        hum:'#4A90D9', grn:'#39E07A', amb:'#E8A000', red:'#E24B4A' },

  // Rounded rect
  rr: function(ctx, x, y, w, h, r) { /* ... */ },

  // Scanlines
  scanlines: function(ctx, w, h) { /* ... */ },

  // Draw AI agent chibi
  drawAgent: function(ctx, x, y, scale) { /* ... */ },

  // Draw human worker chibi
  drawHuman: function(ctx, x, y, scale, skin) { /* ... */ },

  // Draw item icon
  drawItem: function(ctx, x, y, type, scale) { /* ... */ },

  // Generate share card (600×315 PNG)
  generateShareCard: function(title, stats) { /* ... */ },

  // Share to Twitter
  shareToTwitter: function(text) { /* ... */ },

  // Human skin palette
  SKINS: [ /* 8 skin variants */ ],
};
```

---

## Settings (Future — Optional)

```javascript
// User preferences (stored in chrome.storage.local if needed later)
const SETTINGS = {
  enabled: true,            // master toggle
  triggerDelay: 5000,       // ms before game launches
  disabledGames: [],        // game IDs to skip
  preferredTags: [],        // weight games with these tags
  volume: 0,                // 0 = muted (sound is future)
};
```

---

## Adding a New Game — Checklist

1. Write factory function following the template
2. Add `registerGame({...})` call
3. Test: does it start? does setProgress work? does it end cleanly?
4. Test: does destroy() stop the loop and remove listeners?
5. Test: does it play nice after another game just ran?
6. Add to manifest.json js array (if using Option B)
7. Update changelog

---

## Migration Plan (Current → Registry)

### Phase 1: Refactor (no new games)
- Extract turf war into a `registerGame()` call
- Add `pickGame()` and `launchGame()` wrapper
- Add `destroy()` to turf war
- Verify: existing behavior is identical

### Phase 2: Add games 2-5
- Build 4 new games using the template
- Test random selection
- Ship update

### Phase 3: Scale to 10+
- Extract shared utilities
- Add game name to overlay header
- Consider Option B file structure

### Phase 4: Scale to 50+
- Build step
- Settings/preferences
- Weighted selection
- Community contribution guide for games
