# Velocity UI Design System & Style Guide

A complete specification of the UI principles, design tokens, color palettes, typography, components, and interaction patterns used in Velocity. This guide can be used to replicate the exact UI style across web (Tailwind CSS / React / Next.js), mobile, or desktop projects.

---

## 1. Core UI Principles & Philosophy

- **Pitch Black OLED / True Dark**: Rather than standard dark slate or gray, the dark theme is anchored on true `#000000` pitch black for the root scaffold, layered with subtle near-black charcoal tones (`#0A0A0A`, `#141414`). Light mode mirrors this with crisp `#FFFFFF` and soft zinc accents.
- **Subtle Surface Layering (No Hard Dividers)**: Traditional 1px divider lines are avoided (`dividerColor: Colors.transparent`). Visual hierarchy is established via tonal shifts (`#000000` → `#0A0A0A` → `#141414` → `#1E1E1E`), backdrop blurs, and low-contrast borders.
- **Constrained Reading Column (`max-w-3xl` / `768px`)**: The main conversation stream is locked to a centered max-width of `768px`, ensuring optimal line lengths for reading text and code blocks.
- **Invisible Micro-Interactions (Hover-First)**: Secondary actions (such as copying a prompt or triggering inline message edits) stay hidden (`opacity: 0`) and reveal smoothly on hover (`opacity: 1`, 150ms ease).
- **Floating Glassmorphic Header**: The top app bar floats over the scrollable content with `backdrop-filter: blur(24px)` and a subtle vertical gradient that fades to complete transparency.
- **Capsule Input Bar**: A floating pill-shaped input capsule (`border-radius: 28px`) anchored at the bottom with circular action buttons (`36×36px`).
- **Desktop & Keyboard Ergonomics**: Desktop-first keyboard shortcuts for high-frequency workflows (`⌘K` search, `⌘B` sidebar toggle, `⌘⇧O` new chat, `Enter` submit, `Shift+Enter` newline, `Esc` dismiss).

---

## 2. Color Palette & Design Tokens

### Dark Theme (Default)
| Token | Hex Value | Semantic Role |
| :--- | :--- | :--- |
| **Canvas / Scaffold** | `#000000` | Pure pitch black OLED background |
| **Sidebar / Sheet** | `#0A0A0A` | Secondary surface, sidebar background |
| **Card / Input / Bubble** | `#141414` | User message bubbles, input container, search tiles |
| **Active / Highlight** | `#1A1A1A` | Active conversation item in sidebar |
| **Hover State** | `#141414` | Button / row hover background |
| **Popover Card** | `#1E1E22` | Floating menus and parameter popovers |
| **Border / Stroke (Subtle)** | `#1E1E1E` | Card outlines, input borders |
| **Border / Stroke (Menu)** | `#2E2E34` | Popover dialog borders |
| **Secondary Button / Pill** | `#27272A` | Send button, round toggle buttons, active segmented tabs |
| **Text Primary** | `#FFFFFF` / `#FAFAFA` | Main headings, body text, active labels |
| **Text Secondary / Muted** | `#A1A1AA` | Icons, subtitles, inactive states, hints (Zinc 400) |
| **Text Intermediate** | `#D4D4D8` | Unselected session titles, blockquotes (Zinc 300) |

### Light Theme
| Token | Hex Value | Semantic Role |
| :--- | :--- | :--- |
| **Canvas / Scaffold** | `#FFFFFF` | Pure crisp white |
| **Sidebar / Surface** | `#F7F7F8` / `#F4F4F5` | Sidebar background, surface container (Zinc 100) |
| **Card / Input / Bubble** | `#F4F4F5` | User message bubbles, text input background |
| **Active / Highlight** | `#E4E4E7` | Active sidebar item, active button pill (Zinc 200) |
| **Hover State** | `#ECECEE` | Button / row hover background |
| **Popover Card** | `#FFFFFF` | Floating menus and dialog backgrounds |
| **Border / Stroke** | `#E4E4E7` | Borders and dividers (Zinc 200) |
| **Secondary Button / Pill** | `#E4E4E7` | Button backgrounds, segment controls |
| **Text Primary** | `#09090B` | Main headings, body text (Zinc 950) |
| **Text Secondary / Muted** | `#71717A` | Secondary text, icons, placeholders (Zinc 500) |
| **Text Intermediate** | `#3F3F46` | Unselected list items, blockquotes (Zinc 700) |

### Functional & Status Colors
| State | Hex Value | Usage |
| :--- | :--- | :--- |
| **Success / Online** | `#10B981` | Emerald green glowing pulse indicator (Hindsight/Memory) |
| **Warning / Degraded** | `#F59E0B` | Amber warning status dot |
| **Destructive / Error** | `#EF4444` | Red accent for delete actions, offline banner |
| **Inline Code (Dark)** | `#93C5FD` | Soft blue 300 text with `#18181B` bg & `#27272A` border |
| **Inline Code (Light)** | `#1D4ED8` | Blue 700 text with `#F1F5F9` bg & `#E2E8F0` border |

---

## 3. Typography Specification

### Font Families
1. **Primary Sans-Serif**: `Satoshi`
   - Geometric neo-grotesque sans-serif with high legibility and a contemporary tech feel.
   - *Weights Used*: `400` (Regular), `500` (Medium - **standard body weight**), `700` (Bold), `900` (Black - Brand header).
   - *Fallback*: Inter, system-ui, -apple-system, sans-serif.
2. **Monospace**: `JetBrains Mono`
   - Used for code blocks, inline snippets, keyboard shortcut badges, duration counters, and numerical readouts.
   - *Weights Used*: `400` (Regular), `500` (Medium), `700` (Bold).
   - *Fallback*: Roboto Mono, Menlo, Courier New, monospace.

### Type Scale & Specs
| Element | Font | Size | Weight | Line Height | Letter Spacing |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hero Greeting** | Satoshi | `32px` (`2rem`) | `700` (Bold) | `1.2` | `-0.6px` |
| **Brand Logo** | Satoshi | `21px` | `900` (Black) | `1.0` | `-0.5px` |
| **H1 Heading** | Satoshi | `24px` (`1.5rem`) | `800` (Extra Bold) | `1.3` | `-0.4px` |
| **H2 Heading** | Satoshi | `20px` (`1.25rem`) | `800` (Extra Bold) | `1.35` | `-0.3px` |
| **H3 Heading** | Satoshi | `17px` (`1.06rem`) | `800` (Extra Bold) | `1.4` | `-0.2px` |
| **Message Body (Assistant)** | Satoshi | `16px` (`1rem`) | `500` (Medium) | `1.6` | Normal |
| **Message Body (User Bubble)**| Satoshi | `16px` (`1rem`) | `500` (Medium) | `1.45` | Normal |
| **Input Field** | Satoshi | `15px` (`0.94rem`) | `500` (Medium) | `1.4` | Normal |
| **Sidebar Chat Item** | Satoshi | `14px` (`0.88rem`) | `500` / `600` sel | `1.4` | Normal |
| **Header Centered Title** | Satoshi | `13.5px` | `600` (Semi-bold) | `1.2` | `-0.2px` |
| **Code Block Content** | JetBrains Mono | `13.5px` | `400` (Regular) | `1.5` | Normal |
| **Inline Code Badge** | JetBrains Mono | `13px` | `500` (Medium) | `1.2` | Normal |
| **Thinking / Stepper** | JetBrains Mono | `13px` | `500` (Medium) | `1.2` | `-0.2px` |
| **Category Header** | Satoshi | `12px` (`0.75rem`) | `700` (Bold) | `1.0` | Normal |
| **Kbd / Shortcut Badge** | Monospace | `10px` | `700` (Bold) | `1.0` | Normal |

---

## 4. Iconography

- **Icon Family**: **Lucide Icons** (`lucide-react` / `lucide_icons_flutter`)
- **Stroke Width**: `1.5px` to `2.0px`, clean outline style.
- **Sizes**:
  - `14px`: Micro-actions (inline message copy, edit pencil, item options, syntax copy)
  - `16px` - `18px`: Navigation buttons, input capsule icons, dialog controls
- **Primary Icons**:
  - `panelLeft` / `panelLeftClose`: Sidebar toggle
  - `search`: Global search modal (`⌘K`)
  - `plus`: New chat action / Expand popover options menu
  - `ghost`: Temporary chat session indicator
  - `arrowUp`: Submit prompt
  - `loader2`: Rotating streaming/thinking indicator
  - `copy` / `check`: Clipboard action with 2-second checkmark feedback
  - `pencil`: Edit prompt / rename session
  - `rotateCcw`: Regenerate response
  - `trash2`: Delete session
  - `moreVertical`: Context options menu

---

## 5. Layout & Component Architecture

### 1. Master Layout & Collapsible Sidebar
- **Sidebar Width**: `260px` (animates between `0px` and `260px` in `200ms easeInOut`).
- **Sidebar Padding**: `12px horizontal, 12px vertical`.
- **New Chat Action**: Pill card with `12px` rounded corners, plus icon on left, monospace shortcut badge (`⌘⇧O`) on right.
- **Session Items**:
  - Border radius: `10px`.
  - Selected state: `#1A1A1A` (dark) / `#E4E4E7` (light), font weight `600`.
  - Single-line title with ellipsis, accompanied by a trailing vertical 3-dots popup menu (`rename`, `delete`).
- **Footer Status**:
  - `8px` animated pulsing green dot (`#10B981`) with glowing spread shadow (`spreadRadius: 1, blurRadius: 6`).
  - Monospace status caption (`Hindsight Memory`).
  - Theme toggle button (Sun / Moon).

### 2. Floating Header Bar
- **Position**: `top: 0`, `left: 0`, `right: 0`, height `52px`.
- **Glassmorphism**: `backdrop-filter: blur(24px)`.
- **Gradient Mask**: Subtle vertical gradient from `rgba(0,0,0,0.25)` to transparent.
- **Elements**: Left sidebar expand toggle, center plain text conversation title (no pill border), right status indicator and ghost mode toggle.

### 3. Chat Column & Messages
- **Max Width**: `768px` (`max-w-3xl`), centered horizontally in the viewport.
- **User Message**:
  - Aligned to the **right** with a minimum left margin of `64px`.
  - Bubble container: Background `#141414` (dark) / `#F4F4F5` (light).
  - Border radius: `18px`.
  - Padding: `horizontal: 18px, vertical: 13px`.
  - Hover action strip: Below bubble on the right, displaying copy button and edit pencil button with `150ms` fade in.
- **Assistant Message**:
  - Spans the full `768px` column width (no bubble card).
  - Clean Markdown formatting with tight list line spacing.
  - Bottom action strip: Minimal `14px` icon buttons for copy and regenerate.
- **Thinking Indicator**:
  - Appears during initial streaming before tokens arrive.
  - Icon: `loader2` rotating at 1000ms linear loop.
  - Text: `JetBrains Mono`, `13px`, `#A1A1AA`, e.g. `Thinking 3s...`.

### 4. Capsule Input Box
- **Container Shape**: Pill capsule with `border-radius: 28px`.
- **Background**: `#141414` (dark) / `#F4F4F5` (light).
- **Padding**: `10px horizontal, 10px vertical`.
- **Action Buttons**:
  - Left `+` button: Round circle `36×36px`, rotates 45° (`0.125 turns`) when opened.
  - Right `↑` button: Round circle `36×36px`, `#27272A` (dark) / `#E4E4E7` (light), turns into circular progress spinner while generating.
- **Text Area**: Borderless, multi-line auto-grow up to 5 lines.

### 5. Floating Parameter Popover Menu
- Anchored directly above the `+` button inside the input container.
- Width: `290px`, border-radius `16px`.
- Border: `1px solid #2E2E34`.
- Shadow: `0 8px 24px rgba(0, 0, 0, 0.6)`.
- Two-level menu navigation:
  - **Level 1**: Option list (`effort`, `recall`, `verbosity`) with divider rules.
  - **Level 2**: Segmented controls (e.g., `None | Low | Med | High | XHigh | Max`) with explanatory micro-copy beneath.

### 6. Syntax-Highlighted Code Blocks
- **Container**: Border-radius `10px`, background `#0D0D10` (dark) / `#F8F8FA` (light), border `1px solid #222226` (dark) / `#E4E4E7` (light).
- **Typography**: `JetBrains Mono`, `13.5px`, line-height `1.5`.
- **Copy Button**: Floating in top-right corner, icon-only (`copy` / `check`), translucent pill background.
- **Syntax Theme**: GitHub Dark Dimmed palette (muted purples, warm corals `#FF7B72`, blues `#79C0FF`, greens `#7EE787`, oranges `#FFA657`).

---

## 6. Ready-to-Use Tailwind CSS Configuration

If you are implementing this UI in a React/Vue/Svelte project using Tailwind CSS, use this configuration:

```js
// tailwind.config.js
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        velocity: {
          pitch: '#000000',
          surface: '#0A0A0A',
          card: '#141414',
          active: '#1A1A1A',
          popover: '#1E1E22',
          border: '#1E1E1E',
          borderPopover: '#2E2E34',
          pill: '#27272A',
          muted: '#A1A1AA',
          body: '#D4D4D8',
          // Light Mode
          lightCanvas: '#FFFFFF',
          lightSurface: '#F7F7F8',
          lightCard: '#F4F4F5',
          lightActive: '#E4E4E7',
          lightBorder: '#E4E4E7',
          lightMuted: '#71717A',
        },
      },
      fontFamily: {
        sans: ['Satoshi', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      maxWidth: {
        chat: '768px',
      },
      borderRadius: {
        capsule: '28px',
        bubble: '18px',
      },
    },
  },
  plugins: [],
};
```

---

## 7. Key Animation & Motion Specs

- **Sidebar Slide**: `200ms` curve `easeInOut`
- **Hover Micro-Actions Fade**: `150ms` curve `easeOut`
- **Plus Icon Rotation**: `150ms` curve `easeInOut` (0° to 45°)
- **Popover Height Auto-Resize**: `160ms` curve `easeOutCubic`
- **Pulsing Status Indicator**: `1600ms` repeat reverse loop with `Curves.easeInOut` (opacity `0.35` to `1.0`)
- **Clipboard Success Timeout**: `2000ms` before reverting checkmark back to copy icon
