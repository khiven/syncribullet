import { axiosInstance } from '~/utils/axios/cache';
import type { UserSettings } from '~/utils/receiver/types/user-settings/settings';

import type { TVTimeMCIT } from '../types/manifest';
import type { TVTimeLibraryEntryEpisode } from '../types/tvtime/library-episode';
import { createTVTimeHeaders } from './headers';
import { logTVTime } from './log';
import { withTVTimeRefresh } from './refresh';
import { TVTIME_BASE_URL } from './url';

export const episodesTVTimeMetaObject = async (
  id: string,
  count: {
    season: number;
    episode: number;
  },
  userConfig: UserSettings<TVTimeMCIT>,
): Promise<TVTimeLibraryEntryEpisode> => {
  const fields = [`o=https://msapi.tvtime.com/v1/series/${id}/episodes`];
  const url = `${TVTIME_BASE_URL}?${fields.join('&')}`;

  try {
    return await withTVTimeRefresh(userConfig, 'episodes', async (auth) => {
      const response = await axiosInstance(url, {
        method: 'GET',
        headers: createTVTimeHeaders(auth),
      });

      logTVTime('info', 'episodes', {
        series: id,
        season: count.season,
        episode: count.episode,
        status: response.status,
      });

      if (!response.data?.data) {
        throw new Error('TVTime Api: No episodes data');
      }
      const episode = (response.data.data as TVTimeLibraryEntryEpisode[]).find(
        (x) => x.season.number === count.season && x.number === count.episode,
      );
      if (!episode) {
        throw new Error('Episode not found');
      }
      return episode;
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request timed out after ${5000}ms`);
    }
    const status = (error as { response?: { status?: number } }).response
      ?.status;
    logTVTime('error', 'episodes', {
      series: id,
      season: count.season,
      episode: count.episode,
      status,
      error: (error as Error).message,
    });
    throw new Error((error as Error).message);
  }
};
