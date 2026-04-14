import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { RbacService } from '../rbac/rbac.service';
import { createRbacMock, createRbacDenyMock } from '../../test-utils/rbac-mock';

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let projectsService: {
    create: jest.Mock;
    findByOwner: jest.Mock;
    getStatuses: jest.Mock;
    updateMetadata: jest.Mock;
  };

  async function buildController(rbac?: unknown) {
    projectsService = {
      create: jest.fn(),
      findByOwner: jest.fn(),
      getStatuses: jest.fn(),
      updateMetadata: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        { provide: ProjectsService, useValue: projectsService },
        { provide: RbacService, useValue: rbac ?? createRbacMock('project_admin') },
      ],
    }).compile();

    controller = module.get<ProjectsController>(ProjectsController);
  }

  beforeEach(async () => {
    await buildController();
  });

  describe('POST /api/v1/projects', () => {
    it('calls service.create with body and userId from request', async () => {
      const dto = { name: 'Mega Platform', key: 'MEGA' };
      const expectedProject = {
        id: 'project-id',
        name: 'Mega Platform',
        key: 'MEGA',
        ownerId: 'user-id',
        createdAt: new Date(),
      };
      projectsService.create.mockResolvedValue(expectedProject);

      const mockReq = { user: { userId: 'user-id' } } as never;

      const result = await controller.create(dto, mockReq);

      expect(projectsService.create).toHaveBeenCalledWith(dto, 'user-id');
      expect(result).toEqual(expectedProject);
    });
  });

  describe('GET /api/v1/projects', () => {
    it('calls service.findByOwner with userId from request', async () => {
      const expectedProjects = [
        { id: 'p1', name: 'Project 1', key: 'P1', ownerId: 'user-id', createdAt: new Date() },
      ];
      projectsService.findByOwner.mockResolvedValue(expectedProjects);

      const mockReq = { user: { userId: 'user-id' } } as never;

      const result = await controller.findAll(mockReq);

      expect(projectsService.findByOwner).toHaveBeenCalledWith('user-id');
      expect(result).toEqual(expectedProjects);
    });
  });

  describe('GET /api/v1/projects/:projectKey/statuses', () => {
    it('calls service.getStatuses with projectKey', async () => {
      const mockStatuses = [
        { id: 's1', name: 'Backlog', position: 1 },
        { id: 's2', name: 'To Do', position: 2 },
      ];
      projectsService.getStatuses.mockResolvedValue(mockStatuses);

      const mockReq = { user: { userId: 'user-id' } } as never;
      const result = await controller.getStatuses('MEGA', mockReq);

      expect(projectsService.getStatuses).toHaveBeenCalledWith('MEGA');
      expect(result).toEqual(mockStatuses);
    });
  });

  describe('PATCH /api/v1/projects/:projectKey', () => {
    it('calls service.updateMetadata when user has project.edit', async () => {
      const updated = { id: 'p1', name: 'New', key: 'MEGA', description: null, ownerId: 'user-id', createdAt: new Date() };
      projectsService.updateMetadata.mockResolvedValue(updated);

      const mockReq = { user: { userId: 'user-id' } } as never;
      const result = await controller.update('MEGA', { name: 'New' }, mockReq);

      expect(projectsService.updateMetadata).toHaveBeenCalledWith('MEGA', { name: 'New' }, 'user-id');
      expect(result).toEqual(updated);
    });

    it('throws 403 when rbac denies project.edit', async () => {
      await buildController(createRbacDenyMock('project.edit'));
      const mockReq = { user: { userId: 'user-id' } } as never;

      await expect(
        controller.update('MEGA', { name: 'New' }, mockReq),
      ).rejects.toThrow(ForbiddenException);
      expect(projectsService.updateMetadata).not.toHaveBeenCalled();
    });
  });

  describe('HTTP metadata', () => {
    it('requires authentication (no @Public decorator)', () => {
      const metadata = Reflect.getMetadata('isPublic', ProjectsController);
      expect(metadata).toBeUndefined();

      const createMetadata = Reflect.getMetadata('isPublic', controller.create);
      expect(createMetadata).toBeUndefined();

      const findAllMetadata = Reflect.getMetadata('isPublic', controller.findAll);
      expect(findAllMetadata).toBeUndefined();
    });

    it('sets 201 status code on create endpoint', () => {
      const statusCode = Reflect.getMetadata('__httpCode__', ProjectsController.prototype.create);
      expect(statusCode).toBe(201);
    });
  });
});
