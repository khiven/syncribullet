import type { AxiosError } from 'axios';

import { axiosCache } from '~/utils/axios/cache';

import type { TVTimeUserSettings } from '../types/user-settings';
import { createTVTimeHeaders } from './headers';
import { logTVTime } from './log';
import { TVTIME_BASE_URL } from './url';

// Captured from the TV Time PWA (Network → GET /v2/user/{id}/jwt). HTTP
// headers are case-insensitive, so lower-case works; TV Time's PWA
// itself sends it as `Jwt_refresh_token`.
const REFRESH_HEADER_NAME = 'jwt_refresh_token';

type TVTimeAuth = NonNullable<TVTimeUserSettings['auth']>;

interface RefreshResponse {
  id: string;
  jwt_token: string;
}

const buildRefreshUrl = (userId: string): string => {
  const target = `https://api2.tozelabs.com/v2/user/${userId}/jwt`;
  const b64 = Buffer.from(target, 'utf-8').toString('base64url');
  return `${TVTIME_BASE_URL}?o_b64=${b64}`;
};

export const refreshTVTimeToken = async (
  auth: TVTimeAuth,
): Promise<string> => {
  const url = buildRefreshUrl(auth.id);
  const response = await axiosCache(url, {
    method: 'GET',
    cache: false,
    headers: {
      ...createTVTimeHeaders(auth),
      [REFRESH_HEADER_NAME]: auth.rt,
    },
  });
  const body = response.data as RefreshResponse;
  if (!body.jwt_token) {
    throw new Error('TVTime refresh response missing jwt_token');
  }
  return body.jwt_token;
};

export const withTVTimeRefresh = async <T>(
  userConfig: TVTimeUserSettings,
  op: 'sync' | 'meta-previews' | 'episodes',
  fn: (auth: TVTimeAuth) => Promise<T>,
): Promise<T> => {
  if (!userConfig.auth) {
    throw new Error('User is not authenticated');
  }

  try {
    return await fn(userConfig.auth);
  } catch (error) {
    const status = (error as AxiosError).response?.status;
    if (status !== 401) {
      throw error;
    }
    logTVTime('warn', op, { status: 401, action: 'refresh_retry' });

    let refreshed: TVTimeAuth;
    try {
      const newToken = await refreshTVTimeToken(userConfig.auth);
      refreshed = { ...userConfig.auth, access_token: newToken };
      logTVTime('info', 'refresh', {
        status: 200,
        user: userConfig.auth.id,
      });
    } catch (refreshError) {
      const refreshStatus = (refreshError as AxiosError).response?.status;
      logTVTime('error', 'refresh', {
        status: refreshStatus,
        reason: (refreshError as Error).message,
        user: userConfig.auth.id,
        user_must_relogin: true,
      });
      throw error;
    }

    const result = await fn(refreshed);
    logTVTime('info', op, { status: 200, after_refresh: true });
    return result;
  }
};
