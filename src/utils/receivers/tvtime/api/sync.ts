import axios from 'axios';

import { axiosCache } from '~/utils/axios/cache';

import { TVTimeCatalogType } from '../types/catalog/catalog-type';
import type { TVTimeUserSettings } from '../types/user-settings';
import { createTVTimeHeaders } from './headers';
import { logTVTime } from './log';
import { withTVTimeRefresh } from './refresh';
import { TVTIME_BASE_URL } from './url';

export const syncTVTimeMetaObject = async (
  id: string,
  type: TVTimeCatalogType,
  userConfig: TVTimeUserSettings,
  edisodeId?: number,
): Promise<void> => {
  const fields =
    type === TVTimeCatalogType.SERIES
      ? [
          `o=https://api2.tozelabs.com/v2/watched_episodes/episode/${edisodeId}`,
          `is_rewatch=0`,
        ]
      : [`o=https://msapi.tvtime.com/prod/v1/tracking/${id}/watch`];
  const url = `${TVTIME_BASE_URL}?${fields.join('&')}`;

  try {
    await withTVTimeRefresh(userConfig, 'sync', async (auth) => {
      const response = await axiosCache(url, {
        method: 'POST',
        cache: false,
        headers: createTVTimeHeaders(auth),
      });
      logTVTime('info', 'sync', {
        type,
        id,
        episode: edisodeId,
        status: response.status,
      });
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request timed out after ${5000}ms`);
    }
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const code = axios.isAxiosError(error)
      ? error.code
      : (error as { code?: string })?.code;
    logTVTime('error', 'sync', {
      type,
      id,
      episode: edisodeId,
      status,
      code,
      error: (error as Error).message,
    });
    throw error;
  }
};
