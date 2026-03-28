# Changelog

## v2.2 — Grounded Turf War (Current)
- Complete game rewrite: runner → click-based turf war
- 3v3 squads: 3 humans vs 3 AI agents
- Player takes over existing team member (no 4th spawn)
- All characters grounded (Y-axis locked to ground)
- Click anywhere = walk there; click near item = walk + pickup; auto-pickup within 12px
- Items spawn on desk surfaces (70%) and floor (30%), NOT floating in air
- Visual item objects: code files, documents, images, folders, charts
- Detailed environments: wall panels, ceiling lights, floor patterns, furniture per zone
- 5 zones: Tech Office → Design Studio → Newsroom → Film Set → Trading Floor
- Zone transitions keep characters in place, only swap background/items
- Progressive difficulty: AI gets 25% stronger per zone (speed, reaction time, points per grab)
- Power-ups: Overclock (2x spawn), Freeze (pause opponents), Magnet (auto-collect nearby)
- Side selection: JOIN AS AI / JOIN AS HUMAN / OBSERVE
- Tug-of-war bar showing AI vs Human percentage
- Share to Twitter/X with pre-filled text + auto-download PNG
- PNG result card (600×315) with score, winner, tug-of-war bar
- Streaming detection simplified to time-only (5s threshold)
- Overlay anchored above Claude's input box, matching its width

## v1.0 — Endless Runner (Abandoned)
- Side-scrolling runner with absorb mechanic
- Claude agent character running through 5 zones
- LMB absorb / RMB jump controls
- Workers as obstacles to absorb or avoid
- Health bar, combo system, redemption arc (absorbed workers become prompt engineers)
- Abandoned in favor of turf war concept (less active, more satirical)

## v0.x — Early Prototypes
- Initial concept from 14-file GDD
- Name "RUNLAID.exe" coined and confirmed available
- IP audit completed — all content cleared
- MCP server integration for Claude Desktop (secondary to extension)
- DXT package for one-click install
