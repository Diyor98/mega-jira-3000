import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ForbiddenException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  StreamableFile,
  Optional,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit.service';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { promises as fs, createReadStream, constants as fsConstants } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { projects } from '../../database/schema/projects';
import { issues } from '../../database/schema/issues';
import { users } from '../../database/schema/users';
import { attachments } from '../../database/schema/attachments';
import { resolveAttachmentPath } from './attachment-path';

// SVG is deliberately excluded: it can contain inline `<script>` that runs
// when a browser renders it (even with Content-Disposition: attachment, a
// direct navigation or <img> embed can execute it). Re-enable only after
// Story 7.2+ adds an SVG sanitizer.
const ALLOWED_MIME_TYPES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/zip',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/zip': '.zip',
  'application/json': '.json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Strip control characters (CR/LF/NULL/etc.) from a user-supplied filename.
 * Protects:
 * - the `Content-Disposition` response header from CRLF injection
 * - the audit log from line-forging via `\n[AUDIT] attachment.deleted | …`
 */
function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'untitled';
}

function resolveMaxBytes(): number {
  const raw = process.env.ATTACHMENT_MAX_BYTES ?? '52428800';
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `ATTACHMENT_MAX_BYTES must be a positive finite number (got "${raw}")`,
    );
  }
  return parsed;
}

function resolveBaseDir(): string {
  const raw = process.env.ATTACHMENT_STORAGE_DIR ?? './var/attachments';
  // Anchor relative paths to `process.cwd()` explicitly so the base never
  // silently lands in the wrong directory based on where the node process
  // was launched.
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);
  private readonly maxBytes = resolveMaxBytes();
  private readonly baseDir = resolveBaseDir();

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  /** Owner-gate + issue-scoping helper. Returns the project + issue row. */
  private async assertAccessAndLoadIssue(
    projectKey: string,
    issueId: string,
    userId: string,
  ) {
    const [project] = await this.db
      .select({ id: projects.id, key: projects.key, ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }
    if (project.ownerId !== userId) {
      throw new ForbiddenException('You do not have access to this project');
    }

    const [issue] = await this.db
      .select({ id: issues.id, issueKey: issues.issueKey })
      .from(issues)
      .where(
        and(
          eq(issues.id, issueId),
          eq(issues.projectId, project.id),
          isNull(issues.deletedAt),
        ),
      )
      .limit(1);

    if (!issue) {
      throw new NotFoundException('Issue not found');
    }

    return { project, issue };
  }

  private issueDir(projectId: string, issueId: string): string {
    return path.resolve(this.baseDir, projectId, issueId);
  }

  /** Delegates to the shared helper so lifecycle + attachments use identical
   *  path-traversal defense. See `./attachment-path.ts`. */
  private resolveFilePath(projectId: string, issueId: string, storedName: string): string {
    return resolveAttachmentPath(this.baseDir, projectId, issueId, storedName);
  }

  async create(
    projectKey: string,
    issueId: string,
    userId: string,
    file: UploadedFileLike,
  ) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        `File type '${file.mimetype}' is not allowed`,
      );
    }
    if (file.size > this.maxBytes) {
      throw new PayloadTooLargeException(
        `File too large (max ${this.maxBytes} bytes)`,
      );
    }

    const { project, issue } = await this.assertAccessAndLoadIssue(
      projectKey,
      issueId,
      userId,
    );

    // Sanitize the client-supplied filename at ingress — strips CR/LF/NUL/
    // control chars. Protects the Content-Disposition header (CRLF
    // injection) and the audit log (line-forging) downstream.
    const safeFileName = sanitizeFileName(file.originalname);
    const ext = EXT_BY_MIME[file.mimetype] ?? '';
    const storedName = `${randomUUID()}${ext}`;
    const dir = this.issueDir(project.id, issue.id);
    const absPath = this.resolveFilePath(project.id, issue.id, storedName);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(absPath, file.buffer);

    let inserted;
    try {
      const [row] = await this.db
        .insert(attachments)
        .values({
          issueId: issue.id,
          uploadedBy: userId,
          fileName: safeFileName,
          storedName,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        })
        .returning({
          id: attachments.id,
          issueId: attachments.issueId,
          uploadedBy: attachments.uploadedBy,
          fileName: attachments.fileName,
          mimeType: attachments.mimeType,
          sizeBytes: attachments.sizeBytes,
          createdAt: attachments.createdAt,
        });
      inserted = row;
    } catch (e) {
      // Compensate: the file landed on disk but the DB insert failed. Clean
      // up the orphan so we don't leak bytes. If the cleanup itself fails,
      // log at warn — operator intervention may be needed.
      try {
        await fs.unlink(absPath);
      } catch (unlinkErr) {
        this.logger.warn(
          `[AUDIT] attachment.orphanCleanupFailed | path=${absPath} | error=${(unlinkErr as Error).message}`,
        );
      }
      throw e;
    }

    // Hydrate uploader email via a follow-up SELECT (not a JOIN, since we
    // only need one row and the insert path avoids the JOIN complexity).
    const [uploader] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    this.logger.log(
      `[AUDIT] attachment.created | userId=${userId} | projectKey=${project.key} | issueKey=${issue.issueKey} | attachmentId=${inserted.id} | fileName="${safeFileName}" | sizeBytes=${file.size}`,
    );

    await this.auditLog?.record({
      projectId: project.id,
      actorId: userId,
      entityType: 'attachment',
      entityId: inserted.id,
      action: 'created',
      after: {
        issueId: issue.id,
        fileName: safeFileName,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });

    return {
      ...inserted,
      uploadedByEmail: uploader?.email ?? '[deleted user]',
    };
  }

  async listByIssue(projectKey: string, issueId: string, userId: string) {
    const { issue } = await this.assertAccessAndLoadIssue(projectKey, issueId, userId);

    // LEFT JOIN + coalesce — attachments uploaded by a deleted user should
    // still appear in the list, labeled `[deleted user]`. An INNER JOIN
    // would silently drop them.
    return this.db
      .select({
        id: attachments.id,
        issueId: attachments.issueId,
        uploadedBy: attachments.uploadedBy,
        uploadedByEmail: sql<string>`coalesce(${users.email}, '[deleted user]')`,
        fileName: attachments.fileName,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .leftJoin(users, eq(attachments.uploadedBy, users.id))
      .where(and(eq(attachments.issueId, issue.id), isNull(attachments.deletedAt)))
      .orderBy(desc(attachments.createdAt));
  }

  async getFileStream(
    projectKey: string,
    issueId: string,
    attachmentId: string,
    userId: string,
  ) {
    const { project, issue } = await this.assertAccessAndLoadIssue(
      projectKey,
      issueId,
      userId,
    );

    const [row] = await this.db
      .select({
        id: attachments.id,
        storedName: attachments.storedName,
        fileName: attachments.fileName,
        mimeType: attachments.mimeType,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.id, attachmentId),
          eq(attachments.issueId, issue.id),
          isNull(attachments.deletedAt),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException('Attachment not found');
    }

    const absPath = this.resolveFilePath(project.id, issue.id, row.storedName);

    try {
      // Check readability, not just existence — a chmod 000 file would pass
      // F_OK and then fail mid-stream after headers are already committed.
      await fs.access(absPath, fsConstants.R_OK);
    } catch {
      this.logger.warn(
        `[AUDIT] attachment.fileMissing | attachmentId=${attachmentId} | path=${absPath}`,
      );
      throw new NotFoundException('Attachment file is missing');
    }

    const stream = createReadStream(absPath);
    return new StreamableFile(stream, {
      type: row.mimeType,
      disposition: `attachment; filename="${row.fileName.replace(/"/g, '\\"')}"`,
    });
  }

  async delete(
    projectKey: string,
    issueId: string,
    attachmentId: string,
    userId: string,
  ) {
    const { project, issue } = await this.assertAccessAndLoadIssue(
      projectKey,
      issueId,
      userId,
    );

    const [row] = await this.db
      .select({
        id: attachments.id,
        storedName: attachments.storedName,
        fileName: attachments.fileName,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.id, attachmentId),
          eq(attachments.issueId, issue.id),
          isNull(attachments.deletedAt),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException('Attachment not found');
    }

    const absPath = this.resolveFilePath(project.id, issue.id, row.storedName);

    // Unlink first. Swallow ENOENT (file already missing) but re-throw other
    // errors so the DB row stays consistent with the FS state.
    try {
      await fs.unlink(absPath);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        throw e;
      }
    }

    // Scope the DELETE by the full (id, issueId, deletedAt IS NULL) tuple,
    // matching the SELECT guard above — prevents cross-issue manipulation
    // via URL tampering AND forward-compat with Story 7.2 soft-delete.
    await this.db
      .delete(attachments)
      .where(
        and(
          eq(attachments.id, attachmentId),
          eq(attachments.issueId, issue.id),
          isNull(attachments.deletedAt),
        ),
      );

    this.logger.log(
      `[AUDIT] attachment.deleted | userId=${userId} | projectKey=${project.key} | issueKey=${issue.issueKey} | attachmentId=${attachmentId} | fileName="${row.fileName}"`,
    );

    await this.auditLog?.record({
      projectId: project.id,
      actorId: userId,
      entityType: 'attachment',
      entityId: attachmentId,
      action: 'deleted',
      before: {
        issueId: issue.id,
        fileName: row.fileName,
      },
    });

    return { id: attachmentId, deleted: true };
  }
}
