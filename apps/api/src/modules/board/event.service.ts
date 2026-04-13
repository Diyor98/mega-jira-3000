import { Injectable, Logger } from '@nestjs/common';
import { BoardGateway } from './board.gateway';

export interface IssueMovePayload {
  issueId: string;
  statusId: string;
  issueVersion: number;
  actorId: string;
  timestamp: string;
}

export interface IssueCreatePayload {
  issue: Record<string, unknown>;
  actorId: string;
  timestamp: string;
}

export interface IssueUpdatePayload {
  issueId: string;
  fields: Record<string, unknown>;
  actorId: string;
  timestamp: string;
}

export interface IssueDeletePayload {
  issueId: string;
  actorId: string;
  timestamp: string;
}

export interface IssueRestorePayload {
  issueId: string;
  actorId: string;
  timestamp: string;
}

export interface CommentCreatePayload {
  issueId: string;
  comment: Record<string, unknown>;
  actorId: string;
  timestamp: string;
}

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(private readonly gateway: BoardGateway) {}

  // Self-echo: server cannot exclude the actor's socket because mutations
  // arrive via REST and have no bound socket. Clients filter their own
  // optimistic mutations using actorId + a short-lived recent-mutations set.
  private emit(event: string, projectKey: string, payload: unknown): void {
    if (!this.gateway.server) {
      this.logger.warn(`Skipped ${event} for ${projectKey}: gateway server not initialized`);
      return;
    }
    const room = `project:${projectKey}`;
    this.gateway.server.to(room).emit(event, payload);
  }

  emitIssueMoved(projectKey: string, payload: IssueMovePayload): void {
    this.emit('issue.moved', projectKey, payload);
    this.logger.log(`Emitted issue.moved to project:${projectKey} | issue=${payload.issueId}`);
  }

  emitIssueCreated(projectKey: string, payload: IssueCreatePayload): void {
    this.emit('issue.created', projectKey, payload);
    this.logger.log(`Emitted issue.created to project:${projectKey}`);
  }

  emitIssueUpdated(projectKey: string, payload: IssueUpdatePayload): void {
    this.emit('issue.updated', projectKey, payload);
    this.logger.log(`Emitted issue.updated to project:${projectKey} | issue=${payload.issueId}`);
  }

  emitIssueDeleted(projectKey: string, payload: IssueDeletePayload): void {
    this.emit('issue.deleted', projectKey, payload);
    this.logger.log(`Emitted issue.deleted to project:${projectKey} | issue=${payload.issueId}`);
  }

  emitIssueRestored(projectKey: string, payload: IssueRestorePayload): void {
    this.emit('issue.restored', projectKey, payload);
    this.logger.log(`Emitted issue.restored to project:${projectKey} | issue=${payload.issueId}`);
  }

  emitCommentCreated(projectKey: string, payload: CommentCreatePayload): void {
    this.emit('comment.created', projectKey, payload);
    this.logger.log(
      `Emitted comment.created to project:${projectKey} | issue=${payload.issueId}`,
    );
  }
}
