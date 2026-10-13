# Rydr — Image Asset Plan (Miora / Hunyuan Image 3.5)

Last updated: 2026-10-02

## 1. Creative direction

**Warm risograph editorial illustration.**

Rydr's existing design language is warm paper + serif display type. The closest
print analogue is a **risograph / screen-print** editorial illustration: flat
shapes, a deliberately limited ink palette, faint paper grain, and slight ink
misregistration. This matches the existing tokens exactly and avoids the two
failure modes of AI imagery here:

- **Stock photography** would read as generic and undermine the "traceable,
  auditable" positioning.
- **3D renders** would read as SaaS/techy and clash with the warm editorial tone.

Risograph illustration also degrades gracefully: it stays legible at icon size
and at hero size from the same visual family.

**Do not include human faces.** The product is about impartiality and evidence;
faces invite empathy bias and uncanny artifacts. Use objects, maps, threads,
documents, and abstract forms instead.

**Do not include text in any image.** Generated lettering is unreliable and would
also need to be localised. All copy stays in the DOM.

## 2. Style lock (append to every prompt)

Paste this block at the end of each prompt below. It is what makes 12 separate
generations look like one system.

```
Warm risograph editorial illustration. Limited palette: cream paper #f4f0e8
background, deep ink navy-teal #122634, teal #087f78, burnt amber #a96616.
Flat screen-printed shapes, subtle paper grain, slight ink misregistration,
soft natural shadows, calm and trustworthy, generous negative space,
no text, no letters, no numbers, no logos, no watermarks, no human faces.
```

## 3. Palette

| Token | Hex | Use in imagery |
|-------|-----|----------------|
| Paper | `#f4f0e8` | Background field for every asset |
| Ink | `#122634` | Primary line work, terminal nodes, silhouettes |
| Teal | `#087f78` | Confirmed / resolved / primary route |
| Amber | `#a96616` | Uncertain / disputed / deviation |
| White-warm | `#fffdf8` | Highlight fills only, used sparingly |

Only these five. Do not introduce blues, greens, pinks or greys beyond these.

## 4. Asset list

Priority: **P0** = do first and review before continuing. **P1** = next.
**P2** = polish. Generating all 12 in one batch is a mistake — the style lock
needs one round of visual feedback first.

| # | Asset | Size | Format | Save to | Pri |
|---|-------|------|--------|---------|-----|
| 1 | Social share card | 1200×630 | PNG | `public/brand/og-cover.png` | P0 |
| 2 | App icon | 512×512 | PNG | `public/brand/app-icon.png` | P0 |
| 3 | Landing hero | 2100×1400 | PNG | `public/hero/landing-hero.png` | P0 |
| 4 | Step 01 — Evidence | 800×800 | PNG | `public/illustrations/step-01-evidence.png` | P1 |
| 5 | Step 02 — Advocates | 800×800 | PNG | `public/illustrations/step-02-advocates.png` | P1 |
| 6 | Step 03 — Judge | 800×800 | PNG | `public/illustrations/step-03-judge.png` | P1 |
| 7 | Step 04 — Resolution | 800×800 | PNG | `public/illustrations/step-04-resolution.png` | P1 |
| 8 | Empty queue | 1000×700 | PNG | `public/illustrations/empty-queue.png` | P1 |
| 9 | Sequence — no-show | 1400×700 | PNG | `public/diagrams/sequence-no-show.png` | P2 |
| 10 | Sequence — route | 1400×700 | PNG | `public/diagrams/sequence-route.png` | P2 |
| 11 | Marker — no-show | 512×512 | PNG | `public/illustrations/marker-no-show.png` | P2 |
| 12 | Marker — route | 512×512 | PNG | `public/illustrations/marker-route.png` | P2 |

Optional, only if the paper background feels flat after the above:
`public/texture/paper-grain.png` (2000×2000, tileable, extremely low contrast).
Risk: hurts text legibility and adds page weight. Try CSS first.

---

## 5. Prompts

Each prompt is self-contained. Append the style lock (section 2) to every one.

### 1 — Social share card (1200×630)

```
Wide horizontal editorial illustration for a social share card. Composition:
a single teal route line threading across a warm cream field from lower left to
upper right, punctuated by three small circular nodes (two amber, one ink),
with a low abstract city skyline silhouette in deep ink along the bottom edge.
Leave the upper-left third as empty cream for a headline overlay.
```

### 2 — App icon (512×512)

```
App icon, one centred emblem on a cream square with slightly rounded corners.
The emblem is a minimal teal route line that curves and terminates in a solid
circular node, suggesting a resolved journey, with one thin amber accent line
crossing it. High contrast, reads clearly at 32 pixels.
```

### 3 — Landing hero (2100×1400)

```
Editorial hero illustration, calm and quiet. A low-angle view of shophouse
rooftops and two palm silhouettes in deep ink against a cream sky with a soft
amber dusk band. A single simplified car shape sits on a road, and a glowing
teal route line traces from a pickup point to a destination with two small amber
dots along it. Leave the left third mostly empty cream for headline text.
```

### 4 — Step 01, Evidence (800×800)

```
Square editorial illustration: a vertical evidence timeline. A thin teal
vertical line carries five small pinned nodes of varying shapes (circle, square,
diamond) with short horizontal tick marks suggesting timestamps. Two nodes are
outlined in amber to mark uncertain items. Diagrammatic and minimal.
```

### 5 — Step 02, Advocates (800×800)

```
Square editorial illustration: two equal-weight abstract forms facing each other
across a thin vertical axis. A teal rounded form on the left and a deep ink
rounded form on the right, each with a small angular speech-mark shape,
balanced perfectly to suggest equal representation. Symmetric and minimal.
```

### 6 — Step 03, Judge (800×800)

```
Square editorial illustration: two lines converging from the left and right into
a single solid circular node in deep ink at the centre, with a small amber
diamond resting exactly at the junction, representing an impartial decision
point. Symmetric, diagrammatic, minimal.
```

### 7 — Step 04, Resolution (800×800)

```
Square editorial illustration: a teal route line that begins jagged and
uncertain on the left and resolves into a clean smooth curve ending in a solid
circular node enclosed by an abstract seal ring, suggesting a traceable
finalised outcome. Minimal, single line, generous negative space.
```

### 8 — Empty queue (1000×700)

```
Editorial illustration: a quiet empty in-tray motif. A few blank paper sheets
fanned slightly with a single teal thread looping loosely through them, resting
on a cream field with lots of empty space, suggesting nothing awaiting review.
Calm, understated, minimal.
```

### 9 — Sequence schematic, no-show (1400×700)

```
Wide editorial diagram on cream paper: a horizontal three-stage sequence. A
solid teal circle at the left (arrival), a dashed amber-outlined circle in the
middle (uncertain wait), and a solid deep ink circle at the right
(cancellation), joined by a dotted horizontal thread. Small abstract tick marks
beneath suggest elapsed time. Strictly non-geographic, no map, no landscape.
```

### 10 — Sequence schematic, route (1400×700)

```
Wide editorial diagram on cream paper: two abstract route lines drawn between
the same two points. A smooth teal line represents the planned path; a longer
wandering amber line loops away and rejoins, representing the actual path.
Small circular start and end nodes. Strictly non-geographic, no map tiles,
no landscape.
```

### 11 — Marker, no-show (512×512)

```
Minimal square icon on cream paper: an abstract clock face formed by a thin ink
circle with two teal hands and one small amber dot, suggesting a waiting period.
Flat, simple, no numerals.
```

### 12 — Marker, route (512×512)

```
Minimal square icon on cream paper: an abstract route line that splits into two
branches and rejoins, drawn in teal with one amber detour segment. Flat, simple,
no map, no landscape.
```

---

## 6. Delivery

Folders already exist. Save each file at the exact path in the table above, or
drop them anywhere and tell me the location — I will place and rename them.

Naming matters: the integration code references these exact paths.

## 7. Integration plan (what I change once assets land)

| Asset | Code change |
|-------|-------------|
| 1 | `src/app/layout.tsx` — add `openGraph.images` to `metadata` |
| 2 | `src/app/layout.tsx` — add `icons` to `metadata` |
| 3 | `src/app/page.tsx` — hero becomes a 2-column grid, image right, headline left |
| 4–7 | `src/app/page.tsx` — each how-it-works card gets a square image above the label |
| 8 | `src/components/States.tsx` — `EmptyState` accepts an optional `illustration` prop |
| 9–10 | `src/components/CaseDetailView.tsx` — `SequenceSchematic` renders the image, keeps the caption |
| 11–12 | `src/components/CaseDetailView.tsx` + queue table — category marker beside the case ID |

All images get `alt` text. Decorative images (4–7, 11–12) get `alt=""` since the
adjacent heading already names them.

## 8. Guardrails

- Keep the negative space. Every prompt above reserves a quiet area; if a
  generation fills the frame edge to edge, regenerate rather than crop.
- One ink weight, one grain level. If some assets come back much darker or
  grainier than others, they will not sit together — regenerate the outliers.
- Check contrast at final display size. The step illustrations render at roughly
  220px wide, not 800px; detail that only reads at full size is wasted.
- Nothing may imply a real brand, a real person, or a real payment. No currency
  symbols, no company marks, no identifiable vehicles.

## 9. Motion and 3D — deliberately out of scope

**No 3D renders.** The design thesis is flat, printed and documentary. 3D is a
different visual language and mixing the two is the most common way AI-assisted
design reads as inconsistent. 3D's strengths (depth, material, light) also
conflict with a product whose value is precision and traceability. The only
arguable exception is a device mockup for the OG card, and even that is better
served by a flat editorial treatment.

**No AI-generated video.** Three blockers:

1. Video models still garble lettering, and this product is dense UI text.
2. The pages currently ship zero image bytes; a 3–8 MB hero loop is a 10x page
   weight increase for a tool about reading evidence carefully.
3. Autoplay motion fights the calm, forensic tone and reads as marketing.

**What to do instead**, in order of value:

| Goal | Right tool | Notes |
|------|-----------|-------|
| Evidence spine nodes reveal on scroll | CSS/SVG animation | No network weight, respects `prefers-reduced-motion` |
| Sequence schematic animates through its stages | CSS/SVG animation | Sharp at any DPI, stays in palette |
| Demonstrate the 3-agent pipeline | Screen recording of the real app | Authentic; shows real agents and real timing |
| Hero feels alive | Slow CSS parallax on the hero illustration | Subtle only |

For demos, a screen recording of the actual RunMonitor outperforms generated
footage because it is evidence — which is the product's own subject matter.
Showing a generated mock-up of your own product in a demo is self-defeating.

If more credits remain after the P0 batch, the higher-value spend is depth in
the existing set (a second hero angle, or dark variants of the four step
illustrations for the resolution panel), not a new medium.
