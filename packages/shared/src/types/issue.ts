export const ISSUE_TYPES = ['Epic', 'Story', 'Task', 'Bug'] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];
