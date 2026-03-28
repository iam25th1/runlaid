# Environment Design

Canvas: 640×180px. Ground line (GY) at Y=158.

## Layers (back to front)
1. Sky/ceiling (zone-specific color)
2. Back wall (slightly lighter than sky, vertical panel lines at 80px intervals)
3. Ceiling light strips (40px wide, subtle light cone projections in zone accent color at 1.5% opacity)
4. Wall trim (2px horizontal line at wall-floor boundary)
5. Floor (zone-specific pattern)
6. Ground line (1px, zone accent at low opacity)
7. Desk furniture (5 stations per zone)
8. Items on surfaces
9. Characters
10. Particles/effects
11. HUD overlay

## Floor Patterns (per zone)
- **grid** (Tech Office): Vertical + horizontal lines at 30px/15px intervals
- **wood** (Design Studio): Horizontal lines at 8px intervals
- **tile** (Newsroom): Grid at 25px intervals
- **carpet** (Film Set): Checkerboard 5px squares at 10px intervals
- **marble** (Trading Floor): Vertical gold accent lines at 40px intervals

## Desk Furniture Types
Each zone has 5 desks. Types:

### desk / screens
- Surface: #1a1f28 rounded rect, 2 legs (#14181f)
- Monitor: #1a1f28 frame, #0d1218 screen, zone accent screen glow at 08 alpha
- Stand: 4px wide centered

### easel
- Canvas: #1e1a14 rect on angled legs (#2a2218)
- Two legs converging from bottom

### camera
- Lens: Two concentric circles (#2a2a3a outer, #1a1a2a inner)
- Tripod: Two angled lines from center

### tablet
- Small upright rect (#1e1a28) on desk surface

### chair
- Seat: Rounded rect (#1a1520)
- Back: Taller rounded rect behind
- Wheel: Small circle at base

## Zone Watermark
- Zone name in uppercase, 800-weight 24px Syne
- 2.5% opacity, positioned bottom-left of play area
