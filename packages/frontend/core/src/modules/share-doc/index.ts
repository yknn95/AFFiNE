export type { ShareReader } from './entities/share-reader';
export { ShareDocsListService } from './services/share-docs-list';
export { ShareInfoService } from './services/share-info';
export { ShareReaderService } from './services/share-reader';

import { type Framework } from '@toeverything/infra';

import { ServersService, WorkspaceServerService } from '../cloud';
import { DocScope, DocService } from '../doc';
import {
  WorkspaceLocalCache,
  WorkspaceScope,
  WorkspaceService,
} from '../workspace';
import { ShareDocsList } from './entities/share-docs-list';
import { ShareInfo } from './entities/share-info';
import { ShareReader } from './entities/share-reader';
import { ShareDocsListService } from './services/share-docs-list';
import { ShareInfoService } from './services/share-info';
import { ShareReaderService } from './services/share-reader';
import { ShareStore } from './stores/share';
import { ShareDocsStore } from './stores/share-docs';
import { ShareReaderStore } from './stores/share-reader';

export function configureShareDocsModule(framework: Framework) {
  framework
    .service(ShareReaderService)
    .entity(ShareReader, [ShareReaderStore])
    .store(ShareReaderStore, [ServersService])
    .scope(WorkspaceScope)
    .service(ShareDocsListService, [WorkspaceService])
    .store(ShareDocsStore, [WorkspaceServerService])
    .entity(ShareDocsList, [
      WorkspaceService,
      ShareDocsStore,
      WorkspaceLocalCache,
    ])
    .scope(DocScope)
    .service(ShareInfoService)
    .entity(ShareInfo, [WorkspaceService, DocService, ShareStore])
    .store(ShareStore, [WorkspaceServerService]);
}
