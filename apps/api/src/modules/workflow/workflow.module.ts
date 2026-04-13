import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowRulesController } from './workflow-rules.controller';
import { WorkflowService } from './workflow.service';

@Module({
  controllers: [WorkflowController, WorkflowRulesController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
