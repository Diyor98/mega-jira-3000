import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { INestApplication } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | undefined;
  private readonly logger = new Logger(RedisIoAdapter.name);

  constructor(
    app: INestApplication,
    private readonly redisUrl: string,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const pubClient = new Redis(this.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });

    pubClient.on('error', (err) => {
      this.logger.error(`Redis pub client error: ${err.message}`);
    });

    try {
      await pubClient.connect();
    } catch (err) {
      this.logger.error(
        `Failed to connect to Redis at ${this.redisUrl}: ${(err as Error).message}. ` +
          `Falling back to in-memory adapter — multi-instance broadcasts will NOT work.`,
      );
      return;
    }

    const subClient = pubClient.duplicate();
    subClient.on('error', (err) => {
      this.logger.error(`Redis sub client error: ${err.message}`);
    });

    try {
      await subClient.connect();
    } catch (err) {
      this.logger.error(
        `Failed to connect Redis sub client: ${(err as Error).message}. Falling back to in-memory adapter.`,
      );
      return;
    }

    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log('Redis adapter connected for Socket.IO multi-instance scaling');
  }

  createIOServer(port: number, options?: Partial<ServerOptions>) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
