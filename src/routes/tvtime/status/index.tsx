import type { RequestHandler } from '@builder.io/qwik-city';

import { getTVTimeCounters } from '~/utils/receivers/tvtime/api/log';

export const onGet: RequestHandler = async ({ json, headers }) => {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'no-store');

  const snapshot = getTVTimeCounters();

  json(200, {
    service: 'syncribullet',
    receiver: 'tvtime',
    now: new Date().toISOString(),
    ...snapshot,
  });
};
