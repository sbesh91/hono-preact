import { defineLoader } from '@hono-preact/iso';

const summaryFn = async () => ({ title: 'Movie' });
const castFn = async () => ({ actors: [] });
const defaultFn = async () => ({ data: null });

export const serverLoaders = {
  summary: defineLoader(summaryFn, { params: ['genre'] }),
  cast: defineLoader(castFn, { params: '*' }),
  default: defineLoader(defaultFn),
};
