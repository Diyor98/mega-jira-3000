# UX Style Guide — Mega Jira 3000

## Platform Priority

**Web app first.** Desktop browser is the primary target. Responsive design for tablet is secondary. Mobile is tertiary and deferred.

## Design Philosophy: "Asana-Prime" Architecture

### Hierarchy of Influence

1. **Primary (Foundation): Asana** — Prioritize information density and operational speed. Every pixel must serve a function. If a layout can hold more data without losing legibility, do it.
2. **Secondary (Structure): Anytype** — Block-based modular logic. Every UI element feels like an independent, reusable object with clear physical boundaries and logical weight.
3. **Tertiary (Atmosphere): Spotify** — Tonal depth and subtle elevation (shadows/z-axis) only to distinguish layers of information, not for decoration.

### Visual Constraints ("Zero-Fluff" Filter)

- **Typography as Architecture:** The UI is 90% text. Use a tight, rhythmic type scale. Eliminate redundant icons; let typography and hierarchy guide the eye.
- **Functional Stoicism:** Reject all "Dribbble-style" trends. No oversized border radii, no vibrant gradients, no unnecessary whitespace "for breathing." If a component looks like eye candy but slows down a power user, discard it.
- **High-Density Clarity:** Focus on table/list view logic. Optimize for vertical scanning and multi-level navigation.

### Design Principles

- **Rational Minimalism:** Every element must justify its existence.
- **The "Why" Protocol:** Challenge illogical requirements. Demand clarity before production.
- **Practical Stoicism:** Clarity and utility over vanity.
- **Accessibility:** WCAG 2.1 AA standards as baseline — keyboard navigation, screen reader compatibility, 4.5:1 contrast ratio.

### Autonomous Execution Protocol

- **Extrapolate, Don't Ask:** If a specific stylistic value (HEX, spacing, radius) is missing, derive it from Asana-first logic. Choose the most utilitarian option.
- **Logic-Driven Design:** Every stylistic choice must be justifiable by its impact on user focus and mental clarity.

### Technical Standards

- **Framework:** Tailwind CSS (Utility-First)
- **Component Architecture:** Atomic Design (atoms → molecules → organisms → templates → pages)
- **Responsive Strategy:** Web-first, desktop breakpoint as default. Responsive down to tablet. Mobile deferred.
