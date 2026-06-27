import * as clack from '@clack/prompts';
import pc from 'picocolors';

/**
 * Exit cleanly if the user cancelled a clack prompt (Ctrl-C).
 *
 * @template T
 * @param {T | symbol} value
 * @returns {T}
 */
function guard(value) {
  if (clack.isCancel(value)) {
    clack.cancel('Cancelled');
    process.exit(0);
  }
  return /** @type {T} */ (value);
}

/** @type {import('./prompts.mjs').PromptAdapter} */
export const clackPrompts = {
  intro: (message) => clack.intro(message),
  outro: (message) => clack.outro(message),
  cancel: (message) => clack.cancel(message),
  note: (message, title) => clack.note(message, title),
  spinner: () => clack.spinner(),
  text: async (opts) => guard(await clack.text(opts)),
  selectAdapter: async () =>
    guard(
      await clack.select({
        message: 'Adapter:',
        initialValue: 'cloudflare',
        options: [
          { value: 'cloudflare', label: 'Cloudflare Workers' },
          { value: 'node', label: 'Node server' },
        ],
      })
    ),
  confirm: async (opts) => guard(await clack.confirm(opts)),
};

export const brandBanner = pc.cyan(pc.bold('create-hono-preact'));
