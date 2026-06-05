// Animated explainer for useSafeArea. A "bottom" placement (the buildSafePolygon
// 'bottom' case): the trigger sits above the floating element with a gap, and the
// safe corridor is the trapezoid joining the trigger's bottom edge to the floating
// element's top edge. One pointer dot loops diagonally through the corridor (stays
// open); a second veers out through the corridor's slanted edge (closes). Geometry
// is in SVG attributes; all color, stroke, and motion live in root.css (.sa-*), so
// the figure follows the page theme and stops animating under prefers-reduced-motion.
export function SafeAreaDiagram() {
  return (
    <figure class="docs-safe-area">
      <svg
        class="sa"
        viewBox="0 0 360 200"
        role="img"
        aria-label="A trigger above a floating element, joined by a trapezoidal safe corridor. A pointer moving diagonally through the corridor keeps the element open; a pointer that leaves the corridor through its side closes it."
      >
        <defs>
          <marker
            id="sa-arrow-open"
            markerWidth="7"
            markerHeight="7"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path
              class="sa-arrowhead sa-arrowhead--open"
              d="M0,0 L6,3 L0,6 Z"
            />
          </marker>
          <marker
            id="sa-arrow-close"
            markerWidth="7"
            markerHeight="7"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path
              class="sa-arrowhead sa-arrowhead--close"
              d="M0,0 L6,3 L0,6 Z"
            />
          </marker>
        </defs>

        {/* The safe corridor: trigger bottom edge -> floating top edge. */}
        <polygon class="sa-corridor" points="140,52 220,52 264,116 96,116" />

        {/* Trigger. */}
        <rect class="sa-box" x="140" y="20" width="80" height="32" rx="6" />
        <text class="sa-label" x="180" y="40">
          Trigger
        </text>

        {/* Floating element. */}
        <rect class="sa-box" x="96" y="116" width="168" height="64" rx="8" />
        <text class="sa-label" x="180" y="152">
          Floating element
        </text>

        {/* Direction tracks (visible statically so the figure reads without motion). */}
        <line
          class="sa-track sa-track--open"
          x1="190"
          y1="52"
          x2="140"
          y2="130"
        />
        <line
          class="sa-track sa-track--close"
          x1="190"
          y1="52"
          x2="270"
          y2="104"
        />

        {/* Where the closing path crosses out of the corridor. */}
        <g class="sa-x" aria-hidden="true">
          <line x1="238" y1="81" x2="250" y2="93" />
          <line x1="250" y1="81" x2="238" y2="93" />
        </g>

        {/* Pointer dots. */}
        <circle class="sa-dot sa-dot--open" r="6" />
        <circle class="sa-dot sa-dot--close" r="6" />
      </svg>

      <figcaption class="sa-legend">
        <span class="sa-legend__item">
          <span
            class="sa-legend__dot sa-legend__dot--open"
            aria-hidden="true"
          />
          Through the corridor: stays open
        </span>
        <span class="sa-legend__item">
          <span
            class="sa-legend__dot sa-legend__dot--close"
            aria-hidden="true"
          />
          Out of the corridor: closes
        </span>
      </figcaption>
    </figure>
  );
}
