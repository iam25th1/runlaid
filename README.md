<div align="center">

# RUNLAID.exe

### The Great Displacement

A satirical mini-game that auto-plays on [claude.ai](https://claude.ai) while Claude works.<br>
AI agents invade your workplace. Pick a side. Fight for the future.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-brightgreen)](https://github.com/iam25th1/runlaid/releases)
[![Twitter](https://img.shields.io/badge/Follow-@25thprmr-1DA1F2)](https://x.com/25thprmr)

[**Install**](#install) · [**How It Works**](#how-it-works) · [**Game Guide**](#game-guide) · [**Contributing**](#contributing) · [**Support**](#support-the-project)

---

<!-- TODO: Add screenshot/gif here -->
<!-- ![RUNLAID.exe Demo](assets/screenshots/hero-demo.gif) -->

</div>

## What Is This?

RUNLAID.exe is a Chrome/Brave extension that detects when Claude is streaming a long response and launches a **click-based turf war mini-game** right above Claude's input box.

**3 AI agents vs 3 human workers.** Items spawn on desks. Both sides race to collect them. A tug-of-war bar tracks who's winning. When Claude finishes, the winner is declared.

You can:
- **Join as AI Agent** — accelerate the displacement
- **Join as Human** — fight to keep the jobs  
- **Observe** — watch the chaos unfold passively

Free forever. Open source. No tracking. No ads.

## Install

### From GitHub Releases (Recommended)

1. Go to [**Releases**](https://github.com/iam25th1/runlaid/releases) and download the latest `.zip`
2. Extract the zip to a folder on your computer
3. Open `chrome://extensions` (or `brave://extensions`)
4. Enable **Developer mode** (toggle in the top right)
5. Click **Load unpacked** → select the extracted `extension/` folder
6. Go to [claude.ai](https://claude.ai) — the game auto-triggers during long responses

### From Source

```bash
git clone https://github.com/iam25th1/runlaid.git
cd runlaid
```
Then load the `extension/` folder as an unpacked extension (steps 3-6 above).

## How It Works

1. **Detection** — The extension watches for `[data-is-streaming="true"]` on claude.ai
2. **Trigger** — After 5 seconds of continuous streaming, the game launches
3. **Play** — A canvas overlay appears above Claude's input box with the turf war
4. **Sync** — Game progress is tied to Claude's actual streaming duration
5. **End** — When Claude stops, the game finishes and shows results

The game runs entirely client-side. No data is sent anywhere. No network requests. No tracking.

## Game Guide

### Zones (5 sectors, unlocked by task progress)

| Zone | Setting | Items | Difficulty |
|------|---------|-------|------------|
| Tech Office | Monitors, servers | CODE, PR, API | 1.0× |
| Design Studio | Easels, tablets | WIREFRAME, LOGO | 1.25× |
| Newsroom | Desks, cameras | ARTICLE, SCOOP | 1.5× |
| Film Set | Cameras, lights | SCRIPT, VFX | 1.75× |
| Trading Floor | Multi-screens | FORECAST, TRADE | 2.0× |

### Controls

- **Click anywhere** → your character walks there
- **Click near an item** → walk there and pick it up
- **Walk past items** → auto-collect within 12px
- **Click power-ups** → activate special ability

### Power-Ups

| Power-Up | Effect | Duration |
|----------|--------|----------|
| ⚡ Overclock | 2.5× item spawn rate | ~7 seconds |
| ❄ Freeze | Opponents stop moving | ~3.3 seconds |
| ◎ Magnet | Nearby items drift toward you | ~5 seconds |

### Scoring

- **Your grabs:** 1.5 points to your side
- **AI NPC grabs:** 0.7 × zone difficulty multiplier
- **Human NPC grabs:** 0.5 points
- The tug-of-war bar determines the winner

### Sharing

After the game ends, two buttons appear:
- **🐦 Share on X** — Opens Twitter with pre-filled results + downloads PNG card
- **💾 Save Card** — Downloads a 600×315 PNG result card

## Project Structure

```
runlaid/
├── extension/              # Chrome/Brave extension
│   ├── manifest.json       # Manifest V3
│   ├── content.js          # Streaming detection + game engine
│   ├── icon48.png
│   └── icon128.png
├── docs/                   # Documentation
│   ├── game-design/        # Full GDD (design, mechanics, art)
│   ├── architecture.md     # Technical architecture
│   ├── streaming-detection.md
│   └── changelog.md
├── assets/                 # Store/marketing assets
│   ├── screenshots/
│   └── store/
├── index.html              # Landing page
├── LICENSE                 # GPL v3
└── README.md
```

## Contributing

Contributions welcome! Here's how:

1. **Fork** the repo
2. **Create a branch** (`git checkout -b feature/your-feature`)
3. **Make your changes** — the entire game is in `extension/content.js`
4. **Test** — load the extension unpacked and test on claude.ai
5. **Submit a PR** with a clear description

### Ideas for Contributions

- New workplace zones (Hospital, Courtroom, Classroom, etc.)
- New power-ups
- Character skins/cosmetics
- Sound effects (optional, toggle-able)
- Firefox/Safari support
- Performance optimizations
- Accessibility improvements
- Localization

### Code Architecture

The entire extension is a single `content.js` file split into two sections:

1. **Streaming Detection Layer** (lines 1–270) — DOM polling, overlay management, progress feeding
2. **Game Engine** (lines 270+) — Self-contained canvas game with state machine, entities, drawing, input

See `docs/architecture.md` for details.

## Support the Project

RUNLAID.exe is and always will be **100% free**. No premium tiers, no ads, no data collection.

If you enjoy it, you can support development:

- ⭐ **Star this repo** — it helps visibility
- 🐦 **Share on X** — use the in-game share button or tag [@25thprmr](https://x.com/25thprmr)
- ☕ **Buy me a coffee** — [ko-fi.com/25thprmr](https://ko-fi.com/25thprmr)
- 🐛 **Report bugs** — [open an issue](https://github.com/iam25th1/runlaid/issues)
- 🔧 **Contribute** — PRs welcome!

## FAQ

**Does this work on Firefox?**
Not yet. Manifest V3 support varies. Firefox port is a welcome contribution.

**Does it affect Claude's performance?**
No. The game runs entirely in the browser's content script layer. It doesn't interfere with Claude's API calls, streaming, or DOM operations.

**Will this trigger on short responses?**
No. The game only launches after 5+ seconds of continuous streaming.

**Is my data safe?**
Yes. The extension makes zero network requests. No analytics, no tracking, no external calls. Everything runs locally in your browser.

**Can I use this at work?**
That's between you and your manager. But the game auto-hides when Claude finishes, so... plausible deniability? 👀

## License

[GPL v3](LICENSE) — Free to use, modify, and distribute. Forks must remain open source. Includes patent protection.

---

<div align="center">

**Built by [@25thprmr](https://x.com/25thprmr)**

*The displacement continues.*

</div>
