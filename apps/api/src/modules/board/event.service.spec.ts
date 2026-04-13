import { EventService } from './event.service';

describe('EventService', () => {
  let service: EventService;
  let mockEmit: jest.Mock;
  let mockTo: jest.Mock;

  beforeEach(() => {
    mockEmit = jest.fn();
    mockTo = jest.fn().mockReturnValue({ emit: mockEmit });

    const mockGateway = {
      server: { to: mockTo },
    };

    service = new EventService(mockGateway as never);
  });

  describe('emitIssueMoved', () => {
    it('emits issue.moved to the correct project room', () => {
      const payload = {
        issueId: 'issue-1',
        statusId: 'status-2',
        issueVersion: 3,
        actorId: 'user-1',
        timestamp: '2026-04-11T00:00:00Z',
      };

      service.emitIssueMoved('MEGA', payload);

      expect(mockTo).toHaveBeenCalledWith('project:MEGA');
      expect(mockEmit).toHaveBeenCalledWith('issue.moved', payload);
    });
  });

  describe('emitIssueCreated', () => {
    it('emits issue.created to the correct project room', () => {
      const payload = {
        issue: { id: 'issue-1', title: 'Test' },
        actorId: 'user-1',
        timestamp: '2026-04-11T00:00:00Z',
      };

      service.emitIssueCreated('MEGA', payload);

      expect(mockTo).toHaveBeenCalledWith('project:MEGA');
      expect(mockEmit).toHaveBeenCalledWith('issue.created', payload);
    });
  });

  describe('emitIssueUpdated', () => {
    it('emits issue.updated to the correct project room', () => {
      const payload = {
        issueId: 'issue-1',
        fields: { title: 'Updated' },
        actorId: 'user-1',
        timestamp: '2026-04-11T00:00:00Z',
      };

      service.emitIssueUpdated('MEGA', payload);

      expect(mockTo).toHaveBeenCalledWith('project:MEGA');
      expect(mockEmit).toHaveBeenCalledWith('issue.updated', payload);
    });
  });

  describe('emitIssueDeleted', () => {
    it('emits issue.deleted to the correct project room', () => {
      const payload = {
        issueId: 'issue-1',
        actorId: 'user-1',
        timestamp: '2026-04-11T00:00:00Z',
      };

      service.emitIssueDeleted('MEGA', payload);

      expect(mockTo).toHaveBeenCalledWith('project:MEGA');
      expect(mockEmit).toHaveBeenCalledWith('issue.deleted', payload);
    });
  });

  describe('safety guards', () => {
    it('skips emit when gateway.server is not yet initialized', () => {
      const uninitializedGateway = { server: undefined };
      const safeService = new EventService(uninitializedGateway as never);

      expect(() =>
        safeService.emitIssueMoved('MEGA', {
          issueId: 'i',
          statusId: 's',
          issueVersion: 1,
          actorId: 'u',
          timestamp: 't',
        }),
      ).not.toThrow();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    // Note: server-side actor exclusion is intentionally not implemented.
    // REST-originated mutations have no bound socket, so the server cannot
    // identify the originating client. Self-echo is filtered client-side via
    // a recent-mutations set in the board page.
  });
});
