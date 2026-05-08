import { AllDocsIcon, HomeIcon } from '@blocksuite/icons/rc';

import { AppTabCreate } from './create';
import type { Tab } from './type';

export const tabs: Tab[] = [
  {
    key: 'home',
    to: '/home',
    Icon: HomeIcon,
  },
  {
    key: 'all',
    to: '/all',
    Icon: AllDocsIcon,
  },
  {
    key: 'new',
    custom: AppTabCreate,
  },
];
