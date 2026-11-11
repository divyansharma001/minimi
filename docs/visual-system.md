# Visual system

How the chat screen looks, and why.
The tokens live in `src/app/styles.css`; this page explains them.
`DESIGN.md` is the architecture document; this is the visual one.

## Direction

A calm workbench where every fact shows its receipt.
Colour lives behind the work as a grainy green field, and the work sits on white cards.
The craft follows Sarvam's design system (github.com/ashree2118/sarvam): two registers, near-black text, no heavy weights, pill buttons, barely visible shadows.
Its trial-licensed fonts and Sarvam's own logos and shapes are not used: the repo is public, and minimi is not a Sarvam product.

## Two registers

| Register | Where | Rules |
|---|---|---|
| The field | Behind everything | Analogous greens (green-100 to green-600) with one ochre corner, under visible grain. No text sits on its darkest parts except in green-1000. |
| The work | Cards, sidebar, composer | White and `#FCFCFC`, corners 16 to 28px, soft offset shadows, text `#1F1F1F`, never pure black. |

## Colour

The green scale is measured from sarvam.ai.

| Token | Hex | Use |
|---|---|---|
| `--g-100` | `#E3F1D8` | Field base, "checked" pill, citation chips, active chat |
| `--g-200` | `#C8E4B0` | Field middle, text selection |
| `--g-300` to `--g-600` | `#ACD587` to `#6EA335` | Field edges only |
| `--g-700` | `#496D21` | Focus ring, caret, spinner, disabled send arrow |
| `--g-800` | `#385418` | Send button, "checked" pill text |
| `--g-900` | `#263D0E` | Your messages |
| `--g-1000` | `#152605` | Headline and any text on the field |

Status colours carry meaning, and every pair is at least 4.5:1 for small text:

| Status | Pill | Feeling | Contrast |
|---|---|---|---|
| Checked, Still true | green-800 on green-100 | Stable, safe to rely on | 7.3:1 |
| Changed | `#6B4C1C` on `#FFF0CF` | Attention, not alarm: the world moved | 7.0:1 |
| Sources disagree | `#6B4C1C` on white, `#FFE8B7` outline | Look closer: two pages differ | 7.8:1 |
| Was wrong | `#A21913` on `#FDE7E2` | An honest correction, not a failure | 6.6:1 |
| Couldn't confirm | `#525252` on `#F5F5F5` | Unknown, neither good nor bad | 7.2:1 |

Sarvam's own tag rule (step 600 text on step 50) measures 2.8:1, so pills use darker text.

## Type

One family, Figtree, served from the app by `next/font` (open licence; browsers never contact Google).
Weights 400, 500 and 600 only: hierarchy comes from size and weight steps, never bold 700.

| Role | Size | Weight |
|---|---|---|
| Empty-state headline | 34 to 48px, tracking -0.03em | 500 |
| Answer prose | 17px, line height 1.65 | 400 |
| Fact sentence | 16px, `#3D3D3D` | 400 |
| Fact value (price, amount) | 16px, `#1F1F1F`, tabular figures | 600 |
| Labels, meta, sidebar groups | 13px, `#666666` | 500 / 400 |

## Components

- **Answer card:** prose with citation chips, then "Checked facts", then "Sources" numbered by page with the day read and the page's own date.
- **Checked facts** is a dropdown, closed by default.
The closed row shows a small pill per status with its count ("12 checked", "1 changed"), so a change is visible without opening it.
Open, each row shows a grey sentence, the bold value, the source chip and read date, and the status pill.
- **Sources that disagree** sit together in the facts list, under "Sources disagree" and their topic, on a warm amber rail.
The closed row adds an outlined amber chip, "1 disagreement".
Amber, as for "Changed", means "look closer"; outlined rather than filled, because nothing moved: two pages just say different things.
Each fact keeps its own "Checked" pill, since each is true to its own page.
- **Thought process** is a quiet closed row at the top of an answer ("Thought process · 31 s · 2 searches · 8 pages"); open, a thin timeline of the steps with their times.
- **Citation chips** open the source page in a new tab, with the site and page title on hover.
- **Your messages** have edit and delete buttons: left of the bubble on hover or keyboard focus, and always shown under it on touch screens.
Edit turns the bubble into a white panel with "Cancel" and "Ask again", and says what it will replace.
Delete asks inline on a small white card, never in a pop-up.
- **Buttons:** pill shaped; primary green-800, delete red-600 with white text (7:1), quiet ones have no fill until hover.
- **Citations** are numbered by page, not by passage, so one page is one number everywhere.
- **Fact rows:** pill on the right of the text on desktop; on phones the pill sits on the source line, and a long site name shortens before the read date does.
- **Composer:** white panel, 28px corners; send is a flat green-800 circle, and when disabled a green-100 circle with a green-700 arrow.
- **Working state:** live steps with a spinner, then a skeleton for the answer.
- **Tables** keep whole words and scroll sideways in their frame, with edge shadows only while more table lies that way.
- **Sidebar:** chats grouped Today, Yesterday, weekday names for the past week, then dates; a drawer on phones.
A bin shows on a row on hover (on touch screens, on the open chat), and the row turns into "Delete this chat? Cancel / Delete".

## Motion

Easing `cubic-bezier(0.2, 0, 0, 1)`, 150 to 220ms.
Cards and fact rows rise 6px as they arrive; buttons press to 0.95 to 0.98.
Reduced-motion settings turn all of it off, smooth scrolling included.

## Browser surfaces

Selection in green-200, caret and focus ring in green-700, thin green-tinted scrollbars, and a soft fade where the chat scrolls under its edges.
