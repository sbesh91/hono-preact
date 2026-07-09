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

Between the edge and the browser. Between a developer and the thing they're building. Between one docs page and the next idea. Warmth, momentum, and human connection make a web framework feel alive rather than institutional. The brand exists to make building for the web feel personal, capable, and fun.

Positioning in one sentence: a small full-stack framework whose docs make you feel at home in five minutes and never talk down to you.

## 2. The three pillars

Three persistent values weave through the docs, the demos, and the identity. Everything shipped should serve at least one.

**Rich discovery.** Every page leads somewhere. Never just deliver reference; serve it in valuable context: what this is for, what it composes with, where to go next. Every code sample and cross-link is a potential launch pad to the next capability. Help people sift a full-stack surface and zone in on the part they need right now. No dead ends: even a 404 points somewhere useful.

**Simple connections.** Building should be simple and fluid, end to end. The framework's promise (one package, typed from server to client, streaming everywhere) is the brand's promise too: no hassle, no confusion, no clutter. Docs get people to working code fast; features like search and prefetching help at the right moment and stay out of the way otherwise.

**You make it you.** The framework hands over control: routes as a data structure, headless primitives you style yourself, copy-paste starting points in both CSS and Tailwind flavors. The brand celebrates that ownership. Show people how to make it theirs; never imply there is one blessed way.

## 3. Values

- **Independent in spirit.** We don't chase every trend, and we don't try to be every framework. Design choices are made on merit, and we're comfortable diverging from the herd when the merit is there.
- **Authenticity through action.** Never say it, be it. Working demos, honest benchmarks, and real code carry the message; marketing adjectives don't.
- **Organic in experience.** The framework and its docs evolve with the platform: honest about limitations, always changing, always adapting.

## 4. Traits

- **Warm.** The site is a welcoming proposition: an invitation to build something, aimed as much at the newcomer as the expert.
- **Human.** Written by people, for people. The reader is a person mid-task, not "the developer persona."
- **Real.** Real examples, real constraints, honestly documented limitations. No toy code that falls apart on contact.
- **Delightful.** Crafted moments (a fluid view transition, a live demo that just works) that reward attention without demanding it.

## 5. Point of view and tone

Point of view (the outlook behind everything we say):

- **We believe in the platform and its community.** We build on web standards and prior art, and we credit both. The framework is a thin, honest layer over a platform that deserves the spotlight.
- **We strive for simplicity.** Don't get crazy with jargon. Stick to the basics; introduce a term only when the reader needs it.
- **We're honest.** Tell it like it is, including what the framework doesn't do. State your case and let people make up their own minds. Don't try too hard.
- **We're open and inclusive.** No gatekeeping, no assumed folklore. Every page should be enterable by someone who just arrived.
- **We're independent.** There is no single arbiter of best practice. We make up our own minds, and we respect readers who do the same.
- **We like the unexpected.** The platform keeps evolving; so do we. Stay curious in the writing.

Tone (how the brand sounds when it communicates):

- **Integrity.** Portray an honest point of view people can rally around.
- **Friendly.** Talk to readers like colleagues at the next desk, not like a demographic or a target market.
- **Amusing.** It's allowed to be fun: loose, informal, a little unpredictable. Never at the reader's expense.
- **Positive and respectful.** Don't insult other frameworks or tools. Insulting them insults the people who chose them. Compare honestly and respect what others have accomplished.
- **Thoughtful.** We're not shouters. Let the content of what we're saying rise above the noise.
- **Smart and sophisticated.** Confident in what we've built, without arrogance and without boasting.

## 6. Writing rules

Word choice:

- **W1.** Prefer the human word over the system word in guide prose: "reload the page's data" beats "invalidate the loader cache"; "your page" beats "the route module." API names stay exact where the API is the subject.
- **W2.** Be authentic to the audience: web developers. Use their working vocabulary; skip enterprise words ("leverage", "utilize", "solution") and internal names.
- **W3.** Frame actions as less work and more benefit: lead with what the reader gets, then the mechanism.

Phrasing:

- **W4.** Direct, active voice. "Loaders run on the server" beats "execution of loaders is performed server-side."
- **W5.** Simple, short constructions. "Drag the card to another column to move it" beats a clause-stacked instruction.
- **W6.** Human-oriented verbs: people *choose* and *build*, they don't *configure* and *implement* (unless they literally do).
- **W7.** Informal, casual, natural. Write like a person who is good at explaining, not like documentation defending itself.

These rules govern brand voice surfaces: headlines, landing copy, empty states, error pages, marketing-flavored prose. Technical reference (API tables, signatures, error semantics) stays precise first; apply W4 and W5 there, but never trade accuracy for looseness.

## 7. Visual doctrine

The look in one line: **a vast calm neutral stage, energized by a single vivid gesture.**

### 7.1 Color

The signature gesture is the **orangenta gradient**: warm orange flowing into vivid magenta. The color fade connotes transformation: movement, affinity, warmth, energy, intensity.

- **C1.** White (or the theme's neutral background) is predominant. The palette proportion, in descending order of area: background neutral, then the gradient gesture, then the grey ladder, then near-black ink, then solo magenta accents. Vivid color is always the minority.
- **C2.** The gradient is a label and an accent, never a primary field. It should never inhabit more than roughly 8% of the available space.
- **C3.** Orange and magenta are designed to be used together in the gradient. **Orange never appears alone**: not as text, not as a fill, not as an accent. Magenta may occasionally solo as a highlight or accent color. Pole-node exception: an element visually attached to the gradient gesture (the endpoint dots of a wire or bar) may take its pole color, orange included; detached from the gradient, the rule holds.
- **C4.** The neutral stage is a grey ladder between white and a near-black ink. Greys ground; they never compete.
- **C5.** Wordmark-style elements sit in cool grey to counter-balance the vibrant gradient; black or white is permissible where legibility demands it.

### 7.2 Gradient discipline

- **G1.** The gradient always reads orange to magenta, left to right or bottom to top. Diagonals rise (orange low, magenta high).
- **G2.** As a shape, the gradient lives in a vertical, horizontal, or diagonal rectangle: the "energy bar". The color exchange splits at the center of the bar.
- **G3.** The gradient's diffuse form is the "cloud": released from contained shapes and used as a soft environmental glow behind or around content. Clouds may extend the spectrum slightly with hints of complementary purples and yellows.
- **G4.** Diagonal slash accents in the gradient are a signature flourish for framing and energy. Use sparingly (one per composition).

### 7.3 Typography

One typeface family carries everything, in three weights. Character comes from weight, case, and scale, never from mixing families. The one exception is code: code samples and code-adjacent labels (diagram captions naming files, requests, or identifiers) may use the monospace stack.

- **T1.** Display headlines come in two sanctioned modes. **Attitudinal:** bold, uppercase, tight tracking (about -0.04em), tight leading (about 80% of font size); for short, punchy brand messaging. **Statement:** semibold or bold, sentence case, often gradient-filled per T6; for calm, confident claims (the home hero uses this mode). Pick one mode per composition; don't mix them in the same headline block.
- **T2.** Subheadlines: **light, lowercase**. Relaxed and human, the counterpoint to a display headline.
- **T3.** Titles and inline headings: regular or semibold weight, sentence case, normal tracking.
- **T4.** Body: regular weight, sentence case, comfortable leading.
- **T5.** Never jumble upper and lower case within a word, never mix cased and uncased words within a sentence set in a display style, and never mix colors, weights, or fonts within a single word.
- **T6.** Type color stays within the palette: ink, greys, or white on dark. Magenta text is permissible as an accent. **Orange text never** (C3). Gradient-filled display text is the one exception where both colors appear in type, and it follows G1.
- **T7.** Overline micro-labels (nav section headings, group labels, column headers): small size (10-12px), bold or semibold, uppercase, **wide** tracking (0.04em to 0.1em), muted color. This is the only uppercase style with positive tracking; it marks structure, never content. Body-size-and-up uppercase stays in T1 attitudinal territory.

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

- **M1.** Motion is artistic craftsmanship with an innate sense of personality: springy, organic, alive. Prefer soft spring easing over linear or mechanical curves; reach for the shared `--spring-soft` token first, and use a bespoke curve only where a composition needs its own character.
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
| G3 cloud | Utility `bg-brand-cloud` (three diffuse radial glows: orange, magenta, purple hint); the purple hint is tokened as `--color-brand-violet` |
| T1-T4 type | `--font-sans`: Selawik (the shipped open-license face), weights 300 (light), 400 (regular), 600/700 (bold display) |
| A1 accessible accent | `--accent` / `--accent-hover` / `--accent-foreground`: magenta-600/700 on light, brightened magenta on dark; focus ring `--ring` |
| A2 theming | Tokens flip via `prefers-color-scheme` and `:root[data-theme]`; keep both blocks in sync |
| A2 status/priority color | `--priority-*` and `--status-*` tokens (per-mode values) for the demo's category stripes and dots; never raw hex in components |
| A3 paired badges | `badge-*` utilities set surface and foreground together |
| M1 spring motion | `--spring-soft` easing + `--spring-duration`; zeroed under reduced motion |
| S2 elevation | `shadow-card` for cards, `shadow-subtle` for hairline lift, `--shadow-lifted` for drag states; all token-driven and mode-flipped, instead of drawn borders or inline rgba shadows |

When a new visual need has no token, extend `root.css` following these patterns (semantic token, both modes, AA-checked) rather than hardcoding values in a component.

## 10. Checklist

Before shipping visual or copy work, verify:

- [ ] Vivid color is a minority accent: gradient under ~8% of the composition, background neutral dominant (C1, C2)
- [ ] Orange never appears alone; gradient reads orange to magenta, left-to-right, upward, or rising diagonal (C3, G1)
- [ ] One focal point; whitespace generous; borders implied where possible (S1-S3)
- [ ] Display type uses one sanctioned mode; no mixed case/weight/color within a word; no orange text; micro-labels are the only wide-tracked uppercase (T1-T7)
- [ ] Patterns and texture stay in the background, small and quiet (P1)
- [ ] Motion is springy, brief, purposeful, and disabled under reduced motion (M1-M3, A6)
- [ ] AA contrast verified in **both** light and dark modes; tokens used, no raw hex in components (A1, A2)
- [ ] Colored surfaces pair their own foreground; gradient overlays use fixed ink/white (A3, A4)
- [ ] Copy passes the voice test: friendly, direct, active, no jargon, no shouting, no boasting (Sections 5-6)
- [ ] No source brand names anywhere (A7)
