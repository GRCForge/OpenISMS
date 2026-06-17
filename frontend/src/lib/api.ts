import axios from 'axios';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── GET dedup + short-TTL reference cache ─────────────────────────────────────
// Two independent optimisations layered on api.get:
//   1. In-flight de-duplication (ALL GETs): if an identical GET is already in
//      flight, share its promise instead of firing a second request. Zero
//      staleness risk — it only collapses concurrent duplicates (e.g. several
//      components mounting at once and all requesting /users).
//   2. Short-TTL cache (reference endpoints only): rarely-changing lookup data
//      (/users, /groups, /modules) is cached for a few seconds so navigating
//      between pages doesn't refetch it every time. Any mutating request
//      (POST/PUT/PATCH/DELETE) clears the cache, so writes are reflected at once.
const CACHEABLE = [/^\/users$/, /^\/groups$/, /^\/modules$/];
// Reference data changes rarely and is invalidated on every write (below), so a
// longer TTL is safe and makes navigating across the many pages that each load
// /users essentially request-free.
const TTL_MS = 60_000;
const inflight = new Map<string, Promise<AxiosResponse>>();
const cache = new Map<string, { at: number; res: AxiosResponse }>();

const keyOf = (url: string, config?: AxiosRequestConfig) =>
  url + (config?.params ? '?' + JSON.stringify(config.params) : '');

export const clearApiCache = () => { cache.clear(); };

const rawGet = api.get.bind(api);
api.get = function <T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  const key = keyOf(url, config);
  const cacheable = !config?.params && CACHEABLE.some(re => re.test(url));

  if (cacheable) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.res as AxiosResponse<T>);
  }
  const pending = inflight.get(key);
  if (pending) return pending as Promise<AxiosResponse<T>>;

  const p = rawGet<T>(url, config)
    .then(res => {
      inflight.delete(key);
      if (cacheable) cache.set(key, { at: Date.now(), res });
      return res;
    })
    .catch(err => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, p as Promise<AxiosResponse>);
  return p;
} as typeof api.get;

// A write to any endpoint may invalidate cached reference data → drop the cache.
for (const method of ['post', 'put', 'patch', 'delete'] as const) {
  const raw = api[method].bind(api) as (...args: any[]) => Promise<AxiosResponse>;
  (api as any)[method] = (...args: any[]) => {
    clearApiCache();
    return raw(...args);
  };
}

export default api;
