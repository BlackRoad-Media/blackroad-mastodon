import { flattenEmojiData } from 'emojibase';
import type { CompactEmoji, FlatCompactEmoji, Locale } from 'emojibase';

import {
  putEmojiData,
  putCustomEmojiData,
  loadLatestEtag,
  putLatestEtag,
} from './database';
import { toSupportedLocale } from './locale';
import type { CustomEmojiData, LocaleOrCustom } from './types';
import { emojiLogger } from './utils';

const log = emojiLogger('loader');

export async function importEmojiData(localeString: string) {
  const locale = toSupportedLocale(localeString);
  const path = await localeToPath(locale);
  const emojis = await fetchAndCheckEtag<CompactEmoji[]>(locale, path);
  if (!emojis) {
    return;
  }
  const flattenedEmojis: FlatCompactEmoji[] = flattenEmojiData(emojis);
  log('loaded %d for %s locale', flattenedEmojis.length, locale);
  await putEmojiData(flattenedEmojis, locale);
}

export async function importCustomEmojiData() {
  const emojis = await fetchAndCheckEtag<CustomEmojiData[]>(
    'custom',
    'api/v1/custom_emojis',
  );
  if (!emojis) {
    return;
  }
  log('loaded %d custom emojis', emojis.length);
  await putCustomEmojiData(emojis);
}

async function fetchAndCheckEtag<ResultType extends object[]>(
  localeOrCustom: LocaleOrCustom,
  path: string,
): Promise<ResultType | null> {
  // Use location.origin as this script may be loaded from a CDN domain.
  const url = new URL(location.origin);
  url.pathname = path;

  const oldEtag = await loadLatestEtag(localeOrCustom);
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'If-None-Match': oldEtag ?? '', // Send the old ETag to check for modifications
    },
  });
  // If not modified, return null
  if (response.status === 304) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch emoji data for ${localeOrCustom}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as ResultType;
  if (!Array.isArray(data)) {
    throw new Error(
      `Unexpected data format for ${localeOrCustom}: expected an array`,
    );
  }

  // Store the ETag for future requests
  const etag = response.headers.get('ETag');
  if (etag) {
    await putLatestEtag(etag, localeOrCustom);
  }

  return data;
}

const modules = import.meta.glob(
  '../../../../../node_modules/emojibase-data/**/compact.json',
  {
    as: 'url',
  },
);

function localeToPath(locale: Locale) {
  const key = `../../../../../node_modules/emojibase-data/${locale}/compact.json`;
  if (!modules[key] || typeof modules[key] !== 'function') {
    throw new Error(`Unsupported locale: ${locale}`);
  }
  return modules[key]();
}
