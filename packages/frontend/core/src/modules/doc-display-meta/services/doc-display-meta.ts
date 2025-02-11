import { extractEmojiIcon } from '@affine/core/utils';
import { i18nTime } from '@affine/i18n';
import {
  AliasIcon as LitAliasIcon,
  BlockLinkIcon as LitBlockLinkIcon,
  EdgelessIcon as LitEdgelessIcon,
  LinkedEdgelessIcon as LitLinkedEdgelessIcon,
  LinkedPageIcon as LitLinkedPageIcon,
  PageIcon as LitPageIcon,
  TodayIcon as LitTodayIcon,
  TomorrowIcon as LitTomorrowIcon,
  YesterdayIcon as LitYesterdayIcon,
} from '@blocksuite/icons/lit';
import {
  AliasIcon,
  BlockLinkIcon,
  EdgelessIcon,
  LinkedEdgelessIcon,
  LinkedPageIcon,
  PageIcon,
  TodayIcon,
  TomorrowIcon,
  YesterdayIcon,
} from '@blocksuite/icons/rc';
import { LiveData, Service } from '@toeverything/infra';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';

import type { DocRecord, DocsService } from '../../doc';
import type { FeatureFlagService } from '../../feature-flag';
import type { I18nService } from '../../i18n';
import type { JournalService } from '../../journal';

type IconType = 'rc' | 'lit';
interface DocDisplayIconOptions<T extends IconType> {
  type?: T;
  compareDate?: Date | Dayjs;
  /**
   * Override the mode detected inside the hook:
   * by default, it will use the `primaryMode$` of the doc.
   */
  mode?: 'edgeless' | 'page';
  reference?: boolean;
  referenceToNode?: boolean;
  hasTitleAlias?: boolean;
  /**
   * @default true
   */
  enableEmojiIcon?: boolean;
}
interface DocDisplayTitleOptions {
  originalTitle?: string;
  title?: string; // title alias
  reference?: boolean;
  /**
   * @default true
   */
  enableEmojiIcon?: boolean;
}

const rcIcons = {
  AliasIcon,
  BlockLinkIcon,
  EdgelessIcon,
  LinkedEdgelessIcon,
  LinkedPageIcon,
  PageIcon,
  TodayIcon,
  TomorrowIcon,
  YesterdayIcon,
};
const litIcons = {
  AliasIcon: LitAliasIcon,
  BlockLinkIcon: LitBlockLinkIcon,
  EdgelessIcon: LitEdgelessIcon,
  LinkedEdgelessIcon: LitLinkedEdgelessIcon,
  LinkedPageIcon: LitLinkedPageIcon,
  PageIcon: LitPageIcon,
  TodayIcon: LitTodayIcon,
  TomorrowIcon: LitTomorrowIcon,
  YesterdayIcon: LitYesterdayIcon,
};
const icons = { rc: rcIcons, lit: litIcons } as {
  rc: Record<keyof typeof rcIcons, any>;
  lit: Record<keyof typeof litIcons, any>;
};

export class DocDisplayMetaService extends Service {
  constructor(
    private readonly journalService: JournalService,
    private readonly docsService: DocsService,
    private readonly featureFlagService: FeatureFlagService,
    private readonly i18nService: I18nService
  ) {
    super();
  }

  getJournalIcon(
    journalDate: string | Dayjs,
    options?: DocDisplayIconOptions<'rc'>
  ): typeof TodayIcon;

  getJournalIcon(
    journalDate: string | Dayjs,
    options?: DocDisplayIconOptions<'lit'>
  ): typeof LitYesterdayIcon;

  getJournalIcon<T extends IconType = 'rc'>(
    journalDate: string | Dayjs,
    options?: DocDisplayIconOptions<T>
  ): T extends 'rc' ? typeof TodayIcon : typeof LitTodayIcon;

  getJournalIcon<T extends IconType = 'rc'>(
    journalDate: string | Dayjs,
    options?: DocDisplayIconOptions<T>
  ) {
    const iconSet = icons[options?.type ?? 'rc'];
    const day = dayjs(journalDate);
    return day.isBefore(dayjs(), 'day')
      ? iconSet.YesterdayIcon
      : day.isAfter(dayjs(), 'day')
        ? iconSet.TomorrowIcon
        : iconSet.TodayIcon;
  }

  icon$<T extends IconType = 'rc'>(
    docId: string,
    options?: DocDisplayIconOptions<T>
  ) {
    const iconSet = icons[options?.type ?? 'rc'];

    return LiveData.computed(get => {
      const doc = get(this.docsService.list.doc$(docId));
      const title = doc ? get(doc.title$) : '';
      const mode = doc ? get(doc.primaryMode$) : undefined;
      const finalMode = options?.mode ?? mode ?? 'page';
      const referenceToNode = !!(options?.reference && options.referenceToNode);
      const hasTitleAlias = !!(options?.reference && options?.hasTitleAlias);

      // increases block link priority with title alias
      if (hasTitleAlias) {
        return iconSet.AliasIcon;
      }

      // increases block link priority
      if (referenceToNode) {
        return iconSet.BlockLinkIcon;
      }

      // journal icon
      const journalDate = this._toDayjs(
        get(this.journalService.journalDate$(docId))
      );
      if (journalDate) {
        return this.getJournalIcon(journalDate, options);
      }

      // reference icon
      if (options?.reference) {
        return finalMode === 'edgeless'
          ? iconSet.LinkedEdgelessIcon
          : iconSet.LinkedPageIcon;
      }

      // emoji icon
      const enableEmojiIcon =
        get(this.featureFlagService.flags.enable_emoji_doc_icon.$) &&
        options?.enableEmojiIcon !== false;
      if (enableEmojiIcon) {
        const { emoji } = extractEmojiIcon(title);
        if (emoji) return () => emoji;
      }

      // default icon
      return finalMode === 'edgeless' ? iconSet.EdgelessIcon : iconSet.PageIcon;
    });
  }

  title$(docId: string, options?: DocDisplayTitleOptions) {
    return LiveData.computed(get => {
      const enableEmojiIcon =
        get(this.featureFlagService.flags.enable_emoji_doc_icon.$) &&
        options?.enableEmojiIcon !== false;
      const lng = get(this.i18nService.i18n.currentLanguageKey$);
      const doc = get(this.docsService.list.doc$(docId));

      // title alias
      if (options?.title) {
        return enableEmojiIcon
          ? extractEmojiIcon(options.title).rest
          : options.title;
      }

      if (!doc) {
        return this.i18nService.i18n.i18next.t(
          'com.affine.notFoundPage.title',
          { lng }
        );
      }

      // journal title
      const journalDateString = get(this.journalService.journalDate$(docId));
      if (journalDateString) {
        return i18nTime(journalDateString, { absolute: { accuracy: 'day' } });
      }

      // original title
      if (options?.originalTitle) return options.originalTitle;

      const docTitle = get(doc.title$);

      // empty title
      if (!docTitle) {
        return this.i18nService.i18n.i18next.t('Untitled', { lng });
      }

      // reference
      if (options?.reference) return docTitle;

      // emoji icon
      if (enableEmojiIcon) {
        return extractEmojiIcon(docTitle).rest;
      }

      // default
      return docTitle;
    });
  }

  getDocDisplayMeta(docRecord: DocRecord, originalTitle?: string) {
    return {
      title: this.title$(docRecord.id, { originalTitle }).value,
      icon: this.icon$(docRecord.id).value,
      updatedDate: docRecord.meta$.value.updatedDate,
    };
  }

  private _isJournalString(j?: string | false) {
    return j ? !!j?.match(/^\d{4}-\d{2}-\d{2}$/) : false;
  }

  private _toDayjs(j?: string | false) {
    if (!j || !this._isJournalString(j)) return null;
    const day = dayjs(j);
    if (!day.isValid()) return null;
    return day;
  }
}
