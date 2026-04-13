import * as path from 'path';
import { ForbiddenException } from '@nestjs/common';

/**
 * Resolves an attachment's on-disk absolute path and asserts it stays
 * strictly inside `baseDir`. Shared by AttachmentsService (serve/delete)
 * and DataLifecycleService (purge) so any future tightening (symlink
 * checks, etc.) only has to happen in one place.
 *
 * Throws ForbiddenException if the resolved path escapes the issue
 * directory — `storedName` is server-generated as `<uuid>.<ext>` so this
 * is defense-in-depth against future bugs that let a client influence it.
 */
export function resolveAttachmentPath(
  baseDir: string,
  projectId: string,
  issueId: string,
  storedName: string,
): string {
  const dir = path.resolve(baseDir, projectId, issueId);
  const abs = path.resolve(dir, storedName);
  if (!abs.startsWith(dir + path.sep)) {
    throw new ForbiddenException('Invalid attachment path');
  }
  return abs;
}
