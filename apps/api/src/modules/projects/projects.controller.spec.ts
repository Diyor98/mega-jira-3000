import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let projectsService: { create: jest.Mock; findByOwner: jest.Mock };

  beforeEach(async () => {
    projectsService = { create: jest.fn(), findByOwner: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [{ provide: ProjectsService, useValue: projectsService }],
    }).compile();

    controller = module.get<ProjectsController>(ProjectsController);
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
