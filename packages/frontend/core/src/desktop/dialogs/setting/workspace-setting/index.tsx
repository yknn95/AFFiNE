import type { SettingTab } from '@affine/core/modules/dialogs/constant';
import type { WorkspaceMetadata } from '@affine/core/modules/workspace';

import type { SettingState } from '../types';
import { WorkspaceSettingBilling } from './billing';
import { WorkspaceSettingDetail } from './new-workspace-setting-detail';
import { WorkspaceSettingProperties } from './properties';

export const WorkspaceSetting = ({
  workspaceMetadata,
  activeTab,
  onCloseSetting,
  onChangeSettingState,
}: {
  workspaceMetadata: WorkspaceMetadata;
  activeTab: SettingTab;
  onCloseSetting: () => void;
  onChangeSettingState: (settingState: SettingState) => void;
}) => {
  switch (activeTab) {
    case 'workspace:preference':
      return (
        <WorkspaceSettingDetail
          onCloseSetting={onCloseSetting}
          onChangeSettingState={onChangeSettingState}
          workspaceMetadata={workspaceMetadata}
        />
      );
    case 'workspace:properties':
      return (
        <WorkspaceSettingProperties workspaceMetadata={workspaceMetadata} />
      );
    case 'workspace:billing':
      return <WorkspaceSettingBilling workspaceMetadata={workspaceMetadata} />;
  }
  return null;
};
