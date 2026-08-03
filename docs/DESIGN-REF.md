# Design reference (supplied 2026-08-03)

Hannes supplied a Tailwind/Material-3-flavoured design system for a "Puppy Pal" mock of this
game. This file records what we **take**, what we **reject**, and why — so the reasoning
survives.

The mock's own strengths: a properly systematised warm palette, a real type ramp, and a
tactile press treatment. Those are genuine upgrades on what we have. Its gameplay
assumptions contradict decisions this project made on evidence, and those we keep.

---

## ✅ TAKE — the visual language

### Palette (Material-3 token set, warm cream/caramel)
| Token | Hex | Use |
|---|---|---|
| `primary` | `#815129` | primary actions, headings |
| `primary-container` | `#9d693e` | filled chips, meter fills |
| `secondary` | `#765933` | secondary emphasis |
| `secondary-container` | `#fed6a7` | selected nav pill |
| `tertiary` | `#914635` | accents |
| `surface` / `background` / `surface-bright` | `#fff8f3` | page ground |
| `surface-container-lowest` | `#ffffff` | cards |
| `surface-container-low` | `#fff2e1` | |
| `surface-container` | `#ffebcf` | nav bar |
| `surface-container-high` | `#fde5bf` | |
| `surface-container-highest` / `surface-variant` | `#f8dfba` | inset wells |
| `surface-dim` | `#efd7b2` | wood ground |
| `on-surface` | `#251a03` | body ink |
| `on-surface-variant` | `#51443b` | secondary ink |
| `outline` / `outline-variant` | `#84746a` / `#d6c3b7` | borders, stitched dividers |
| `inverse-surface` / `inverse-on-surface` | `#3c2e15` / `#ffeed8` | toasts |
| `error` / `error-container` | `#ba1a1a` / `#ffdad6` | |
| **`coral-toy`** | `#F2A291` | hearts, affection |
| **`mint-grass`** | `#A8D5BA` | outdoors / walks |
| **`sky-blue`** | `#B9E0FF` | water / energy |
| **`deep-bark`** | `#2A1C14` | deepest shadow — already our boot colour |

This is very close to what the game already uses, but systematised. Worth adopting as the
canonical token set in `state/balance.js` so every surface pulls from one place.

### Type ramp — Plus Jakarta Sans
| Role | Size / line / weight |
|---|---|
| display-lg | 48 / 56 / 800, −0.02em |
| headline-lg | 32 / 40 / 700 (mobile 28 / 36) |
| title-md | 20 / 28 / 600 |
| body-lg | 18 / 26 / 400 |
| body-md | 16 / 24 / 400 |
| label-md | 14 / 20 / 600, +0.01em |
| label-sm | 12 / 16 / 700, +0.05em |

**Must be self-hosted as woff2 and precached** — no Google Fonts request. See rejections.

### Radii & spacing
Radii `1rem` default / `2rem` lg / `3rem` xl / full. Spacing: base 8, gutter 16,
card-padding 24, mobile margin 20.

### Surface treatments worth stealing
- **`.tactile-button`** — a 3–4px bottom border that shrinks to 1px and translates down 2px on
  press. This is the single best idea in the mock: it makes buttons feel like physical objects,
  which is exactly right for a cozy pet game. Cheap to reproduce in Canvas2D.
- **`.soft-shadow`** — `0 12px 32px -4px rgba(131,83,43,.12)`. A *warm* shadow, not grey.
- **`.glass-overlay`** — blur + `rgba(255,248,243,.85)`.
- **Inset wells** — `inset 0 2px 4px rgba(0,0,0,.05–.1)` for anything recessed.
- **`.stitched-divider`** — 2px dashed `#d6c3b7`. Very fitting; the rug already has stitching.
- **Simplified nav.** The mock uses **4 labelled tabs**. We currently have **8 pills**, already
  flagged as a thumb-reach risk. Worth reducing — see open question.

---

## ❌ REJECT — and the reasons, which are not stylistic

### 1. Percentage status bars (`Hunger 75%`, `Happy 90%`, `Energy 45%`)
This is the one to refuse hardest. `docs/nintendogs-design-reference.md` §2 found that the
original **deliberately had no affection readout at all**: hunger/thirst/coat were inspectable
as **words** (`Full → Normal → Hungry → Famished`), and the bond was legible only off the
animal — tail speed, ear position, whether he approaches, whether he obeys first time. The
research's words: *"Do not build an affection bar."*

We built one in stage 1 and removed it on that evidence. A **`Happy 90%`** bar is precisely
that bar returning, and it changes the game from reading a creature to managing three numbers.
It also makes neglect quantified and therefore accusing, which breaks the "he never resents
her" principle.

### 2. The puppy as a static image that bobs on a CSS loop
The mock's dog is one AI-generated PNG, floating on a 5s `translateY` and scaling on tap. That
is the **Style B option we evaluated and rejected**, and it discards the entire reason this
game works: a procedurally drawn dog on ~30 springs, with a stroke-impulse field, ten petting
zones with sweet/bad asymmetry, rhythm sensitivity, eyes that lead the head, 18 idle clips and
a five-beat reunion. Tap-to-spawn-a-heart is not petting.

### 3. Every external dependency
Tailwind CDN, Google Fonts, `transparenttextures.com`, `googleusercontent.com` images.
`docs/ARCHITECTURE.md` §1 requires **zero runtime network requests**, and gift blocker 1.5 is
"works fully offline" — which is not decoration: installing + offline is what stops iOS
evicting her save (blocker 1.2). Any CDN reference breaks the service worker's
precache-everything guarantee.

Everything we take must be **reimplemented in code**: tokens as data, fonts self-hosted woff2
and precached, textures generated procedurally (the game already draws its own grain).

### 4. `navigator.vibrate`
Confirmed **absent** on the target iPhone (`docs/PLATFORM-RISKS.md`). Dead code.

---

## Open questions for Hannes
1. **Status display** — words (research-backed) vs the mock's bars? Or a middle path: bars for
   the *care* needs only (hunger/thirst/coat, which the original did surface), and **never** for
   the bond?
2. **Fonts** — self-host Plus Jakarta Sans (~2 woff2 files, real polish, a little weight), or
   keep the system font stack (zero bytes)?
3. **Nav** — reduce 8 pills toward the mock's 4 labelled tabs?
