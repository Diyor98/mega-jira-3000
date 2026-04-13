import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { users } from '../../database/schema/users';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async list(): Promise<Array<{ id: string; email: string }>> {
    return this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .orderBy(users.email)
      .limit(100);
  }
}
