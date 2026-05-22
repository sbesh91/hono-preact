import { defineLoader } from 'hono-preact';

export const serverLoaders = {
  default: defineLoader(async () => ({
    message: 'Hello from your hono-preact app!',
    renderedAt: new Date().toISOString(),
  })),
};
