import Axios from 'axios';
import { setupCache } from 'axios-cache-interceptor';

export const axiosInstance = Axios.create();

const debug =
  process.env.AXIOS_CACHE_DEBUG === '1'
    ? (x: unknown) => console.log('[axios-cache]', JSON.stringify(x))
    : undefined;

export const axiosCache = setupCache(axiosInstance, {
  staleIfError: 5 * 60 * 1000,
  // GET caches all reads. POST is kept because anilist's GraphQL queries
  // (current-user, meta-object, meta-previews) intentionally use axiosCache
  // POST as a query cache. ALL mutation POSTs (sync.ts in every receiver)
  // pass `cache: false` explicitly to prevent silent replay of writes.
  methods: ['get', 'post'],
  ...(debug ? { debug } : {}),
});
