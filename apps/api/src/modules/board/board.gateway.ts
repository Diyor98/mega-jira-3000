import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Inject, Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { eq } from 'drizzle-orm';
import { TokenService } from '../auth/token.service';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { projects } from '../../database/schema/projects';

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  }
  return cookies;
}

@WebSocketGateway({
  namespace: '/board',
  cors: {
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class BoardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(BoardGateway.name);

  constructor(
    private readonly tokenService: TokenService,
    @Inject(DATABASE_TOKEN) private readonly db: Database,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Extract JWT from httpOnly cookie (same as REST endpoints)
      const cookieHeader = client.handshake.headers.cookie ?? '';
      const cookies = parseCookies(cookieHeader);
      const token = cookies['access_token'];

      if (!token) {
        this.logger.warn(`Client ${client.id} rejected: no access_token cookie`);
        client.disconnect(true);
        return;
      }

      const payload = this.tokenService.verifyToken(token);
      if (payload.type === 'refresh') {
        this.logger.warn(`Client ${client.id} rejected: refresh token used`);
        client.disconnect(true);
        return;
      }

      client.data.userId = payload.sub;
      this.logger.log(`Client ${client.id} connected (user: ${payload.sub})`);
    } catch {
      this.logger.warn(`Client ${client.id} rejected: invalid token`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client ${client.id} disconnected`);
  }

  @SubscribeMessage('join-project')
  async handleJoinProject(client: Socket, projectKey: string) {
    if (typeof projectKey !== 'string' || projectKey.length === 0) {
      return { event: 'error', data: { message: 'Invalid projectKey' } };
    }

    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      this.logger.warn(`Client ${client.id} (user ${client.data.userId}) denied join: project ${projectKey} not found`);
      return { event: 'error', data: { message: `Project '${projectKey}' not found` } };
    }

    const room = `project:${projectKey}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);
    return { event: 'joined', data: { projectKey } };
  }

  @SubscribeMessage('leave-project')
  handleLeaveProject(client: Socket, projectKey: string) {
    const room = `project:${projectKey}`;
    client.leave(room);
    this.logger.log(`Client ${client.id} left room ${room}`);
    return { event: 'left', data: { projectKey } };
  }
}
