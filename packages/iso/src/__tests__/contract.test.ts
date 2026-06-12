import { describe, expect, it } from 'vitest';
import {
  LOADERS_RPC_PATH,
  CLIENT_ENTRY_FILE,
  CLIENT_ENTRY_URL,
  VIRTUAL_CLIENT_ID,
  VIRTUAL_CLIENT_DEV_URL,
  MODULE_KEY_EXPORT,
  LOADER_NAME_OPTION,
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
} from '../internal-runtime.js';

describe('wire-contract constants', () => {
  it('pins the exact wire values (changing any is a breaking change)', () => {
    expect(LOADERS_RPC_PATH).toBe('/__loaders');
    expect(CLIENT_ENTRY_FILE).toBe('static/client.js');
    expect(VIRTUAL_CLIENT_ID).toBe('virtual:hono-preact/client');
    expect(MODULE_KEY_EXPORT).toBe('__moduleKey');
    expect(LOADER_NAME_OPTION).toBe('__loaderName');
    expect(FORM_MODULE_FIELD).toBe('__module');
    expect(FORM_ACTION_FIELD).toBe('__action');
  });

  it('derives the URL forms from their base constants', () => {
    expect(CLIENT_ENTRY_URL).toBe(`/${CLIENT_ENTRY_FILE}`);
    expect(VIRTUAL_CLIENT_DEV_URL).toBe(`/@id/__x00__${VIRTUAL_CLIENT_ID}`);
    expect(CLIENT_ENTRY_URL).toBe('/static/client.js');
    expect(VIRTUAL_CLIENT_DEV_URL).toBe(
      '/@id/__x00__virtual:hono-preact/client'
    );
  });
});
