# Technical Architecture

## Chrome Extension (Manifest V3)

### Files
- `manifest.json` — Manifest V3, content script injection on `claude.ai/*`
- `content.js` — Everything: streaming detection + game engine (single file, no iframe)
- `icon48.png`, `icon128.png` — Extension icons

### Why Single File?
Brave/Chrome blocks `chrome-extension://` URLs in iframes on web pages. Injecting a `<script>` tag hits CSP. Running the game engine directly in the content script context (which has canvas API access) avoids both issues.

### Content Script Structure
```
content.js
├── IIFE wrapper
├── State variables (streaming detection)
├── getInputBox() / getInputBoxRect() — find Claude's input element
├── createOverlay() — DOM container + CSS + position tracking
├── launchGame() — creates canvas, calls gameEngineCode()
├── showGame() / hideGame() — lifecycle management
├── isStreaming() — DOM query for streaming state
├── startWatching() — 500ms polling loop
│
└── gameEngineCode() — self-contained game engine
    ├── Constants (colors, zones, skins, powerups)
    ├── State (game state machine, entities, timers)
    ├── Entity factories (mkChar, spawnItem, spawnPowerup)
    ├── Input handler (mousedown → click routing)
    ├── Update loop (state-dependent, 60fps)
    ├── Draw functions (environment, items, characters, HUD)
    ├── Share functions (generateCard, savePNGCard, shareToTwitter)
    └── API (window._runlaid: start, setProgress, getState)
```

### Communication
The content script communicates with the game engine through `window._runlaid`:
- `start()` — reset and begin game
- `setProgress(0-100)` — externally control task progress
- `getState()` — read current game state

### Canvas
- Internal resolution: 640×180
- CSS: `width: 100%` (stretches to match input box width)
- All coordinates relative to internal resolution
- Mouse coordinates converted: `(clientX - rect.left) * (W / rect.width)`
