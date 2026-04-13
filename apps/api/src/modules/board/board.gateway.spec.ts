import { BoardGateway } from './board.gateway';

describe('BoardGateway', () => {
  let gateway: BoardGateway;
  let mockTokenService: { verifyToken: jest.Mock };
  let mockDb: { select: jest.Mock };
  let projectLookupResult: Array<{ id: string }>;

  beforeEach(() => {
    mockTokenService = {
      verifyToken: jest.fn(),
    };
    projectLookupResult = [{ id: 'project-uuid' }];
    mockDb = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockImplementation(() => Promise.resolve(projectLookupResult)),
          }),
        }),
      }),
    };
    gateway = new BoardGateway(mockTokenService as never, mockDb as never);
    gateway.server = { to: jest.fn() } as never;
  });

  describe('handleConnection', () => {
    it('accepts client with valid JWT in cookie', async () => {
      mockTokenService.verifyToken.mockReturnValue({ sub: 'user-1', email: 'a@b.com', role: 'Developer' });
      const mockClient = {
        id: 'socket-1',
        handshake: { headers: { cookie: 'access_token=valid-jwt' } },
        data: {} as Record<string, unknown>,
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockClient as never);

      expect(mockClient.data['userId']).toBe('user-1');
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });

    it('rejects client with missing cookie', async () => {
      const mockClient = {
        id: 'socket-2',
        handshake: { headers: {} },
        data: {},
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockClient as never);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('rejects client with invalid JWT', async () => {
      mockTokenService.verifyToken.mockImplementation(() => {
        throw new Error('invalid token');
      });
      const mockClient = {
        id: 'socket-3',
        handshake: { headers: { cookie: 'access_token=bad-jwt' } },
        data: {},
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockClient as never);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('rejects client with refresh token', async () => {
      mockTokenService.verifyToken.mockReturnValue({ sub: 'user-1', type: 'refresh' });
      const mockClient = {
        id: 'socket-4',
        handshake: { headers: { cookie: 'access_token=refresh-jwt' } },
        data: {},
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockClient as never);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('handleJoinProject', () => {
    it('joins the correct room when project exists', async () => {
      const mockClient = {
        id: 'socket-1',
        data: { userId: 'user-1' },
        join: jest.fn(),
      };

      const result = await gateway.handleJoinProject(mockClient as never, 'MEGA');

      expect(mockClient.join).toHaveBeenCalledWith('project:MEGA');
      expect(result).toEqual({ event: 'joined', data: { projectKey: 'MEGA' } });
    });

    it('denies join when project does not exist', async () => {
      projectLookupResult = [];
      const mockClient = {
        id: 'socket-1',
        data: { userId: 'user-1' },
        join: jest.fn(),
      };

      const result = await gateway.handleJoinProject(mockClient as never, 'NOPE');

      expect(mockClient.join).not.toHaveBeenCalled();
      expect(result.event).toBe('error');
    });

    it('rejects empty projectKey', async () => {
      const mockClient = { id: 'socket-1', data: { userId: 'user-1' }, join: jest.fn() };

      const result = await gateway.handleJoinProject(mockClient as never, '');

      expect(mockClient.join).not.toHaveBeenCalled();
      expect(result.event).toBe('error');
    });
  });

  describe('handleLeaveProject', () => {
    it('leaves the correct room', () => {
      const mockClient = {
        id: 'socket-1',
        leave: jest.fn(),
      };

      const result = gateway.handleLeaveProject(mockClient as never, 'MEGA');

      expect(mockClient.leave).toHaveBeenCalledWith('project:MEGA');
      expect(result).toEqual({ event: 'left', data: { projectKey: 'MEGA' } });
    });
  });
});
