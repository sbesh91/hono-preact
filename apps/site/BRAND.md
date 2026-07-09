# Brand System

This document is the source of truth for the brand direction of the docs site (`apps/site`). Read it before any work that touches what a visitor sees or reads: page design, components, CSS, illustrations, copy, headlines, error messages, empty states.

How to use it:

- Sections 1 through 6 are the ideology: who the brand is, how it sounds. Apply them to every sentence of user-facing copy.
- Section 7 is the visual doctrine: how the brand looks. Apply it to every visual decision.
- Section 8 lists hard constraints that outrank brand aesthetics. When a brand rule and a constraint conflict, the constraint wins.
- Section 9 maps the doctrine to the tokens and utilities that already exist in `src/styles/root.css`. Use those; do not invent parallel ones.
- Section 10 is a checklist to verify work against before calling it done.

Rules carry IDs (V1, C3, T2...) so reviews can cite them precisely.

## 1. Essence

**We inspire connections.**

Warmth, momentum, and human connection make technology feel alive. The brand exists to amplify discovery and enjoyment, to empower creative expression, and to engage each person more deeply with the things they love.

Positioning in one sentence: a personal, connected experience that ignites rich connections between people and the things they care about.

## 2. The three pillars

Three persistent values weave through the design, the product, and the brand experience. Everything shipped should serve at least one.

**Rich discovery.** Discovery is powered by people and by context. There is a conversation behind everything, and exciting connections to be made with every exchange. Never just deliver content; serve it in valuable context. Every click is a potential launch pad to a series of more rewarding associations. Help people sift the infinity of what is available and zone in on what they love.

**Simple connections.** Enjoyment should be simple and fluid, everywhere, all the time. Make the process of connecting less complicated and more fulfilling, with features that help at the right moment. No hassle, no confusion, no clutter: people find exactly what they are looking for.

**You make it you.** Provide rich ways for people to express their individuality and enjoy the experience on their own terms. It should be easy, and fun, to tweak almost everything, totally making it yours.

## 3. Values

- **Independent in spirit.** We don't conform, and we don't try to be everything to everyone.
- **Authenticity through action.** Never say it, be it. Passion shows through genuine actions, not claims.
- **Organic in experience.** Honest self-expression that is intimate and unpredictable, always changing, always adapting.

## 4. Traits

- **Warm.** The brand is a welcoming proposition, an invitation to join a larger experience and connect with others.
- **Human.** Its purpose is to create, and be a conduit for, meaningful human connections.
- **Real.** Accessible; real people and real situations sit at the center of the brand.
- **Delightful.** It creates impactful moments that delight and enrich.

## 5. Point of view and tone

Point of view (the outlook behind everything we say):

- **We believe in community power.** This is an emotional space more than a technological one.
- **We strive for simplicity.** Don't get crazy with tech-speak. Stick to the basics.
- **We're honest.** Tell it like it is and practice fanatical consistency. State your case and let people make up their own minds. Don't try too hard.
- **We're open and inclusive.** Act like the social space we are.
- **We're independent.** There is no single arbiter of cool; we make up our own minds.
- **We like the unexpected.** Life, journeys, and choices keep changing. Stay open to it.

Tone (how the brand sounds when it communicates):

- **Integrity.** Portray an honest point of view people can rally around.
- **Friendly.** Talk to people like they're your friends, not a demographic or a target market.
- **Amusing.** It's supposed to be fun: loose, informal, and unpredictable.
- **Positive and respectful.** Don't insult competitors or alternatives. Insulting them insults the people who chose them. Respect what others have accomplished.
- **Thoughtful.** We're not shouters. Let the content of what we're saying rise above the noise.
- **Smart and sophisticated.** Confident in who we are and what we're doing, without arrogance and without boasting.

## 6. Writing rules

Word choice:

- **W1.** Prefer the human word over the system word. Say what the thing is to the person, not what it is to the machine (the way "song" beats "file", and "replace" beats "overwrite").
- **W2.** Be authentic to the audience: use the words they'd use, not internal or enterprise vocabulary.
- **W3.** Frame actions as less work and more benefit ("update it" rather than naming the mechanism that performs the update).

Phrasing:

- **W4.** Direct, active voice. "A workspace can hold up to 200 projects" beats "the limit of projects that can be in a workspace is 200."
- **W5.** Simple, short constructions. "Drag items anywhere in the list to change the order" beats a clause-stacked instruction.
- **W6.** Human-oriented verbs: people *choose*, they don't *configure*.
- **W7.** Informal, casual, natural. Write like a person who is good at explaining, not like documentation defending itself.

These rules govern brand voice surfaces: headlines, landing copy, empty states, marketing-flavored prose. Technical reference (API tables, signatures, error semantics) stays precise first; apply W4 and W5 there, but never trade accuracy for looseness.

## 7. Visual doctrine

The look in one line: **a vast calm neutral stage, energized by a single vivid gesture.**

### 7.1 Color

The signature gesture is the **orangenta gradient**: warm orange flowing into vivid magenta. The color fade connotes transformation: movement, affinity, warmth, energy, intensity.

- **C1.** White (or the theme's neutral background) is predominant. The palette proportion, in descending order of area: background neutral, then the gradient gesture, then the grey ladder, then near-black ink, then solo magenta accents. Vivid color is always the minority.
- **C2.** The gradient is a label and an accent, never a primary field. It should never inhabit more than roughly 8% of the available space.
- **C3.** Orange and magenta are designed to be used together in the gradient. **Orange never appears alone**: not as text, not as a fill, not as an accent. Magenta may occasionally solo as a highlight or accent color.
- **C4.** The neutral stage is a grey ladder between white and a near-black ink. Greys ground; they never compete.
- **C5.** Wordmark-style elements sit in cool grey to counter-balance the vibrant gradient; black or white is permissible where legibility demands it.

### 7.2 Gradient discipline

- **G1.** The gradient always reads orange to magenta, left to right or bottom to top. Diagonals rise (orange low, magenta high).
- **G2.** As a shape, the gradient lives in a vertical, horizontal, or diagonal rectangle: the "energy bar". The color exchange splits at the center of the bar.
- **G3.** The gradient's diffuse form is the "cloud": released from contained shapes and used as a soft environmental glow behind or around content. Clouds may extend the spectrum slightly with hints of complementary purples and yellows.
- **G4.** Diagonal slash accents in the gradient are a signature flourish for framing and energy. Use sparingly (one per composition).

### 7.3 Typography

One typeface family carries everything, in three weights. Character comes from weight, case, and scale, never from mixing families.

- **T1.** Headlines: **bold, uppercase**, tight tracking (about -0.04em), tight leading (about 80% of font size). Short, attitudinal.
- **T2.** Subheadlines: **light, lowercase**. Relaxed and human, the counterpoint to the bold headline.
- **T3.** Titles and labels: regular weight, uppercase, normal tracking.
- **T4.** Body: regular weight, sentence case, comfortable leading.
- **T5.** Never jumble upper and lower case within a word, never mix cased and uncased words within a sentence set in a display style, and never mix colors, weights, or fonts within a single word.
- **T6.** Type color stays within the palette: ink, greys, or white on dark. Magenta text is permissible as an accent. **Orange text never** (C3). Gradient-filled display text is the one exception where both colors appear in type, and it follows G1.

### 7.4 Space and layout

- **S1.** Layouts are airy, open, and boundless. Generous whitespace is a brand asset, not empty space to fill.
- **S2.** Borders are implied rather than drawn wherever possible: use spacing, background shifts, and diffuse fades before reaching for a line.
- **S3.** Content pops against softer, less crowded surroundings. One focal point per composition; supporting elements recede.
- **S4.** Give identity elements (logos, lockups, hero marks) clear territory. Crowding reads as cheap.

### 7.5 Texture, pattern, and craft

- **P1.** Patterns and textures are background whispers: small in scale, low in contrast, never conspicuous, never a primary design element. They add a layer of textural richness built on the idea of connections.
- **P2.** The quality bar is **raw deluxe**: contemporary luxury craftsmanship. Warm tones, organic textures, and a deft human touch wrap the technology in a premium, understated context. Prefer one crafted detail over three decorative ones.
- **P3.** Icons and badges ground themselves in grey, accented by the gradient for signature style. Grey is the body; the gradient is the glint.

### 7.6 Motion

- **M1.** Motion is artistic craftsmanship with an innate sense of personality: springy, organic, alive. Prefer soft spring easing over linear or mechanical curves.
- **M2.** Motion is brief and purposeful. It clarifies spatial relationships (where things came from, where they went); it never performs for its own sake.
- **M3.** Every animation respects `prefers-reduced-motion` (see 8).

### 7.7 Imagery

- **I1.** Imagery captures authentic human moments: editorial, candid, never staged or posed. Real people, believable situations, genuine emotion.
- **I2.** Product and screenshot imagery floats weightless on a limitless background: crisp, borderless, free of clutter.
- **I3.** The gradient cloud may wash over imagery as a diffuse tint, calling out the brand's pervasive energy and unifying mixed sources.

## 8. Hard constraints (these outrank aesthetics)

- **A1.** **WCAG AA contrast (4.5:1 for text, 3:1 for large text and UI) beats the brand swatch.** Where a signature color fails AA on a surface, use the accessible derivative for that mode instead (this is why the accent is a darkened magenta in light mode and a brightened magenta in dark mode). Never ship sub-AA text or interactive color to stay on-swatch.
- **A2.** Both light and dark themes are first-class. Every visual decision must be made (and checked) in both. Semantic tokens flip per mode; components consume tokens, never raw hex.
- **A3.** Badges and chips always pair a surface color with its own foreground color; a label must never inherit the page foreground onto a colored surface.
- **A4.** Text overlaying gradient or cloud surfaces uses a fixed ink or white, chosen for contrast against that surface, not the theme foreground.
- **A5.** Web platform features: Baseline Widely Available only. Newly Available features may be used as progressive enhancement with a safe fallback.
- **A6.** All motion honors `prefers-reduced-motion: reduce` (disable or reduce to opacity).
- **A7.** Naming: brand tokens and utilities are named `brand-*` or by coined color words (`orangenta`, `magenta`). The names of the source brand and its parent company never appear in code, comments, class names, or site copy. Exemption: operating-system fonts may be named in `font-family` fallback position (the `--font-sans` stack does this); the shipped webfont itself is the only face we present as ours.

## 9. Mapping to the codebase

The doctrine is already implemented as tokens and utilities in `apps/site/src/styles/root.css`. Consume these; do not restate raw values in components, and do not invent parallel tokens.

| Doctrine | Implementation |
|---|---|
| C3 signature colors | `--color-brand-magenta` (#ec008c), `--color-brand-orange` (#fe5000, gradient use only), plus the `--color-magenta-50…900` ramp |
| C4 neutral stage | Semantic tokens `--background`, `--foreground`, `--muted`, `--surface`, `--surface-subtle`, `--border-color`; ink is `--color-brand-ink` (#25282a), grey is `--color-brand-grey` (#888b8d) |
| G1/G2 energy bar | `--gradient-orangenta` (90deg, orange to magenta); utilities `bg-orangenta`, `text-orangenta`, `energy-bar` |
| G3 cloud | Utility `bg-brand-cloud` (three diffuse radial glows: orange, magenta, purple hint) |
| T1-T4 type | `--font-sans`: Selawik (the shipped open-license face), weights 300 (light), 400 (regular), 600/700 (bold display) |
| A1 accessible accent | `--accent` / `--accent-hover` / `--accent-foreground`: magenta-600/700 on light, brightened magenta on dark; focus ring `--ring` |
| A2 theming | Tokens flip via `prefers-color-scheme` and `:root[data-theme]`; keep both blocks in sync |
| A3 paired badges | `badge-*` utilities set surface and foreground together |
| M1 spring motion | `--spring-soft` easing + `--spring-duration`; zeroed under reduced motion |
| S2 elevation | `shadow-card` token-driven shadow instead of drawn borders where depth is meant |

When a new visual need has no token, extend `root.css` following these patterns (semantic token, both modes, AA-checked) rather than hardcoding values in a component.

## 10. Checklist

Before shipping visual or copy work, verify:

- [ ] Vivid color is a minority accent: gradient under ~8% of the composition, background neutral dominant (C1, C2)
- [ ] Orange never appears alone; gradient reads orange to magenta, left-to-right, upward, or rising diagonal (C3, G1)
- [ ] One focal point; whitespace generous; borders implied where possible (S1-S3)
- [ ] Display type follows the casing system; no mixed case/weight/color within a word; no orange text (T1-T6)
- [ ] Patterns and texture stay in the background, small and quiet (P1)
- [ ] Motion is springy, brief, purposeful, and disabled under reduced motion (M1-M3, A6)
- [ ] AA contrast verified in **both** light and dark modes; tokens used, no raw hex in components (A1, A2)
- [ ] Colored surfaces pair their own foreground; gradient overlays use fixed ink/white (A3, A4)
- [ ] Copy passes the voice test: friendly, direct, active, no tech-speak, no shouting, no boasting (Sections 5-6)
- [ ] No source brand names anywhere (A7)
