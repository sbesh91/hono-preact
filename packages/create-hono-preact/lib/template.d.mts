export function copyTemplate(source: string, target: string): Promise<void>;
export function renameDotfiles(target: string): Promise<void>;
export function substituteName(target: string, name: string): Promise<void>;
export function fileExists(path: string): Promise<boolean>;
export function copyAgentsFiles(
  agentsDir: string,
  targetDir: string,
  options: { force: boolean },
): Promise<Array<{ file: string; action: 'created' | 'overwritten' | 'skipped' }>>;
