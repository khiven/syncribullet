import axios from 'axios';

import { axiosCache } from '../axios/cache';
import type { RequireAtLeastOne } from '../helpers/types';
import { IDSources, type IDs } from '../receiver/types/id';
import type { UserSettings } from '../receiver/types/user-settings/settings';
import { createTVTimeHeaders } from '../receivers/tvtime/api/headers';
import { logTVTime } from '../receivers/tvtime/api/log';
import { withTVTimeRefresh } from '../receivers/tvtime/api/refresh';
import { TVTIME_BASE_URL } from '../receivers/tvtime/api/url';
import type { TVTimeCatalogType } from '../receivers/tvtime/types/catalog/catalog-type';
import type { TVTimeMCIT } from '../receivers/tvtime/types/manifest';
import type { TVTimeUserSettings } from '../receivers/tvtime/types/user-settings';

export type TVTimeSearchResult = {
  uuid: string;
  id: number;
  name: string;
  type: TVTimeCatalogType;
};

export async function getMappingIdsTVTimeIMDB(
  id: string,
  type: TVTimeCatalogType | undefined,
  userSettings: UserSettings<TVTimeMCIT>,
): Promise<RequireAtLeastOne<IDs>> {
  try {
    const fields = [
      `o=https://search.tvtime.com/v1/search/${type ? type : 'movie,series'}`,
      `q=${id}`,
      `offset=0`,
      `limit=1`,
    ];
    const url = `${TVTIME_BASE_URL}?${fields.join('&')}`;

    const response = await withTVTimeRefresh(
      userSettings as TVTimeUserSettings,
      'mappings',
      (auth) =>
        axiosCache(url, {
          id: `tvtime-mappings-${id}-${IDSources.IMDB}`,
          headers: createTVTimeHeaders(auth),
          method: 'GET',
          cache: {
            ttl: 1000 * 60 * 60 * 24,
            interpretHeader: false,
            staleIfError: 60 * 60 * 5,
          },
        }),
    );

    logTVTime('info', 'mappings', {
      imdb: id,
      type: type ?? 'any',
      status: response.status,
    });

    const tvTimeResult = response.data as {
      status: 'success' | 'error';
      data: TVTimeSearchResult[];
    };

    if (tvTimeResult.status !== 'success') {
      throw new Error('TVTime search returned status != success');
    }

    const ids: RequireAtLeastOne<IDs> = {
      [IDSources.IMDB]: id,
    };

    for (const result of tvTimeResult.data) {
      const { id: tvdbId, uuid } = result;
      return {
        [IDSources.IMDB]: id,
        [IDSources.TVDB]: tvdbId,
        [IDSources.TVTIME]: uuid,
      };
    }
    return ids;
  } catch (e) {
    const status = axios.isAxiosError(e) ? e.response?.status : undefined;
    const code = axios.isAxiosError(e)
      ? e.code
      : (e as { code?: string })?.code;
    logTVTime('error', 'mappings', {
      imdb: id,
      type: type ?? 'any',
      status,
      code,
      error: (e as Error).message,
    });
    throw new Error(`TVTime mappings failed: ${(e as Error).message}`);
  }
}
