# apps/web/src/ui/

**Job:** the web app's primitives and design tokens: actions, fields, status and layout pieces,
each a component and its CSS module, drawn only from `tokens/`. No feature logic.

## Layout

| Path                                  | What                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens/tokens.css`                   | Colour, type, space, radius, motion and layout tokens (`--ds-*`); three themes (Drip Light, Drip Dark, Drip Night) by `html[data-theme]`, Light and Dark through `light-dark()`, the device deciding when it is absent; `[data-status]` aliases; the reading sheet follows the theme     |
| `tokens/base.css`                     | Reset, body, focus ring, headings, `.ds-visually-hidden`, keyframes (enter, rise, shine, shimmer, spin), reduced motion                                                                                                                                                                  |
| `Button` `IconButton`                 | Actions (`ink` is the steel accent fill, then `secondary quiet danger link`; `loading` shows a spinner and a shine); lift on hover, press scale, a focus ring that glides out; `ButtonLink` for navigation; IconButton needs `label`, and `shape="round"` is a 32 px circle (send, back) |
| `TextField` `TextArea` `Select`       | Labelled fields with hint and error (`Field` owns ids); TextArea counts from 90% of `maxLength`                                                                                                                                                                                          |
| `Checkbox` `Switch` `Segmented`       | Native checkbox, switch role, radiogroup with arrow keys and a thumb that slides to the chosen face (two to seven options; `size="sm"` is the 32 px toolbar control)                                                                                                                     |
| `CodeField`                           | Six-digit code: autofill, paste splits, `onComplete`                                                                                                                                                                                                                                     |
| `Pill` `Notice` `Banner`              | Agreement status and tone words with icons (`info` is steel, `confirm` is teal and means verified); `live` is `polite` or `alert`                                                                                                                                                        |
| `EmptyState` `Skeleton`               | Empty states (optional icon tile and detail line) and loading states                                                                                                                                                                                                                     |
| `Dialog` `Drawer`                     | Native `<dialog>` through `Modal/useModal`, fading and sliding in and out; focus returns to the opener                                                                                                                                                                                   |
| `Menu`                                | Native popover with menu keys; optional `caption` above the items, `narrowOnly` items and `group` labels; fades in and out                                                                                                                                                               |
| `PageHeader` `TopBar` `Mark` `Avatar` | Page head (h1 and actions), sticky 56 px top bar with slots, product mark (`compact` is the glyph alone), initials                                                                                                                                                                       |
| `Moment`                              | `<time>`: absolute local time in mono for evidence, a local day, relative for lists                                                                                                                                                                                                      |
| `Tone`                                | Internal: the one tone and status colour map and tone icons                                                                                                                                                                                                                              |
| `icons.tsx`                           | The lucide icons the app uses; import icons from here                                                                                                                                                                                                                                    |

## Rules here

- `--ds-*` tokens only. `1px` borders, `@media` breakpoints and percentage widths are the only
  literals; a colour appears in `tokens/tokens.css` alone.
- Motion is a token (`--ds-motion-*`, `--ds-anim-*`) and every duration drops to zero under
  `prefers-reduced-motion`; controls stay at or under 200 ms. A list row rises on first paint with
  `animation: var(--ds-anim-rise)` and `animation-delay` of `--ds-motion-stagger` times its
  `--rise-index`. A card that is a link or button lifts with `translate: 0 var(--ds-lift)`. Every enabled link, button, summary, menu item, tab and radio label presses in by `scale: var(--ds-press)` (`tokens/base.css`, zero specificity); a big surface sets `--ds-press: 0.99`, and a `transition` of its own must list `scale`.
- Variants, sizes and states are data attributes (`data-variant`, `data-tone`, `data-status`);
  one class per element. Shared drawing is shared with CSS `composes`.
- Props are exact and readonly; nothing is spread onto the DOM. `'use client'` only where state or
  a handler needs it.
- Native elements carry the semantics; every control is keyboard reachable, labelled, and 44 px
  on a coarse pointer through the size tokens.
- The root layout loads `tokens/tokens.css` then `tokens/base.css` and sets `--ds-face-geist`,
  `--ds-face-newsreader` and `--ds-face-geist-mono` on `<html>`; primitives rely on both.

## Pointers

Up `../../README.md` · design `docs/DECISIONS.md`
