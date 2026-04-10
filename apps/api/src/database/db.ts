import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as usersSchema from './schema/users';
import * as loginAttemptsSchema from './schema/login-attempts';
import * as projectsSchema from './schema/projects';
import * as workflowsSchema from './schema/workflows';
import * as workflowStatusesSchema from './schema/workflow-statuses';
import * as issuesSchema from './schema/issues';
import * as issueSequencesSchema from './schema/issue-sequences';
import * as issueLinksSchema from './schema/issue-links';

const schema = { ...usersSchema, ...loginAttemptsSchema, ...projectsSchema, ...workflowsSchema, ...workflowStatusesSchema, ...issuesSchema, ...issueSequencesSchema, ...issueLinksSchema };

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
export type Database = typeof db;
