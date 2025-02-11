import type { useI18n } from '@affine/i18n';
import { track } from '@affine/track';
import { ContactWithUsIcon, NewIcon } from '@blocksuite/icons/rc';

import type { GlobalDialogService } from '../modules/dialogs';
import type { UrlService } from '../modules/url';
import { registerAffineCommand } from './registry';

export function registerAffineHelpCommands({
  t,
  urlService,
  globalDialogService,
}: {
  t: ReturnType<typeof useI18n>;
  urlService: UrlService;
  globalDialogService: GlobalDialogService;
}) {
  const unsubs: Array<() => void> = [];
  unsubs.push(
    registerAffineCommand({
      id: 'affine:help-whats-new',
      category: 'affine:help',
      icon: <NewIcon />,
      label: t['com.affine.cmdk.affine.whats-new'](),
      run() {
        track.$.cmdk.help.openChangelog();
        urlService.openPopupWindow(BUILD_CONFIG.changelogUrl);
      },
    })
  );
  unsubs.push(
    registerAffineCommand({
      id: 'affine:help-contact-us',
      category: 'affine:help',
      icon: <ContactWithUsIcon />,
      label: t['com.affine.cmdk.affine.contact-us'](),
      run() {
        track.$.cmdk.help.contactUs();
        globalDialogService.open('setting', {
          activeTab: 'about',
          workspaceMetadata: null,
        });
      },
    })
  );

  return () => {
    unsubs.forEach(unsub => unsub());
  };
}
