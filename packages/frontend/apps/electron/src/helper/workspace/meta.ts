import path from 'node:path';

import type { SpaceType } from '@affine/nbstore';
import fs from 'fs-extra';

import { isWindows } from '../../shared/utils';
import { logger } from '../logger';
import { mainRPC } from '../main-rpc';
import type { WorkspaceMeta } from '../type';

let _appDataPath = '';

export async function getAppDataPath() {
  if (_appDataPath) {
    return _appDataPath;
  }
  _appDataPath = await mainRPC.getPath('sessionData');
  return _appDataPath;
}

export async function getWorkspacesBasePath() {
  return path.join(await getAppDataPath(), 'workspaces');
}

export async function getWorkspaceBasePathV1(
  spaceType: SpaceType,
  workspaceId: string
) {
  return path.join(
    await getAppDataPath(),
    spaceType === 'userspace' ? 'userspaces' : 'workspaces',
    isWindows() ? workspaceId.replace(':', '_') : workspaceId
  );
}

export async function getSpaceBasePath(spaceType: SpaceType) {
  return path.join(
    await getAppDataPath(),
    spaceType === 'userspace' ? 'userspaces' : 'workspaces'
  );
}

export function escapeFilename(name: string) {
  // replace all special characters with '_' and replace repeated '_' with a single '_' and remove trailing '_'
  return name
    .replaceAll(/[\\/!@#$%^&*()+~`"':;,?<>|]/g, '_')
    .replaceAll(/_+/g, '_')
    .replace(/_+$/, '');
}

export async function getSpaceDBPath(
  peer: string,
  spaceType: SpaceType,
  id: string
) {
  return path.join(
    await getSpaceBasePath(spaceType),
    escapeFilename(peer),
    id,
    'storage.db'
  );
}

export async function getDeletedWorkspacesBasePath() {
  return path.join(await getAppDataPath(), 'deleted-workspaces');
}

export async function getWorkspaceDBPath(
  spaceType: SpaceType,
  workspaceId: string
) {
  return path.join(
    await getWorkspaceBasePathV1(spaceType, workspaceId),
    'storage.db'
  );
}

export async function getWorkspaceMetaPath(
  spaceType: SpaceType,
  workspaceId: string
) {
  return path.join(
    await getWorkspaceBasePathV1(spaceType, workspaceId),
    'meta.json'
  );
}

/**
 * Get workspace meta, create one if not exists
 * This function will also migrate the workspace if needed
 */
export async function getWorkspaceMeta(
  spaceType: SpaceType,
  workspaceId: string
): Promise<WorkspaceMeta> {
  try {
    const basePath = await getWorkspaceBasePathV1(spaceType, workspaceId);
    const metaPath = await getWorkspaceMetaPath(spaceType, workspaceId);
    if (
      !(await fs
        .access(metaPath)
        .then(() => true)
        .catch(() => false))
    ) {
      await fs.ensureDir(basePath);
      const dbPath = await getWorkspaceDBPath(spaceType, workspaceId);
      // create one if not exists
      const meta = {
        id: workspaceId,
        mainDBPath: dbPath,
        type: spaceType,
      };
      await fs.writeJSON(metaPath, meta);
      return meta;
    } else {
      const meta = await fs.readJSON(metaPath);
      return meta;
    }
  } catch (err) {
    logger.error('getWorkspaceMeta failed', err);
    throw err;
  }
}
