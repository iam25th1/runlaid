# Contributing to RUNLAID.exe

Thanks for wanting to contribute! Here's everything you need to know.

## Quick Start

1. Fork the repo and clone it
2. Load `extension/` as an unpacked extension in Chrome/Brave
3. Go to `claude.ai` and trigger a long response to test
4. Make your changes in `extension/content.js`
5. Reload the extension (`chrome://extensions` → refresh button)
6. Submit a PR

## Architecture

The entire game lives in `extension/content.js` — a single IIFE with two major sections:

- **Lines 1–270:** Streaming detection, overlay management, progress feeding
- **Lines 270+:** Self-contained canvas game engine

See `docs/architecture.md` for a detailed breakdown.

## What We're Looking For

### High Priority
- **Bug fixes** — anything broken, file an issue or submit a fix
- **New zones** — add workplaces (Hospital, Courtroom, Classroom, etc.)
- **Balance tuning** — if difficulty feels off, propose changes with data
- **Firefox support** — port the extension to Firefox

### Welcome
- New power-ups (keep it balanced)
- Character variety (new skins, animations)
- Sound effects (must be opt-in with a toggle)
- Accessibility improvements
- Performance optimizations
- UI/UX refinements

### Not Looking For
- Premium/paid features
- Analytics or tracking of any kind
- External network requests
- Major architectural rewrites without discussion first

## Code Style

- All game code in a single `content.js` file (no build step, no bundler)
- Use `const`/`let`, never `var`
- Semicolons always
- Canvas drawing functions can be compact — readability is secondary to file size here
- Comments for sections, not every line

## Testing

Manual testing only (no test framework). Test checklist:

- [ ] Extension loads without errors
- [ ] Game triggers on 5+ second streaming responses
- [ ] Game does NOT trigger on short responses
- [ ] All 3 side options work (AI, Human, Observe)
- [ ] Items spawn on surfaces, not floating
- [ ] Characters stay grounded
- [ ] Zone transitions work without resetting characters
- [ ] Share to X button works
- [ ] Save PNG card works
- [ ] Game cleans up properly between tasks
- [ ] Multiple consecutive tasks work

## Submitting PRs

- Clear title describing the change
- Description of what and why
- Screenshots/recordings if visual changes
- Tested on Chrome or Brave

## Issues

When filing issues, include:
- Browser and version
- Steps to reproduce
- Expected vs actual behavior
- Console errors (F12 → Console tab)

## License

By contributing, you agree that your contributions will be licensed under the GPL v3.
