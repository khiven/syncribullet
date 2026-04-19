type Op = 'sync' | 'meta-previews' | 'episodes' | 'refresh';
type Level = 'info' | 'warn' | 'error';

export const logTVTime = (
  level: Level,
  op: Op,
  fields: Record<string, string | number | boolean | undefined>,
) => {
  const ts = new Date().toISOString();
  const line = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  const msg = `[${ts}] [tvtime] [${op}] ${line}`;
  if (level === 'error') console.error(msg);
  else if (level === 'warn') console.warn(msg);
  else console.log(msg);
};
