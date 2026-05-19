import { defineLoader, defineAction } from 'hono-preact';

export const serverLoaders = {
  default: defineLoader(async () => ({
    message: 'Hello from the Node adapter loader',
    renderedAt: new Date().toISOString(),
  })),
};

export const serverActions = {
  echo: defineAction<{ text: string }, { echoed: string }>(
    async (_ctx, input) => ({ echoed: input.text })
  ),
};
