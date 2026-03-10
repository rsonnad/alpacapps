# Sloop Page — Design Rules

> Primary display: **Tesla Model Y 15.4" center screen** (landscape, ~2200x1300, Chromium browser)
> Secondary: mobile phones, desktop browsers

## Layout Rules

- **No tall hero sections** — use the slim `<nav class="hero">` bar (AlpacApps logo + version + page name, one line, ~40px tall)
- **Container max-width: 1200px** — use the full landscape width
- **Two-column grid for content cards** — diagrams/visuals on left, text/data on right (`grid-template-columns: auto 1fr`)
- **Minimize vertical scrolling** — the primary content (chord chart) should be fully visible without scrolling on the Tesla screen
- **Container padding: 1rem 1.5rem** — keep it tight, no wasted space

## Typography

- Body font: Inter (loaded from Google Fonts)
- Monospace (chord lines): Courier New
- **Minimum readable font size: 1rem** — the driver is ~2 feet from the screen
- Chord line font: **1.15rem** monospace
- Section labels: **0.8rem** uppercase, accent color, bold
- Song title: **1.6rem** weight 800
- Don't use anything below 0.7rem — it's unreadable on the car screen

## Design Tokens (CSS variables)

```
--bg: #faf8f6          --surface: #ffffff      --surface2: #f4f1ee
--border: #e2ddd8      --text: #1a1a1a         --text-soft: #3d3d3d
--text-dim: #6b6b6b    --text-muted: #9a9a9a   --accent: #2563eb
--radius: 12px         --radius-lg: 16px
```

## Chord Chart Conventions

- SVG chord diagrams: `width="72" height="88" viewBox="0 0 60 72"` — scaled up from standard for car-screen readability
- Finger dots: `r="5"` fill with `--accent` (#2563eb)
- Open strings: letter "o" above the nut, font-size 9
- Chord diagrams grid: 3 columns on left side of layout
- Lyrics use `white-space: pre` for chord alignment
- Chord names in lyrics: `.c` class (accent color, bold)
- Section labels (Verse, Chorus, Bridge): `.section-label` class

## Responsive Breakpoints

- **>700px** (Tesla, desktop): two-column chord layout, inline nav bar
- **<=700px** (tablet/portrait): stack to single column, chord diagrams in 6-column row
- **<=480px** (phone): chord diagrams 3-column, smaller monospace font

## Nav Bar Structure

```html
<nav class="hero">
  [AlpacApps SVG icon]  [AlpacApps text]  [version badge]  [spacer]  [page name]
</nav>
```

- Always keep the nav as a single flex row
- Version uses `data-site-version` attribute for CI stamping
- Page identifier on the right side

## What NOT to Do

- No tall splash/hero sections — every pixel matters on the car screen
- No font sizes below 0.7rem
- No hover-only interactions (Tesla is touch-only)
- No sticky headers that eat vertical space
- No modals or popups (Tesla browser handles them poorly)
- Don't load heavy JS frameworks — keep it vanilla HTML/CSS/JS
- Don't add scroll-dependent animations
