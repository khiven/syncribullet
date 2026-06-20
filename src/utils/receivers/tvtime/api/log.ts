type Op = 'sync' | 'meta-previews' | 'episodes' | 'mappings' | 'refresh';
type Level = 'info' | 'warn' | 'error';
type StatusClass = '2xx' | '3xx' | '4xx' | '5xx' | 'err';

const sanitize = (v: string | number | boolean | undefined): string =>
  String(v).replace(/[\r\n\t]+/g, ' ').slice(0, 500);

const jsonMode = process.env.LOG_FORMAT === 'json';

export const logTVTime = (
  level: Level,
  op: Op,
  fields: Record<string, string | number | boolean | undefined>,
) => {
  const ts = new Date().toISOString();
  const cleaned: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    cleaned[k] = typeof v === 'string' ? sanitize(v) : v;
  }

  const msg = jsonMode
    ? JSON.stringify({ ts, level, source: 'tvtime', op, ...cleaned })
    : `[${ts}] [tvtime] [${op}] ${Object.entries(cleaned)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`;

  if (level === 'error') console.error(msg);
  else if (level === 'warn') console.warn(msg);
  else console.log(msg);

  if (typeof fields.status === 'number' || fields.error !== undefined) {
    recordCounter(op, classifyStatus(fields.status));
  }
};

const classifyStatus = (
  status: string | number | boolean | undefined,
): StatusClass => {
  if (typeof status !== 'number') return 'err';
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  if (status >= 200) return '2xx';
  return 'err';
};

const BUCKETS = 15;
type Bucket = Map<string, number>;
const buckets: Bucket[] = Array.from({ length: BUCKETS }, () => new Map());
const bucketTs: number[] = new Array(BUCKETS).fill(0);
const lastSuccessTs = new Map<Op, number>();

const recordCounter = (op: Op, sc: StatusClass) => {
  const minute = Math.floor(Date.now() / 60000);
  const idx = minute % BUCKETS;
  if (bucketTs[idx] !== minute) {
    buckets[idx] = new Map();
    bucketTs[idx] = minute;
  }
  const key = `${op}:${sc}`;
  buckets[idx].set(key, (buckets[idx].get(key) ?? 0) + 1);
  if (sc === '2xx') lastSuccessTs.set(op, Date.now());
};

export const getTVTimeCounters = () => {
  const minute = Math.floor(Date.now() / 60000);
  const totals: Record<string, number> = {};
  for (let i = 0; i < BUCKETS; i++) {
    if (minute - bucketTs[i] < BUCKETS) {
      for (const [k, v] of buckets[i]) {
        totals[k] = (totals[k] ?? 0) + v;
      }
    }
  }
  const lastSuccess: Record<string, string | null> = {};
  for (const op of ['sync', 'meta-previews', 'episodes', 'mappings', 'refresh'] as Op[]) {
    const t = lastSuccessTs.get(op);
    lastSuccess[op] = t ? new Date(t).toISOString() : null;
  }
  return {
    window_minutes: BUCKETS,
    counters: totals,
    last_success_at: lastSuccess,
  };
};
