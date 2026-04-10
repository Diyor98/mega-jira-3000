import { Test, TestingModule } from '@nestjs/testing';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';

describe('IssuesController', () => {
  let controller: IssuesController;
  let issuesService: { create: jest.Mock; findByProject: jest.Mock; findById: jest.Mock; update: jest.Mock; findChildren: jest.Mock; getProgress: jest.Mock; createLink: jest.Mock; getLinks: jest.Mock; createBugFromStory: jest.Mock; softDelete: jest.Mock };

  beforeEach(async () => {
    issuesService = { create: jest.fn(), findByProject: jest.fn(), findById: jest.fn(), update: jest.fn(), findChildren: jest.fn(), getProgress: jest.fn(), createLink: jest.fn(), getLinks: jest.fn(), createBugFromStory: jest.fn(), softDelete: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IssuesController],
      providers: [{ provide: IssuesService, useValue: issuesService }],
    }).compile();

    controller = module.get<IssuesController>(IssuesController);
  });

  describe('POST /api/v1/projects/:projectKey/issues', () => {
    it('calls service.create with body, userId, and projectKey', async () => {
      const dto = { title: 'Fix bug', type: 'Bug' as const };
      const expectedIssue = {
        id: 'issue-id',
        issueKey: 'MEGA-1',
        title: 'Fix bug',
        type: 'bug',
        priority: 'P3',
        statusId: 'status-id',
        reporterId: 'user-id',
        issueVersion: 1,
        createdAt: new Date(),
      };
      issuesService.create.mockResolvedValue(expectedIssue);

      const mockReq = { user: { userId: 'user-id' } } as never;

      const result = await controller.create(dto, 'MEGA', mockReq);

      expect(issuesService.create).toHaveBeenCalledWith(dto, 'user-id', 'MEGA');
      expect(result).toEqual(expectedIssue);
    });
  });

  describe('GET /api/v1/projects/:projectKey/issues', () => {
    it('calls service.findByProject with projectKey', async () => {
      const expectedIssues = [
        { id: '1', issueKey: 'MEGA-1', title: 'Issue 1' },
      ];
      issuesService.findByProject.mockResolvedValue(expectedIssues);

      const result = await controller.findAll('MEGA');

      expect(issuesService.findByProject).toHaveBeenCalledWith('MEGA');
      expect(result).toEqual(expectedIssues);
    });
  });

  describe('GET /api/v1/projects/:projectKey/issues/:issueId', () => {
    it('calls service.findById with projectKey and issueId', async () => {
      const expectedIssue = { id: 'issue-id', issueKey: 'MEGA-1', title: 'Fix bug' };
      issuesService.findById.mockResolvedValue(expectedIssue);

      const result = await controller.findById('MEGA', 'issue-id');

      expect(issuesService.findById).toHaveBeenCalledWith('MEGA', 'issue-id');
      expect(result).toEqual(expectedIssue);
    });
  });

  describe('GET /api/v1/projects/:projectKey/issues/:issueId/children', () => {
    it('calls service.findChildren', async () => {
      const mockChildren = [{ id: 'c1', issueKey: 'MEGA-2' }];
      issuesService.findChildren.mockResolvedValue(mockChildren);

      const result = await controller.findChildren('MEGA', '00000000-0000-0000-0000-000000000001');

      expect(issuesService.findChildren).toHaveBeenCalledWith('MEGA', '00000000-0000-0000-0000-000000000001');
      expect(result).toEqual(mockChildren);
    });
  });

  describe('GET /api/v1/projects/:projectKey/issues/:issueId/progress', () => {
    it('calls service.getProgress', async () => {
      const progress = { total: 5, completed: 3, percentage: 60 };
      issuesService.getProgress.mockResolvedValue(progress);

      const result = await controller.getProgress('MEGA', '00000000-0000-0000-0000-000000000001');

      expect(issuesService.getProgress).toHaveBeenCalledWith('MEGA', '00000000-0000-0000-0000-000000000001');
      expect(result).toEqual(progress);
    });
  });

  describe('POST /api/v1/projects/:projectKey/issues/:issueId/links', () => {
    it('calls service.createLink', async () => {
      const dto = { targetIssueId: '00000000-0000-0000-0000-000000000020', linkType: 'related' as const };
      const mockLink = { id: 'link-id', linkType: 'related' };
      issuesService.createLink.mockResolvedValue(mockLink);

      const mockReq = { user: { userId: 'user-id' } } as never;
      const result = await controller.createLink(dto, 'MEGA', 'issue-id', mockReq);

      expect(issuesService.createLink).toHaveBeenCalledWith('MEGA', 'issue-id', dto, 'user-id');
      expect(result).toEqual(mockLink);
    });
  });

  describe('GET /api/v1/projects/:projectKey/issues/:issueId/links', () => {
    it('calls service.getLinks', async () => {
      const mockLinks = [{ linkId: 'l1', linkType: 'related', issue: { issueKey: 'MEGA-2' } }];
      issuesService.getLinks.mockResolvedValue(mockLinks);

      const result = await controller.getLinks('MEGA', 'issue-id');

      expect(issuesService.getLinks).toHaveBeenCalledWith('MEGA', 'issue-id');
      expect(result).toEqual(mockLinks);
    });
  });

  describe('POST /api/v1/projects/:projectKey/issues/:issueId/create-bug', () => {
    it('calls service.createBugFromStory', async () => {
      const dto = { title: 'New Bug' };
      const mockBug = { id: 'bug-id', issueKey: 'MEGA-5', type: 'bug' };
      issuesService.createBugFromStory.mockResolvedValue(mockBug);

      const mockReq = { user: { userId: 'user-id' } } as never;
      const result = await controller.createBugFromStory(dto, 'MEGA', 'story-id', mockReq);

      expect(issuesService.createBugFromStory).toHaveBeenCalledWith('MEGA', 'story-id', dto, 'user-id');
      expect(result).toEqual(mockBug);
    });
  });

  describe('PATCH /api/v1/projects/:projectKey/issues/:issueId', () => {
    it('calls service.update with correct params', async () => {
      const dto = { title: 'Updated', issueVersion: 1 };
      const expectedIssue = { id: 'issue-id', issueKey: 'MEGA-1', title: 'Updated', issueVersion: 2 };
      issuesService.update.mockResolvedValue(expectedIssue);

      const mockReq = { user: { userId: 'user-id' } } as never;

      const result = await controller.update(dto, 'MEGA', 'issue-id', mockReq);

      expect(issuesService.update).toHaveBeenCalledWith('MEGA', 'issue-id', dto, 'user-id');
      expect(result).toEqual(expectedIssue);
    });
  });

  describe('DELETE /api/v1/projects/:projectKey/issues/:issueId', () => {
    it('calls service.softDelete with correct params', async () => {
      const mockDeleted = { id: 'issue-id', issueKey: 'MEGA-1', deletedAt: new Date() };
      issuesService.softDelete.mockResolvedValue(mockDeleted);

      const mockReq = { user: { userId: 'user-id' } } as never;
      const result = await controller.softDelete({ issueVersion: 1 }, 'MEGA', 'issue-id', mockReq);

      expect(issuesService.softDelete).toHaveBeenCalledWith('MEGA', 'issue-id', 1, 'user-id');
      expect(result).toEqual(mockDeleted);
    });
  });

  describe('HTTP metadata', () => {
    it('requires authentication (no @Public decorator)', () => {
      const metadata = Reflect.getMetadata('isPublic', IssuesController);
      expect(metadata).toBeUndefined();
    });

    it('sets 201 status code on create endpoint', () => {
      const statusCode = Reflect.getMetadata('__httpCode__', IssuesController.prototype.create);
      expect(statusCode).toBe(201);
    });
  });
});
