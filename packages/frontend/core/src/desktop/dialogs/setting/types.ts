import type { SettingTab } from '@affine/core/modules/dialogs/constant';
import type { WorkspaceMetadata } from '@affine/core/modules/workspace';

export interface SettingState {
  activeTab: SettingTab;
  activeWorkspaceMetadata?: WorkspaceMetadata | null;
  scrollAnchor?: string;
}
