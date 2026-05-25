---
name: Omoiyari POS
description: Integrated POS & Deep Inventory Management System
colors:
  neutral-bg: "oklch(1 0 0)"
  neutral-fg: "oklch(0.141 0.005 285.823)"
  neutral-muted: "oklch(0.967 0.001 286.375)"
  neutral-muted-fg: "oklch(0.552 0.016 285.938)"
  neutral-border: "oklch(0.92 0.004 286.32)"
  neutral-input: "oklch(0.92 0.004 286.32)"
  neutral-ring: "oklch(0.871 0.006 286.286)"
  primary-bg: "oklch(0.21 0.006 285.885)"
  primary-fg: "oklch(0.985 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  destructive-fg: "oklch(0.577 0.245 27.325)"
  sidebar-bg: "oklch(0.985 0 0)"
  sidebar-fg: "oklch(0.141 0.005 285.823)"
  sidebar-border: "oklch(0.92 0.004 286.32)"
  chart-orange: "oklch(0.646 0.222 41.116)"
  chart-teal: "oklch(0.6 0.118 184.704)"
  chart-blue: "oklch(0.398 0.07 227.392)"
  chart-yellow: "oklch(0.828 0.189 84.429)"
  chart-amber: "oklch(0.769 0.188 70.08)"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Fira Sans, Droid Sans, Helvetica Neue, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Fira Sans, Droid Sans, Helvetica Neue, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Fira Sans, Droid Sans, Helvetica Neue, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.2
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Fira Sans, Droid Sans, Helvetica Neue, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-default:
    backgroundColor: "{primary-bg}"
    textColor: "{primary-fg}"
    rounded: "{rounded.md}"
    padding: "4px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "{neutral-bg}"
    textColor: "{neutral-fg}"
    rounded: "{rounded.md}"
    padding: "4px 16px"
    height: "36px"
  button-secondary:
    backgroundColor: "{neutral-muted}"
    textColor: "{neutral-fg}"
    rounded: "{rounded.md}"
    padding: "4px 16px"
    height: "36px"
  button-ghost:
    backgroundColor: transparent
    textColor: "{neutral-fg}"
    rounded: "{rounded.md}"
    padding: "4px 16px"
    height: "36px"
  button-destructive:
    backgroundColor: "{destructive}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "4px 16px"
    height: "36px"
  input:
    backgroundColor: transparent
    textColor: "{neutral-fg}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  card:
    backgroundColor: "{neutral-bg}"
    textColor: "{neutral-fg}"
    rounded: "{rounded.xl}"
    padding: "24px"
  dialog:
    backgroundColor: "{neutral-bg}"
    textColor: "{neutral-fg}"
    rounded: "{rounded.lg}"
    padding: "24px"
  select-trigger:
    backgroundColor: transparent
    textColor: "{neutral-fg}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  badge-default:
    backgroundColor: "{primary-bg}"
    textColor: "{primary-fg}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "20px"
  badge-secondary:
    backgroundColor: "{neutral-muted}"
    textColor: "{neutral-fg}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "20px"
  badge-destructive:
    backgroundColor: "{destructive}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "20px"
  sidebar:
    backgroundColor: "{sidebar-bg}"
    textColor: "{sidebar-fg}"
    rounded: "0"
    padding: "0"
    width: "256px"
---

# Design System: Omoiyari POS

## 1. Overview

**Creative North Star: "The Operational Ledger"**

Omoiyari POS is a serious operational tool for ghost kitchen logistics. The visual system is designed to be seen but not noticed — it gets out of the way so kasir, warehouse admins, and supervisors can do their work without visual noise. Every pixel exists to serve data, not decoration.

This is a **restrained, neutral-first** palette. The background is clean white (light) or near-black (dark). Primary is not an accent color — it's the structural surface color for buttons and navigation. The only saturation in the system lives inside the analytics charts, where color carries semantic weight (channel breakdowns, trend lines). No decorative gradients, no glass effects, no playful illustrations.

The system explicitly rejects restaurant-themed UI (food icons, warm browns, decorative illustrations). It looks more like an inventory management terminal than a consumer app — and that's by design. The visual personality is **Efficient, Trustworthy, Calm**.

**Key Characteristics:**
- Restrained palette: neutrals tinted toward a subtle cool-blue gray, zero decorative color
- Content-forward: tables, ledgers, and data grids are the primary interface surface
- Flat by default: shadows are subtle (`shadow-sm`, `shadow-xs`) and used for structural layering, not decorative depth
- Mobile-capable but desktop-first: sidebar (256px) + main content area with responsive collapse
- Dark and light modes maintained in parallel with full OKLCH parity — both are first-class, not afterthoughts

## 2. Colors: The Neutral Ledger

The palette is monochrome with a cool blue-gray undertone (hue ~286° in OKLCH). Chroma is held below 0.02 for all surface colors. The only chroma lives in the data visualization palette.

### Neutral
- **White** (`oklch(1 0 0)`): Background, card, popover, and popover-foreground surfaces in light mode.
- **Near-Black** (`oklch(0.141 0.005 285.823)`): Default text, card foreground, popover foreground in light mode.
- **Soft Muted** (`oklch(0.967 0.001 286.375)`): Secondary backgrounds, accent fills, muted surfaces, table row hover in light mode.
- **Muted Text** (`oklch(0.552 0.016 285.938)`): Secondary labels, placeholders, metadata, descriptions.
- **Border** (`oklch(0.92 0.004 286.32)`): Input borders, table cell dividers, card outlines, separator lines.

### Primary
- **Structural Dark** (`oklch(0.21 0.006 285.885)`): Button fills, active states, badge backgrounds in light mode. Not an accent — it's the structural surface for interactive elements.
- **Structural Light** (`oklch(0.985 0 0)`): Text on primary backgrounds, and the primary background itself in dark mode.

### Destructive / Alert
- **Alert Red** (`oklch(0.577 0.245 27.325)`): Destructive actions, error states, variance highlights, negative values. Uses warm red hue (27°) that reads clearly against both light and dark backgrounds.

### Sidebar
- **Off-White Panel** (`oklch(0.985 0 0)`): Sidebar background, separated from the main content area by a 1px border. Draws from the same neutral family.
- **Sidebar Foreground** (`oklch(0.141 0.005 285.823)`): Navigation labels, matching the main content text color.

### Data Visualization (Chart palette)
- **Orange** (`oklch(0.646 0.222 41.116)`): Primary chart series.
- **Teal** (`oklch(0.6 0.118 184.704)`): Secondary chart series.
- **Blue** (`oklch(0.398 0.07 227.392)`): Tertiary chart series.
- **Yellow** (`oklch(0.828 0.189 84.429)`): Quaternary chart series.
- **Amber** (`oklch(0.769 0.188 70.08)`): Quinary chart series.

Chart colors are the ONLY saturated colors in the system. They exist purely for data discrimination, not decoration.

### The Restraint Rule
The primary surface color (structural dark) is the background for buttons and interactive elements. It does not function as a "brand accent." The system communicates through layout, typography weight, and data density — not through color. If the obvious question is "what's the brand color?", the system is working correctly.

## 3. Typography

**Display & Body Font:** System UI stack (-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif)
**Mono Font:** Source Code Pro, Menlo, Monaco, Consolas, "Courier New", monospace

**Character:** Clean, neutral, and available. No custom font loading — the system stack ensures instant rendering and native platform familiarity. The typography is invisible by design: well-spaced, well-weighted, and purely functional.

### Hierarchy
- **Display** (700 weight, 20px, 1.2 line-height): Page titles, section headings in dashboards. Used sparingly — one per view.
- **Title** (600 weight, 16px, 1.3 line-height): Card headers, modal titles, sidebar section labels.
- **Body** (400 weight, 14px, 1.5 line-height): Table cells, form inputs, list items, descriptions, all operational data. Cap line length at 65–75ch for readability.
- **Label** (500 weight, 12px, 1.3 line-height): Badge text, small metadata, table column headers, form helper text.

### The System Stack Rule
No custom web fonts. Restaurants and kitchens have unpredictable network conditions; the system stack renders instantly regardless of connectivity. Font loading latency during a lunch rush is a business risk, not a design tradeoff.

## 4. Elevation

Flat-by-default. The interface uses tonal layering rather than shadow depth to separate surfaces. Cards sit on the same background as the page but are distinguished by a 1px border (`oklch(0.92 0.004 286.32)`) rather than a drop shadow. The sidebar is separated from the main content by a vertical border.

### Shadow Vocabulary
- **shadow-sm** (`0 1px 3px rgba(0,0,0,0.08)`): Card containers. Barely visible — just enough to suggest layering.
- **shadow-xs** (`0 1px 2px rgba(0,0,0,0.05)`): Button default state, outline button backgrounds. Essentially flat.
- **shadow-lg** (`0 10px 15px rgba(0,0,0,0.1)`): Dialogs, modal overlays, popovers. The only elevation that reads as real depth.

### The Flat-By-Default Rule
Surfaces are flat at rest. Shadows appear only where structural hierarchy demands it — a dialog above the page, a popover above the content. Cards do not lift on hover. Buttons use a subtle background shift, not a shadow change.

## 5. Components

### Buttons
- **Shape:** Gently rounded corners (6px radius). Clean rectangles, no pill shapes.
- **Default:** Structural dark fill (`oklch(0.21 0.006 285.885)`) with white text. Hover shifts the fill to 90% opacity — a warm, subtle darkening. Focus visible adds a 3px ring in `neutral-ring`.
- **Outline:** Transparent fill, 1px border (`neutral-border`). Hover fills with muted background. Used as the secondary action next to a default button.
- **Secondary:** Muted background fill. Softer than default, for grouped actions inside cards.
- **Ghost:** No fill, no border. Hover reveals the muted background. For toolbar actions and inline controls.
- **Destructive:** Alert red fill with white text. Used exclusively for irreversible actions (delete, void, cancel).
- **Sizes:** 6 sizes from xs (24px) through icon-only variants to lg (40px). The POS screen uses tactile sizes with adequate tap targets.

### Inputs & Fields
- **Style:** Bordered rectangle (1px `neutral-border`, transparent fill). Gently rounded (6px).
- **Focus:** A 3px ring in `neutral-ring` replaces the border. Clean, never a glow.
- **Selection:** Text selection matches the `primary-bg` (structural dark) on light theme, white on dark theme.
- **Placeholder:** Muted text (`oklch(0.552 0.016 285.938)`). Subtle, always readable.
- **Disabled:** Reduced opacity (50%), no pointer events. The transparent background carries through.
- **Error:** Red border (`destructive`) with matching focus ring.

### Cards / Containers
- **Corner Style:** Pronounced rounding (12px). Cards are the only elements with xl-radius, making them instantly recognizable as containers.
- **Background:** Matches the page background (`neutral-bg`). Cards are defined by their 1px border and shadow-sm, not by a color change.
- **Shadow Strategy:** `shadow-sm` at rest. No hover lift.
- **Internal Padding:** 24px on all sides (px-6, py-6). Gap between content sections is also 24px.

### DataTable
- **Style:** Full-width bordered table with sticky first column. 14px body text, 12px uppercase headers.
- **Header row:** Muted text, 500 weight, sortable columns show a subtle arrow indicator. Hover on sortable headers reveals interaction.
- **Rows:** Alternating transparent rows with a hover state (`bg-muted/50`). Clickable rows show a pointer cursor.
- **Pagination:** Compact button group (first, prev, page indicator, next, last) using outline-style icon buttons.
- **Search:** Integrated search bar with a search icon, filtering in real-time over the current dataset. 15 items per page default.

### Navigation (Sidebar)
- **Width:** 256px fixed, hidden on mobile with a hamburger toggle.
- **Background:** Off-white (`oklch(0.985 0 0)`) with a right border separating it from content.
- **Organization:** Grouped under category labels ("Utama", "Operasional", "Rantai Pasok", etc.) with collapsible expand/collapse. Each group has a role-based visibility filter — kasir sees only POS-related groups.
- **States:** Active route highlighted with accent background. Icons in 16px Lucide, consistently sized.

### Badges / Chips
- **Shape:** Compact rounded rectangle (6px radius), 20px height, 9px horizontal padding.
- **Variants:** Default (structural dark), Secondary (muted bg), Destructive (red), Success (green), Warning (amber), Outline (transparent with border).
- **Use:** Status indicators, tags, labels. The only components that use green and amber — reserved for operational status (Completed, Pending, etc.).

### Dialog / Modal
- **Structure:** Centered overlay with a semi-transparent black backdrop (50% opacity). The dialog panel has rounded corners (8px), `shadow-lg`, and 24px internal padding.
- **Animation:** Fade-in and zoom-in on open; fade-out and zoom-out on close. Clean, short duration (200ms).
- **Close:** An X icon button in the top-right corner, with opacity hover effect. The panel auto-implements `sr-only` "Close" text for screen readers.

## 6. Do's and Don'ts

### Do:
- **Do** use the system font stack everywhere. No custom web fonts.
- **Do** keep surfaces flat. Use borders and tonal layering before shadows.
- **Do** use the chart palette exclusively for data visualization. Those colors do not appear in UI chrome.
- **Do** restrict the primary surface color (structural dark / structural light) to interactive elements — buttons, badges, active states.
- **Do** use Indonesian for all labels, messages, and error states. The entire user-facing text layer should be in Indonesian.
- **Do** respect role-based opacity: hide entire UI sections for roles that don't need them, don't just disable them.
- **Do** test contrast in both bright (sunlit kitchen) and dim (evening shift) environments before shipping.
- **Do** use 24px (gap-6) as the standard card padding and section gap.
- **Do** keep card backgrounds matching the page background — cards are defined by their border, not a tint.

### Don't:
- **Don't** use decorative color. No colored headers, tinted backgrounds, accent borders, or highlight strips. The palette is restrained by design.
- **Don't** use gradient text, glassmorphism, or any decorative visual effect.
- **Don't** use side-stripe borders (`border-left` or `border-right` greater than 1px as a colored accent).
- **Don't** use food-themed illustrations, icons, or decorations. This is an operational tool, not a restaurant consumer app.
- **Don't** use bounce, elastic, or spring animations. Transitions should be fast (200ms) and clean (ease-out).
- **Don't** over-shadow. `shadow-sm` on cards, `shadow-lg` only on dialogs. Nothing in between.
- **Don't** show expected stock values or expected cash amounts to the person doing the physical count. Blind verification is a design requirement, not a choice.
- **Don't** create hero-metric dashboards (big number, small label, gradient). Dashboard content should be actionable data — tables, alerts, and ledger summaries.
- **Don't** animate CSS layout properties. Only opacity and transform transitions.
- **Don't** use the brand name "Omoiyari" or any brand logo as decorative flair on the POS screen. The POS is a tool, not a branding surface.
