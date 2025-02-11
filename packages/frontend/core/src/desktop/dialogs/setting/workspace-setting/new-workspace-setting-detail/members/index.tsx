import { Button, Tooltip } from '@affine/component';
import { SettingRow } from '@affine/component/setting-components';
import { AffineErrorBoundary } from '@affine/core/components/affine/affine-error-boundary';
import { useWorkspaceInfo } from '@affine/core/components/hooks/use-workspace-info';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import type { ReactElement } from 'react';

import type { SettingState } from '../../../types';
import { CloudWorkspaceMembersPanel } from './cloud-members-panel';
import * as styles from './styles.css';

export const MembersPanel = ({
  onChangeSettingState,
}: {
  onChangeSettingState: (settingState: SettingState) => void;
}): ReactElement | null => {
  const workspace = useService(WorkspaceService).workspace;
  const isTeam = useWorkspaceInfo(workspace.meta)?.isTeam;
  if (workspace.flavour === 'local') {
    return <MembersPanelLocal />;
  }
  return (
    <AffineErrorBoundary>
      <CloudWorkspaceMembersPanel
        onChangeSettingState={onChangeSettingState}
        isTeam={isTeam}
      />
    </AffineErrorBoundary>
  );
};

const MembersPanelLocal = () => {
  const t = useI18n();
  return (
    <Tooltip content={t['com.affine.settings.member-tooltip']()}>
      <div className={styles.fakeWrapper}>
        <SettingRow name={`${t['Members']()} (0)`} desc={t['Members hint']()}>
          <Button>{t['Invite Members']()}</Button>
        </SettingRow>
      </div>
    </Tooltip>
  );
};
