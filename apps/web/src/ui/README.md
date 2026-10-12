# apps/web/src/ui/

**Job:** the web app's primitives and design tokens: actions, fields, status and layout pieces,
each a component and its CSS module, drawn only from `tokens/`. No feature logic.

## Layout

| Path                                  | What                                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens/tokens.css`                   | Colour, type, space, radius, motion and layout tokens (`--ds-*`); light, dark by `prefers-color-scheme`, `[data-status]` aliases; the reading sheet follows the theme      |
| `tokens/base.css`                     | Reset, body, focus ring, headings, `.ds-visually-hidden`, keyframes, reduced motion                                                                              |
| `Button` `IconButton`                 | Actions (`ink` is the teal accent fill, then `secondary quiet danger link`, `loading`); `ButtonLink` for navigation; IconButton needs `label`, and `shape="round"` is a 32 px circle (send, back) |
| `TextField` `TextArea` `Select`       | Labelled fields with hint and error (`Field` owns ids); TextArea counts from 90% of `maxLength`                                                                  |
| `Checkbox` `Switch` `Segmented`       | Native checkbox, switch role, radiogroup with arrow keys (`size="sm"` is the 32 px toolbar control)                                                              |
| `CodeField`                           | Six-digit code: autofill, paste splits, `onComplete`                                                                                                             |
| `Pill` `Notice` `Banner`              | Agreement status and tone words with icons; `live` is `polite` or `alert`                                                                                        |
| `EmptyState` `Skeleton`               | Empty states (optional icon tile and detail line) and loading states                                                                                                                                         |
| `Dialog` `Drawer`                     | Native `<dialog>` through `Modal/useModal`; focus returns to the opener                                                                                          |
| `Menu`                                | Native popover with menu keys; optional `caption` above the items and `narrowOnly` items                                                                         |
| `PageHeader` `TopBar` `Mark` `Avatar` | Page head (h1 and actions), sticky 56 px top bar with slots, product mark (`compact` is the glyph alone), initials                                                                                     |
| `Moment`                              | `<time>`: absolute local time in mono for evidence, relative for lists                                                                                           |
| `Tone`                                | Internal: the one tone and status colour map and tone icons                                                                                                      |
| `icons.tsx`                           | The lucide icons the app uses; import icons from here                                                                                                            |

## Rules here

- `--ds-*` tokens only. `1px` borders, `@media` breakpoints and percentage widths are the only
  literals; a colour appears in `tokens/tokens.css` alone.
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
