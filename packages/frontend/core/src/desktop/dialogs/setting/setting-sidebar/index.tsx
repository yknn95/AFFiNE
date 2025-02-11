import {
  WorkspaceListItemSkeleton,
  WorkspaceListSkeleton,
} from '@affine/component/setting-components';
import { Avatar } from '@affine/component/ui/avatar';
import { Tooltip } from '@affine/component/ui/tooltip';
import { UserPlanButton } from '@affine/core/components/affine/auth/user-plan-button';
import { useCatchEventCallback } from '@affine/core/components/hooks/use-catch-event-hook';
import { useWorkspaceInfo } from '@affine/core/components/hooks/use-workspace-info';
import { WorkspaceAvatar } from '@affine/core/components/workspace-avatar';
import { AuthService } from '@affine/core/modules/cloud';
import { UserFeatureService } from '@affine/core/modules/cloud/services/user-feature';
import { GlobalDialogService } from '@affine/core/modules/dialogs';
import type { SettingTab } from '@affine/core/modules/dialogs/constant';
import { GlobalContextService } from '@affine/core/modules/global-context';
import {
  type WorkspaceMetadata,
  WorkspacesService,
} from '@affine/core/modules/workspace';
import { UNTITLED_WORKSPACE_NAME } from '@affine/env/constant';
import { useI18n } from '@affine/i18n';
import { track } from '@affine/track';
import { Logo1Icon } from '@blocksuite/icons/rc';
import { useLiveData, useService, useServices } from '@toeverything/infra';
import clsx from 'clsx';
import {
  type MouseEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
} from 'react';

import { useGeneralSettingList } from '../general-setting';
import * as style from './style.css';

export type UserInfoProps = {
  onAccountSettingClick: () => void;
  onTabChange: (
    key: SettingTab,
    workspaceMetadata: WorkspaceMetadata | null
  ) => void;
  active?: boolean;
};

export const UserInfo = ({
  onAccountSettingClick,
  onTabChange,
  active,
}: UserInfoProps) => {
  const account = useLiveData(useService(AuthService).session.account$);

  const onClick = useCatchEventCallback(() => {
    onTabChange('plans', null);
  }, [onTabChange]);

  if (!account) {
    // TODO(@eyhn): loading ui
    return;
  }
  return (
    <div
      data-testid="user-info-card"
      className={clsx(style.accountButton, {
        active: active,
      })}
      onClick={onAccountSettingClick}
    >
      <Avatar
        size={28}
        rounded={2}
        name={account.label}
        url={account.avatar}
        className="avatar"
      />

      <div className="content">
        <div className="name-container">
          <div className="name" title={account.label}>
            {account.label}
          </div>
          <UserPlanButton onClick={onClick} />
        </div>

        <div className="email" title={account.email}>
          {account.email}
        </div>
      </div>
    </div>
  );
};

export const SignInButton = () => {
  const t = useI18n();
  const globalDialogService = useService(GlobalDialogService);

  return (
    <div
      className={style.accountButton}
      onClick={useCallback(() => {
        globalDialogService.open('sign-in', {});
      }, [globalDialogService])}
    >
      <div className="avatar not-sign">
        <Logo1Icon />
      </div>

      <div className="content">
        <div className="name" title={t['com.affine.settings.sign']()}>
          {t['com.affine.settings.sign']()}
        </div>
        <div className="email" title={t['com.affine.setting.sign.message']()}>
          {t['com.affine.setting.sign.message']()}
        </div>
      </div>
    </div>
  );
};

export const SettingSidebar = ({
  activeTab,
  onTabChange,
  selectedWorkspaceId,
}: {
  activeTab: SettingTab;
  onTabChange: (
    key: SettingTab,
    workspaceMetadata: WorkspaceMetadata | null
  ) => void;
  selectedWorkspaceId: string | null;
}) => {
  const t = useI18n();
  const loginStatus = useLiveData(useService(AuthService).session.status$);
  const generalList = useGeneralSettingList();
  const gotoTab = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const tab = e.currentTarget.dataset.eventArg;
      if (!tab) return;
      track.$.settingsPanel.menu.openSettings({ to: tab });
      onTabChange(tab as SettingTab, null);
    },
    [onTabChange]
  );
  const onAccountSettingClick = useCallback(() => {
    track.$.settingsPanel.menu.openSettings({ to: 'account' });
    onTabChange('account', null);
  }, [onTabChange]);
  const onWorkspaceSettingClick = useCallback(
    (tab: SettingTab, workspaceMetadata: WorkspaceMetadata) => {
      track.$.settingsPanel.menu.openSettings({
        to: 'workspace',
        control: tab,
      });
      onTabChange(tab, workspaceMetadata);
    },
    [onTabChange]
  );

  return (
    <div className={style.settingSlideBar} data-testid="settings-sidebar">
      <div className={style.sidebarTitle}>
        {t['com.affine.settingSidebar.title']()}
      </div>
      <div className={style.sidebarSubtitle}>
        {t['com.affine.settingSidebar.settings.general']()}
      </div>
      <div className={style.sidebarItemsWrapper}>
        {generalList.map(({ title, icon, key, testId }) => {
          return (
            <div
              className={clsx(style.sidebarSelectItem, {
                active: key === activeTab,
              })}
              key={key}
              title={title}
              data-event-arg={key}
              onClick={gotoTab}
              data-testid={testId}
            >
              {icon({ className: 'icon' })}
              <span className="setting-name">{title}</span>
            </div>
          );
        })}
      </div>

      <div className={style.sidebarSubtitle}>
        {t['com.affine.settingSidebar.settings.workspace']()}
      </div>
      <div className={clsx(style.sidebarItemsWrapper, 'scroll')}>
        <Suspense fallback={<WorkspaceListSkeleton />}>
          <WorkspaceList
            onWorkspaceSettingClick={onWorkspaceSettingClick}
            selectedWorkspaceId={selectedWorkspaceId}
            activeTab={activeTab}
          />
        </Suspense>
      </div>

      <div className={style.sidebarFooter}>
        {loginStatus === 'unauthenticated' ? <SignInButton /> : null}
        {loginStatus === 'authenticated' ? (
          <Suspense>
            <UserInfo
              onAccountSettingClick={onAccountSettingClick}
              active={activeTab === 'account'}
              onTabChange={onTabChange}
            />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
};

export const WorkspaceList = ({
  onWorkspaceSettingClick,
  selectedWorkspaceId,
  activeTab,
}: {
  onWorkspaceSettingClick: (
    activeTab: SettingTab,
    workspaceMetadata: WorkspaceMetadata
  ) => void;
  selectedWorkspaceId: string | null;
  activeTab: SettingTab;
}) => {
  const workspaces = useLiveData(
    useService(WorkspacesService).list.workspaces$
  );
  return (
    <>
      {workspaces.map(workspace => {
        return (
          <Suspense key={workspace.id} fallback={<WorkspaceListItemSkeleton />}>
            <WorkspaceListItem
              meta={workspace}
              onClick={subTab => {
                onWorkspaceSettingClick(subTab, workspace);
              }}
              activeTab={
                workspace.id === selectedWorkspaceId ? activeTab : undefined
              }
            />
          </Suspense>
        );
      })}
    </>
  );
};

const WorkspaceListItem = ({
  activeTab,
  meta,
  onClick,
}: {
  meta: WorkspaceMetadata;
  activeTab?: SettingTab;
  onClick: (activeTab: SettingTab) => void;
}) => {
  const { globalContextService, userFeatureService } = useServices({
    GlobalContextService,
    UserFeatureService,
  });
  const information = useWorkspaceInfo(meta);
  const name = information?.name ?? UNTITLED_WORKSPACE_NAME;
  const currentWorkspaceId = useLiveData(
    globalContextService.globalContext.workspaceId.$
  );
  const isCurrent = currentWorkspaceId === meta.id;
  const t = useI18n();

  useEffect(() => {
    userFeatureService.userFeature.revalidate();
  }, [userFeatureService]);

  const onClickPreference = useCallback(() => {
    onClick('workspace:preference');
  }, [onClick]);

  const showBilling = information?.isTeam && information?.isOwner;
  const subTabs = useMemo(() => {
    const subTabConfigs = [
      {
        key: 'workspace:preference',
        title: 'com.affine.settings.workspace.preferences',
      },
      {
        key: 'workspace:properties',
        title: 'com.affine.settings.workspace.properties',
      },
      ...(showBilling
        ? [
            {
              key: 'workspace:billing' as SettingTab,
              title: 'com.affine.settings.workspace.billing',
            },
          ]
        : []),
    ] satisfies {
      key: SettingTab;
      title: keyof ReturnType<typeof useI18n>;
    }[];

    return subTabConfigs.map(({ key, title }) => {
      return (
        <div
          data-testid={`workspace-list-item-${key}`}
          onClick={() => {
            onClick(key);
          }}
          className={clsx(style.sidebarSelectSubItem, {
            active: activeTab === key,
          })}
          key={key}
        >
          {t[title]()}
        </div>
      );
    });
  }, [activeTab, onClick, showBilling, t]);

  return (
    <>
      <div
        className={clsx(style.sidebarSelectItem, { active: !!activeTab })}
        title={name}
        onClick={onClickPreference}
        data-testid="workspace-list-item"
      >
        <WorkspaceAvatar
          key={meta.id}
          meta={meta}
          size={16}
          name={name}
          colorfulFallback
          style={{
            marginRight: '10px',
          }}
          rounded={2}
        />
        <span className="setting-name">{name}</span>
        {isCurrent ? (
          <Tooltip content="Current" side="top">
            <div
              className={style.currentWorkspaceLabel}
              data-testid="current-workspace-label"
            ></div>
          </Tooltip>
        ) : null}
      </div>
      {activeTab && subTabs.length > 1 ? subTabs : null}
    </>
  );
};
