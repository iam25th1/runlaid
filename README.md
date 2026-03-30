<div align="center">

# RUNLAID.exe

### 100 Satirical Mini-Games That Play While Claude Works

A Chrome extension that auto-launches a random game on [claude.ai](https://claude.ai) whenever Claude streams a long response. Different game every time. AI vs Humans.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-brightgreen)](https://github.com/iam25th1/runlaid/releases)
[![Games](https://img.shields.io/badge/Games-12%20%2F%20100-7C50FF)](https://github.com/iam25th1/runlaid)
[![Twitter](https://img.shields.io/badge/Follow-@25thprmr-1DA1F2)](https://x.com/25thprmr)

[**Install**](#install) · [**The Games**](#the-games) · [**How It Works**](#how-it-works) · [**Contributing**](#contributing) · [**Support**](#support-the-project)

---

</div>

## What Is This?

RUNLAID.exe is a Chrome/Brave extension that detects when Claude is streaming a long response and launches a **random mini-game** right above Claude's input box.

Every time Claude works on a long task, you get a different game. 12 shipped, 100 planned. Each one is a satirical take on AI displacing humans in the workplace.

Free forever. Open source. No tracking. No ads.

## Install

### From GitHub Releases

1. Go to [**Releases**](https://github.com/iam25th1/runlaid/releases) and download the latest `.zip`
2. Extract the zip to a folder
3. Open `chrome://extensions` (or `brave://extensions`)
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked** and select the `extension/` folder
6. Visit [claude.ai](https://claude.ai) and send a long task

### From Source

```bash
git clone https://github.com/iam25th1/runlaid.git
cd runlaid
```
Then load the `extension/` folder as an unpacked extension (steps 3-6 above).

## The Games

12 games and counting. A new random game every time Claude starts streaming.

| # | Game | What You Do |
|---|------|------------|
| 1 | **The Great Displacement** | 3v3 turf war. Click to walk, collect work items, pick AI or Human side |
| 2 | **Displacement Whack** | AI agents pop up at desks. Whack them. Don't hit humans |
| 3 | **Office Breakout** | Paddle + ball. Smash AI agent bricks. Catch power-ups |
| 4 | **Resume Raid** | Shoot resumes upward at descending AI formations. Hold to auto-fire |
| 5 | **Coffee Rush** | Workers fall asleep. Click to deliver coffee before AI takes their desk |
| 6 | **Wire Tap** | AI cables grow toward stations. Click the tips to sever them |
| 7 | **Firewall** | Toggle lane barriers. Block AI packets (red), let humans (blue) through |
| 8 | **Ctrl+Z** | AI edits scroll across code. Click to undo. Don't touch human edits |
| 9 | **Desk Shuffle** | Shell game. Memorize humans, desks shuffle, find them again |
| 10 | **Spam Filter** | Emails fall. Click left = trash (AI spam). Click right = inbox (human mail) |
| 11 | **Signal Boost** | Radio towers decay. Click to boost signal. Click AI jammers to destroy |
| 12 | **Pixel Turf** | Grid territory. Click tiles to claim. AI virus spreads to adjacent tiles |

Every game has a different mechanic. No two play the same. The registry picks randomly with repeat avoidance so you won't play the same game twice in a row.

### Shared Mechanics

All games share these elements:

- **5 Workplace Zones** that unlock as Claude's response progresses (Tech Office, Design Studio, Newsroom, Film Set, Trading Floor)
- **Progressive difficulty** that scales with zones
- **Intro screen** with quick instructions before gameplay starts
- **Results screen** when Claude finishes with score, stats, and a verdict

## How It Works

1. **Detection** -- Watches for `[data-is-streaming="true"]` on claude.ai
2. **Trigger** -- After 5 seconds of continuous streaming, a random game launches
3. **Play** -- Canvas overlay appears above Claude's input box
4. **Sync** -- Game progress is tied to Claude's actual streaming duration
5. **End** -- When Claude stops streaming, the game wraps up and shows results

The game runs entirely client-side. No data is sent anywhere. No network requests. No tracking. Not even localStorage.

## Architecture

```
runlaid/
├── extension/
│   ├── manifest.json       # Manifest V3, content script on claude.ai only
│   ├── content.js          # Detection + overlay + game registry + all games
│   ├── icon48.png
│   └── icon128.png
├── docs/
│   ├── game-design/
│   ├── architecture.md
│   ├── streaming-detection.md
│   └── changelog.md
├── index.html              # Landing page
├── privacy.html            # Privacy policy
├── LICENSE                 # GPL v3
└── README.md
```

### Game Registry

Every game is a single `registerGame()` call with a factory function that receives a canvas and returns `{start, setProgress, getState, destroy}`. Adding a new game is one function.

```javascript
registerGame({
  id: 'my-game',
  name: 'My Game',
  factory: function(canvas) {
    // your entire game here
    return { start, setProgress, getState, destroy };
  }
});
```

The registry handles random selection, repeat avoidance, canvas setup, and lifecycle management. Games don't need to know about Claude, streaming, or the overlay.

## Contributing

We're building toward 100 games. Contributions welcome.

1. **Fork** the repo
2. **Create a branch** (`git checkout -b game/your-game-name`)
3. **Write your game** using the `registerGame()` template
4. **Test** with the test harness (`test-games.html`) or load the extension
5. **Submit a PR** with a description of the game mechanic

### Game Guidelines

- Canvas is 640x180 (wide banner format)
- Mouse only (click, move, hold, drag)
- AI vs Humans theme
- Include an intro screen with quick instructions
- Include a results screen with score and stats
- Must implement `destroy()` to clean up event listeners
- No network requests, no storage, no external dependencies

### Other Contributions

- New workplace zones
- Power-up ideas
- Bug fixes
- Firefox/Safari port
- Performance optimizations
- Landing page improvements

## Privacy

- Zero data collection
- Zero network requests
- Zero storage access
- Zero access to conversations
- Everything runs locally
- [Full privacy policy](https://iam25th1.github.io/runlaid/privacy.html)

## Support the Project

RUNLAID.exe is 100% free. No premium tiers, no ads, no data collection.

- Star this repo
- Share on X ([@25thprmr](https://x.com/25thprmr))
- [Buy me a coffee](https://ko-fi.com/25thprmr)
- [Report bugs](https://github.com/iam25th1/runlaid/issues)
- Contribute a game

## FAQ

**Does this work on Firefox?**
Not yet. Firefox port is a welcome contribution.

**Does it affect Claude's performance?**
No. The game runs in the browser's content script layer. It doesn't interfere with Claude's API calls or streaming.

**Will this trigger on short responses?**
No. Only after 5+ seconds of continuous streaming.

**Is my data safe?**
Yes. Zero network requests. Zero storage. Zero tracking. Everything runs locally.

**Same game every time?**
No. The registry picks a random game each trigger with repeat avoidance. You won't see the same game twice in a row.

## License

[GPL v3](LICENSE) -- Free to use, modify, and distribute. Forks must remain open source.

---

<div align="center">

**Built by [@25thprmr](https://x.com/25thprmr)**

*12 down. 88 to go. The displacement continues.*

</div>
