import type { WorkspaceMetadata } from '@affine/core/modules/workspace';

import type { SettingState } from '../../types';

export interface WorkspaceSettingDetailProps {
  workspaceMetadata: WorkspaceMetadata;
  onCloseSetting: () => void;
  onChangeSettingState: (settingState: SettingState) => void;
}
