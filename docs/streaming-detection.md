# Streaming Detection

## How It Works

The content script runs on `https://claude.ai/*` and polls the DOM every 500ms.

### Detection Method
```javascript
document.querySelector('[data-is-streaming="true"]')
```

If this element exists for **5 consecutive seconds**, the game launches.

### Why Time-Only?

Previous iterations tried:
- Content length checks → failed (collapsed code sections have ~0 textContent)
- Code block detection → failed (Claude's collapsed containers don't expose `<pre>` or `<code>`)
- Combined checks → overly complex, still missed edge cases

The simple solution: if Claude is streaming for 5 seconds, it's a long task. Short responses (under 5s) never trigger the game.

### Progress Feeding
While streaming, the content script feeds progress to the game engine every 300ms:
- Caps at 65% while streaming continues
- Jumps to 100% when streaming stops
- Game's internal progress never auto-advances (externally controlled only)

### Cleanup Between Tasks
When streaming stops:
- Progress pushed to 100%
- 5-second buffer for finish sequence
- Overlay fades out over 400ms
- Container removed from DOM
- All intervals cleared
- `window._runlaid` nulled

On next trigger, any stale container is force-removed before creating fresh.

## Overlay Positioning
- Anchored above Claude's input box
- Matches input box width
- Repositions every 300ms
- Input box found via: `[contenteditable="true"]`, `textarea`, `[class*="ProseMirror"]`
- Walks up 5 parent levels to find the visible box container
- Rounded corners on top only (flush with input box below)
