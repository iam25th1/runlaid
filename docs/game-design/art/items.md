# Visual Item Types

All items are 18×14px. Background: #282840. Subtle bob ±0.8px.

## code — Code File
- Rounded rect with green border (CL.grn + BB alpha)
- "</>" text in #8d8, bold 7px monospace
- Used for: CODE, API, DEPLOY, VFX, MODEL

## doc — Document
- Rounded rect with #888 border
- Three horizontal lines (#777) simulating text
- Used for: ARTICLE, HEADLINE, SCRIPT, REPORT, BUG FIX

## img — Image File
- Rounded rect with #888 border
- Green mountain triangle + amber sun circle
- Used for: WIREFRAME, MOCKUP, LOGO, PHOTO, STORYBOARD

## folder — Folder
- Folder silhouette (tab + body shape)
- Amber border (CL.amb + BB alpha)
- Used for: MODULE, LAYOUT, FOLDER items

## chart — Chart
- Rounded rect with #888 border
- 5 vertical bars in green (#39E07A at 99 alpha)
- Used for: FORECAST, ANALYSIS, AUDIT

## Labels
- 6px bold monospace, #bbb color
- Centered below item
- Only visible when item is not grabbed

## Spawn Behavior
- 70% spawn on desk surfaces (GY - 28 ± 4px)
- 30% spawn on floor between desks (GY - 10 ± 3px)
- Max 10 ungrabbed items on screen at once
- Max age: 400-700 frames, then despawn
