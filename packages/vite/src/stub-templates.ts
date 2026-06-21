import {
  MODULE_KEY_EXPORT,
  LOADER_NAME_OPTION,
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
  FORM_SOCKET_FIELD,
} from '@hono-preact/iso/internal/runtime';

// Source for the `serverLoaders` client stub: a Proxy whose every property read
// constructs a fresh loader stub carrying the module key, loader name, and the
// statically-mined params for that loader.
export function loaderStubSource(
  localName: string,
  moduleKey: string,
  loadersMeta: Record<string, string[] | '*'>
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
    `      params: __meta,\n` +
    `    });\n` +
    `  }\n` +
    `});`
  );
}

// Source for the `serverActions` client stub. Each `serverActions.<name>` read
// constructs a fresh descriptor record (module + action), so the stub is not a
// stable singleton; callers that key a Map on the stub will be surprised. The
// contract is "stubs are descriptor records, not singletons."
export function actionStubSource(localName: string, moduleKey: string): string {
  return (
    `const ${localName} = new Proxy({}, {\n` +
    `  get(_, action) {\n` +
    `    const stub = { ${FORM_MODULE_FIELD}: ${JSON.stringify(moduleKey)}, ${FORM_ACTION_FIELD}: String(action) };\n` +
    `    stub.useAction = (opts) => __$useAction_hpiso(stub, opts);\n` +
    `    return stub;\n` +
    `  }\n` +
    `});`
  );
}

// Source for the `serverSockets` client stub. Each `serverSockets.<name>` read
// constructs a descriptor record (module + socket name) and attaches a
// `.useSocket` method that delegates to `__$useSocket_hpiso`, mirroring the
// pattern used by `actionStubSource` for `.useAction`. Like actions, the stub
// is a descriptor, not a singleton.
export function socketStubSource(localName: string, moduleKey: string): string {
  return (
    `const ${localName} = new Proxy({}, {\n` +
    `  get(_, name) {\n` +
    `    const stub = { ${FORM_MODULE_FIELD}: ${JSON.stringify(moduleKey)}, ${FORM_SOCKET_FIELD}: String(name) };\n` +
    `    stub.useSocket = (opts) => __$useSocket_hpiso(stub, opts);\n` +
    `    return stub;\n` +
    `  }\n` +
    `});`
  );
}
