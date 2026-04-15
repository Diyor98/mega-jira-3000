---
stepsCompleted: [1, 2, 3, 4]
status: complete
lastStep: 4
inputDocuments:
  - "_bmad-output/planning-artifacts/prd.md"
  - "_bmad-output/planning-artifacts/architecture.md"
  - "_bmad-output/planning-artifacts/ux-design-specification.md"
---

# Mega Jira 3000 - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Mega Jira 3000, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR1: Users (Admin, Proj Admin, PM, Dev, QA) can create issues of type Epic, Story, Task, or Bug within a project
- FR2: Users can edit issue fields including title, description (Markdown), type, priority, and assignee
- FR3: Users can delete issues (Admin and Proj Admin only)
- FR4: Users can view issue detail panels showing all fields, comments, attachments, and linked issues
- FR5: Users can create child issues under an Epic, establishing parent-child hierarchy
- FR6: Users can link related issues (e.g., Bug linked to originating Story)
- FR7: Users can create a Bug directly from within a Story context, with auto-linking preserved
- FR8: System assigns sequential project-scoped keys to issues (e.g., MEGA-101)
- FR9: Users can soft-delete issues, with 30-day recovery window before hard deletion
- FR10: Users can view project issues on a Kanban board organized by workflow status columns
- FR11: Users can drag and drop issues between board columns to transition status
- FR12: Users can view Epic progress as a percentage roll-up of child issue completion
- FR13: Users can view an Epic detail view showing all child issues and their statuses
- FR14: Board state syncs in real-time across all connected clients
- FR15: Admins (Sys Admin, Proj Admin) can define and customize workflow statuses for a project
- FR16: Admins can configure transition rules (e.g., require Assignee before moving to In Progress)
- FR17: Admins can configure mandatory fields on specific transitions (e.g., require Resolution reason for Done)
- FR18: System enforces transition rules — blocks invalid transitions and prompts user for required data
- FR19: System provides default workflow template (Backlog → To Do → In Progress → In Review → QA → Done → Archived)
- FR20: Transitioning from Done → To Do (reopen) clears Resolution field and resets Time in Status
- FR21: Users can filter issues by status, assignee, issue type, priority, and date range
- FR22: Users can combine two or more filters simultaneously
- FR23: Users can save and recall named filter configurations
- FR24: Filter results update in real-time as issues change
- FR25: Users can add comments to issues with Markdown formatting
- FR26: Users can mention other users in comments using @username notation
- FR27: Comments appear in real-time for all users viewing the same issue
- FR28: System tracks comment timestamps and authorship
- FR29: Users receive in-app notifications for: issue assigned, mentioned in comment, status changed on watched issues
- FR30: Users can view a notification bell showing unread notification count
- FR31: Users can mark notifications as read individually or in bulk
- FR32: Users can configure which notification types they receive
- FR33: Users can upload file attachments to issues (max 50MB per file)
- FR34: System validates file type and size before accepting uploads
- FR35: Users can download and preview attached files
- FR36: Attachments are stored encrypted at rest
- FR37: System Admin can create and manage user accounts
- FR38: System Admin can assign users to one of 6 roles (System Admin, Project Admin, PM, Developer, QA, Viewer)
- FR39: Project Admins can assign project-level roles within their projects
- FR40: System enforces role-based permissions for all actions per the RBAC matrix
- FR41: System returns 403 Forbidden and redirects to project home if a user attempts an unauthorized action
- FR42: Users can authenticate via email and password with secure session tokens
- FR43: System Admin can create new projects with a unique project key
- FR44: Admins can configure project settings including workflow, roles, and notification preferences
- FR45: Admins can view an immutable audit trail of all mutation actions within a project
- FR46: All board changes (issue creation, status transitions, assignments) sync to all connected clients within 1 second
- FR47: System handles concurrent edits using optimistic locking with version tracking
- FR48: When a conflict is detected (409), system prompts the second user to review changes before retrying
- FR49: System maintains soft-deleted issues for 30 days before permanent hard deletion
- FR50: System masks PII in application logs
- FR51: All mutation actions are recorded in an append-only audit log

### NonFunctional Requirements

- NFR1: Board page load completes in under 1 second for projects with up to 10,000 issues
- NFR2: Issue CRUD API responses return in under 200ms at the 95th percentile
- NFR3: WebSocket events propagate to all connected clients within 1 second of the triggering action
- NFR4: Structured filter queries return results in under 500ms for datasets up to 1 million issues
- NFR5: Drag-and-drop interactions provide visual feedback within 100ms (client-side optimistic update)
- NFR6: All data encrypted in transit via TLS 1.2+
- NFR7: All data encrypted at rest across all persistent data stores
- NFR8: Access tokens expire after 15 minutes; refresh tokens after 7 days
- NFR9: Authentication attempts are rate-limited to max 5 failed attempts per 15 minutes per account
- NFR10: Failed authentication attempts are logged with IP and timestamp (without logging passwords)
- NFR11: PII is masked in all application logs
- NFR12: All user-facing inputs are sanitized to prevent XSS and SQL injection
- NFR13: System supports 500 concurrent users per tenant in MVP without performance degradation
- NFR14: Database schema supports up to 5 million issues per tenant before requiring sharding
- NFR15: WebSocket server handles up to 2,000 concurrent connections per node
- NFR16: System supports horizontal scaling of application and WebSocket layers via container orchestration
- NFR17: System targets 99.5% uptime during Alpha and Beta phases
- NFR18: No data loss on application crash — all write operations are transactional
- NFR19: Graceful degradation: if WebSocket connection drops, client falls back to polling with user notification
- NFR20: Database backups run daily with point-in-time recovery capability
- NFR21: All interactive elements are keyboard-navigable (Tab, Enter, Escape)
- NFR22: All form inputs have associated labels for screen reader compatibility
- NFR23: Color is never the sole indicator of state — icons or text labels accompany all status indicators
- NFR24: Minimum contrast ratio of 4.5:1 for all text content (WCAG 2.1 AA)
- NFR25: Immutable audit log captures all create, update, and delete operations with actor, timestamp, and before/after values
- NFR26: Soft-deleted data is permanently purged after 30 days via automated process
- NFR27: System supports data export for a specific user upon request (GDPR data portability)
- NFR28: All API error responses use standard error schema — no stack traces or internal details exposed to clients

### Additional Requirements

- AR1: Initialize Turborepo monorepo with create-next-app (apps/web) + nest new (apps/api) + shared packages
- AR2: Configure Docker Compose for local dev (PostgreSQL + Redis)
- AR3: Implement tenant provisioning service (create DB, run migrations, seed defaults)
- AR4: Set up GitHub Actions CI/CD pipeline (lint → test → build → deploy)
- AR5: Configure shared Zod validation schemas in packages/shared
- AR6: Implement NestJS audit-log interceptor for all mutation controllers
- AR7: Implement standard API response wrapper ({ data } / { data, pagination } / { error, message, code })
- AR8: Configure pino structured JSON logging with PII masking
- AR9: Implement health check endpoints (/health)

### UX Design Requirements

- UX-DR1: Implement IssueCard molecule (key + type badge + title + avatar + priority dot, states: default/hover/dragging/drop-target/disabled)
- UX-DR2: Implement BoardColumn organism (sticky header with count, card stack with 4px gap, inline create, drop zones)
- UX-DR3: Implement SlideOverPanel organism (480px right-side, slide-in 200ms, field grid, comment thread, Esc to close)
- UX-DR4: Implement FilterBar organism (chip dropdowns, active chips with remove, saved presets, clear all)
- UX-DR5: Implement CommandPalette organism (Cmd+K, 520px overlay, Combobox, action list with shortcut hints)
- UX-DR6: Implement NotificationBell molecule (bell icon, red unread badge, dropdown notification list)
- UX-DR7: Implement WorkflowPrompt molecule (inline slide-down at card position, auto-focus, Enter submit, Esc cancel)
- UX-DR8: Implement design tokens in tailwind.config.js (11 color tokens, Inter typography scale, 4px spacing, 4px radius)
- UX-DR9: Implement keyboard shortcuts system (14 shortcuts including Cmd+K, arrow nav, single-key transitions I/R/D)
- UX-DR10: Implement skeleton loader pattern (board column + card shapes, no spinners)
- UX-DR11: Implement empty state pattern (CTAs in empty boards/columns, field hints in empty panels)
- UX-DR12: Implement toast notification system (success auto-dismiss 3s, error persist with recovery action)
- UX-DR13: Implement WCAG 2.1 AA baseline (2px focus indicators, ARIA labels, semantic HTML, screen reader announcements)
- UX-DR14: Implement responsive breakpoints (1440+ full, 1024-1439 compact sidebar, 768-1023 hidden sidebar)

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1-FR9 | Epic 2 | Issue Management |
| FR10-FR14 | Epic 3 | Board & Visualization |
| FR15-FR18, FR20 | Epic 4 | Workflow Engine |
| FR19 | Epic 1 | Default workflow template |
| FR21-FR24 | Epic 5 | Search & Filtering |
| FR25-FR28 | Epic 6 | Comments & Collaboration |
| FR29-FR32 | Epic 6 | Notifications |
| FR33-FR36 | Epic 7 | File Attachments |
| FR37-FR38, FR42 | Epic 1 | User Auth & Creation |
| FR39-FR41 | Epic 8 | RBAC Enforcement |
| FR43 | Epic 1 | Project Creation |
| FR44-FR45 | Epic 8 | Project Admin & Audit |
| FR46-FR48 | Epic 3 | Real-Time Sync |
| FR49-FR51 | Epic 7 | Data Management |

**Coverage: 51/51 FRs mapped (100%)**

## Epic List

### Epic 1: Project Foundation & User Authentication
Users can register, log in, and create their first project. FRs: FR37, FR38, FR42, FR43, FR19. ARs: AR1, AR2, AR5, AR7, AR8, AR9, UX-DR8.

### Epic 2: Core Issue Management
Users can create, view, edit, and organize issues within a project. FRs: FR1-FR9. ARs: AR6, UX-DR1, UX-DR3, UX-DR11.

### Epic 3: Kanban Board Experience
Users can visualize and manage work on an interactive board with real-time sync. FRs: FR10-FR14, FR46-FR48. ARs: UX-DR2, UX-DR7, UX-DR10, UX-DR13.

### Epic 4: Workflow Engine & Rules
Admins can customize statuses and enforce transition rules. FRs: FR15-FR18, FR20. ARs: AR3.

### Epic 5: Search, Filtering & Saved Views
Users can filter and save views for efficient work discovery. FRs: FR21-FR24. ARs: UX-DR4.

### Epic 6: Team Collaboration
Users can communicate via comments and receive notifications. FRs: FR25-FR32. ARs: UX-DR6, UX-DR12.

### Epic 7: File Attachments & Data Integrity
Users can attach files and trust data safety. FRs: FR33-FR36, FR49-FR51.

### Epic 8: RBAC & Project Administration
Admins can manage roles and project settings. FRs: FR39-FR41, FR44-FR45. ARs: UX-DR14.

### Epic 9: Power User Experience
Cmd+K, keyboard shortcuts, List view, design system polish. ARs: AR4, UX-DR5, UX-DR9, UX-DR14.

**Dependency chain:** Epic 1 → Epic 2 → Epic 3 → Epic 4. Epics 5-9 independent of each other, build on 1-3.

## Epic 1: Project Foundation & User Authentication

Users can register, log in, and create their first project — the minimum viable platform entry point.

### Story 1.1: Initialize Monorepo and Development Environment

As a **developer**, I want the project scaffolded as a Turborepo monorepo with Next.js, NestJS, and shared packages, So that the team has a consistent, working development environment from day one.

**Acceptance Criteria:**

**Given** a fresh clone of the repository **When** I run `pnpm install && pnpm dev` **Then** Next.js starts on port 3000 and NestJS API starts on port 3001 **And** PostgreSQL and Redis are running via `docker-compose up` **And** `packages/shared` types are importable from both apps **And** design tokens are configured in tailwind.config.js per UX-DR8

### Story 1.2: User Registration

As a **new user**, I want to create an account with email and password, So that I can access the platform.

**Acceptance Criteria:**

**Given** I am on the registration page **When** I submit a valid email and password (min 8 chars, 1 uppercase, 1 number) **Then** my account is created and I am redirected to the login page **And** my password is stored hashed with bcrypt

**Given** I submit an email that already exists **When** I click register **Then** I see an error: "Email already registered"

### Story 1.3: User Login & Session Management

As a **registered user**, I want to log in with my email and password, So that I can access my projects securely.

**Acceptance Criteria:**

**Given** I have a registered account **When** I submit correct credentials **Then** I receive JWT access token (httpOnly cookie, 15min) and refresh token (7-day) **And** I am redirected to the main app

**Given** I submit incorrect credentials **Then** I see "Invalid email or password" **And** the failed attempt is logged with IP and timestamp (NFR10)

**Given** 5 failed attempts in 15 minutes **Then** I am temporarily blocked (NFR9)

**Given** my access token expires **Then** the refresh token automatically obtains a new one without user action

### Story 1.4: Create First Project

As a **System Admin**, I want to create a new project with a unique key, So that my team has a workspace to track issues.

**Acceptance Criteria:**

**Given** I am logged in as System Admin **When** I click "+ New Project" and enter name "Mega Platform" with key "MEGA" **Then** a project is created with default workflow (7 statuses per FR19) **And** the project appears in my sidebar **And** I land on an empty board with column headers visible

**Given** I enter a project key that already exists **Then** I see "Project key already in use"

### Story 1.5: API Foundation & Health Check

As a **platform operator**, I want standardized API responses, structured logging, and health checks, So that the platform is monitorable and consistent.

**Acceptance Criteria:**

**Given** any successful API response **Then** format is `{ data: T }` (AR7)

**Given** any API error **Then** format is `{ error, message, code }` with no stack traces (NFR28)

**Given** the API is running **When** I call GET /health **Then** I receive `{ status: "ok" }` with 200

**And** all logs use pino structured JSON with PII masking (AR8, NFR11)

## Epic 2: Core Issue Management

Users can create, view, edit, and organize issues within a project.

### Story 2.1: Create Issues

As a **team member** (Admin, Proj Admin, PM, Dev, QA), I want to create issues of type Epic, Story, Task, or Bug, So that I can track work items.

**Acceptance Criteria:**

**Given** I am on a project board **When** I click "+" or press Cmd+N **Then** I see a creation form with: title (required), type, priority, assignee, description (Markdown)

**Given** I submit **Then** the issue receives a sequential key (e.g., MEGA-101) per FR8 **And** it appears on the board with IssueCard rendering per UX-DR1

### Story 2.2: View Issue Detail Panel

As a **team member**, I want to view full issue details in a slide-over panel, So that I can see context without leaving the board.

**Acceptance Criteria:**

**Given** I click an issue card **Then** a 480px panel slides in from the right per UX-DR3 **And** the board remains visible behind it

**When** I press Esc **Then** the panel closes, board scroll position preserved

**Given** no description **Then** shows "No description yet — click to add" per UX-DR11

### Story 2.3: Edit Issue Fields

As a **team member**, I want to edit issue fields inline, So that I can update information without a separate edit mode.

**Acceptance Criteria:**

**Given** I am in the detail panel **When** I click a field **Then** it becomes editable (dropdown, input, or date picker) **And** changes save automatically on click-away or Enter **And** issue_version increments **And** mutation is audit-logged (AR6, NFR25)

### Story 2.4: Issue Hierarchy — Epic Parent-Child

As a **PM**, I want to create child issues under an Epic, So that I can break down features into manageable work.

**Acceptance Criteria:**

**Given** I am viewing an Epic **When** I click "Add Child Issue" **Then** I can create a Story/Task/Bug with parent_id set to the Epic

**Given** an Epic has 5 children, 3 completed **Then** the Epic card shows "60%" progress roll-up per FR12

### Story 2.5: Issue Linking & Bug Creation from Story

As a **QA engineer**, I want to create a Bug from a Story with auto-linking, So that bugs trace to their source.

**Acceptance Criteria:**

**Given** I am viewing a Story **When** I click "Create Bug" **Then** form pre-fills: parent link, type Bug, reporter as me per FR7 **And** Bug is auto-linked in Story's "Linked Issues" per FR6

### Story 2.6: Delete & Soft-Delete Issues

As an **Admin**, I want to delete issues with 30-day recovery, So that accidental deletions are recoverable.

**Acceptance Criteria:**

**Given** I am Admin viewing an issue **When** I click "Delete" and confirm **Then** issue is soft-deleted per FR9

**Given** I am a Developer **Then** delete action is not available (FR3)

## Epic 3: Kanban Board Experience

Interactive board with drag-and-drop and real-time sync — the defining experience.

### Story 3.1: Board View with Columns

As a **team member**, I want to view issues organized in Kanban columns, So that I can see work status at a glance.

**Acceptance Criteria:**

**Given** I navigate to `/[projectKey]/board` **Then** columns render for each workflow status with cards per UX-DR2 **And** column headers are sticky with status name + count **And** board loads within 1 second (NFR1) **And** skeleton loaders appear first per UX-DR10 **And** empty columns show dashed drop zone per UX-DR11

### Story 3.2: Drag-and-Drop Status Transitions

As a **team member**, I want to drag cards between columns, So that I can update progress without forms.

**Acceptance Criteria:**

**Given** I drag a card over a valid column **Then** blue drop-zone indicator shows

**Given** I drop a card **Then** it snaps into the new column within 100ms (NFR5) **And** server confirms within 200ms (NFR2) **And** status_id and issue_version update **And** mutation is audit-logged

**Given** I press Cmd+Z within 5 seconds **Then** the card returns to its previous column

### Story 3.3: Real-Time Board Synchronization

As a **team member**, I want the board to update when teammates make changes, So that I see current information.

**Acceptance Criteria:**

**Given** User A drags a card **Then** User B sees it move within 1 second (NFR3) **And** a subtle pulse indicates the change

**Given** WebSocket drops **Then** "Reconnecting..." indicator appears, client falls back to polling (NFR19)

### Story 3.4: Optimistic Locking & Conflict Resolution

As a **team member**, I want to know when someone else edits the same issue, So that I don't overwrite changes.

**Acceptance Criteria:**

**Given** User A saves first (version increments) **When** User B saves **Then** 409 Conflict returned per FR48 **And** inline notification: "Updated by User A. [Review Changes]" **And** card returns to original column smoothly

## Epic 4: Workflow Engine & Rules

Admins can customize statuses and enforce transition rules.

### Story 4.1: Custom Workflow Statuses

As a **Project Admin**, I want to define custom workflow statuses, So that the board reflects my team's process.

**Acceptance Criteria:**

**Given** I am in workflow settings **When** I add "Peer Review" status **Then** it appears as a board column per FR15

**Given** I delete a status with issues **Then** I must move existing issues to another status first

### Story 4.2: Transition Rules Configuration

As a **Project Admin**, I want to configure transition rules, So that my team follows the agreed process.

**Acceptance Criteria:**

**Given** I add rule "Require Assignee" for "To Do → In Progress" **When** a user drags an unassigned issue **Then** WorkflowPrompt slides down with assignee dropdown per UX-DR7, FR16, FR18

### Story 4.3: Mandatory Fields on Transitions

As a **Project Admin**, I want to require fields on specific transitions, So that quality data is always captured.

**Acceptance Criteria:**

**Given** "Bug → Done" requires "Root Cause" **When** user drags Bug to Done **Then** WorkflowPrompt shows Root Cause dropdown per FR17

**Given** Done issue reopened to To Do **Then** Resolution clears, Time in Status resets per FR20

## Epic 5: Search, Filtering & Saved Views

Efficient issue discovery through structured filters.

### Story 5.1: Structured Filter Bar

As a **team member**, I want to filter by status, assignee, type, priority, and date range, So that I can focus on relevant issues.

**Acceptance Criteria:**

**Given** I click a filter chip **Then** dropdown shows options **And** selecting adds an active chip per UX-DR4

**Given** multiple active filters **Then** only matching issues shown per FR22 **And** "Clear All" resets filters

### Story 5.2: Saved Filter Presets

As a **PM**, I want to save and recall filter configurations, So that I can switch views quickly.

**Acceptance Criteria:**

**Given** active filters applied **When** I click "Save Filter" and name it **Then** preset saved and appears in dropdown per FR23

**Given** I select a saved preset **Then** filters apply instantly and update in real-time per FR24

## Epic 6: Team Collaboration

Comments and notifications for in-platform communication.

### Story 6.1: Issue Comments with Markdown

As a **team member**, I want to add Markdown comments, So that I can discuss work in context.

**Acceptance Criteria:**

**Given** I am in the detail panel **When** I submit a comment **Then** it appears with name, avatar, timestamp per FR25, FR28

**Given** another user is viewing the same issue **Then** they see my comment in real-time per FR27

### Story 6.2: @Mention Users in Comments

As a **team member**, I want to @mention teammates, So that they're notified.

**Acceptance Criteria:**

**Given** I type "@" in a comment **Then** dropdown shows matching members **And** selecting inserts @username as link per FR26

### Story 6.3: In-App Notification System

As a **team member**, I want notifications for assignments, mentions, and status changes, So that I stay informed.

**Acceptance Criteria:**

**Given** I am assigned/mentioned/watched issue changes **Then** bell shows unread count per FR30, UX-DR6 **And** clicking bell shows dropdown **And** clicking notification navigates to issue

**Given** unread notifications **When** I click "Mark all read" **Then** all marked read per FR31

### Story 6.4: Notification Preferences

As a **team member**, I want to configure notification types, So that I'm not overwhelmed.
sdf
**Acceptance Criteria:**

**Given** I toggle off "Status Changes" in settings **Then** I no longer receive those notifications per FR32 **And** toast confirms "Preferences saved" per UX-DR12

## Epic 7: File Attachments & Data Integrity

File uploads and reliable data lifecycle.

### Story 7.1: File Upload & Download

As a **team member**, I want to attach files to issues, So that I can share documents alongside work.

**Acceptance Criteria:**

**Given** I drag a file or click "Attach File" **Then** file uploads (max 50MB) and appears in attachment list per FR33

**Given** file exceeds 50MB or invalid type **Then** error shown per FR34

**Given** attachment exists **When** I click it **Then** I can download or preview per FR35 **And** stored encrypted at rest per FR36

### Story 7.2: Soft Delete & Data Lifecycle

As a **System Admin**, I want 30-day recovery on deletions, So that data isn't permanently lost.

**Acceptance Criteria:**

**Given** soft-deleted issue **When** 30 days pass **Then** permanently purged per FR49, NFR26

**Given** any mutation **Then** recorded in audit log with actor, timestamp, before/after per FR51, NFR25

## Epic 8: RBAC & Project Administration

Role-based access and project settings.

### Story 8.1: Project-Level Role Assignment

As a **Project Admin**, I want to assign roles to members, So that permissions are appropriate.

**Acceptance Criteria:**

**Given** I am on settings → Team **When** I change a member's role **Then** change takes effect immediately per FR39

### Story 8.2: Permission Enforcement

As a **system**, I want to enforce RBAC on every action, So that unauthorized actions are blocked.

**Acceptance Criteria:**

**Given** Viewer creates issue **Then** 403 Forbidden per FR41 **And** toast + redirect to project home

**Given** role revoked mid-action **Then** next request fails with 403 gracefully

### Story 8.3: Project Settings & Audit Trail

As a **Project Admin**, I want to configure settings and view audit trail, So that I can manage my project.

**Acceptance Criteria:**

**Given** I navigate to Audit Trail tab **Then** chronological list of mutations per FR45

**Given** I update settings **Then** changes take effect immediately per FR44

### Story 8.4: Responsive Layout Breakpoints

As a **user**, I want the layout to adapt to screen size, So that I can use the platform on different devices.

**Acceptance Criteria:**

**Given** 1440px+ **Then** 240px sidebar, 6 columns, 480px detail per UX-DR14

**Given** 1024-1439px **Then** 48px icon sidebar, 400px detail

**Given** 768-1023px **Then** sidebar hidden, full-width detail overlay

## Epic 9: Power User Experience

Maximum speed for daily users.

### Story 9.1: Command Palette (Cmd+K)

As a **power user**, I want a command palette for instant actions, So that I never navigate menus.

**Acceptance Criteria:**

**Given** I press Cmd+K **Then** palette opens with search + actions per UX-DR5 **And** each action shows shortcut **And** typing filters results **And** Enter executes, Esc closes

### Story 9.2: Keyboard Shortcuts

As a **power user**, I want keyboard shortcuts for board actions, So that I can operate without a mouse.

**Acceptance Criteria:**

**Given** issue focused **When** I press `I` **Then** moves to "In Progress" per UX-DR9

**Given** I press `/` **Then** filter input focused

**Given** I press `?` **Then** shortcut help overlay shows all 14 shortcuts

### Story 9.3: List View

As a **PM**, I want a List view, So that I can triage with dense, sortable data.

**Acceptance Criteria:**

**Given** I click "List" toggle **Then** issues display in table grouped by status **And** clicking issue opens the issue detail modal (Story 9.5) **And** active filters carry over from Board

### Story 9.5: Issue Detail Modal & Permalink

As a **user**, I want issue detail to open as a centered modal (not a side slide-over) **and** I want each issue to have a shareable URL, So that I can focus on one issue without losing board context AND link teammates to a specific issue.

**Background:** The original Story 2.2 implementation used a 480px right-side `SlideOverPanel`. At lg viewports this cramped the 2-column field grid and there was no way to share a direct link to an issue. This story replaces the slide-over with a Jira-style centered modal AND introduces a dedicated route per issue.

**Acceptance Criteria:**

**Given** I click an issue card on the board or a row on the list **Then** a centered modal opens (`max-w-3xl`, `max-h-[90vh]`) over a `bg-black/50` backdrop **And** the underlying board remains visible but non-interactive **And** Esc, click-outside, and the close button all dismiss it.

**Given** the modal is open **Then** the header shows the issue key as an `<a href="/projects/[key]/issues/[issueKey]">` link **And** Cmd/Ctrl+Click on the key opens that URL in a new browser tab **And** the new tab renders a full-page view of the same `IssueDetailPanel` body without the modal chrome.

**Given** I navigate directly to `/projects/[key]/issues/[issueKey]` **Then** the dedicated issue page loads server-side with the same content as the modal **And** a "Back to board" link returns me to `/projects/[key]` **And** if the issue does not exist or I lack `project.read`, I get a friendly 404/403.

**Given** the modal is open **And** I open the command palette (Cmd+K) **And** I select "Open issue MEGA-123" **Then** the new issue replaces the current one in the modal (no double-modal stacking).

**Given** the focus trap is active in the modal **Then** Tab cycles only inside the modal **And** focus returns to the originating card/row on close (per UX-DR1).

**Given** I'm on a < 768px viewport **Then** the modal renders as a full-screen sheet instead of a centered card.

**Files affected (informational, ~6 files):** new `components/issue-detail-modal.tsx`, new route `app/projects/[key]/issues/[issueKey]/page.tsx`, modified `app/projects/[key]/page.tsx` (swap `SlideOverPanel` → `IssueDetailModal`, link the key), modified `components/issue-card-content.tsx` and `components/issue-list-view.tsx` (key becomes a real link with `Cmd+Click` semantics), modified `lib/palette-actions.ts` (open-issue action navigates to the permalink route or replaces the modal). The existing `slide-over-panel.tsx` stays for now (used elsewhere) but the issue-detail usage is removed.

### Story 9.6: Edit Assignee in Issue Detail

As a **team member**, I want to **change an issue's assignee directly from the detail view**, So that I can re-route work without leaving the issue context (no extra menus, no separate "edit" modal).

**Background:** The issue detail panel currently displays the assignee as a truncated UUID (`apps/web/src/components/issue-detail-panel.tsx:391`) and is read-only. The backend's `PATCH /issues/:id` endpoint already accepts `assigneeId` (nullable), and the `users` list is already loaded by the project page and passed into `<IssueDetailPanel>` as a prop. Story 9.6 wires the existing pieces together with an inline editor matching the existing priority-edit pattern at line 366.

**Acceptance Criteria:**

**Given** I am viewing an issue in the detail modal AND I have the `issue.edit` permission **When** I click the Assignee field **Then** the value swaps to a `<select>` populated with all project users (showing each user's email prefix) plus an "Unassigned" sentinel option **And** the current assignee is preselected.

**Given** the assignee select is open **When** I pick a different user **Then** the change auto-saves via `PATCH /issues/:id` with the new `assigneeId` **And** the panel reflects the new assignee email immediately **And** a success toast confirms "Assignee updated".

**Given** the assignee select is open **When** I pick "Unassigned" **Then** the request is sent with `assigneeId: null` **And** the field shows "Unassigned" in tertiary text style.

**Given** I press Esc inside the open select **Then** the edit is cancelled and the field reverts without firing a request.

**Given** the PATCH request fails (network, 403, conflict) **Then** an error toast surfaces the server message **And** the field reverts to the previous value (no optimistic-update lie).

**Given** I do NOT have `issue.edit` permission **Then** the assignee field renders as plain read-only text (the existing read-only style) and clicking it does nothing.

**Given** the `users` list is empty (still loading) **Then** the field falls back to read-only text until the list arrives.

**Files affected (informational, ~2 files):** `apps/web/src/components/issue-detail-panel.tsx` (replace the read-only block at lines 387–393 with the same click-to-edit pattern used for priority at lines 365–376; reuse the existing `users` prop and the `PATCH` helper). Optionally also update the assignee display from "first 8 chars of UUID" to "email prefix" in the same patch — same data shape.

### Story 9.7: Human-Readable Status & Reporter in Issue Detail

As a **user viewing an issue**, I want the **Status** and **Reporter** fields in the detail view to show the **workflow status name** and the **reporter's email prefix** instead of truncated UUIDs, So that I can understand at a glance which column the issue lives in and who reported it — without cross-referencing IDs.

**Background:** Both fields have sat as read-only truncated UUIDs since Story 2.2:
- `apps/web/src/components/issue-detail-panel.tsx:397` — `{issue.statusId.slice(0, 8)}...`
- `apps/web/src/components/issue-detail-panel.tsx:453` — `{issue.reporterId.slice(0, 8)}...`

The reporter fix is trivial: the `users` prop is already threaded into `<IssueDetailPanel>` (used for assignee, workflow-prompt, and now for assignee edit in Story 9.6). One lookup, same pattern as the new `assigneeDisplay` const at line 247.

The status fix needs **one additional prop**: the project page (`apps/web/src/app/projects/[key]/page.tsx`) already owns a `statuses` array (`Array<{id: string; name: string; position: number}>`) that drives the board columns. It is NOT currently passed into `<IssueDetailPanel>`. Story 9.7 adds a new optional `statuses?: Status[]` prop and threads it through from both the modal usage at `page.tsx:1247` AND the dedicated permalink route at `app/projects/[key]/issues/[issueKey]/page.tsx`.

**Acceptance Criteria:**

**Given** I open an issue in the detail modal **Then** the Status field shows the workflow status name (e.g., "In Progress") in primary text style, not a truncated UUID **And** when the status lookup fails (stale or missing `statuses` prop), it falls back to the first 8 chars of the UUID so the page never crashes.

**Given** I open an issue in the detail modal **Then** the Reporter field shows the email prefix of the reporter's address (e.g., `demo` for `demo@example.com`) in primary text style, not a truncated UUID **And** when the user lookup fails (stale or missing user), it falls back to the first 8 chars of the UUID.

**Given** I navigate directly to `/projects/[key]/issues/[issueKey]` **Then** the dedicated permalink route ALSO shows status name and reporter email prefix — the dedicated route page must load both `users` AND `statuses` (new fetch) before rendering the panel's field grid.

**Given** the `statuses` prop is not provided or has loaded lazily **Then** the Status field shows the UUID fallback in the read-only style — no crash, no empty string, no flicker. Same behavior for a missing `users` list on Reporter.

**Given** Status and Reporter are **read-only** fields (per the existing comments at lines 393 and 451) **Then** neither field gains click-to-edit behavior in this story — only the display changes.

**Files affected (informational, ~4 files):**
- `apps/web/src/components/issue-detail-panel.tsx` — add `statuses?` prop, compute `statusDisplay` and `reporterDisplay` alongside the existing `assigneeDisplay`, replace the two `.slice(0, 8)` spans.
- `apps/web/src/app/projects/[key]/page.tsx` — pass `statuses={statuses}` into the `<IssueDetailPanel>` mounted inside the modal.
- `apps/web/src/app/projects/[key]/issues/[issueKey]/page.tsx` — fetch the project's `statuses` list alongside `users`, pass both into `<IssueDetailPanel>`.
- (No API changes — the existing `GET /projects/:key/statuses` endpoint already returns the shape we need.)

### Story 9.4: CI/CD Pipeline Setup

As a **DevOps engineer**, I want automated testing and deployment, So that code quality is enforced.

**Acceptance Criteria:**

**Given** a PR is opened **When** GitHub Actions runs **Then** pipeline: lint → type-check → unit tests → build per AR4 **And** Turborepo caching for speed **And** failing steps block merge
