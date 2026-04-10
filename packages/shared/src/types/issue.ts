export const ISSUE_TYPES = ['Epic', 'Story', 'Task', 'Bug'] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];
