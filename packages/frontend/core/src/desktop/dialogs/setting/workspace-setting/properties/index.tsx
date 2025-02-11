import { Button, Menu } from '@affine/component';
import { SettingHeader } from '@affine/component/setting-components';
import { DocPropertyManager } from '@affine/core/components/doc-properties/manager';
import { CreatePropertyMenuItems } from '@affine/core/components/doc-properties/menu/create-doc-property';
import { useWorkspaceInfo } from '@affine/core/components/hooks/use-workspace-info';
import type { DocCustomPropertyInfo } from '@affine/core/modules/db';
import type { WorkspaceMetadata } from '@affine/core/modules/workspace';
import { Trans, useI18n } from '@affine/i18n';
import track from '@affine/track';
import { FrameworkScope } from '@toeverything/infra';
import { useCallback } from 'react';

import { useWorkspace } from '../../../../../components/hooks/use-workspace';
import * as styles from './styles.css';

const WorkspaceSettingPropertiesMain = () => {
  const t = useI18n();

  const onCreated = useCallback((property: DocCustomPropertyInfo) => {
    track.$.settingsPanel.workspace.addProperty({
      type: property.type,
      control: 'at menu',
    });
  }, []);

  const onPropertyInfoChange = useCallback(
    (property: DocCustomPropertyInfo, field: string) => {
      track.$.settingsPanel.workspace.editPropertyMeta({
        type: property.type,
        field,
      });
    },
    []
  );

  return (
    <div className={styles.main}>
      <div className={styles.listHeader}>
        <Menu items={<CreatePropertyMenuItems onCreated={onCreated} />}>
          <Button variant="primary">
            {t['com.affine.settings.workspace.properties.add_property']()}
          </Button>
        </Menu>
      </div>
      <DocPropertyManager onPropertyInfoChange={onPropertyInfoChange} />
    </div>
  );
};

export const WorkspaceSettingProperties = ({
  workspaceMetadata,
}: {
  workspaceMetadata: WorkspaceMetadata;
}) => {
  const t = useI18n();
  const workspace = useWorkspace(workspaceMetadata);
  const workspaceInfo = useWorkspaceInfo(workspaceMetadata);
  const title = workspaceInfo?.name || 'untitled';

  if (workspace === null) {
    return null;
  }

  return (
    <FrameworkScope scope={workspace.scope}>
      <SettingHeader
        title={t['com.affine.settings.workspace.properties.header.title']()}
        subtitle={
          <Trans
            values={{
              name: title,
            }}
            i18nKey="com.affine.settings.workspace.properties.header.subtitle"
          >
            Manage workspace <strong>name</strong> properties
          </Trans>
        }
      />
      <WorkspaceSettingPropertiesMain />
    </FrameworkScope>
  );
};
