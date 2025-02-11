import { generateDocUrl } from '@blocksuite/affine-block-embed';
import type { InlineHtmlAST } from '@blocksuite/affine-shared/adapters';
import { InlineDeltaToHtmlAdapterExtension } from '@blocksuite/affine-shared/adapters';

export const boldDeltaToHtmlAdapterMatcher = InlineDeltaToHtmlAdapterExtension({
  name: 'bold',
  match: delta => !!delta.attributes?.bold,
  toAST: (_, context) => {
    return {
      type: 'element',
      tagName: 'strong',
      properties: {},
      children: [context.current],
    };
  },
});

export const italicDeltaToHtmlAdapterMatcher =
  InlineDeltaToHtmlAdapterExtension({
    name: 'italic',
    match: delta => !!delta.attributes?.italic,
    toAST: (_, context) => {
      return {
        type: 'element',
        tagName: 'em',
        properties: {},
        children: [context.current],
      };
    },
  });

export const strikeDeltaToHtmlAdapterMatcher =
  InlineDeltaToHtmlAdapterExtension({
    name: 'strike',
    match: delta => !!delta.attributes?.strike,
    toAST: (_, context) => {
      return {
        type: 'element',
        tagName: 'del',
        properties: {},
        children: [context.current],
      };
    },
  });

export const inlineCodeDeltaToMarkdownAdapterMatcher =
  InlineDeltaToHtmlAdapterExtension({
    name: 'inlineCode',
    match: delta => !!delta.attributes?.code,
    toAST: (_, context) => {
      return {
        type: 'element',
        tagName: 'code',
        properties: {},
        children: [context.current],
      };
    },
  });

export const underlineDeltaToHtmlAdapterMatcher =
  InlineDeltaToHtmlAdapterExtension({
    name: 'underline',
    match: delta => !!delta.attributes?.underline,
    toAST: (_, context) => {
      return {
        type: 'element',
        tagName: 'u',
        properties: {},
        children: [context.current],
      };
    },
  });

export const referenceDeltaToHtmlAdapterMatcher =
  InlineDeltaToHtmlAdapterExtension({
    name: 'reference',
    match: delta => !!delta.attributes?.reference,
    toAST: (delta, context) => {
      let hast: InlineHtmlAST = {
        type: 'text',
        value: delta.insert,
      };
      const reference = delta.attributes?.reference;
      if (!reference) {
        return hast;
      }

      const { configs } = context;
      const title = configs.get(`title:${reference.pageId}`);
      const url = generateDocUrl(
        configs.get('docLinkBaseUrl') ?? '',
        String(reference.pageId),
        reference.params ?? Object.create(null)
      );
      if (title) {
        hast.value = title;
      }
      hast = {
        type: 'element',
        tagName: 'a',
        properties: {
          href: url,
        },
        children: [hast],
      };

      return hast;
    },
  });

export const linkDeltaToHtmlAdapterMatcher = InlineDeltaToHtmlAdapterExtension({
  name: 'link',
  match: delta => !!delta.attributes?.link,
  toAST: (delta, _) => {
    const hast: InlineHtmlAST = {
      type: 'text',
      value: delta.insert,
    };
    const link = delta.attributes?.link;
    if (!link) {
      return hast;
    }
    return {
      type: 'element',
      tagName: 'a',
      properties: {
        href: link,
      },
      children: [hast],
    };
  },
});

export const inlineDeltaToHtmlAdapterMatchers = [
  boldDeltaToHtmlAdapterMatcher,
  italicDeltaToHtmlAdapterMatcher,
  strikeDeltaToHtmlAdapterMatcher,
  underlineDeltaToHtmlAdapterMatcher,
  inlineCodeDeltaToMarkdownAdapterMatcher,
  referenceDeltaToHtmlAdapterMatcher,
  linkDeltaToHtmlAdapterMatcher,
];
