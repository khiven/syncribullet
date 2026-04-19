import { axiosCache } from '~/utils/axios/cache';

import type {
  TVTimeCatalogMovieStatus,
  TVTimeCatalogSeriesStatus,
  TVTimeCatalogStatus,
} from '../types/catalog/catalog-status';
import { TVTimeCatalogType } from '../types/catalog/catalog-type';
import type {
  TVTimeLibraryEntryMovie,
  TVTimeLibraryEntryResponse,
  TVTimeLibraryEntryShow,
  TVTimeLibraryEntryShowsResponse,
} from '../types/tvtime/library-entry';
import type { TVTimeUserSettings } from '../types/user-settings';
import { createTVTimeHeaders } from './headers';
import { logTVTime } from './log';
import { withTVTimeRefresh } from './refresh';
import { TVTIME_BASE_URL } from './url';

export const getTVTimeMetaPreviewsSeries = async (
  status: TVTimeCatalogSeriesStatus,
  userConfig: TVTimeUserSettings,
  iOffset: number,
  iLimit: number,
): Promise<TVTimeLibraryEntryShow[]> => {
  const auth = userConfig.auth;
  if (!auth) {
    throw new Error('User not authenticated');
  }

  const fields = [
    'id',
    'name',
    'genres',
    'network',
    'status',
    'overview',
    'runtime',
    'episode_count',
    'season_count',
    'rating',
    'runtime',
    'imdb_id',
    'poster',
    'fanart',
    'filters',
    'sorting',
    'watched_episode_count',
    'aired_episode_count',
  ];
  let results: TVTimeLibraryEntryShow[] = [];

  const limit = 500;
  let offset = 0;
  let newOffset = 0;

  do {
    offset = newOffset;
    const sidecar = [
      `o=https://api2.tozelabs.com/v2/user/${auth.id}`,
      `fields=shows.fields(${fields.join(
        ',',
      )}).offset(${offset}).limit(${limit})`,
    ];

    const url = `${TVTIME_BASE_URL}?${sidecar.join('&')}`;

    try {
      const response = await withTVTimeRefresh(
        userConfig,
        'meta-previews',
        (currentAuth) =>
          axiosCache(url, {
            id: `tvtime-series-${currentAuth.id}-${iOffset}-${iLimit}-${offset}`,
            method: 'GET',
            headers: createTVTimeHeaders(currentAuth),
            cache: {
              ttl: 1000 * 60 * 20,
              interpretHeader: false,
              staleIfError: 1000 * 60 * 5,
            },
          }),
      );

      logTVTime('info', 'meta-previews', {
        kind: 'series',
        user: auth.id,
        offset,
        status: response.status,
      });

      if (
        !response.data ||
        !response.data.shows ||
        !response.data.shows.length
      ) {
        throw new Error('TVTime Api: No catalog data found!');
      }

      const data = response.data as TVTimeLibraryEntryShowsResponse;
      results = [...results, ...data.shows];
      if (results.length >= limit + offset) {
        newOffset += limit;
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Request timed out after ${5000}ms`);
      }
      const status = (error as { response?: { status?: number } }).response
        ?.status;
      logTVTime('error', 'meta-previews', {
        kind: 'series',
        user: auth.id,
        offset,
        status,
        error: (error as Error).message,
      });
      throw new Error((error as Error).message);
    }
  } while (results.length >= limit + offset);

  return results
    .filter((entry) => {
      return entry.filters.find(
        (x) =>
          x.id === 'progress' &&
          (x.values.includes(status) ||
            (status === 'watching' ? x.values.includes('up_to_date') : false)),
      );
    })
    .map((entry) => {
      entry.type = 'series';
      return entry;
    })
    .slice(iOffset, iOffset + iLimit);
};

export const getTVTimeMetaPreviewsMovie = async (
  status: TVTimeCatalogMovieStatus,
  userConfig: TVTimeUserSettings,
  chunk: number,
): Promise<TVTimeLibraryEntryMovie[]> => {
  const auth = userConfig.auth;
  if (!auth) {
    throw new Error('User not authenticated');
  }

  const sidecar = [
    `o=https://msapi.tvtime.com/prod/v1/tracking/cgw/follows/user/${auth.id}`,
    `entity_type=movie`,
    `sort=watched_date,desc`,
    `filter=${status}`,
  ];

  const pagination = {
    'Page-Limit': `${500}`,
    'Page-Last-Key': ``,
  };

  const url = `${TVTIME_BASE_URL}?${sidecar.join('&')}`;

  try {
    let response;
    let iteration = 0;
    do {
      response = await withTVTimeRefresh(
        userConfig,
        'meta-previews',
        (currentAuth) =>
          axiosCache(url, {
            id: `tvtime-movie-${status}-${currentAuth.id}-${pagination['Page-Last-Key']}`,
            method: 'GET',
            headers: createTVTimeHeaders(
              currentAuth,
              pagination['Page-Limit'],
              pagination['Page-Last-Key'],
            ),
            cache: {
              ttl: 1000 * 60 * 20,
              interpretHeader: false,
              staleIfError: 1000 * 60 * 5,
            },
          }),
      );

      logTVTime('info', 'meta-previews', {
        kind: 'movie',
        user: auth.id,
        status_filter: status,
        iteration,
        status: response.status,
      });

      pagination['Page-Last-Key'] = response.headers['Page-Last-Key']
        ? response.headers['Page-Last-Key']
        : '';

      if (
        !response.data ||
        !response.data.data ||
        !response.data.data.objects ||
        !response.data.data.objects.length
      ) {
        throw new Error('TVTime Api: No catalog data found!');
      }

      iteration++;
    } while (
      pagination['Page-Last-Key'] &&
      chunk + 500 < (iteration + 1) * 500
    );

    if (
      !response.data ||
      !response.data.data ||
      !response.data.data.objects ||
      !response.data.data.objects.length
    ) {
      throw new Error('TVTime Api: No catalog data found!');
    }

    const data = response.data as TVTimeLibraryEntryResponse;
    return data.data.objects.filter((entry) => entry.filter.includes(status));
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request timed out after ${5000}ms`);
    }
    const responseStatus = (error as { response?: { status?: number } })
      .response?.status;
    logTVTime('error', 'meta-previews', {
      kind: 'movie',
      user: auth.id,
      status_filter: status,
      status: responseStatus,
      error: (error as Error).message,
    });
    throw new Error((error as Error).message);
  }
};

export const getTVTimeMetaPreviews = async (
  type: TVTimeCatalogType,
  status: TVTimeCatalogStatus,
  userConfig: TVTimeUserSettings,
  chunk: number,
  perChunk: number,
): Promise<(TVTimeLibraryEntryMovie | TVTimeLibraryEntryShow)[]> => {
  if (!userConfig.auth) {
    throw new Error('User not authenticated');
  }
  if (type === TVTimeCatalogType.SERIES) {
    return getTVTimeMetaPreviewsSeries(
      status as TVTimeCatalogSeriesStatus,
      userConfig,
      chunk,
      perChunk,
    );
  }
  return getTVTimeMetaPreviewsMovie(
    status as TVTimeCatalogMovieStatus,
    userConfig,
    chunk,
  );
};
