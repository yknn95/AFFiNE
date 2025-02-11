import { DebugLogger } from '@affine/debug';
import {
  createWorkspaceMutation,
  deleteWorkspaceMutation,
  getWorkspaceInfoQuery,
  getWorkspacesQuery,
} from '@affine/graphql';
import { DocCollection } from '@blocksuite/affine/store';
import {
  type BlobStorage,
  catchErrorInto,
  type DocStorage,
  effect,
  exhaustMapSwitchUntilChanged,
  fromPromise,
  LiveData,
  ObjectPool,
  onComplete,
  onStart,
  Service,
} from '@toeverything/infra';
import { isEqual } from 'lodash-es';
import { nanoid } from 'nanoid';
import { EMPTY, map, mergeMap, Observable, switchMap } from 'rxjs';
import { encodeStateAsUpdate } from 'yjs';

import type { Server, ServersService } from '../../cloud';
import {
  AccountChanged,
  AuthService,
  FetchService,
  GraphQLService,
  WebSocketService,
  WorkspaceServerService,
} from '../../cloud';
import type { GlobalState } from '../../storage';
import {
  getAFFiNEWorkspaceSchema,
  type Workspace,
  type WorkspaceEngineProvider,
  type WorkspaceFlavourProvider,
  type WorkspaceFlavoursProvider,
  type WorkspaceMetadata,
  type WorkspaceProfileInfo,
} from '../../workspace';
import type { WorkspaceEngineStorageProvider } from '../providers/engine';
import { BroadcastChannelAwarenessConnection } from './engine/awareness-broadcast-channel';
import { CloudAwarenessConnection } from './engine/awareness-cloud';
import { CloudBlobStorage } from './engine/blob-cloud';
import { StaticBlobStorage } from './engine/blob-static';
import { CloudDocEngineServer } from './engine/doc-cloud';
import { CloudStaticDocStorage } from './engine/doc-cloud-static';
import { getWorkspaceProfileWorker } from './out-worker';

const getCloudWorkspaceCacheKey = (serverId: string) => {
  if (serverId === 'affine-cloud') {
    return 'cloud-workspace:'; // FOR BACKWARD COMPATIBILITY
  }
  return `selfhosted-workspace-${serverId}:`;
};

const logger = new DebugLogger('affine:cloud-workspace-flavour-provider');

class CloudWorkspaceFlavourProvider implements WorkspaceFlavourProvider {
  private readonly authService: AuthService;
  private readonly webSocketService: WebSocketService;
  private readonly fetchService: FetchService;
  private readonly graphqlService: GraphQLService;

  private readonly unsubscribeAccountChanged: () => void;

  constructor(
    private readonly globalState: GlobalState,
    private readonly storageProvider: WorkspaceEngineStorageProvider,
    private readonly server: Server
  ) {
    this.authService = server.scope.get(AuthService);
    this.webSocketService = server.scope.get(WebSocketService);
    this.fetchService = server.scope.get(FetchService);
    this.graphqlService = server.scope.get(GraphQLService);
    this.unsubscribeAccountChanged = this.server.scope.eventBus.on(
      AccountChanged,
      () => {
        this.revalidate();
      }
    );
  }

  flavour = this.server.id;

  async deleteWorkspace(id: string): Promise<void> {
    await this.graphqlService.gql({
      query: deleteWorkspaceMutation,
      variables: {
        id: id,
      },
    });
    this.revalidate();
    await this.waitForLoaded();
  }

  async createWorkspace(
    initial: (
      docCollection: DocCollection,
      blobStorage: BlobStorage,
      docStorage: DocStorage
    ) => Promise<void>
  ): Promise<WorkspaceMetadata> {
    // create workspace on cloud, get workspace id
    const {
      createWorkspace: { id: workspaceId },
    } = await this.graphqlService.gql({
      query: createWorkspaceMutation,
    });

    // save the initial state to local storage, then sync to cloud
    const blobStorage = this.storageProvider.getBlobStorage(workspaceId);
    const docStorage = this.storageProvider.getDocStorage(workspaceId);

    const docCollection = new DocCollection({
      id: workspaceId,
      idGenerator: () => nanoid(),
      schema: getAFFiNEWorkspaceSchema(),
      blobSources: {
        main: blobStorage,
      },
    });

    try {
      // apply initial state
      await initial(docCollection, blobStorage, docStorage);

      // save workspace to local storage, should be vary fast
      await docStorage.doc.set(
        workspaceId,
        encodeStateAsUpdate(docCollection.doc)
      );
      for (const subdocs of docCollection.doc.getSubdocs()) {
        await docStorage.doc.set(subdocs.guid, encodeStateAsUpdate(subdocs));
      }

      this.revalidate();
      await this.waitForLoaded();
    } finally {
      docCollection.dispose();
    }

    return {
      id: workspaceId,
      flavour: this.server.id,
    };
  }
  revalidate = effect(
    map(() => {
      return { accountId: this.authService.session.account$.value?.id };
    }),
    exhaustMapSwitchUntilChanged(
      (a, b) => a.accountId === b.accountId,
      ({ accountId }) => {
        return fromPromise(async signal => {
          if (!accountId) {
            return null; // no cloud workspace if no account
          }

          const { workspaces } = await this.graphqlService.gql({
            query: getWorkspacesQuery,
            context: {
              signal,
            },
          });

          const ids = workspaces.map(({ id, initialized }) => ({
            id,
            initialized,
          }));
          return {
            accountId,
            workspaces: ids.map(({ id, initialized }) => ({
              id,
              flavour: this.server.id,
              initialized,
            })),
          };
        }).pipe(
          mergeMap(data => {
            if (data) {
              const { accountId, workspaces } = data;
              const sorted = workspaces.sort((a, b) => {
                return a.id.localeCompare(b.id);
              });
              this.globalState.set(
                getCloudWorkspaceCacheKey(this.server.id) + accountId,
                sorted
              );
              if (!isEqual(this.workspaces$.value, sorted)) {
                this.workspaces$.next(sorted);
              }
            } else {
              this.workspaces$.next([]);
            }
            return EMPTY;
          }),
          catchErrorInto(this.error$, err => {
            logger.error('error to revalidate cloud workspaces', err);
          }),
          onStart(() => this.isRevalidating$.next(true)),
          onComplete(() => this.isRevalidating$.next(false))
        );
      },
      ({ accountId }) => {
        if (accountId) {
          this.workspaces$.next(
            this.globalState.get(
              getCloudWorkspaceCacheKey(this.server.id) + accountId
            ) ?? []
          );
        } else {
          this.workspaces$.next([]);
        }
      }
    )
  );

  error$ = new LiveData<any>(null);
  isRevalidating$ = new LiveData(false);
  workspaces$ = new LiveData<WorkspaceMetadata[]>([]);

  async getWorkspaceProfile(
    id: string,
    signal?: AbortSignal
  ): Promise<WorkspaceProfileInfo | undefined> {
    // get information from both cloud and local storage

    // we use affine 'static' storage here, which use http protocol, no need to websocket.
    const cloudStorage = new CloudStaticDocStorage(id, this.fetchService);
    const docStorage = this.storageProvider.getDocStorage(id);
    // download root doc
    const localData = await docStorage.doc.get(id);
    const cloudData = (await cloudStorage.pull(id))?.data;

    const info = await this.getWorkspaceInfo(id, signal);

    if (!cloudData && !localData) {
      return {
        isOwner: info.isOwner,
        isAdmin: info.isAdmin,
        isTeam: info.workspace.team,
      };
    }

    const client = getWorkspaceProfileWorker();

    const result = await client.call(
      'renderWorkspaceProfile',
      [localData, cloudData].filter(Boolean) as Uint8Array[]
    );

    return {
      name: result.name,
      avatar: result.avatar,
      isOwner: info.isOwner,
      isAdmin: info.isAdmin,
      isTeam: info.workspace.team,
    };
  }
  async getWorkspaceBlob(id: string, blob: string): Promise<Blob | null> {
    const localBlob = await this.storageProvider.getBlobStorage(id).get(blob);

    if (localBlob) {
      return localBlob;
    }

    const cloudBlob = new CloudBlobStorage(
      id,
      this.fetchService,
      this.graphqlService
    );
    return await cloudBlob.get(blob);
  }

  getEngineProvider(workspaceId: string): WorkspaceEngineProvider {
    return {
      getAwarenessConnections: () => {
        return [
          new BroadcastChannelAwarenessConnection(workspaceId),
          new CloudAwarenessConnection(workspaceId, this.webSocketService),
        ];
      },
      getDocServer: () => {
        return new CloudDocEngineServer(workspaceId, this.webSocketService);
      },
      getDocStorage: () => {
        return this.storageProvider.getDocStorage(workspaceId);
      },
      getLocalBlobStorage: () => {
        return this.storageProvider.getBlobStorage(workspaceId);
      },
      getRemoteBlobStorages: () => {
        return [
          new CloudBlobStorage(
            workspaceId,
            this.fetchService,
            this.graphqlService
          ),
          new StaticBlobStorage(),
        ];
      },
    };
  }

  onWorkspaceInitialized(workspace: Workspace): void {
    // bind the workspace to the affine cloud server
    workspace.scope.get(WorkspaceServerService).bindServer(this.server);
  }

  private async getWorkspaceInfo(workspaceId: string, signal?: AbortSignal) {
    return await this.graphqlService.gql({
      query: getWorkspaceInfoQuery,
      variables: {
        workspaceId,
      },
      context: { signal },
    });
  }

  private waitForLoaded() {
    return this.isRevalidating$.waitFor(loading => !loading);
  }

  dispose() {
    this.revalidate.unsubscribe();
    this.unsubscribeAccountChanged();
  }
}

export class CloudWorkspaceFlavoursProvider
  extends Service
  implements WorkspaceFlavoursProvider
{
  constructor(
    private readonly globalState: GlobalState,
    private readonly storageProvider: WorkspaceEngineStorageProvider,
    private readonly serversService: ServersService
  ) {
    super();
  }

  workspaceFlavours$ = LiveData.from<WorkspaceFlavourProvider[]>(
    this.serversService.servers$.pipe(
      switchMap(servers => {
        const refs = servers.map(server => {
          const exists = this.pool.get(server.id);
          if (exists) {
            return exists;
          }
          const provider = new CloudWorkspaceFlavourProvider(
            this.globalState,
            this.storageProvider,
            server
          );
          provider.revalidate();
          const ref = this.pool.put(server.id, provider);
          return ref;
        });

        return new Observable<WorkspaceFlavourProvider[]>(subscribe => {
          subscribe.next(refs.map(ref => ref.obj));
          return () => {
            refs.forEach(ref => {
              ref.release();
            });
          };
        });
      })
    ),
    [] as any
  );

  private readonly pool = new ObjectPool<string, CloudWorkspaceFlavourProvider>(
    {
      onDelete(obj) {
        obj.dispose();
      },
    }
  );
}
