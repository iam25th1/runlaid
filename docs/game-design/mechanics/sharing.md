# Sharing — Twitter/X & PNG Card

## Finished Screen Buttons

Two buttons appear on the finished overlay:

### 🐦 SHARE ON X
1. Auto-downloads PNG result card (so user can attach to tweet)
2. Opens `x.com/intent/tweet` with pre-filled text:
```
AI won the turf war in RUNLAID.exe!

⬡ 14 items captured
AI 63% vs HUMAN 37%

I played as AI Agent while Claude coded.

by @25thprmr
```

### 💾 SAVE CARD
Downloads `runlaid-result.png` — a 600×315 PNG card.

## PNG Card Design (600×315)

```
┌──────────────────────────────────────┐
│          RUNLAID .exe                │
│    THE GREAT DISPLACEMENT            │
│  ─────────────────────────────────   │
│                                      │
│          AI WIN / HUMANS WIN         │
│                                      │
│  [████████████░░░░░░░░░░░░░░░░░░░]  │
│  AI 63%                 HUMAN 37%    │
│                                      │
│        Played as AI AGENT            │
│        ⬡ 14 items captured           │
│                                      │
│  The displacement continues. @25thprmr│
└──────────────────────────────────────┘
```

- Background: #0F0D1A with subtle grid (#7C50FF at 3% opacity)
- Border: #7C50FF at 27% opacity
- Tug bar with rounded corners, AI orange left / Human blue right
- All text monospace except title (Syne 800)
