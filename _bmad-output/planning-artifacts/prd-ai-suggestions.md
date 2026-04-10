# PRD AI Suggestions & Decisions Log

**Project:** Mega Jira 3000
**Date:** 2026-04-09

---

## Step 2 — Project Discovery

**AI Classification Proposal:**
- Project Type: SaaS B2B
- Domain: General (software project management)
- Complexity: Medium-High
- Project Context: Greenfield

**User Decision:** Approved as-is.

---

## Step 2b — Product Vision

**AI Vision Synthesis:**
- Vision: Single source of truth for SDLC — centralized, ultra-fast, developer-native
- Differentiator: Performance as a core feature (sub-200ms p95), developer-native Git workflow integration, MJQL query language, real-time WebSocket collaboration at scale
- Core Insight: Legacy tools were built for process managers, not developers. Mega Jira 3000 flips this — built for developers first, management layer emerges from dev workflow.

**User Decision:** Approved as-is.

---

## Step 2c — Executive Summary

**AI Draft:** Full executive summary covering platform vision, four personas (Planner, Executor, Gatekeeper, Observer), and four key differentiators (performance, dev-native workflow, MJQL, real-time collaboration).

**User Decision:** Approved as-is.

---

## Step 3 — Success Criteria

**AI Questions:**
1. What does "worth it" look like for enterprise buyers — velocity improvement, reduced tool spend, or something else?
2. For MVP scope — would you ship Alpha without MJQL or data migration?
3. Which features would you push past GA (CSV export, advanced MJQL, accessibility)?

**User Decision:** Approved the synthesized success criteria and scope split (MVP / Growth / Vision) as drafted.

---

## Step 4 — User Journey Mapping

**AI Suggestion — Additional Personas:**
- Suggested adding 2 user types beyond the 4 in the spec document:
  - The Admin (System/Project Admin) — configures workflows, manages roles/permissions, onboards teams
  - The Integrator (API Consumer) — builds automations, connects external tools via webhooks/API
- Asked if Scrum Master or Support/Customer Success roles should be distinct personas

**User Decision:** Approved 6 personas. Added two directives:
1. Record all AI suggestions and user answers in a separate `prd-ai-suggestions.md` file (this file)
2. **Prioritize features that do NOT require 3rd party integration** to ship the product smoothly. This affects MVP scope — GitHub/Slack/GitLab integrations should be deprioritized in favor of core platform capabilities that are self-contained.

**AI Action:** All 6 narrative journeys were written to demonstrate core platform value without relying on any 3rd party integration. Journey 2 (Developer) was reframed to focus on in-app workflow rather than GitHub PR linking.

**User Decision:** Approved all 6 journeys as drafted.

---

## Step 5 — Domain-Specific Requirements (Optional)

**AI Suggestion:** Domain is "general" but complexity is medium-high with SOC2/GDPR and enterprise security concerns. Offered to explore domain-specific compliance constraints or skip since they're already captured in Success Criteria.

**User Decision:** Skipped. Compliance items to be covered in functional requirements later.

---

## Step 6 — Innovation Discovery (Optional)

**AI Analysis:** Detected 3 innovation signals — MJQL as a custom DSL, performance-as-architecture (not optimization), and real-time reconciliation with optimistic locking at enterprise scale. Assessed these as strong engineering differentiators rather than market-category-creating innovations. Characterized the product as "excellent execution of an existing concept with genuinely innovative technical approaches."

**User Decision:** Skipped innovation section.

---

## Step 7 — Project Type Deep Dive (SaaS B2B)

**AI Questions:**
1. Multi-tenant or single-tenant? 
2. Permission model additions beyond the 6-role RBAC?
3. Subscription tiers (Free/Pro/Enterprise)?
4. Integration surface for MVP?
5. Compliance scope?

**User Directive:** "Do according to best practices, simplicity of implementation, and keep in mind the product should be shipped quickly."

**AI Decisions (user-approved):**
1. Single-tenant database with shared app layer — simpler, evolve to multi-tenancy at ~50 tenants
2. Keep 6-role RBAC as specified — already well-defined
3. Single enterprise license tier for MVP — no billing complexity
4. REST API only, no 3rd party integrations in MVP
5. SOC2 + GDPR essentials only — audit trail, soft/hard delete, PII masking. Full audit engagement deferred to pre-GA.

**User Decision:** Approved all decisions.

---

## Step 8 — Scoping Exercise

**AI Simplification Proposals:**
1. Defer MJQL to Growth — ship MVP with structured filters (dropdowns for status, assignee, type, priority, date range). Saves ~4 weeks of parser + Elasticsearch work.
2. Defer SLA engine to Growth — manual escalation via comments/mentions in MVP. Eliminates background scheduler complexity.
3. Defer virus scanning on uploads — MVP uses file type + 50MB size validation only. Removes AWS Lambda dependency.

**Additional Deferrals Applied:**
- Email notifications deferred (in-app only for MVP)
- WIP limits deferred
- Bulk operations deferred
- REST API deferred to Phase 2 (internal-only in MVP)

**User Decision:** "Keep your simplifications" — approved all three plus additional deferrals. MVP focuses on core board + issues + workflow + RBAC + real-time sync.

---

## Step 9 — Functional Requirements

**AI Synthesis:** Generated 51 FRs across 10 capability areas (Issue Management, Board & Visualization, Workflow Engine, Search & Filtering, Comments & Collaboration, Notifications, File Attachments, User & Access Management, Project Administration, Real-Time Synchronization, Data Management). All FRs scoped to MVP only — MJQL, SLA engine, bulk ops, integrations excluded per scoping decisions.

**User Decision:** Approved all 51 FRs as drafted.

---

## Step 10 — Non-Functional Requirements

**AI Draft:** 28 NFRs across 6 categories (Performance, Security, Scalability, Reliability, Accessibility, Compliance). MVP-appropriate targets — e.g., 500 concurrent users (not 5,000), 99.5% uptime (not 99.9%). Accessibility basics included (keyboard nav, screen reader labels, contrast ratios) without full WCAG 2.1 AA compliance.

**User Decision:** Approved all 28 NFRs as drafted.

---

## Step 11 — Document Polish

**AI Actions:**
1. Removed duplicate "Product Scope" section (Step 3 version contradicted Step 8 scoping decisions — still listed GitHub, MJQL, SLA in MVP)
2. Added note to User Journeys clarifying they represent full product vision, not MVP scope
3. Fixed SaaS B2B "Implementation Considerations" to reflect MVP reality (PostgreSQL queries, not Elasticsearch; direct processing, not RabbitMQ)
4. Merged "Project Classification" into document header for density
5. Tightened language throughout per PRD purpose anti-patterns

**User Decision:** Approved polish.
