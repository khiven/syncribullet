import axios from 'axios';

import { axiosCache } from '~/utils/axios/cache';

import type { TVTimeUserSettings } from '../types/user-settings';
import { createTVTimeHeaders } from './headers';
import { logTVTime } from './log';
import { TVTIME_BASE_URL } from './url';

// Captured from the TV Time PWA (Network → GET /v2/user/{id}/jwt). HTTP
// headers are case-insensitive, so lower-case works; TV Time's PWA
// itself sends it as `Jwt_refresh_token`.
const REFRESH_HEADER_NAME = 'jwt_refresh_token';

// Refresh access tokens this many ms before their JWT `exp` claim says
// they will expire — keeps the path proactive instead of reactive.
const PROACTIVE_REFRESH_LEEWAY_MS = 60_000;

// Memoize "rt is dead, user must re-login" for this long after first
// failure, so we don't 401-storm TV Time on every subsequent request.
const DEAD_RT_MEMOIZE_MS = 5 * 60 * 1000;

type TVTimeAuth = NonNullable<TVTimeUserSettings['auth']>;
type Op = 'sync' | 'meta-previews' | 'episodes' | 'mappings';

interface RefreshResponse {
  id: string;
  jwt_token: string;
}

export class TVTimeReAuthRequired extends Error {
  public override readonly name = 'TVTimeReAuthRequired';
  constructor(
    public readonly refreshStatus: number | undefined,
    public readonly originalStatus = 401,
  ) {
    super(
      'TVTime authentication expired — please re-configure the addon in the syncribullet UI',
    );
  }
}

// Module-level coordination across concurrent requests.
const inflightRefresh = new Map<string, Promise<string>>();
const deadAuthAt = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decodeJwtExpMs = (token: string): number | null => {
  try {
    const middle = token.split('.')[1];
    if (!middle) return null;
    const json = Buffer.from(middle, 'base64url').toString('utf-8');
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp !== 'number') return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
};

const buildRefreshUrl = (userId: string): string => {
  const target = `https://api2.tozelabs.com/v2/user/${userId}/jwt`;
  const b64 = Buffer.from(target, 'utf-8').toString('base64url');
  return `${TVTIME_BASE_URL}?o_b64=${b64}`;
};

const previewBody = (data: unknown): string => {
  if (typeof data === 'string') return data.slice(0, 200);
  try {
    return JSON.stringify(data)?.slice(0, 200) ?? '';
  } catch {
    return String(data).slice(0, 200);
  }
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
  const body = response.data as RefreshResponse | undefined;
  if (!body || typeof body !== 'object' || !body.jwt_token) {
    throw new Error(
      `TVTime refresh response missing jwt_token (body=${previewBody(response.data)})`,
    );
  }
  return body.jwt_token;
};

const notifyReAuthRequired = async (userId: string, reason: string) => {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return;
  try {
    await axios.post(
      url,
      { source: 'syncribullet', event: 'tvtime_reauth_required', user: userId, reason },
      { timeout: 5000 },
    );
  } catch {
    // Notification is best-effort; never block the request on it.
  }
};

const dedupedRefresh = (auth: TVTimeAuth): Promise<string> => {
  const existing = inflightRefresh.get(auth.id);
  if (existing) return existing;
  const p = refreshTVTimeToken(auth).finally(() => {
    inflightRefresh.delete(auth.id);
  });
  inflightRefresh.set(auth.id, p);
  return p;
};

const statusOf = (err: unknown): number | undefined => {
  if (axios.isAxiosError(err)) return err.response?.status;
  return undefined;
};

const codeOf = (err: unknown): string | undefined => {
  if (axios.isAxiosError(err)) return err.code;
  const maybe = err as { code?: string };
  return typeof maybe?.code === 'string' ? maybe.code : undefined;
};

export const withTVTimeRefresh = async <T>(
  userConfig: TVTimeUserSettings,
  op: Op,
  fn: (auth: TVTimeAuth) => Promise<T>,
): Promise<T> => {
  if (!userConfig.auth) {
    throw new Error('User is not authenticated');
  }
  const auth = userConfig.auth;

  // Dead-rt circuit breaker: if we recently confirmed the refresh token
  // itself was rejected, fail-fast for DEAD_RT_MEMOIZE_MS instead of
  // spamming TV Time with doomed calls (rate-limit / IP-ban risk).
  const deadAt = deadAuthAt.get(auth.id);
  if (deadAt && Date.now() - deadAt < DEAD_RT_MEMOIZE_MS) {
    throw new TVTimeReAuthRequired(undefined);
  }

  // Proactive refresh: if the access token JWT is already past its exp
  // (or within LEEWAY of it), refresh before the call instead of paying
  // the round-trip 401. Single-flight so concurrent requests share one.
  const expMs = decodeJwtExpMs(auth.access_token);
  if (expMs !== null && expMs <= Date.now() + PROACTIVE_REFRESH_LEEWAY_MS) {
    try {
      const newToken = await dedupedRefresh(auth);
      auth.access_token = newToken;
      deadAuthAt.delete(auth.id);
      logTVTime('info', 'refresh', {
        user: auth.id,
        proactive: true,
        status: 200,
      });
    } catch (refreshError) {
      const rs = statusOf(refreshError);
      logTVTime('error', 'refresh', {
        user: auth.id,
        proactive: true,
        status: rs,
        reason: (refreshError as Error).message,
        user_must_relogin: true,
      });
      deadAuthAt.set(auth.id, Date.now());
      void notifyReAuthRequired(auth.id, (refreshError as Error).message);
      throw new TVTimeReAuthRequired(rs);
    }
  }

  try {
    return await fn(auth);
  } catch (error) {
    const status = statusOf(error);

    if (status === 429) {
      const retryAfter = axios.isAxiosError(error)
        ? Number(error.response?.headers['retry-after']) || 1
        : 1;
      logTVTime('warn', op, { status: 429, action: 'retry_after', after_s: retryAfter });
      await sleep(retryAfter * 1000);
      return await fn(auth);
    }

    if (status !== undefined && status >= 500 && status < 600) {
      logTVTime('warn', op, { status, action: '5xx_retry' });
      await sleep(500 + Math.random() * 500);
      return await fn(auth);
    }

    if (status !== 401) {
      // Non-auth, non-transient error. Surface with diagnostic context.
      throw error;
    }

    logTVTime('warn', op, { status: 401, action: 'refresh_retry' });

    let newToken: string;
    try {
      newToken = await dedupedRefresh(auth);
      auth.access_token = newToken;
      deadAuthAt.delete(auth.id);
      logTVTime('info', 'refresh', { user: auth.id, status: 200 });
    } catch (refreshError) {
      const rs = statusOf(refreshError);
      logTVTime('error', 'refresh', {
        user: auth.id,
        status: rs,
        reason: (refreshError as Error).message,
        user_must_relogin: true,
      });
      deadAuthAt.set(auth.id, Date.now());
      void notifyReAuthRequired(auth.id, (refreshError as Error).message);
      throw new TVTimeReAuthRequired(rs);
    }

    try {
      const result = await fn(auth);
      logTVTime('info', op, { user: auth.id, after_refresh: true });
      return result;
    } catch (retryError) {
      const rs = statusOf(retryError);
      logTVTime('error', op, {
        user: auth.id,
        after_refresh: true,
        status: rs,
        code: codeOf(retryError),
        reason: (retryError as Error).message,
      });
      throw retryError;
    }
  }
};
