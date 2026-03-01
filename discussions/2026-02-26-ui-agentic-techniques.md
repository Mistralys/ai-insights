# Research Report: UI Development Techniques for Agentic Coding

**Date:** 2026-02-26
**Last updated:** 2026-02-26 (enriched with web research)
**Status:** Complete
**Scope:** UI frameworks, scheduling libraries, and agentic coding techniques for building a sports club booking planner

---

## Executive Summary

Building complex UI through agentic coding (LLM-assisted development) exposes a fundamental gap: LLMs operate on text but UI is inherently visual. This research investigates how to bridge that gap for a sports club booking/planner system.

**Key findings:**

1. **shadcn/ui + Tailwind CSS is the optimal UI framework** for agentic coding. It has the highest LLM comprehension of any modern component library due to its copy-paste component model, widespread training data presence, and utility-class approach that is fully describable in text. As of August 2025, shadcn/ui ships an official MCP server and CLI 3.0 with namespaced registries, giving AI assistants direct programmatic access to discover, preview, and install components.

2. **FullCalendar remains the strongest scheduling library**, with the most mature resource scheduling features needed for court/field booking. FullCalendar v8 (Q4 2025) and v9 (Q1 2026) introduce composable React components, infinite scroll, and improved TypeScript definitions. However, its complexity makes it harder for LLMs to work with. A hybrid approach -- FullCalendar for the core scheduler with shadcn/ui for surrounding UI -- balances capability with LLM-friendliness. **ScheduleX** has matured significantly since 2024 and now offers resource scheduling with infinite scroll, though its LLM training data presence remains limited.

3. **Component-driven development with Storybook** is the single most impactful technique for agentic UI coding. Storybook v9 (released July 2025) adds built-in visual testing, a Vitest partnership ("Storybook Test"), and a watch mode. The upcoming **Storybook MCP** server will expose component metadata and patterns directly to AI agents, enabling autonomous self-healing loops where agents run tests, see failures, and fix their own bugs.

4. **Visual verification has improved significantly.** The **Playwright MCP Server** (`@playwright/mcp` on npm, by Microsoft, launched March 2025) uses accessibility tree snapshots instead of screenshots -- 2-5KB of structured data that is 10-100x faster than pixel-based approaches. **Percy's AI Visual Review Agent** (late 2025) reduces review time by 3x and filters 40% of false positives. These tools are closing the visual feedback loop that was previously the weakest link.

5. **TypeScript with strict typing and constrained component APIs** dramatically improves LLM accuracy. The more constrained the design space, the more predictable LLM output becomes.

6. **Tailwind CSS v4 introduces a breaking paradigm shift** -- CSS-first configuration via `@theme` blocks instead of `tailwind.config.js`. LLMs trained before v4 (January 2025) will generate v3-style configuration by default. Projects must provide v4-specific context (via CLAUDE.md rules, llms.txt files, or Storybook MCP) to ensure correct code generation.

7. **Spec-driven development (SDD) has emerged as a key methodology** for agentic UI coding. Writing structured specifications (requirements, design docs, task breakdowns) before implementation, combined with project rules files (CLAUDE.md), dramatically improves LLM output quality.

---

## Problem Statement

A developer is building a web-based booking system for a sports club and needs to construct a complex planner UI using agentic coding tools (Claude Code, Cursor, GitHub Copilot, etc.). The core challenge is that LLMs cannot see the rendered output of the code they generate, making iterative UI development unreliable. The developer's hypothesis is that a well-established UI framework can serve as a shared "UI language" between human and LLM.

## Problem Decomposition

1. **Framework selection**: Which UI framework maximizes LLM comprehension and output predictability?
2. **Scheduling component**: Which calendar/scheduler library best fits a sports booking use case while remaining LLM-accessible?
3. **Development methodology**: What workflow and tooling patterns make agentic UI development reliable?
4. **Visual verification**: How can LLM-generated UI be verified for correctness without manual inspection?
5. **Stack integration**: How do these choices compose into a coherent, practical tech stack?

## Context & Constraints

- The target application is a sports club booking planner (court/field reservations, time slots, resource management)
- Development is primarily agentic (LLM-assisted), meaning the LLM needs to understand and correctly modify UI code
- The UI is complex: calendar views, drag-and-drop scheduling, resource columns, time grids
- The developer needs to describe desired UI changes in natural language and get correct results
- Budget and timeline favor leveraging existing component libraries over building from scratch

---

## 1. UI Frameworks as a Shared Language for Agentic Coding

### Assessment Criteria

For agentic coding, a UI framework must excel on three axes:
- **Training data prevalence**: How much of the LLM's training data includes this framework?
- **Textual describability**: Can the framework's output be fully specified in text without visual ambiguity?
- **Predictability**: Does a given description map to one obvious implementation, or are there many ways to achieve the same result?

### Framework Analysis

#### Bootstrap

- **Description:** The most widely used CSS framework, based on predefined classes and a grid system. Version 5 dropped jQuery dependency.
- **Training data prevalence:** Extremely high. Bootstrap has been the dominant CSS framework since 2012. LLMs have vast amounts of Bootstrap code in their training data.
- **Textual describability:** Good. Class names like `btn btn-primary`, `col-md-6`, `card` are self-documenting. The grid system is straightforward to describe.
- **Predictability:** High for basic layouts. Bootstrap's opinionated defaults mean there is usually one "Bootstrap way" to build something.
- **Strengths:**
  - Massive training data means LLMs rarely hallucinate Bootstrap APIs
  - Comprehensive documentation that LLMs have internalized
  - Responsive grid system is easy to describe ("3-column layout on desktop, single column on mobile")
  - Component library covers most common UI patterns
- **Weaknesses:**
  - Looks dated without significant customization ("Bootstrap look")
  - Heavy override burden for custom designs
  - Not component-model friendly (class-based, not component-based)
  - Poor TypeScript support in vanilla form
  - React-Bootstrap and reactstrap exist but are less frequently in training data
- **Fit for this project:** Moderate. Good LLM comprehension but poor fit for complex interactive UIs like schedulers. Lacks the component model that modern React applications expect.

#### Tailwind CSS

- **Description:** Utility-first CSS framework. Instead of predefined components, it provides low-level utility classes that compose to build any design.
- **Current version:** v4.0 (released January 2025). Major architectural overhaul from v3.
- **Training data prevalence:** Very high for v3. **Caution: v4 introduces breaking changes** that most LLMs (trained before January 2025) do not yet know about. See section 1a below for v4-specific guidance.
- **Textual describability:** Excellent. Every visual property maps to a specific utility class. `bg-blue-500 text-white px-4 py-2 rounded-lg` fully describes a button's appearance. There is zero ambiguity.
- **Predictability:** Mixed. Tailwind is low-level, so there are many ways to achieve the same visual result. However, common patterns are well-established, and LLMs tend to converge on idiomatic Tailwind.
- **Strengths:**
  - Perfect text-to-visual mapping -- every class has a single, predictable effect
  - No cascade issues or specificity wars
  - Highly customizable via config (design tokens map cleanly)
  - Dominant in the modern React ecosystem, massive training data
  - Works with any component model
  - v4: Full builds 3.78x faster, incremental builds up to 182x faster
  - v4: Automatic content detection (no more `content` array in config)
  - v4: Built-in container queries, 3D transforms, enhanced gradient APIs
  - v4: Native CSS theme variables exposed as custom properties
- **Weaknesses:**
  - No pre-built components -- you build everything from primitives
  - Verbose class strings can get long and hard to review
  - Requires a component library on top for productivity
  - Design consistency requires discipline or a design system layer
  - **v4 migration risk for LLMs** (see section 1a)
- **Fit for this project:** High as a styling layer, but needs a component library on top.

#### 1a. Tailwind CSS v4: Critical Considerations for Agentic Coding

Tailwind CSS v4 (released January 2025) is a significant architectural overhaul that **breaks LLM assumptions** trained on v3 patterns. Key changes:

| Aspect | v3 (LLM default) | v4 (current) |
|--------|-------------------|--------------|
| **Configuration** | `tailwind.config.js` (JavaScript) | CSS `@theme` block |
| **CSS import** | `@tailwind base/components/utilities` | Single `@import "tailwindcss"` |
| **Content setup** | Manual `content: []` array | Automatic detection |
| **Colors** | sRGB palette | Wide-gamut P3 oklch palette |
| **Container queries** | Plugin required | Built-in |
| **Dynamic utilities** | Limited, required config | Native support (e.g., `grid-cols-15` works without config) |
| **Setup** | Multi-step with config file | One-line CSS: `@import "tailwindcss"` |

**Impact on LLM coding:**
- LLMs will generate `tailwind.config.js` files by default -- these still work (v4 has backwards compatibility) but are not the idiomatic approach
- LLMs may use `@tailwind base; @tailwind components; @tailwind utilities;` directives instead of `@import "tailwindcss"`
- Custom color definitions should use `@theme` blocks in CSS, not JavaScript config
- Community members have created LLM-optimized documentation resources (llms.txt files, Tailwind v4 info docs) to help AI tools understand v4 syntax

**Mitigation strategies:**
1. Include Tailwind v4 configuration examples in your CLAUDE.md or project rules
2. Use the community-created `tailwind-llms` resource or similar llms.txt files for context
3. Provide a working `app.css` with `@theme` block as a reference for the LLM
4. Consider using v3-compatible `tailwind.config.js` if LLM accuracy is a higher priority than idiomatic v4 (backwards compatibility is supported)

**Sources:**
- [Tailwind CSS v4.0 announcement](https://tailwindcss.com/blog/tailwindcss-v4)
- [Tailwind v4 LLM compatibility discussion](https://github.com/tailwindlabs/tailwindcss/discussions/14677)
- [Tailwind v4 as "Archenemy of Claude 3.7 Sonnet"](https://medium.com/@dpzhcmy/tailwind-css-v4-the-archenemy-of-claude-3-7-sonnet-209ce7470f76)

#### shadcn/ui

- **Description:** A collection of re-usable React components built on Radix UI primitives and styled with Tailwind CSS. Uniquely, components are copied into your project (not installed as a dependency), giving full ownership and customizability.
- **Current version:** CLI 3.0 (August 2025). Includes MCP server and namespaced registries.
- **Training data prevalence:** High and rapidly growing. shadcn/ui became the dominant React component library in 2023-2024. It is the default component library for Next.js scaffolding and has extensive presence in LLM training data. Claude and GPT-4 both have strong familiarity.
- **Textual describability:** Excellent. Components have clear, semantic names (`<Button>`, `<Card>`, `<Dialog>`, `<Table>`) and use Tailwind for styling, so both the component structure and the visual appearance are fully describable in text.
- **Predictability:** Very high. The component API is constrained (limited props, clear variants), and the Tailwind styling eliminates CSS ambiguity.
- **Strengths:**
  - Components live in your codebase -- LLMs can read and modify them directly
  - Built on Radix UI, which handles accessibility and complex interactions correctly
  - Tailwind styling means visual changes are fully describable
  - Strong TypeScript support with strict prop types
  - Rapidly became a de facto standard; extensive LLM training data
  - CLI tool (`npx shadcn@latest add <component>`) for easy component installation
  - Active community and ecosystem (shadcn/ui charts, tables, etc.)
  - **NEW: Official MCP server** -- AI assistants can programmatically browse, search, and install components from any configured registry
  - **NEW: Namespaced registries** (`@registry/name` format) for community, company, and private component registries
  - **NEW: LLM API endpoint** (`/llm/` route) that transforms documentation into AI-consumable markdown with actual source code instead of previews
  - **NEW: DocsCopyPage component** with one-click integration to v0.dev, ChatGPT, Claude, and Scira
  - **NEW: 25+ AI/conversational UI components** via Vercel AI Elements library built on shadcn/ui
- **Weaknesses:**
  - React-only (no Vue/Angular/Svelte variants, though ports exist)
  - Copy-paste model means manual updates when upstream changes
  - No built-in calendar/scheduler component complex enough for booking systems
  - Tailwind v4 migration may require updating copied components
- **Fit for this project:** Excellent for all non-scheduler UI. The ideal "shell" framework. The MCP server integration makes it the most AI-native component library available.

**Sources:**
- [shadcn/ui MCP Server docs](https://ui.shadcn.com/docs/mcp)
- [shadcn CLI 3.0 and MCP Server changelog](https://ui.shadcn.com/docs/changelog/2025-08-cli-3-mcp)
- [shadcn/ui AI Integration and LLM API (DeepWiki)](https://deepwiki.com/shadcn-ui/ui/8.3-ai-integration-and-llm-api)
- [Vercel AI Elements](https://github.com/vercel/ai-elements)

#### Material UI (MUI)

- **Description:** React component library implementing Google's Material Design. The most popular React component library by npm downloads.
- **Training data prevalence:** Very high. MUI has been the leading React component library for years with billions of npm downloads.
- **Textual describability:** Good. Component names are semantic (`<TextField>`, `<DataGrid>`, `<Drawer>`). However, the `sx` prop and theme system add complexity.
- **Predictability:** Moderate. MUI has multiple styling approaches (sx prop, styled(), makeStyles legacy, theme overrides), and LLMs sometimes mix them or use deprecated patterns.
- **Strengths:**
  - Comprehensive component library (250+ components in MUI X)
  - MUI X includes a DateTimePicker and Scheduler (commercial license)
  - Excellent TypeScript support
  - Strong documentation that LLMs have internalized
  - Design consistency out of the box
- **Weaknesses:**
  - Heavy bundle size
  - Multiple styling paradigms cause LLM confusion (sx vs styled vs theme)
  - Material Design aesthetic is distinctive -- hard to make it look "not Material"
  - MUI X scheduler/date components require commercial license for advanced features
  - Complex theme customization that LLMs sometimes get wrong
- **Fit for this project:** Good if Material Design aesthetic is acceptable. MUI X Scheduler could be relevant, but the commercial license and complexity are drawbacks.

#### Ant Design

- **Description:** Enterprise-grade React component library from Alibaba. Includes extensive data display components.
- **Training data prevalence:** High globally, especially strong in Chinese-language training data. Good but not dominant in English-language codebases.
- **Textual describability:** Good. Semantic component names and props.
- **Predictability:** Moderate. Ant Design has gone through multiple major versions (v4 to v5 migration was significant), and LLMs sometimes generate code for the wrong version.
- **Strengths:**
  - ProComponents library includes a Scheduler/Calendar
  - Extremely comprehensive (table, form, layout components)
  - Good TypeScript support
  - Strong for data-heavy enterprise UIs
- **Weaknesses:**
  - LLMs frequently mix v4 and v5 APIs
  - Heavy bundle size
  - Customization can be complex (CSS-in-JS in v5)
  - Documentation is sometimes primarily in Chinese
  - Opinionated aesthetic that is hard to override
- **Fit for this project:** Moderate. Strong component library but version confusion is a real risk with LLM coding.

#### Radix UI (Headless)

- **Description:** Unstyled, accessible React component primitives. The foundation underneath shadcn/ui.
- **Training data prevalence:** Moderate. Radix is well-known but less frequently used directly (most use it via shadcn/ui).
- **Textual describability:** Limited for visual aspects since components are unstyled.
- **Strengths:** Perfect accessibility, composable primitives, no styling opinions
- **Weaknesses:** Requires styling from scratch; not useful alone for rapid UI development
- **Fit for this project:** Used indirectly through shadcn/ui, not recommended as standalone.

### Framework Comparison for Agentic Coding

| Criterion | Bootstrap | Tailwind CSS | shadcn/ui | MUI | Ant Design |
|-----------|-----------|-------------|-----------|-----|------------|
| **LLM training data** | Very High | Very High (v3) / Growing (v4) | High | Very High | High |
| **Textual describability** | Good | Excellent | Excellent | Good | Good |
| **Output predictability** | High | Medium | Very High | Medium | Medium |
| **Component richness** | Medium | None (utility) | Medium | Very High | Very High |
| **TypeScript quality** | Low | N/A | Excellent | Excellent | Good |
| **Customizability** | Low | Very High | Very High | Medium | Medium |
| **Version confusion risk** | Medium (v4/v5) | **High (v3/v4)** | Low | Medium | High (v4/v5) |
| **Modern React fit** | Low | High | Very High | High | High |
| **AI/MCP integration** | None | None | **Excellent (MCP server)** | None | None |

### Verdict on Frameworks

**shadcn/ui + Tailwind CSS is the strongest choice for agentic coding.** The combination provides:
- A constrained component API that LLMs can reason about precisely
- Utility-class styling that eliminates visual ambiguity in text
- Components that live in the codebase and are directly readable/modifiable by LLMs
- Strong TypeScript types that catch LLM errors at compile time
- **An official MCP server** that gives AI assistants direct access to the component registry
- **An LLM API endpoint** that serves documentation as AI-consumable markdown with source code

**Important caveat on Tailwind v4:** Teams must decide whether to use idiomatic v4 (CSS-first config) or stick with v3-compatible JavaScript config. For maximum LLM reliability today, using the backwards-compatible `tailwind.config.js` approach while providing v4-specific examples in project context files is a pragmatic middle ground.

Bootstrap is a reasonable fallback if the team prefers familiarity over modernity, but it sacrifices the component model and TypeScript benefits that make agentic coding more reliable.

---

## 1b. v0.dev by Vercel: AI-Powered UI Generation

**v0.dev** is Vercel's AI-powered application building agent that generates React code using shadcn/ui and Tailwind CSS from natural language prompts. It is particularly relevant to this project because it validates the shadcn/ui + Tailwind choice.

**Key capabilities (as of 2025-2026):**
- Generates production-ready React components from text prompts
- Trained specifically on React, Tailwind CSS, and shadcn/ui best practices
- Automatically uses shadcn/ui components in generated output
- Supports custom design systems (custom Tailwind configs, globals.css, CSS variables)
- Model variants: v0-1.0-md and v0-1.5-lg with context limits up to 512,000 tokens
- Uses a composite approach: retrieval for grounding, frontier LLM for reasoning, and "AutoFix" streaming post-processor for error detection
- Integrated "Open in v0" feature directly in shadcn/ui documentation

**Strengths for agentic coding:**
- Strongest at standard, repeatable UI patterns: navigation bars, hero sections, dashboards, sidebars, cards, CRUD forms
- Can generate initial component scaffolds that are then refined with Claude Code or Cursor
- Design system support means generated code matches project conventions

**Limitations:**
- Struggles with complex state logic -- authentication flows, multi-step forms, data fetching still need manual work
- Not suitable for generating scheduling/calendar UIs (too specialized)
- Cloud-only service; generated code must be copied into the project

**Fit for this project:** Useful as a scaffolding tool for standard UI pages (settings pages, admin dashboards, booking forms) but not for the core scheduler component. Best used in a pipeline: v0 generates initial layout, Claude Code/Cursor refines and adds logic.

**Sources:**
- [v0.dev](https://v0.app/)
- [Open in v0 - shadcn/ui](https://ui.shadcn.com/docs/v0)
- [Vercel v0 Review 2025](https://skywork.ai/blog/vercel-v0-review-2025-ai-ui-code-generation-nextjs/)
- [v0 Design Systems docs](https://v0.app/docs/design-systems)

---

## 2. Component Libraries for Scheduling/Planner UIs

### Requirements for a Sports Club Booking System

- **Resource view**: Show courts/fields as columns or rows, time as the other axis
- **Time grid**: 30-minute or 1-hour slots
- **Drag-and-drop**: Create and move bookings by dragging
- **Multi-day views**: Day, week, month views
- **Event overlap handling**: Show conflicting bookings
- **Resource filtering**: Filter by court type, availability
- **Mobile responsiveness**: Usable on phones for quick bookings
- **Customizable appearance**: Match the application's design system

### Library Analysis

#### FullCalendar

- **Description:** The most mature and feature-rich JavaScript calendar library. Available for vanilla JS, React, Vue, Angular. Premium plugins add resource scheduling, timeline views, and drag-and-drop.
- **Current version:** v6.1.20 (stable). v8 planned Q4 2025, v9 planned Q1 2026.
- **npm weekly downloads:** ~1,000,000+ (as of 2025, over 19,000 GitHub stars)
- **License:** MIT for core; premium plugins (Resource Timeline, Resource DayGrid) require commercial license ($480/developer, $720/2 devs, $1560/5 devs, $2400/10 devs).
- **LLM comprehension:** High. FullCalendar has been around since 2009 and has extensive documentation, blog posts, and StackOverflow answers in LLM training data. The React wrapper (`@fullcalendar/react`) is well-understood. **Caution:** LLMs may generate v5 patterns; ensure v6 is specified in project context.
- **Strengths:**
  - Resource Timeline view is purpose-built for booking systems (resources as rows, time as columns)
  - Mature drag-and-drop with snapping to time slots
  - Extensive event model (recurring events, all-day events, timed events)
  - Good React integration
  - Active maintenance and regular releases
  - Extensive plugin ecosystem
  - **v8 roadmap:** Infinite scroll for all views, resource pagination, Hijri/Jalaali calendar systems, improved TypeScript definitions, internal data refactor to leverage React state
  - **v9 roadmap:** Composable React components (`<Toolbar>`, `<MonthView>`), swipe/sliding navigation, advanced accessibility (roving tab index)
- **Weaknesses:**
  - Premium plugins required for resource scheduling (the key feature for this use case)
  - Complex configuration -- many options, which can confuse LLMs
  - Styling customization requires CSS overrides that can be brittle
  - Bundle size can be large when all plugins are loaded
  - The plugin architecture (import-based) sometimes confuses LLMs about which packages to install
  - v5/v6 version confusion in LLM output
- **Fit for this project:** Excellent for functionality, but requires commercial license for resource features. LLMs handle basic FullCalendar well but may struggle with advanced resource configuration. The v9 composable components (when released) will significantly improve React integration and LLM predictability.

**Sources:**
- [FullCalendar Roadmap](https://fullcalendar.io/roadmap)
- [FullCalendar Pricing](https://fullcalendar.io/pricing)
- [Best React Scheduler Components comparison (DHTMLX)](https://dhtmlx.com/blog/best-react-scheduler-components-dhtmlx-bryntum-syncfusion-daypilot-fullcalendar/)

#### react-big-calendar

- **Description:** Open-source React calendar component inspired by Google Calendar. MIT licensed.
- **npm weekly downloads:** ~300,000+ (as of early 2025)
- **License:** MIT (fully free)
- **LLM comprehension:** Good. Well-represented in training data. Simpler API than FullCalendar.
- **Strengths:**
  - Fully open source, no premium features behind paywall
  - Simpler API than FullCalendar -- easier for LLMs to generate correctly
  - Good React integration (pure React component)
  - Day, week, month, agenda views
  - Drag-and-drop support
  - Localizable with moment.js, date-fns, or luxon
- **Weaknesses:**
  - No built-in resource view (the critical feature for booking systems)
  - Resource view requires significant custom implementation
  - Less active maintenance than FullCalendar
  - Styling requires CSS that LLMs may not handle well
  - Documentation is sparse compared to FullCalendar
- **Fit for this project:** Poor for a booking system. The lack of resource views is a dealbreaker unless significant custom development is acceptable.

#### ScheduleX

- **Description:** Modern, lightweight calendar/scheduler library. Framework-agnostic with React, Vue, and Svelte adapters. Uses reactive Signal objects for real-time configuration updates.
- **Current status:** Actively maintained, with significant updates through 2025-2026.
- **License:** MIT for core; premium plugins for resource scheduling, drag-and-drop event creation, and event modal.
- **LLM comprehension:** Low to Moderate. ScheduleX is relatively new (2024) and unlikely to be well-represented in LLM training data. However, its API is clean and well-documented, making it feasible to provide documentation as context.
- **Strengths:**
  - Modern architecture, small bundle size
  - Clean API design with reactive Signal-based configuration
  - Framework-agnostic core
  - **Resource scheduler now available** with hourly and daily views
  - **Infinite scroll and lazy loading** for handling large datasets
  - Drag-and-drop with configurable snapping
  - Event resizing support
  - Interactive modal for adding, editing, and deleting events
  - Outlook-inspired scheduling assistant
  - Configurable sizing: `hourWidth`, `dayWidth`, `resourceHeight`, `eventHeight`
  - Hierarchical resource nesting with custom color definitions
  - Light and dark theme support
- **Weaknesses:**
  - Premium features required for resource scheduling (the `@sx-premium/resource-scheduler` package)
  - Smaller community and ecosystem than FullCalendar
  - Limited LLM training data -- requires extensive context provision
  - Less battle-tested than FullCalendar for complex booking scenarios
  - Documentation, while clean, is less comprehensive than FullCalendar's
- **Fit for this project:** A viable alternative to FullCalendar, especially if the modern API and smaller bundle size are priorities. The resource scheduler has matured significantly. However, the low LLM familiarity means more manual guidance will be needed during agentic coding. Best suited for teams willing to provide ScheduleX documentation as context to their LLM tools.

**Sources:**
- [ScheduleX Resource Scheduler docs](https://schedule-x.dev/docs/calendar/resource-scheduler)
- [ScheduleX Premium features](https://schedule-x.dev/premium)
- [ScheduleX GitHub](https://github.com/schedule-x)

#### Bryntum Scheduler

- **Description:** Commercial JavaScript scheduler with an official React wrapper. One of the most feature-rich scheduling libraries available.
- **License:** Subscription-based commercial license (separate OEM license for commercial apps). More expensive than FullCalendar.
- **LLM comprehension:** Low to Moderate. Less common in open-source training data than FullCalendar.
- **Strengths:**
  - Best-in-class feature set: advanced filtering, dependencies, histogram summaries, vertical mode
  - Full access to API via React props
  - Professional UI, extensive demos and documentation
  - Strong performance benchmarks
- **Weaknesses:**
  - Commercial-only with subscription pricing (significantly more expensive than FullCalendar)
  - Smaller community; less LLM training data
  - Overkill for a sports club booking system
- **Fit for this project:** Not recommended. The cost and complexity exceed what a sports club booking system requires. FullCalendar provides sufficient features at lower cost.

**Source:** [Bryntum Scheduler](https://bryntum.com/blog/the-best-javascript-scheduler-components/)

#### DHTMLX Scheduler

- **Description:** Part of the DHTMLX suite. Standard edition is free and open-source; PRO edition has extra features.
- **License:** Standard: free/open-source. PRO: commercial license with 30-day trial.
- **LLM comprehension:** Moderate. Has been around for years but less popular than FullCalendar in React ecosystems.
- **Strengths:**
  - Free Standard edition with basic scheduling features
  - More feature-rich than react-big-calendar in the free tier
  - Part of a larger component suite
- **Weaknesses:**
  - Advanced features require PRO license
  - Less React-native than FullCalendar
  - Documentation quality varies
- **Fit for this project:** A possible budget-friendly alternative if FullCalendar's premium license is unacceptable, but with less React integration and LLM familiarity.

**Source:** [DHTMLX Scheduler comparison](https://dhtmlx.com/blog/best-react-scheduler-components-dhtmlx-bryntum-syncfusion-daypilot-fullcalendar/)

#### Cal.com Atoms (Booking-Specific)

- **Description:** Cal.com is open-source scheduling infrastructure. Cal Atoms are modular React components for building booking flows. The Cal Booker Atom is a fully customizable booking UI.
- **License:** Open source (various licenses depending on component).
- **LLM comprehension:** Low for Atoms specifically, but Cal.com itself is well-known.
- **Strengths:**
  - Purpose-built for booking flows (connect calendars, set availabilities, collect guest info, schedule appointments)
  - Open-source, modular components
  - Customizable to match any design system
  - Handles calendar integrations (Google, Outlook, Apple) out of the box
  - Production-proven (Cal.com serves millions of bookings)
- **Weaknesses:**
  - Designed for appointment scheduling, not resource/court booking specifically
  - Assumes a Cal.com backend or compatible API
  - Does not provide a resource timeline view (courts as columns/rows)
  - Not a general-purpose scheduler; focused on 1:1 or group booking flows
- **Fit for this project:** Limited. Useful if the booking system needs appointment-style scheduling (e.g., personal training sessions), but not suitable for the core court/resource scheduling view. Could complement FullCalendar for booking form UIs.

**Sources:**
- [Cal.com Platform / Atoms](https://cal.com/platform)
- [Cal.com Open Source Calendar Guide](https://cal.com/blog/the-ultimate-guide-to-open-source-calendar-software-and-scheduler-tools)

#### TUI Calendar (Toast UI Calendar)

- **Description:** Calendar library from NHN (Korean company). Supports monthly, weekly, daily views.
- **License:** MIT
- **LLM comprehension:** Moderate. Has been around since 2018 but less popular than FullCalendar in Western ecosystems.
- **Strengths:**
  - Free and open source
  - Supports task, milestone, and allday schedules
  - Good visual design out of the box
- **Weaknesses:**
  - React wrapper is community-maintained and sometimes lags
  - Limited resource scheduling capabilities
  - Documentation quality is inconsistent
  - Smaller ecosystem than FullCalendar
- **Fit for this project:** Moderate. Lacks the resource view sophistication needed for a booking system.

#### PrimeReact Schedule

- **Description:** Part of the PrimeReact component library. The Schedule component is a wrapper around FullCalendar.
- **License:** MIT (PrimeReact itself), but the underlying FullCalendar premium features still require a license.
- **LLM comprehension:** Moderate for PrimeReact, but since it wraps FullCalendar, the same considerations apply.
- **Strengths:**
  - Integrated with PrimeReact's design system
  - Familiar FullCalendar API underneath
  - Good documentation as part of PrimeReact
- **Weaknesses:**
  - Adds an abstraction layer over FullCalendar, which can confuse LLMs
  - Ties you to the PrimeReact ecosystem
  - Premium FullCalendar features still need separate licensing
- **Fit for this project:** Low advantage over using FullCalendar directly. The abstraction layer adds confusion for LLMs without significant benefit.

#### Custom-built with a grid library (e.g., react-grid-layout, @dnd-kit)

- **Description:** Build a scheduler from scratch using a drag-and-drop library and CSS Grid.
- **LLM comprehension:** High for the individual pieces (CSS Grid, @dnd-kit are well-known), but the composition is complex.
- **Strengths:**
  - Full control over appearance and behavior
  - No licensing concerns
  - Easier to align with shadcn/ui design system
  - Each primitive (grid layout, drag-and-drop, time calculations) is well-understood by LLMs
- **Weaknesses:**
  - Enormous development effort for a production-quality scheduler
  - Edge cases (time zones, recurring events, overlap resolution) are notoriously difficult
  - Not recommended for agentic coding -- too many interacting pieces
  - Performance optimization for large event counts requires expertise
- **Fit for this project:** Not recommended unless requirements are very simple (e.g., a basic day grid with no overlap handling).

### Existing Open-Source Sports Booking Systems (Reference)

Several open-source projects provide reference implementations for sports court booking UIs:

- **ep3-bs** ([GitHub](https://github.com/tkrebs/ep3-bs)): Online booking system for courts (PHP/Zend Framework). Not React-based, but useful for understanding booking domain patterns.
- **courtbooker** ([GitHub](https://github.com/bolu-atx/courtbooker)): Court booking system for tennis courts (React/Create React App). Basic but demonstrates the domain model.
- **tennis-court-reservation-system-v2** ([GitHub](https://github.com/adroste/tennis-court-reservation-system-v2)): Modern, open-source tennis court reservation system (AGPL license).
- **PulsePlay**: Full-stack single-club sports management app with court booking, membership management, and admin dashboards.

These projects can serve as domain references when writing specifications for the LLM, even if the actual implementation uses different technologies.

### Scheduling Library Comparison

| Criterion | FullCalendar | react-big-calendar | ScheduleX | Bryntum | DHTMLX | Custom-built |
|-----------|-------------|-------------------|-----------|---------|--------|-------------|
| **Resource view** | Excellent (premium) | None (manual) | Good (premium) | Excellent | Good (PRO) | Full control |
| **Drag-and-drop** | Excellent | Good | Good (premium) | Excellent | Good | Manual (@dnd-kit) |
| **LLM comprehension** | High | Good | Low | Low-Med | Moderate | Varies |
| **License cost** | $480+/yr | Free | Premium varies | High (subscription) | Free / PRO | Free |
| **Customization** | Medium (CSS overrides) | Medium | Good | Good | Medium | Full |
| **Maintenance status** | Active (v8/v9 roadmap) | Moderate | Active | Active | Active | N/A |
| **Time to productive** | Days | Weeks (no resources) | Days | Days | Days | Months |
| **Design system fit** | Requires CSS work | Requires CSS work | Better | Requires CSS work | Requires CSS work | Perfect |
| **React integration** | Good (v9: composable) | Native | Adapter | Wrapper | Wrapper | Native |

### Verdict on Scheduling Libraries

**FullCalendar with premium plugins is the pragmatic choice.** Despite the licensing cost and CSS customization burden, it is the only library that provides production-ready resource scheduling out of the box with high LLM comprehension. Its high LLM comprehension means agentic coding can handle most configuration tasks. The v9 roadmap (composable React components) will further improve the agentic coding experience.

**ScheduleX is now a credible alternative**, particularly for teams that prioritize modern architecture, smaller bundle size, and cleaner API design. Its resource scheduler has matured with features like infinite scroll, drag-and-drop, and hierarchical resources. The main risk is low LLM familiarity, which requires providing documentation as context.

For the styling gap (making FullCalendar match a shadcn/ui design system), provide the LLM with a CSS override file and explicit design tokens to reference.

---

## 3. Agentic Coding Techniques for UI Development

### 3.1 Component-Driven Development (Highest Impact)

**Description:** Build UI as small, isolated, testable components before composing them into pages.

**Why it helps agentic coding:**
- Small components fit within LLM context windows
- Each component has a clear, describable purpose
- Components can be tested in isolation (unit tests, visual tests, Storybook)
- Changes to one component do not cascade unpredictably
- The LLM can focus on one component at a time

**Recommended practice:**
```
src/
  components/
    ui/          # shadcn/ui base components (Button, Card, Dialog, etc.)
    booking/     # Domain-specific components
      TimeSlot.tsx
      CourtColumn.tsx
      BookingCard.tsx
      BookingDialog.tsx
      WeekNavigator.tsx
    scheduler/   # FullCalendar wrapper and configuration
      SchedulerView.tsx
      SchedulerToolbar.tsx
      resourceConfig.ts
      eventTransformers.ts
  stories/       # Co-located or separate Storybook stories
```

Each component should have:
- A clear TypeScript interface for its props
- A Storybook story showing its visual states
- A brief JSDoc comment describing its purpose and expected appearance

### 3.2 Spec-Driven Development (SDD)

**Description:** An emerging methodology (2025) where structured specifications are the primary development artifact, and code is generated from these specs by AI agents.

**Why it matters for agentic UI coding:**
- Specifications give LLMs clear, unambiguous requirements to work from
- The planning phase (requirements -> design -> tasks) reduces wasted iterations
- Specs serve as persistent context that survives across LLM sessions
- Human review of specs is faster and more reliable than reviewing generated code

**Recommended workflow:**
1. Write a specification document (e.g., `docs/specs/booking-card.md`) describing the component's purpose, props, visual states, and behavior
2. Include wireframe descriptions or reference screenshots
3. Have the LLM generate the implementation from the spec
4. Review generated code against the spec
5. Iterate on the spec if requirements change

**Key tools for SDD:**
- **CLAUDE.md / project rules files**: Encode project conventions, coding standards, and framework preferences so every LLM interaction starts from the same baseline
- **Claude Code Skills**: Reusable slash commands that package UI development instructions (e.g., `/frontend-design` workflow)
- **Subagents**: Dedicated agents for planning, coding, and testing phases

**Sources:**
- [Spec-Driven Development with Claude Code (Agent Factory)](https://agentfactory.panaversity.org/docs/General-Agents-Foundations/spec-driven-development)
- [Thoughtworks: Spec-driven development](https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices)
- [Addy Osmani: My LLM coding workflow going into 2026](https://addyosmani.com/blog/ai-coding-workflow/)

### 3.3 Storybook for Isolated Component Development

**Description:** Storybook renders components in isolation outside the application, allowing individual component development and visual verification.

**Current version:** Storybook v9 (released July 2025).

**Why it helps agentic coding:**
- Each component can be developed and verified independently
- Stories serve as visual documentation that can be described to the LLM
- Storybook's args/controls system maps directly to component props
- Visual regression tools (Chromatic) integrate directly with Storybook
- LLMs understand Storybook story format well (CSF3 format is widely in training data)

**Storybook v9 improvements for agentic coding:**
- **Storybook Test**: Built-in testing partnership with Vitest. Run interaction, accessibility, and visual tests from within Storybook or in CI.
- **Watch mode**: Tests run automatically on file save, tightening the local development feedback loop.
- **Test widget**: Run tests across all stories at once and see status in the sidebar.
- **Built-in visual testing**: No separate addon required for basic visual regression.
- **Flatter dependency structure**: Better performance and easier setup.

**Storybook MCP (upcoming, early access December 2025):**
- Exposes component metadata, usage snippets, and types as machine-readable context to AI agents
- Agents can discover existing patterns before generating new code
- **Autonomous self-healing loop**: Agents run component tests (interaction + accessibility), see failures, and fix bugs without developer intervention
- Benchmarks show: better quality code, faster completion, fewer tokens consumed
- Targets mature React design system teams with CI coverage

**Recommended setup:**
- Use Storybook 9 with the React/Vite builder
- Write stories in CSF3 (Component Story Format 3) -- the format LLMs handle best
- Create stories for every visual state (default, loading, empty, error, filled)
- Use Storybook's `play` function for interaction stories (hover, click, drag)
- Enable Storybook Test for automated testing on save
- Configure Storybook MCP when available for AI agent integration

**Example story structure that LLMs generate well:**
```typescript
// BookingCard.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { BookingCard } from './BookingCard';

const meta: Meta<typeof BookingCard> = {
  component: BookingCard,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof BookingCard>;

export const Default: Story = {
  args: {
    courtName: 'Court 1',
    startTime: '09:00',
    endTime: '10:00',
    playerName: 'John Doe',
    status: 'confirmed',
  },
};

export const Pending: Story = {
  args: {
    ...Default.args,
    status: 'pending',
  },
};
```

**Sources:**
- [Storybook v9 released (InfoQ)](https://www.infoq.com/news/2025/07/storybook-v9-released/)
- [Storybook MCP sneak peek](https://storybook.js.org/blog/storybook-mcp-sneak-peek/)
- [Storybook component testing docs](https://storybook.js.org/docs/writing-tests)

### 3.4 Design Token Systems

**Description:** Define visual properties (colors, spacing, typography, borders) as named tokens rather than raw values.

**Why it helps agentic coding:**
- LLMs can reference tokens by name instead of guessing hex values
- Tailwind CSS config serves as a natural token system
- Changes propagate consistently through the design
- Reduces the "creative" decisions LLMs have to make

**Recommended practice with Tailwind v4:**
```css
/* app.css -- serves as the design token dictionary in v4 */
@import "tailwindcss";

@theme {
  --color-booking-confirmed: oklch(0.65 0.2 145);   /* green */
  --color-booking-pending: oklch(0.75 0.15 85);      /* yellow */
  --color-booking-cancelled: oklch(0.55 0.25 27);    /* red */
  --color-booking-court: oklch(0.6 0.2 250);         /* blue */

  --spacing-slot-height: 3rem;    /* height of a 30-min slot */
  --spacing-court-width: 12rem;   /* width of a court column */
}
```

**Alternative with Tailwind v3-compatible config (better LLM support):**
```javascript
// tailwind.config.js -- serves as the design token dictionary
module.exports = {
  theme: {
    extend: {
      colors: {
        booking: {
          confirmed: '#22c55e',  // green-500
          pending: '#eab308',     // yellow-500
          cancelled: '#ef4444',   // red-500
          court: '#3b82f6',       // blue-500
        },
      },
      spacing: {
        'slot-height': '3rem',    // height of a 30-min slot
        'court-width': '12rem',   // width of a court column
      },
    },
  },
};
```

Then instruct the LLM: "Use `bg-booking-confirmed` for confirmed bookings, `h-slot-height` for time slot height." This eliminates guesswork.

### 3.5 Prompt Engineering Techniques for UI Generation

**Effective patterns:**

1. **Reference existing components:** "Make this look like the BookingCard component but for a different status" -- LLMs handle variations better than novel creation.

2. **Describe layout structurally, not visually:** Instead of "make it look nice," say "use a 2-column grid with the form on the left (col-span-1) and the preview on the right (col-span-1), with a 4px gap."

3. **Provide design tokens in context:** Include the Tailwind config or a design token reference in the prompt context.

4. **Use component API contracts:** "Create a `<TimeSlot>` component with props: `startTime: string`, `endTime: string`, `isAvailable: boolean`, `onBook: () => void`. When `isAvailable` is true, show a green border; when false, show a gray background with reduced opacity."

5. **Reference screenshots or wireframes:** If the tool supports vision (Claude Code does when provided image paths), include a screenshot or wireframe of the desired result.

6. **Constrain the design space:** "Use only shadcn/ui components and Tailwind CSS utility classes. Do not use inline styles or custom CSS."

7. **Use spec files:** Write a markdown specification file describing the component before asking the LLM to implement it. This is the SDD approach described in section 3.2.

### 3.6 TypeScript as a UI Guardrail

**Why TypeScript is critical for agentic UI coding:**
- Strict prop types catch LLM errors at compile time
- Interface definitions serve as documentation the LLM can read
- Generic types for event handlers prevent callback signature mismatches
- Discriminated unions for component states (loading | error | success) prevent impossible states

**Recommended practice:**
- Enable `strict: true` in tsconfig
- Define all component props as explicit interfaces (not inline types)
- Use `React.ComponentPropsWithoutRef<'div'>` for base element props
- Export prop types so LLMs can import and reference them

### 3.7 Figma-to-Code Pipelines

**Description:** Tools like Figma's Dev Mode, Locofy, Anima, or Builder.io can generate code from Figma designs.

**Assessment for agentic coding:**
- These tools generate initial component code, but the output usually requires significant cleanup
- They are most useful for establishing the initial visual structure, after which agentic coding takes over
- The generated code is often not idiomatic for the target framework
- **Not recommended as a primary workflow,** but useful for initial scaffolding of complex layouts
- **v0.dev** (see section 1b) is a more practical alternative for generating shadcn/ui components from descriptions

### 3.8 Monorepo Component Library Pattern

**Description:** Organize shared components in a separate package within a monorepo, with clear exports and documentation.

**Why it helps agentic coding:**
- LLMs can be pointed to a single directory containing all available components
- Clear package boundaries prevent LLMs from creating ad-hoc components
- Barrel exports (index.ts files) give LLMs a manifest of what is available
- Consistent patterns across components make LLM output more predictable

### 3.9 Practitioner Insights: Claude Code and Cursor for UI Development

Based on real-world practitioner experiences documented in 2025-2026:

**Claude Code strengths for UI:**
- Excels with large, complex codebases. At Builder.io, Claude Code successfully updated an 18,000-line React component where no other AI agent could.
- "Gets stuck incredibly rarely" due to the tight integration between Anthropic's models and the tool.
- Terminal-first workflow: Claude becomes the primary interface; developers "only peek at code when reviewing changes."
- Claude Code Skills (Agent Skills) allow packaging UI development instructions into reusable slash commands (e.g., Design -> Craft -> A11y -> Perf workflow).

**Cursor strengths for UI:**
- Best for "vibe coding" -- rapid visual iteration with in-IDE workflow.
- AI-powered completions, diffs, and search in the editor.
- Struggles with extremely large files and complex patch resolution.

**Hybrid approach:**
- Use Claude Code for deep reasoning, complex refactoring, and large file modifications.
- Use Cursor for quick visual iterations, completions, and browsing.
- The Claude Code Cursor extension bridges both worlds.

**Common practitioner advice:**
- "Feed the LLM manageable tasks, not the whole codebase at once" (Addy Osmani)
- Use frequent commits as "save points" for rapid rollback
- Create project-specific rule files (CLAUDE.md) with coding standards
- Treat AI-generated code like junior developer contributions -- always verify
- Start with specs, not code: "AI-augmented software engineering, not AI-automated" (Addy Osmani)

**Sources:**
- [How I use Claude Code (Builder.io)](https://www.builder.io/blog/claude-code)
- [Addy Osmani: My LLM coding workflow going into 2026](https://addyosmani.com/blog/ai-coding-workflow/)
- [Claude Code Skills: UI Skills workflow](https://dev.to/blamsa0mine/claude-code-skills-install-ui-skills-build-a-frontend-design-workflow-claude-code-cursorvs-4n43)

---

## 4. The UI Verification Problem

### 4.1 The Core Challenge

LLMs generate code that produces visual output, but they cannot see that output. This creates a feedback loop gap:
1. Human describes desired UI
2. LLM generates code
3. Code renders in browser
4. Human must manually verify and describe any issues back to the LLM

Steps 3-4 are the bottleneck. Current solutions attempt to close this loop. **As of 2025-2026, significant progress has been made**, particularly with Playwright MCP and Percy's AI Visual Review Agent.

### 4.2 Visual Regression Testing Tools

#### Playwright Screenshots

- **Description:** Playwright can capture screenshots of pages or specific elements during tests.
- **Integration with agentic coding:** A test script can render a component, capture a screenshot, and either compare it to a baseline or pass it to a vision model for evaluation.
- **Strengths:** Free, runs locally, integrates with CI, supports component testing
- **Weaknesses:** Baseline management overhead; pixel-perfect comparison is brittle
- **Agentic workflow:** The most practical option. Write Playwright tests that capture screenshots, then feed those screenshots back to the LLM (if it supports vision) for self-evaluation.

**Example workflow:**
```bash
# 1. LLM generates/modifies a component
# 2. Run Playwright to capture screenshot
npx playwright test --project=chromium --grep="BookingCard"
# 3. Screenshot saved to test-results/
# 4. Feed screenshot back to LLM for evaluation
# (requires vision-capable model and tooling that supports image input)
```

#### Chromatic (Storybook Visual Testing)

- **Description:** Cloud-based visual regression testing service that integrates with Storybook. Captures snapshots of every story and detects visual changes.
- **2025-2026 updates:** Chromatic has doubled down on component-focused testing, with tight Storybook integration keeping feedback loops short. Recommended for teams focused on reusable components and design systems.
- **Strengths:** Automatic baseline management, PR-based review workflow, catches unintended visual changes, makes visual testing "feel like part of your build, not an afterthought"
- **Weaknesses:** Cloud service (cost), requires Storybook stories to be comprehensive, does not directly feed back to LLMs
- **Fit for this project:** Excellent as a CI safety net, but does not directly help the agentic coding loop.

#### Percy (BrowserStack) with AI Visual Review Agent

- **Description:** Visual regression testing platform, now with an **AI-powered Visual Review Agent** (launched late 2025).
- **AI Visual Review Agent capabilities:**
  - Replaces pixel highlighting with **smart highlights** -- draws bounding boxes around meaningful changes and ignores noise
  - Instead of "47,000 pixels changed," reports "the header navigation shifted 4px left and the hero image was replaced"
  - **Reduces review time by 3x**
  - **Automatically filters 40% of false positives** (anti-aliasing, sub-pixel rendering, OS font variations)
  - 6x faster setup via visual test integration agent
- **Strengths:** Framework-agnostic, good CI integration, AI-powered review significantly reduces noise
- **Weaknesses:** Cloud service, cost, still does not directly feed back to LLMs in an automated loop
- **Fit for this project:** Strong choice for CI visual regression, especially with the AI Review Agent reducing false positives that would otherwise slow down agentic workflows.

**Source:** [Percy Visual Regression Testing: AI Review Agent Guide](https://bug0.com/knowledge-base/percy-visual-regression-testing)

### 4.3 MCP Servers and Browser Access for LLMs

#### Playwright MCP Server (Microsoft)

**The most significant development in LLM browser access since the original research.**

- **Package:** `@playwright/mcp` on npm
- **GitHub:** [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) -- **confirmed active and maintained by Microsoft**
- **Launched:** March 2025
- **Description:** A Model Context Protocol server that enables LLMs to interact with web pages through structured accessibility snapshots.

**Key architecture decision: Accessibility tree, not screenshots.**
Unlike traditional browser automation that relies on pixels/screenshots, Playwright MCP uses the browser's accessibility tree. This means:
- **2-5KB of structured data** per page snapshot (vs. megabytes for screenshots)
- **10-100x faster** than screenshot-based approaches
- **No vision model needed** -- operates on pure text/structured data
- **Deterministic** -- avoids ambiguity of pixel interpretation

**Operational modes:**
1. **Persistent Profile**: Browser data persists across sessions in user data directories
2. **Isolated Mode**: Temporary sessions with optional initial storage state
3. **Browser Extension**: Direct connection to existing browser tabs with active login sessions

**Capabilities:**
- Navigate to URLs, interact with elements, capture accessibility snapshots
- 25+ tools exposed for browser control through LLM-friendly APIs
- Rich introspection and iterative reasoning over page structure
- Works with Claude Code, Cursor IDE, and emerging MCP clients

**Integration with agentic UI development:**
1. LLM generates component code
2. LLM uses Playwright MCP to navigate to Storybook story or local dev server
3. Playwright MCP returns accessibility tree snapshot (structured text)
4. LLM evaluates the structure against requirements
5. LLM iterates if needed -- **no human in the loop for structural verification**

**Limitation:** Accessibility tree captures structure and semantics, not visual appearance (colors, spacing, alignment). For visual verification, screenshots or visual regression tools are still needed.

**Sources:**
- [microsoft/playwright-mcp GitHub](https://github.com/microsoft/playwright-mcp)
- [Playwright MCP: Field Guide for Agentic Browser Automation](https://medium.com/@adnanmasood/playwright-and-playwright-mcp-a-field-guide-for-agentic-browser-automation-f11b9daa3627)
- [Playwright MCP changes AI testing in 2026](https://bug0.com/blog/playwright-mcp-changes-ai-testing-2026)
- [Cloudflare Playwright MCP docs](https://developers.cloudflare.com/browser-rendering/playwright/playwright-mcp/)

#### Community Playwright MCP Server (executeautomation)

- **GitHub:** [executeautomation/mcp-playwright](https://github.com/executeautomation/mcp-playwright)
- **Description:** Community-maintained alternative that supports Claude Desktop, Cline, Cursor IDE, and more.
- **Fit:** Use as an alternative if the official Microsoft server does not meet specific integration needs.

#### Puppeteer MCP Server

- **Description:** Similar to Playwright MCP but using Puppeteer.
- Various community implementations exist.
- Less actively maintained than the Playwright variant.
- **Fit:** Use only if already heavily invested in Puppeteer.

**Recommended workflow with Browser MCP:**
1. LLM generates component code
2. LLM uses Browser MCP to navigate to Storybook story for that component
3. LLM captures accessibility snapshot (Playwright MCP) or screenshot
4. LLM evaluates the result against the requirements
5. LLM iterates if needed

**Caveat:** This workflow requires the development server (Storybook or the app) to be running, and the MCP server to be configured. Setup overhead is non-trivial but is a one-time cost.

#### Anthropic Computer Use

- **Description:** Anthropic's computer use capability allows Claude to control a computer desktop -- moving the mouse, clicking, typing, and viewing the screen.
- **Status (as of early 2026):** Available as an API feature. Being integrated into various tools and agents.
- **Strengths:** Full visual feedback -- the LLM can literally see the rendered UI
- **Weaknesses:**
  - Significantly slower than text-only interactions
  - Screen resolution and detail limitations
  - Not yet tightly integrated into coding workflows like Claude Code
  - Cost per interaction is higher due to vision model usage
- **Fit for this project:** Promising for the future, but not yet practical as a primary development workflow. Best used for periodic verification rather than continuous iteration. Playwright MCP (accessibility tree approach) is more practical for the continuous agentic coding loop.

#### browser-use and Similar Agent Frameworks

- **Description:** Open-source Python framework that makes websites accessible to AI agents. Over 60,000 GitHub stars; $17M+ seed funding secured.
- **Key capabilities:**
  - Combines visual understanding and HTML structure extraction
  - Handles multiple browser tabs for complex workflows
  - Compatible with all major LLMs via LangChain (GPT-4, Claude, Llama)
  - ChatBrowserUse() model optimized for browser tasks (3-5x faster than generic models)
  - 89.1% score on WebVoyager tests
- **Strengths:** Flexible, self-hosted, active community, can be integrated into custom workflows
- **Weaknesses:** Python-only (not directly usable in a TypeScript/React workflow), requires custom scripting, latency
- **Fit for this project:** Useful if the developer wants to build a custom verification pipeline. Not for the primary agentic coding loop, but could power a CI-based visual verification system.

**Source:** [browser-use GitHub](https://github.com/browser-use/browser-use)

### 4.4 Practical Verification Strategy

Given the state of tooling as of February 2026, the most practical verification approach combines multiple techniques:

1. **Primary: Storybook + Playwright MCP** -- LLM generates component, navigates to Storybook via Playwright MCP, evaluates accessibility tree snapshot. Fast, automated, no vision model needed.
2. **Secondary: Playwright screenshots for visual verification** -- When structural correctness is confirmed but visual appearance needs checking, capture screenshots and either feed to a vision model or compare to baselines.
3. **Safety net: Percy (with AI Review Agent) or Chromatic in CI** -- Catches visual regressions before merge with intelligent noise filtering.
4. **On-demand: Storybook MCP** -- When available, agents use Storybook's component metadata and test results for self-healing loops.
5. **Periodic: Manual review with screenshot feedback** -- Human describes issues, LLM corrects. Frequency decreases as automated verification improves.

### Visual Verification Tool Comparison

| Tool | Closes LLM feedback loop? | Setup effort | Cost | Speed | AI-powered? |
|------|--------------------------|-------------|------|-------|-------------|
| Playwright MCP (accessibility tree) | **Yes (structural)** | Medium | Free | **Very fast** | No (text-based) |
| Playwright screenshots | Partially (needs vision) | Medium | Free | Fast | No |
| Chromatic | No (CI only) | Low | Paid | N/A | No |
| Percy + AI Review Agent | No (CI only, but smarter) | Low | Paid | N/A | **Yes** |
| Storybook MCP | **Yes (when available)** | Medium | Free | Fast | Yes |
| Browser MCP (screenshot mode) | Yes | High | Free | Medium | Needs vision |
| Computer Use API | Yes | Medium | Per-use | Slow | Yes |
| browser-use | Yes (custom setup) | High | Free | Medium | Yes |
| Manual review | Yes (human in loop) | None | Human time | Slow | N/A |

---

## 5. Real-World Patterns and Recommendations

### 5.1 Patterns from Practitioners

Based on established patterns in the agentic coding community (2025-2026):

**Pattern: Constraint-based component APIs over freeform CSS**
- Practitioners consistently report better results when LLMs work with constrained component APIs (limited props, clear variants) versus freeform CSS
- Example: A `<Button variant="primary" size="lg">` produces more reliable output than "style a button with blue background, white text, larger padding"
- shadcn/ui and similar libraries excel here because variant definitions are explicit in the code

**Pattern: "Spec, Generate, Verify, Iterate" loop (updated from "Describe, Generate, Verify, Iterate")**
- Write a spec first (markdown document with requirements, props, visual states)
- LLM generates code from the spec
- Verify output (Playwright MCP for structure, screenshot or manual for visuals)
- Describe corrections and iterate
- Typically converges in 2-3 iterations for simple components, 5+ for complex ones
- Providing a reference image or wireframe dramatically reduces iterations

**Pattern: Incremental complexity**
- Start with static layouts, then add interactivity, then add state management
- LLMs handle each layer better when they can build on a working foundation
- "Make the layout first, then we'll add drag-and-drop" is more effective than "build a drag-and-drop calendar"

**Pattern: Component composition over monolithic pages**
- Never ask an LLM to generate an entire page in one prompt
- Break the page into components, generate each, then compose
- Composition instructions ("use BookingCard inside the TimeSlot grid") are handled well by LLMs

**Pattern: CSS Grid and Flexbox over absolute positioning**
- LLMs are much better at CSS Grid and Flexbox than absolute/relative positioning
- Grid-based layouts are also more predictable and maintainable
- For scheduling UIs, CSS Grid is natural: rows = time slots, columns = resources

**Pattern: Project rules files (CLAUDE.md, .cursorrules)**
- Every successful agentic UI project uses project-specific rule files
- Rules encode: framework choices, styling constraints, file structure conventions, component patterns
- This replaces "tribal knowledge" that LLMs cannot infer from code alone
- See section 3.2 (Spec-Driven Development) for the broader methodology

**Pattern: Frequent commits as checkpoints**
- Treat git commits as save points during agentic coding
- Commit after each successful component generation before moving to the next
- Enables rapid rollback when LLM output goes off track
- Addy Osmani: "like save points in a game"

### 5.2 TypeScript's Role

TypeScript is not optional for agentic UI coding -- it is a force multiplier:
- **Compile-time error catching:** LLM-generated code with type errors is immediately flagged
- **Auto-completion context:** TypeScript definitions help LLMs understand available APIs
- **Self-documenting interfaces:** Prop types serve as the component's contract
- **Refactoring safety:** When the LLM changes a component's props, TypeScript catches all call sites that need updating

### 5.3 Anti-Patterns to Avoid

- **Asking for "pixel-perfect" results:** LLMs cannot see pixels. Describe structure and constraints instead.
- **Using CSS modules or styled-components for agentic coding:** These add indirection that makes it harder for LLMs to reason about visual output. Utility classes (Tailwind) are more transparent.
- **Large, monolithic component files:** LLMs lose context in files over ~300 lines. Keep components small. (Exception: Claude Code has demonstrated handling 18,000-line files, but this is the exception, not the rule.)
- **Relying on CSS specificity:** LLMs struggle with cascade and specificity. Tailwind's utility-first approach eliminates this problem.
- **Mixing multiple styling paradigms:** Pick one approach (Tailwind) and enforce it. LLMs get confused when projects use Tailwind, CSS modules, and inline styles simultaneously.
- **Generating entire pages in one prompt:** Break pages into components and compose incrementally.
- **Skipping specs:** Going straight to "build me a booking form" without a specification leads to rework. Write specs first.
- **Ignoring Tailwind v4 migration:** If using Tailwind v4, explicitly tell the LLM. Otherwise it will generate v3-style code.

---

## 6. Recommended Approach for Sports Club Booking Planner

### Recommended Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Framework** | React 18+ with Next.js (App Router) or Vite | Dominant framework in LLM training data; excellent TypeScript support |
| **Language** | TypeScript (strict mode) | Essential for agentic coding reliability |
| **UI Components** | shadcn/ui (with MCP server) | Best LLM comprehension, copy-paste model, Tailwind-based, AI-native MCP integration |
| **Styling** | Tailwind CSS v4 (with v3-compatible config fallback) | Perfect textual describability, design token support. Use `@theme` blocks for new projects, `tailwind.config.js` if LLM accuracy is priority |
| **Scheduler** | FullCalendar (Premium) | Only production-ready resource scheduling with high LLM familiarity. Monitor v9 composable components. |
| **Scheduler alternative** | ScheduleX (Premium) | Consider if bundle size, modern API, or FullCalendar licensing are concerns. Requires providing docs as LLM context. |
| **Drag-and-drop** | FullCalendar built-in (for scheduler); @dnd-kit (for other UI) | Proven solutions with good LLM comprehension |
| **State management** | Zustand or React Query (TanStack Query) | Simple APIs that LLMs handle well |
| **Component dev** | Storybook 9 (with Storybook Test) | Isolated component development, built-in testing, and upcoming MCP integration |
| **Visual testing** | Playwright MCP (structural) + Chromatic or Percy (visual) | Multi-layered verification strategy |
| **Browser MCP** | Playwright MCP Server (`@playwright/mcp`) | Gives LLM structural feedback via accessibility tree. Fast, deterministic, no vision model needed. |
| **AI scaffolding** | v0.dev (for standard UI pages) | Generate initial layouts for non-scheduler pages |
| **Methodology** | Spec-Driven Development with CLAUDE.md | Write specs first, encode project conventions in rules files |

### Architecture Sketch

```
src/
  app/                      # Next.js App Router pages
    (booking)/
      page.tsx              # Main booking planner page
      layout.tsx
  components/
    ui/                     # shadcn/ui base components
      button.tsx
      card.tsx
      dialog.tsx
      select.tsx
      ...
    booking/                # Domain-specific components
      BookingCard.tsx        # Individual booking display
      BookingDialog.tsx      # Create/edit booking form
      CourtSelector.tsx      # Court/resource filter
      TimeSlotGrid.tsx       # Custom time slot display
      BookingStatusBadge.tsx # Status indicator
    scheduler/              # FullCalendar integration
      SchedulerView.tsx      # FullCalendar wrapper
      SchedulerToolbar.tsx   # Custom toolbar (date nav, view switcher)
      resourceConfig.ts      # Court/resource definitions
      eventTransformers.ts   # Data transformation FullCalendar <-> domain
      schedulerStyles.css    # FullCalendar CSS overrides
  lib/
    types/
      booking.ts            # Booking domain types
      court.ts              # Court/resource types
      schedule.ts           # Schedule/time slot types
    hooks/
      useBookings.ts        # Booking data fetching
      useCourts.ts          # Court data fetching
    utils/
      timeUtils.ts          # Time calculation helpers
      bookingValidation.ts  # Business rule validation
  stories/                  # Storybook stories
    booking/
      BookingCard.stories.tsx
      BookingDialog.stories.tsx
      ...
    scheduler/
      SchedulerView.stories.tsx
docs/
  specs/                    # Component and feature specifications (SDD)
    booking-card.md
    scheduler-view.md
    booking-dialog.md
CLAUDE.md                   # Project rules for AI agents
```

### Implementation Strategy for Agentic Coding

**Phase 1: Foundation (shadcn/ui setup)**
1. Initialize the project (Next.js + TypeScript + Tailwind v4)
2. Create CLAUDE.md with project rules (framework choices, styling constraints, component patterns)
3. Install shadcn/ui and add base components (Button, Card, Dialog, Select, Badge, Table)
4. Configure shadcn MCP server for AI assistant integration
5. Define design tokens in CSS `@theme` block (booking colors, slot dimensions, court widths)
6. Set up Storybook 9 with Storybook Test
7. Create domain TypeScript types (Booking, Court, TimeSlot, BookingStatus)

**Phase 2: Domain Components (fully agentic-friendly)**
1. Write specs for each booking component (markdown documents)
2. Build each booking component in isolation with Storybook stories
3. Use strict TypeScript props for each component
4. Verify each component via Playwright MCP (accessibility tree) and visual review
5. Components at this stage are static (no data fetching, no state management)

**Phase 3: FullCalendar Integration (more manual guidance needed)**
1. Install FullCalendar with React and Premium plugins
2. Create a thin wrapper component (`SchedulerView`) that configures FullCalendar
3. Define resource and event transformers to bridge domain types to FullCalendar's API
4. Create a CSS override file for FullCalendar styling to match the design system
5. This phase likely requires more human guidance due to FullCalendar's configuration complexity
6. Provide FullCalendar v6 documentation as context to the LLM to avoid version confusion

**Phase 4: Interactivity and State**
1. Add booking creation dialog (shadcn/ui Dialog + Form)
2. Implement drag-and-drop booking (FullCalendar built-in)
3. Add state management (Zustand for client state, TanStack Query for server state)
4. Connect to backend API

**Phase 5: Polish and Testing**
1. Add visual regression tests (Playwright screenshots + Percy/Chromatic)
2. Configure Storybook MCP (when available) for autonomous testing
3. Responsive design adjustments
4. Accessibility audit (Storybook v9's built-in a11y testing)

### Key Guidance for the LLM During Development

Provide these instructions in your CLAUDE.md or project-level AI instructions:

```markdown
## UI Development Rules

1. Use ONLY shadcn/ui components and Tailwind CSS utility classes for styling.
2. Never use inline styles, CSS modules, or styled-components.
3. Reference design tokens from the @theme block in app.css (Tailwind v4).
4. Every new component must have a corresponding Storybook story (CSF3 format).
5. Component files must not exceed 200 lines. Extract sub-components if needed.
6. All component props must be defined as named TypeScript interfaces.
7. For FullCalendar configuration, reference the existing SchedulerView.tsx wrapper.
8. Use the booking domain types from lib/types/ -- do not create ad-hoc types.
9. When modifying the scheduler, test changes in Storybook first.
10. For layout, use CSS Grid or Flexbox. Never use absolute positioning for layout.
11. Use Tailwind v4 syntax: @import "tailwindcss" (not @tailwind directives).
12. Use @theme blocks for custom design tokens (not tailwind.config.js).
13. Write a spec document in docs/specs/ before implementing complex components.
```

---

## Comparative Evaluation Summary

| Criterion | shadcn/ui + FullCalendar (Recommended) | Bootstrap + FullCalendar | MUI + MUI X Scheduler | Custom-built |
|-----------|---------------------------------------|------------------------|----------------------|-------------|
| **LLM comprehension** | High | Very High | High | Medium |
| **UI predictability** | Very High | High | Medium | Low |
| **Feature completeness** | High | High | Very High | Low initially |
| **Development speed** | Fast | Fast | Fast | Very Slow |
| **Customizability** | Very High | Low | Medium | Total |
| **TypeScript quality** | Excellent | Poor | Excellent | Varies |
| **License cost** | ~$480/yr (FullCalendar) | ~$480/yr (FullCalendar) | MUI X from $180/yr | Free |
| **Maintenance burden** | Low | Low | Low | Very High |
| **Modern React fit** | Excellent | Poor | Good | Varies |
| **Visual testing** | Excellent (Storybook 9) | Good | Good | Manual |
| **AI/MCP integration** | Excellent (shadcn MCP, Playwright MCP, Storybook MCP) | None | None | None |

## Open Questions

1. **FullCalendar Premium licensing:** The resource scheduling features require a commercial license. Is the $480+/year cost acceptable? If not, ScheduleX is now a viable alternative (also premium for resource features), or building a custom scheduler with CSS Grid + @dnd-kit (significantly longer development time).

2. **Tailwind v4 adoption timing:** Should the project start with idiomatic Tailwind v4 (CSS-first config) or use the backwards-compatible v3 config approach? The tradeoff is between staying current vs. maximizing LLM accuracy. As LLM training data catches up to v4, this question resolves itself. **Recommendation: Start with v4 CSS-first config but include v4-specific examples in CLAUDE.md.**

3. **Storybook MCP availability:** Storybook MCP entered early access in December 2025. Its exact feature set and stability should be verified before building the verification workflow around it. If not yet production-ready, the Playwright MCP + Chromatic combination is a proven alternative.

4. **ScheduleX maturity:** ScheduleX's resource scheduler has improved significantly but is still less battle-tested than FullCalendar for complex booking scenarios. If considering ScheduleX, build a proof-of-concept with realistic data volumes before committing.

5. **Anthropic Computer Use integration:** If/when computer use is integrated into Claude Code as a first-class feature, it could fundamentally change the visual verification workflow. Monitor Anthropic's releases for this capability. In the meantime, Playwright MCP (accessibility tree approach) provides structural verification without vision models.

6. **FullCalendar version specifics:** LLM training data includes FullCalendar v5 and v6 patterns. FullCalendar v8/v9 are on the roadmap. Ensure the LLM is directed to use the correct version by including version-specific documentation in CLAUDE.md. The v9 composable components will be a significant improvement for agentic coding.

7. **Next.js vs. Vite:** For a booking system that may not need SSR, Vite (with React Router) might be simpler. Next.js adds complexity but provides SSR/ISR benefits for SEO (less relevant for an internal booking tool). Choose based on deployment requirements.

## Sources & References

### UI Frameworks
- **shadcn/ui docs:** https://ui.shadcn.com/docs
- **shadcn/ui MCP Server:** https://ui.shadcn.com/docs/mcp
- **shadcn CLI 3.0 changelog:** https://ui.shadcn.com/docs/changelog/2025-08-cli-3-mcp
- **shadcn/ui AI Integration (DeepWiki):** https://deepwiki.com/shadcn-ui/ui/8.3-ai-integration-and-llm-api
- **Vercel AI Elements:** https://github.com/vercel/ai-elements
- **Tailwind CSS v4 announcement:** https://tailwindcss.com/blog/tailwindcss-v4
- **Tailwind CSS docs:** https://tailwindcss.com/docs
- **Tailwind v4 LLM discussion:** https://github.com/tailwindlabs/tailwindcss/discussions/14677
- **Tailwind v4 llms.txt request:** https://github.com/tailwindlabs/tailwindcss/discussions/18256
- **Tailwind v4 vs Claude 3.7 Sonnet:** https://medium.com/@dpzhcmy/tailwind-css-v4-the-archenemy-of-claude-3-7-sonnet-209ce7470f76
- **Radix UI:** https://www.radix-ui.com/

### Scheduling Libraries
- **FullCalendar docs:** https://fullcalendar.io/docs
- **FullCalendar Pricing:** https://fullcalendar.io/pricing
- **FullCalendar Roadmap:** https://fullcalendar.io/roadmap
- **ScheduleX docs:** https://schedule-x.dev/
- **ScheduleX Resource Scheduler:** https://schedule-x.dev/docs/calendar/resource-scheduler
- **ScheduleX Premium:** https://schedule-x.dev/premium
- **ScheduleX GitHub:** https://github.com/schedule-x
- **DHTMLX Scheduler comparison:** https://dhtmlx.com/blog/best-react-scheduler-components-dhtmlx-bryntum-syncfusion-daypilot-fullcalendar/
- **Bryntum Scheduler:** https://bryntum.com/blog/the-best-javascript-scheduler-components/
- **react-big-calendar:** https://github.com/jquense/react-big-calendar
- **Cal.com Platform (Atoms):** https://cal.com/platform
- **Cal.com Open Source Calendar Guide:** https://cal.com/blog/the-ultimate-guide-to-open-source-calendar-software-and-scheduler-tools
- **Best React Calendar Components (Builder.io):** https://www.builder.io/blog/best-react-calendar-component-ai

### Scheduling Reference Projects
- **ep3-bs (court booking):** https://github.com/tkrebs/ep3-bs
- **courtbooker (tennis courts):** https://github.com/bolu-atx/courtbooker
- **tennis-court-reservation-system-v2:** https://github.com/adroste/tennis-court-reservation-system-v2

### AI/Agentic Coding Tools & Workflows
- **v0.dev:** https://v0.app/
- **v0 Design Systems:** https://v0.app/docs/design-systems
- **v0 Review (Skywork):** https://skywork.ai/blog/vercel-v0-review-2025-ai-ui-code-generation-nextjs/
- **Storybook docs:** https://storybook.js.org/docs
- **Storybook v9 (InfoQ):** https://www.infoq.com/news/2025/07/storybook-v9-released/
- **Storybook MCP sneak peek:** https://storybook.js.org/blog/storybook-mcp-sneak-peek/
- **Storybook component testing:** https://storybook.js.org/docs/writing-tests
- **How I use Claude Code (Builder.io):** https://www.builder.io/blog/claude-code
- **Addy Osmani: LLM coding workflow 2026:** https://addyosmani.com/blog/ai-coding-workflow/
- **Addy Osmani: How to write a good spec for AI agents:** https://addyosmani.com/blog/good-spec/
- **Claude Code Skills UI workflow:** https://dev.to/blamsa0mine/claude-code-skills-install-ui-skills-build-a-frontend-design-workflow-claude-code-cursorvs-4n43
- **Spec-Driven Development (Agent Factory):** https://agentfactory.panaversity.org/docs/General-Agents-Foundations/spec-driven-development
- **Spec-Driven Development (Thoughtworks):** https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices

### Visual Verification & Browser MCP
- **Playwright MCP (Microsoft):** https://github.com/microsoft/playwright-mcp
- **Playwright MCP Field Guide:** https://medium.com/@adnanmasood/playwright-and-playwright-mcp-a-field-guide-for-agentic-browser-automation-f11b9daa3627
- **Playwright MCP AI Testing 2026:** https://bug0.com/blog/playwright-mcp-changes-ai-testing-2026
- **Cloudflare Playwright MCP:** https://developers.cloudflare.com/browser-rendering/playwright/playwright-mcp/
- **mcp-playwright (community):** https://github.com/executeautomation/mcp-playwright
- **Playwright docs (screenshots):** https://playwright.dev/docs/test-snapshots
- **Chromatic:** https://www.chromatic.com/
- **Percy:** https://percy.io/
- **Percy AI Review Agent:** https://bug0.com/knowledge-base/percy-visual-regression-testing
- **browser-use:** https://github.com/browser-use/browser-use
- **Anthropic Computer Use:** https://docs.anthropic.com/en/docs/computer-use

### Other Libraries
- **@dnd-kit:** https://dndkit.com/
- **Zustand:** https://github.com/pmndrs/zustand
- **TanStack Query:** https://tanstack.com/query

---

**Note on methodology:** This research was originally conducted in February 2026 without web access. It was updated on 2026-02-26 with extensive web research (15+ searches, multiple article deep-dives) to validate findings, add new tools and libraries discovered in 2025-2026, and include current version numbers, pricing, and feature information. All library assessments reflect the state of the ecosystem as of February 2026.
