import type { RequestHandler } from '@builder.io/qwik-city';

export const onGet: RequestHandler = async ({ json, headers }) => {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'no-store');

  json(200, {
    status: 'ok',
    now: new Date().toISOString(),
  });
};
