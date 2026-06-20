import Axios from 'axios';
import { buildWebStorage, setupCache } from 'axios-cache-interceptor';
import type { AxiosCacheInstance } from 'axios-cache-interceptor';

export const axiosInstance = Axios.create();

let sessionCache: AxiosCacheInstance | undefined = undefined;

const debug =
  import.meta.env.PUBLIC_AXIOS_CACHE_DEBUG === '1'
    ? (x: unknown) => console.log('[axios-cache]', JSON.stringify(x))
    : undefined;

export const axiosSessionCache = () => {
  if (sessionCache) {
    return sessionCache;
  }
  sessionCache = setupCache(axiosInstance, {
    staleIfError: 5 * 60 * 1000,
    methods: ['get', 'post'],
    storage: buildWebStorage(sessionStorage),
    ...(debug ? { debug } : {}),
  });
  return sessionCache;
};
