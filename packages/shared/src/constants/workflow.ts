export const DEFAULT_WORKFLOW_STATUSES = [
  'Backlog',
  'To Do',
  'In Progress',
  'In Review',
  'QA',
  'Done',
  'Archived',
] as const;

export type WorkflowStatusName = (typeof DEFAULT_WORKFLOW_STATUSES)[number];
