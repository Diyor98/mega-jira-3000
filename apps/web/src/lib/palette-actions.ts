export type PaletteCategory = 'Action' | 'Project' | 'Navigate' | 'Issue';

export interface PaletteActionContext {
  router: { push: (href: string) => void };
  projectKey: string | null;
  close: () => void;
}

export interface PaletteAction {
  id: string;
  label: string;
  category: PaletteCategory;
  shortcut?: string;
  visible?: (ctx: { projectKey: string | null }) => boolean;
  perform: (ctx: PaletteActionContext) => void;
}

export interface CachedProject {
  id: string;
  key: string;
  name: string;
}

const ISSUE_KEY_RE = /^[A-Z]+-\d+$/;

/**
 * sessionStorage keys used as a hand-off channel for cross-route palette
 * commands. The palette writes before `router.push`, and the target page's
 * mount-time effect drains the pending command. This avoids the race where
 * a synchronously-dispatched window event would fire before the target
 * page's listener mounts.
 */
export const PENDING_OPEN_ISSUE_KEY = 'mega:pending:open-issue';

/**
 * Static action list (v1). No dynamic/server-loaded actions.
 *
 * NOTES
 * - "Sign out" is intentionally omitted — the app has no reusable logout
 *   hook today; revisit with 9.2 if/when auth gains a sign-out surface.
 * - "Open Notifications" is intentionally omitted — there is no
 *   `/notifications` route in the app today (`apps/web/src/app/notifications/`
 *   does not exist). Spec AC3 #12 permits gating the action when the route
 *   is missing; this is the gate. Add back if the route lands.
 */
export const STATIC_ACTIONS: PaletteAction[] = [
  {
    id: 'navigate-board',
    label: 'Navigate: Board',
    category: 'Navigate',
    visible: ({ projectKey }) => projectKey !== null,
    perform: ({ router, projectKey, close }) => {
      if (projectKey) router.push(`/projects/${projectKey}`);
      close();
    },
  },
  {
    id: 'navigate-settings',
    label: 'Navigate: Settings',
    category: 'Navigate',
    visible: ({ projectKey }) => projectKey !== null,
    perform: ({ router, projectKey, close }) => {
      if (projectKey) router.push(`/projects/${projectKey}/settings`);
      close();
    },
  },
  {
    id: 'create-issue',
    label: 'Create Issue',
    category: 'Action',
    // Only visible on a project route. The dispatcher on `page.tsx` re-checks
    // `issue.create` permission before opening the form — palette is UI-only,
    // not the source of truth for authorization.
    visible: ({ projectKey }) => projectKey !== null,
    perform: ({ projectKey, close }) => {
      if (projectKey && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('mega:command:create-issue', {
            detail: { projectKey },
          }),
        );
      }
      close();
    },
  },
];

export function buildProjectActions(projects: CachedProject[]): PaletteAction[] {
  return projects.map((p) => ({
    id: `project-${p.id}`,
    label: `Go to project: ${p.name}`,
    category: 'Project' as const,
    perform: ({ router, close }) => {
      router.push(`/projects/${p.key}`);
      close();
    },
  }));
}

export function buildJumpToIssueAction(
  rawInput: string,
  currentProjectKey: string | null,
): PaletteAction | null {
  const trimmed = rawInput.trim().toUpperCase();
  if (!ISSUE_KEY_RE.test(trimmed)) return null;
  const projectKeyFromIssue = trimmed.split('-')[0];
  const targetProjectKey = projectKeyFromIssue || currentProjectKey;
  if (!targetProjectKey) return null;
  return {
    id: `jump-issue-${trimmed}`,
    label: `Jump to issue: ${trimmed}`,
    category: 'Issue',
    perform: ({ router, projectKey: currentKey, close }) => {
      if (typeof window !== 'undefined') {
        if (currentKey === targetProjectKey) {
          // Same project — target page is already mounted, synchronous
          // dispatch is safe. No navigation needed.
          window.dispatchEvent(
            new CustomEvent('mega:command:open-issue', {
              detail: { issueKey: trimmed, projectKey: targetProjectKey },
            }),
          );
        } else {
          // Cross-project — the target page has not mounted yet, so a
          // synchronous dispatch would race past the listener. Hand off via
          // sessionStorage; the target page drains it on mount once issues
          // have loaded.
          try {
            sessionStorage.setItem(
              PENDING_OPEN_ISSUE_KEY,
              JSON.stringify({
                issueKey: trimmed,
                projectKey: targetProjectKey,
              }),
            );
          } catch {
            // Storage disabled / quota exceeded — navigate anyway; the
            // issue simply won't auto-open.
          }
          router.push(`/projects/${targetProjectKey}`);
        }
      }
      close();
    },
  };
}

export function filterVisibleActions(
  actions: PaletteAction[],
  projectKey: string | null,
): PaletteAction[] {
  return actions.filter((a) => (a.visible ? a.visible({ projectKey }) : true));
}

/**
 * Substring match against lowercased labels. Sort: exact-prefix first,
 * then alphabetical by label. Category bucket ordering (Action, Project,
 * Navigate, Issue) is applied by the caller for the "empty input" case.
 */
export function filterActions(
  rawInput: string,
  actions: PaletteAction[],
): PaletteAction[] {
  const q = rawInput.trim().toLowerCase();
  if (q === '') return orderByCategory(actions);
  const matches = actions.filter((a) => a.label.toLowerCase().includes(q));
  return matches.sort((a, b) => {
    const aStarts = a.label.toLowerCase().startsWith(q);
    const bStarts = b.label.toLowerCase().startsWith(q);
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

const CATEGORY_ORDER: Record<PaletteCategory, number> = {
  Action: 0,
  Project: 1,
  Navigate: 2,
  Issue: 3,
};

function orderByCategory(actions: PaletteAction[]): PaletteAction[] {
  return [...actions].sort((a, b) => {
    const ca = CATEGORY_ORDER[a.category];
    const cb = CATEGORY_ORDER[b.category];
    if (ca !== cb) return ca - cb;
    return a.label.localeCompare(b.label);
  });
}
