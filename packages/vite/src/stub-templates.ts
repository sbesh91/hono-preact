import {
  MODULE_KEY_EXPORT,
  LOADER_NAME_OPTION,
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
  FORM_ROOM_FIELD,
  FORM_SOCKET_FIELD,
} from '@hono-preact/iso/internal/contract';
import type { ServerLoaderMeta } from './source-extraction.js';

// Source for the `serverLoaders` client stub: a Proxy whose every property read
// constructs a fresh loader stub carrying the module key, loader name, and the
// statically-mined metadata (cacheKeyParams + route-binding) for that loader.
// `__meta` is undefined for loaders with no entry (route-independent, default
// cacheKeyParams), so both reads guard with `__meta &&` and the stub falls
// back to its defaults.
export function loaderStubSource(
  localName: string,
  moduleKey: string,
  loadersMeta: Record<string, ServerLoaderMeta>
): string {
  const metaVar = `__$serverLoadersMeta_${localName}`;
  const metaJson = JSON.stringify(loadersMeta);
  return (
    `const ${metaVar} = ${metaJson};\n` +
    `const ${localName} = new Proxy({}, {\n` +
    `  get(_, name) {\n` +
    `    const __meta = ${metaVar}[String(name)];\n` +
    `    return __$createLoaderStub_hpiso({\n` +
    `      ${MODULE_KEY_EXPORT}: ${JSON.stringify(moduleKey)},\n` +
    `      ${LOADER_NAME_OPTION}: String(name),\n` +
    `      cacheKeyParams: __meta && __meta.cacheKeyParams,\n` +
    `      __routeBound: __meta && __meta.routeBound,\n` +
    `    });\n` +
    `  }\n` +
    `});`
  );
}

/**
 * The one descriptor-stub template, shared by actions, sockets and rooms.
 *
 * All three emit the same Proxy: every `<export>.<name>` read constructs a
 * fresh descriptor record (the module key plus the kind's name field) and
 * attaches the kind's hook method, which delegates to the framework hook the
 * matching `STUB_IMPORTS` entry prepends. The three differ ONLY in the three
 * fields below, so they are one template with three configurations rather than
 * three templates: a fix to the emitted shape (or a new field on the
 * descriptor) has exactly one place to land, and the kinds cannot drift apart.
 *
 * The stub is a descriptor record, not a stable singleton: each read builds a
 * new object, so a caller keying a Map on the stub will be surprised. The
 * contract is "stubs are descriptor records, not singletons."
 */
function descriptorStubSource(
  localName: string,
  moduleKey: string,
  kind: {
    /** Contract field naming this kind on the descriptor (e.g. `__action`). */
    nameField: string;
    /** Method the stub exposes (e.g. `useAction`). */
    method: string;
    /** Framework hook the method delegates to (e.g. `__$useAction_hpiso`). */
    hook: string;
  }
): string {
  return (
    `const ${localName} = new Proxy({}, {\n` +
    `  get(_, name) {\n` +
    `    const stub = { ${FORM_MODULE_FIELD}: ${JSON.stringify(moduleKey)}, ${kind.nameField}: String(name) };\n` +
    `    stub.${kind.method} = (opts) => ${kind.hook}(stub, opts);\n` +
    `    return stub;\n` +
    `  }\n` +
    `});`
  );
}

/** Source for the `serverActions` client stub. */
export function actionStubSource(localName: string, moduleKey: string): string {
  return descriptorStubSource(localName, moduleKey, {
    nameField: FORM_ACTION_FIELD,
    method: 'useAction',
    hook: '__$useAction_hpiso',
  });
}

/** Source for the `serverSockets` client stub. */
export function socketStubSource(localName: string, moduleKey: string): string {
  return descriptorStubSource(localName, moduleKey, {
    nameField: FORM_SOCKET_FIELD,
    method: 'useSocket',
    hook: '__$useSocket_hpiso',
  });
}

/** Source for the `serverRooms` client stub. */
export function roomStubSource(localName: string, moduleKey: string): string {
  return descriptorStubSource(localName, moduleKey, {
    nameField: FORM_ROOM_FIELD,
    method: 'useRoom',
    hook: '__$useRoom_hpiso',
  });
}
