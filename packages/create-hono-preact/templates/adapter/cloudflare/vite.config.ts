import { honoPreact } from 'hono-preact/vite';
import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [honoPreact({ adapter: cloudflareAdapter() })],
});
