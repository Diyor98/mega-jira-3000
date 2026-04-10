---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain-skipped
  - step-06-innovation-skipped
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
inputDocuments:
  - "Product Requirements Document (PRD) Specification Document_ Mega Jira 3000.docx"
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 0
  projectDocs: 0
  externalSpecs: 1
classification:
  projectType: saas_b2b
  domain: general
  complexity: medium-high
  projectContext: greenfield
workflowType: 'prd'
---

# Product Requirements Document - Mega Jira 3000

**Author:** Diyor
**Date:** 2026-04-09
**Project Type:** SaaS B2B | **Domain:** Software Project Management | **Complexity:** Medium-High | **Context:** Greenfield

## Executive Summary

Enterprise engineering organizations lose thousands of hours annually to fragmented toolchains, sluggish issue trackers, and constant context-switching between tools. Mega Jira 3000 is a centralized, real-time SDLC platform serving as the single source of truth for project planning, execution, and reporting — built for organizations with 10,000+ active users managing millions of issues.

The platform targets four primary personas: Planners (PMs) needing predictable velocity and cross-team dependency visibility; Executors (Developers) updating tickets directly from Git workflows; Gatekeepers (QA) generating bugs from test failures with auto-attached logs; and Observers (Executives) accessing live dashboards with epic-level progress and risk flags.

Mega Jira 3000 reduces developer tool fatigue, improves velocity by an estimated 15%, and delivers real-time project predictability to leadership.

### What Makes This Special

**Performance as a core feature.** API responses under 200ms at p95 with 5,000 concurrent users. Sub-second response times querying millions of historical records — an architectural commitment to speed via a modern reactive stack (Next.js + NestJS + PostgreSQL + Elasticsearch).

**Developer-native workflow integration.** Tickets auto-transition when PRs are merged. Status updates via Git commit messages. The tool adapts to developer workflows, not the other way around.

**MJQL (Mega Jira Query Language).** Purpose-built query language with AND/OR operators, historical state lookups (`WAS "In Progress"`), relative date functions (`startOfWeek()`, `endOfMonth()`), and full-text search — backed by Elasticsearch with graceful degradation to PostgreSQL.

**Real-time collaboration at scale.** WebSocket-driven bidirectional syncing for boards, issues, and comments via Redis Pub/Sub, with optimistic locking and conflict resolution for concurrent edits.

## Success Criteria

### User Success

- **Daily Stickiness (GA):** DAU/MAU ratio > 75%
- **Time to First Value (MVP):** < 15 minutes from account creation to first issue moved across a board
- **Usability (Beta):** SUS score > 80 from Beta participants
- **Task Findability (GA):** CSAT > 4.5/5 on "How easily were you able to find your assigned work today?"
- **Developer Flow (MVP):** Ticket status updates without leaving the platform — in-app workflow only. IDE/Git integration added in Phase 3.

### Business Success

- **Developer Velocity (GA):** 15% improvement measured by reduced context-switching time
- **Enterprise Adoption (Beta):** 5 enterprise clients onboarded during Beta (Month 5), public GA by Month 7
- **Quality at Launch (GA):** < 2% critical P1 bugs in production within 30 days of GA
- **Retention (GA):** > 90% enterprise client retention after first 6 months post-GA

### Technical Success

- **API Performance (MVP):** p95 response time < 200ms under 500 concurrent users. **(GA):** under 5,000 concurrent users.
- **Scale (GA):** 50M issues per tenant without search degradation. **(MVP):** 5M issues per tenant.
- **Real-time (GA):** 10,000+ concurrent connections without event loop crashes. **(MVP):** 2,000 connections per node.
- **Uptime (MVP):** 99.5% during Alpha/Beta. **(GA):** 99.9% availability SLA.
- **Compliance (GA):** SOC2 Type II and GDPR before GA

### Measurable Outcomes

| Metric | Target | Measurement Point |
|--------|--------|-------------------|
| API Latency (p95) | < 200ms | Continuous via Datadog APM |
| DAU/MAU | > 75% | Monthly from GA |
| SUS Score | > 80 | Beta exit survey |
| TTFV | < 15 min | Beta onboarding tracking |
| Defect Escape Rate | < 2% P1 | 30 days post-GA |
| CSAT (task findability) | > 4.5/5 | In-app prompt, weekly |

## User Journeys

> **Note:** Journeys represent the full product vision across all phases. Features referenced here (MJQL, WIP limits, SLA escalation, REST API) may be deferred beyond MVP per the Scoping section. Each journey demonstrates the end-state user experience.

### Journey 1: The Planner — "Sarah Finally Sees the Whole Picture"

**Sarah**, a Senior PM managing 3 cross-functional teams (28 engineers), starts her Monday dreading the usual routine: opening four browser tabs, cross-referencing spreadsheets, and manually piecing together sprint status.

**Opening Scene:** Sarah logs into Mega Jira 3000 and lands on her project board. All three teams' work is visible in a single view — real-time, no refresh needed. Team Alpha's epic is 78% complete, but two stories are stuck in "In Review" for 3 days.

**Rising Action:** She uses MJQL to query `status = "In Review" AND updated < -3d AND team = "Alpha"` and instantly finds the bottleneck. She reassigns the review, adds a comment tagging the reviewer, and drags a blocked story back to "To Do." The board updates live for everyone.

**Climax:** During standup, the board is already current — no one spent time updating tickets beforehand. She sets a WIP limit on "In Review" to prevent recurring bottlenecks. Standup takes 8 minutes instead of 25.

**Resolution:** Sarah spends < 10 minutes a day on board management. Velocity charts are predictable because data is real-time and accurate.

### Journey 2: The Executor — "Marcus Updates His Ticket Without Leaving His Flow"

**Marcus**, a backend developer, picks up story MEGA-55 from "To Do."

**Opening Scene:** MEGA-55 shows clear acceptance criteria and a linked Epic for context. He drags it to "In Progress" — no friction, no form, just a drag.

**Rising Action:** He opens the issue detail panel to check a QA comment about an edge case. He replies directly in Mega Jira 3000 — his PM sees the response in real-time.

**Climax:** Marcus moves the ticket to "In Review." The system enforces the workflow rule — transition requires review notes. His teammate sees the status change instantly via WebSocket and starts reviewing.

**Resolution:** The review completes, the ticket moves to "QA." No tab switching, no manual updates, no "did you update the ticket?" messages.

### Journey 3: The Gatekeeper — "Quinn Catches a Bug Before It Ships"

**Quinn**, a QA engineer, checks the QA column on her board.

**Opening Scene:** 3 stories in "QA," WIP limit set to 4. She opens MEGA-55 and reviews acceptance criteria against the staging build.

**Rising Action:** She discovers an edge case — input exceeding 500 characters breaks the feature. She clicks "Create Bug" from within the story; the bug auto-links to MEGA-55 with Epic context preserved.

**Climax:** Quinn fills in bug details with severity P2 and selects "Root Cause: Input Validation" — a mandatory field enforced by the workflow. This data feeds quality metrics dashboards.

**Resolution:** The bug appears on the board instantly. Marcus picks it up in real-time. The SLA clock starts — P2 bugs escalate after 24 hours if untouched.

### Journey 4: The Observer — "VP Chen Gets Answers Without Asking"

**VP Chen** has a board meeting in 2 hours.

**Opening Scene:** He navigates to the Epic view for Project Falcon — 4 Epics with completion percentages and child story status rolled up automatically.

**Rising Action:** Epic 3 ("Search Infrastructure") is at 45% — behind the others at 70-80%. He clicks in and sees 3 blocked stories with comments explaining dependencies. The data is live.

**Climax:** Chen runs `type = Epic AND project = "FALCON" AND status != Done ORDER BY progress ASC` to get a prioritized risk view and shares with leadership.

**Resolution:** Chen walks into the board meeting with current, accurate data — no PM pings needed.

### Journey 5: The Admin — "Priya Onboards a New Team in 30 Minutes"

**Priya**, a System Admin, sets up a new 12-person team.

**Opening Scene:** She creates Project "ATLAS," selects the standard workflow template, and adds a mandatory "Root Cause" field for Bug → Done transitions.

**Rising Action:** She configures RBAC — 1 Project Admin, 2 PMs, 6 Developers, 2 QA, 1 Viewer. She sets WIP limits and notification preferences.

**Climax:** SLA rules configured, setup completed in 25 minutes. The team starts immediately.

**Resolution:** Priya monitors the Audit Trail. When a Viewer attempts to create an issue, the system returns 403 with a redirect. Everything works as configured.

### Journey 6: The Integrator — "Alex Builds a Custom Dashboard via API"

**Alex**, a platform engineer, builds an analytics dashboard pulling data from Mega Jira 3000.

**Opening Scene:** `GET /api/v1/issues?status=Done&project=MEGA` returns in under 200ms with clean JSON and standard error schemas.

**Rising Action:** Alex queries MJQL via API to track performance-related bugs. Cursor-based pagination with `next_cursor` handles large result sets.

**Climax:** Alex hits 429 (rate limit) during batch loading. `Retry-After` header guides exponential backoff. The API is predictable and well-behaved.

**Resolution:** Dashboard goes live, pulling fresh data every 5 minutes — built entirely on the public API.

### Journey Requirements Summary

| Journey | Key Capabilities Revealed |
|---------|--------------------------|
| Planner (Sarah) | Board views, MJQL search, real-time sync, WIP limits, comment threading, drag-and-drop |
| Executor (Marcus) | Issue detail panel, workflow transitions with enforcement, real-time comments, assignment |
| Gatekeeper (Quinn) | Bug creation from stories, mandatory fields on transitions, SLA escalation, issue linking |
| Observer (Chen) | Epic roll-up views, MJQL export, progress aggregation, read-only access patterns |
| Admin (Priya) | Project creation, RBAC configuration, workflow customization, SLA setup, audit trail |
| Integrator (Alex) | REST API, cursor pagination, MJQL via API, rate limiting, standard error responses |

## SaaS B2B Specific Requirements

### Project-Type Overview

Mega Jira 3000 is a B2B SaaS platform targeting enterprise engineering organizations. Architecture prioritizes speed to market: launch with simplified tenancy and single pricing tier, evolve to multi-tenancy and tiered pricing based on customer feedback.

### Tenant Model

- **Architecture:** Single-tenant database, shared application layer. Each organization gets an isolated database/schema.
- **Rationale:** Simplifies data isolation, security auditing, and per-tenant backup/restore.
- **Evolution Path:** Pooled multi-tenancy with row-level security when tenant count exceeds ~50.
- **Provisioning:** Automated tenant setup via admin API — create database, run migrations, seed defaults.

### RBAC Matrix

| Action | Sys Admin | Proj Admin | PM | Developer | QA | Viewer |
|--------|-----------|------------|-----|-----------|-----|--------|
| Create/Edit Project | Yes | No | No | No | No | No |
| Edit Workflows | Yes | Yes | No | No | No | No |
| Create/Edit Issues | Yes | Yes | Yes | Yes | Yes | No |
| Transition Status | Yes | Yes | Yes | Yes | Yes | No |
| Delete Issues | Yes | Yes | No | No | No | No |
| Manage Users/Roles | Yes | No | No | No | No | No |
| View Audit Trail | Yes | Yes | No | No | No | No |
| Configure SLAs | Yes | Yes | No | No | No | No |

- **Mid-action revocation:** POST/PATCH fails with 403 Forbidden and redirects to project home.
- **Role assignment:** Project Admins assign within their project. System Admins manage cross-project roles.

### Subscription & Licensing

- **MVP:** Single enterprise license tier. No free tier, no self-serve billing.
- **Evolution:** Tiered pricing (Team / Business / Enterprise) post-GA based on usage data.

### Integration Surface

- **MVP:** REST API (`/api/v1/`) is the sole integration surface. No 3rd party integrations.
- **Endpoints:** CRUD for Projects, Issues, Comments, Attachments. Structured filter endpoint. User management.
- **Authentication:** API key per tenant. OAuth2 for user-context access post-MVP.
- **Pagination:** Cursor-based (`limit`, `next_cursor`). Max 10,000 results.
- **Rate Limiting:** Per-tenant limits with 429 responses and `Retry-After` headers.

### Compliance

- **Audit Trail:** All mutations logged to immutable append-only log. PII masked in application logs.
- **Data Lifecycle:** Soft delete (30-day recovery) → hard delete purges from DB and S3.
- **GDPR:** Automated PII anonymization for Right to be Forgotten requests.
- **SOC2 Type II:** Audit trail, RBAC enforcement, encryption at rest and in transit (TLS 1.2+).
- **Deferred:** Full SOC2 audit engagement and GDPR DPA templates deferred to pre-GA.

### Implementation Considerations

- **Session Management:** JWT tokens (15 min access, 7-day refresh). Stateless.
- **Deployment:** Docker + Kubernetes. Single-region for MVP; multi-region post-GA.
- **Database:** PostgreSQL per tenant. PgBouncer connection pooling. No sharding in MVP.
- **Search:** MVP uses PostgreSQL indexed queries with compound indexes on (project_id, status, assignee_id, type, created_at). Elasticsearch via CDC added in Phase 2 for MJQL.
- **Queue:** Direct processing in MVP. RabbitMQ added in Phase 2 for email notifications and bulk operations.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Problem-solving MVP — deliver core issue tracking and board experience so well that teams abandon current tools.

**Guiding Principle:** No 3rd party integrations. No infrastructure complexity beyond essentials. Every feature works with PostgreSQL + Redis + application layer alone.

**Resource Requirements:** 2 Frontend (React/Next.js), 2 Backend (NestJS), 1 DevOps, 1 QA. Total: 6-person team.

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:**
- Planner (Sarah) — board views, structured filters, real-time sync, drag-and-drop
- Executor (Marcus) — issue detail, workflow transitions, real-time comments
- Gatekeeper (Quinn) — bug creation from stories, mandatory fields on transitions, issue linking
- Admin (Priya) — project creation, RBAC configuration, workflow customization

**Must-Have Capabilities:**
- Project and Issue CRUD (Epic, Story, Task, Bug) with Comments
- Board view with drag-and-drop and real-time WebSocket syncing
- Workflow state machine (Backlog → To Do → In Progress → In Review → QA → Done → Archived)
- Transition rules enforcement (e.g., require Assignee for To Do → In Progress)
- 6-role RBAC with permissions matrix
- Structured search filters (status, assignee, type, priority, date range) with saved filter presets — no MJQL
- In-app notification bell (mentions, assignments, status changes)
- Optimistic locking with 409 Conflict resolution
- File attachments via S3 with file type/size validation (no virus scanning)
- Issue hierarchy: Epic → Story/Task/Bug with progress roll-up
- Audit trail for all mutation actions
- JWT authentication with email/password login

**Explicitly Deferred from MVP:**
- MJQL query language (replaced by structured filters)
- SLA engine and auto-escalation (manual escalation via comments/mentions)
- Virus scanning on uploads (file type + 50MB size limit only)
- Email notifications (in-app only)
- WIP limits on columns
- Bulk operations

### Post-MVP Features

**Phase 2 — Growth:**
- MJQL with AND/OR operators, `=`, `!=`, `IN`, `NOT IN`, `~` (contains)
- Elasticsearch integration via CDC for full-text search
- Email notifications batched every 15 minutes
- SLA engine with P1/P2 auto-escalation rules
- WIP limits on board columns with visual indicators
- Custom mandatory fields on workflow transitions (e.g., Root Cause for Bugs)
- Bulk operations (up to 500 issues) with async queue processing
- REST API (`/api/v1/`) with cursor pagination and rate limiting
- CSV export of search results (up to 10,000 rows)
- File attachment virus scanning via async processing

**Phase 3 — Expansion:**
- Advanced MJQL: historical state lookups (`WAS`), relative date functions (`startOfWeek()`)
- GitHub integration: PR linking, auto-transition on merge, webhooks
- Slack integration for notifications
- GitLab and Bitbucket integration
- Webhook system with HMAC SHA-256 signing
- Executive dashboard with Epic-level progress, budget burn, risk flags
- SAML 2.0 / OAuth2 SSO (Okta, Azure AD, Google Workspace)
- WCAG 2.1 Level AA accessibility
- Data migration tool for legacy Jira imports
- Multi-tenant database sharding
- GDPR Right to be Forgotten automation
- Subscription tiers and self-serve billing

### Risk Mitigation Strategy

**Technical Risks:**
- *WebSocket at scale:* Single Redis Pub/Sub node initially. Horizontal scaling via Kubernetes when connections exceed capacity. Monitor event loop latency from day one.
- *Search without Elasticsearch:* PostgreSQL compound indexes on (project_id, status, assignee_id, type, created_at) support structured filters at scale.
- *Conflict resolution:* Optimistic locking with `issue_version` integer — well-understood, low risk.

**Market Risks:**
- *"Just another Jira" perception:* Lead with performance benchmarks in Alpha. Publish latency comparisons.
- *Enterprise readiness without SSO:* Email/password + API keys acceptable for Alpha and early Beta. SSO required before GA.

**Resource Risks:**
- *Reduced team (4 people):* Cut file attachments from MVP. Core board + issues + workflow buildable by 2 FE + 2 BE.
- *Timeline pressure:* Structured filters instead of MJQL saves ~4 weeks. In-app-only notifications saves ~2 weeks.

## Functional Requirements

### Issue Management

- FR1: Users (Admin, Proj Admin, PM, Dev, QA) can create issues of type Epic, Story, Task, or Bug within a project
- FR2: Users can edit issue fields including title, description (Markdown), type, priority, and assignee
- FR3: Users can delete issues (Admin and Proj Admin only)
- FR4: Users can view issue detail panels showing all fields, comments, attachments, and linked issues
- FR5: Users can create child issues under an Epic, establishing parent-child hierarchy
- FR6: Users can link related issues (e.g., Bug linked to originating Story)
- FR7: Users can create a Bug directly from within a Story context, with auto-linking preserved
- FR8: System assigns sequential project-scoped keys to issues (e.g., MEGA-101)
- FR9: Users can soft-delete issues, with 30-day recovery window before hard deletion

### Board & Visualization

- FR10: Users can view project issues on a Kanban board organized by workflow status columns
- FR11: Users can drag and drop issues between board columns to transition status
- FR12: Users can view Epic progress as a percentage roll-up of child issue completion
- FR13: Users can view an Epic detail view showing all child issues and their statuses
- FR14: Board state syncs in real-time across all connected clients

### Workflow Engine

- FR15: Admins (Sys Admin, Proj Admin) can define and customize workflow statuses for a project
  - *Acceptance hint: Given a project with default workflow, When admin adds a custom status "Peer Review", Then it appears as a column on the board*
- FR16: Admins can configure transition rules (e.g., require Assignee before moving to In Progress)
  - *Acceptance hint: Given a transition rule requiring Assignee, When a user moves an unassigned issue to In Progress, Then the transition is blocked with a prompt to assign*
- FR17: Admins can configure mandatory fields on specific transitions (e.g., require Resolution reason for Done)
  - *Acceptance hint: Given a Bug with no Root Cause selected, When user moves it to Done, Then a modal requires Root Cause before saving*
- FR18: System enforces transition rules — blocks invalid transitions and prompts user for required data
- FR19: System provides default workflow template (Backlog → To Do → In Progress → In Review → QA → Done → Archived)
- FR20: Transitioning from Done → To Do (reopen) clears Resolution field and resets Time in Status
  - *Acceptance hint: Given issue MEGA-55 in Done with Resolution "Fixed", When reopened to To Do, Then Resolution is cleared and Time in Status resets to 0*

### Search & Filtering

- FR21: Users can filter issues by status, assignee, issue type, priority, and date range
- FR22: Users can combine two or more filters simultaneously
- FR23: Users can save and recall named filter configurations
- FR24: Filter results update in real-time as issues change

### Comments & Collaboration

- FR25: Users can add comments to issues with Markdown formatting
- FR26: Users can mention other users in comments using @username notation
- FR27: Comments appear in real-time for all users viewing the same issue
- FR28: System tracks comment timestamps and authorship

### Notifications

- FR29: Users receive in-app notifications for: issue assigned, mentioned in comment, status changed on watched issues
- FR30: Users can view a notification bell showing unread notification count
- FR31: Users can mark notifications as read individually or in bulk
- FR32: Users can configure which notification types they receive

### File Attachments

- FR33: Users can upload file attachments to issues (max 50MB per file)
- FR34: System validates file type and size before accepting uploads
- FR35: Users can download and preview attached files
- FR36: Attachments are stored encrypted at rest

### User & Access Management

- FR37: System Admin can create and manage user accounts
- FR38: System Admin can assign users to one of 6 roles (System Admin, Project Admin, PM, Developer, QA, Viewer)
- FR39: Project Admins can assign project-level roles within their projects
- FR40: System enforces role-based permissions for all actions per the RBAC matrix
- FR41: System returns 403 Forbidden and redirects to project home if a user attempts an unauthorized action
- FR42: Users can authenticate via email and password with secure session tokens

### Project Administration

- FR43: System Admin can create new projects with a unique project key
- FR44: Admins can configure project settings including workflow, roles, and notification preferences
- FR45: Admins can view an immutable audit trail of all mutation actions within a project

### Real-Time Synchronization

- FR46: All board changes (issue creation, status transitions, assignments) sync to all connected clients within 1 second
- FR47: System handles concurrent edits using optimistic locking with version tracking
- FR48: When a conflict is detected (409), system prompts the second user to review changes before retrying

### Data Management

- FR49: System maintains soft-deleted issues for 30 days before permanent hard deletion
- FR50: System masks PII in application logs
- FR51: All mutation actions are recorded in an append-only audit log

## Non-Functional Requirements

### Performance

- NFR1: Board page load completes in under 1 second for projects with up to 10,000 issues
- NFR2: Issue CRUD API responses return in under 200ms at the 95th percentile
- NFR3: WebSocket events propagate to all connected clients within 1 second of the triggering action
- NFR4: Structured filter queries return results in under 500ms for datasets up to 1 million issues
- NFR5: Drag-and-drop interactions provide visual feedback within 100ms (client-side optimistic update)

### Security

- NFR6: All data encrypted in transit via TLS 1.2+
- NFR7: All data encrypted at rest across all persistent data stores
- NFR8: Access tokens expire after 15 minutes; refresh tokens after 7 days
- NFR9: Authentication attempts are rate-limited to max 5 failed attempts per 15 minutes per account
- NFR10: Failed authentication attempts are logged with IP and timestamp (without logging passwords)
- NFR11: PII is masked in all application logs
- NFR12: All user-facing inputs are sanitized to prevent XSS and SQL injection

### Scalability

- NFR13: System supports 500 concurrent users per tenant in MVP without performance degradation
- NFR14: Database schema supports up to 5 million issues per tenant before requiring sharding
- NFR15: WebSocket server handles up to 2,000 concurrent connections per node
- NFR16: System supports horizontal scaling of application and WebSocket layers via container orchestration

### Reliability

- NFR17: System targets 99.5% uptime during Alpha and Beta phases
- NFR18: No data loss on application crash — all write operations are transactional
- NFR19: Graceful degradation: if WebSocket connection drops, client falls back to polling with user notification
- NFR20: Database backups run daily with point-in-time recovery capability

### Accessibility

- NFR21: All interactive elements are keyboard-navigable (Tab, Enter, Escape)
- NFR22: All form inputs have associated labels for screen reader compatibility
- NFR23: Color is never the sole indicator of state — icons or text labels accompany all status indicators
- NFR24: Minimum contrast ratio of 4.5:1 for all text content (WCAG 2.1 AA)

### Compliance

- NFR25: Immutable audit log captures all create, update, and delete operations with actor, timestamp, and before/after values
- NFR26: Soft-deleted data is permanently purged after 30 days via automated process
- NFR27: System supports data export for a specific user upon request (GDPR data portability)
- NFR28: All API error responses use standard error schema — no stack traces or internal details exposed to clients
