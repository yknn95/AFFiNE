import path from 'node:path';

import fs from 'fs-extra';

import { logger } from '../logger';
import { ensureSQLiteDB } from '../nbstore/v1/ensure-db';
import type { WorkspaceMeta } from '../type';
import {
  getDeletedWorkspacesBasePath,
  getWorkspaceBasePathV1,
  getWorkspaceMeta,
} from './meta';

export async function deleteWorkspace(id: string) {
  const basePath = await getWorkspaceBasePathV1('workspace', id);
  const movedPath = path.join(await getDeletedWorkspacesBasePath(), `${id}`);
  try {
    const db = await ensureSQLiteDB('workspace', id);
    await db.destroy();
    return await fs.move(basePath, movedPath, {
      overwrite: true,
    });
  } catch (error) {
    logger.error('deleteWorkspace', error);
  }
}

export async function storeWorkspaceMeta(
  workspaceId: string,
  meta: Partial<WorkspaceMeta>
) {
  try {
    const basePath = await getWorkspaceBasePathV1('workspace', workspaceId);
    await fs.ensureDir(basePath);
    const metaPath = path.join(basePath, 'meta.json');
    const currentMeta = await getWorkspaceMeta('workspace', workspaceId);
    const newMeta = {
      ...currentMeta,
      ...meta,
    };
    await fs.writeJSON(metaPath, newMeta);
  } catch (err) {
    logger.error('storeWorkspaceMeta failed', err);
  }
}
