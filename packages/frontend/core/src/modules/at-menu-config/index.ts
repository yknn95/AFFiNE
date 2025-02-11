import { type Framework } from '@toeverything/infra';

import { WorkspaceDialogService } from '../dialogs';
import { DocsService } from '../doc';
import { DocDisplayMetaService } from '../doc-display-meta';
import { DocsSearchService } from '../docs-search';
import { EditorSettingService } from '../editor-setting';
import { JournalService } from '../journal';
import { RecentDocsService } from '../quicksearch';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { AtMenuConfigService } from './services';

export function configAtMenuConfigModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(AtMenuConfigService, [
      WorkspaceService,
      JournalService,
      DocDisplayMetaService,
      WorkspaceDialogService,
      RecentDocsService,
      EditorSettingService,
      DocsService,
      DocsSearchService,
    ]);
}
