import { HttpException, HttpStatus } from '@nestjs/common';

export interface WorkflowRuleViolationPayload {
  id: string;
  ruleType: string;
  requiredField: string;
  fromStatusId: string | null;
  toStatusId: string;
}

export class WorkflowRuleViolationException extends HttpException {
  constructor(message: string, rule: WorkflowRuleViolationPayload) {
    super(
      {
        error: 'WorkflowRuleViolation',
        message,
        code: HttpStatus.UNPROCESSABLE_ENTITY,
        rule,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
