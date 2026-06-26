export interface PromptAdapter {
  text(opts: {
    message: string;
    placeholder?: string;
    validate?: (value: string) => string | undefined;
  }): Promise<string>;
  selectAdapter(): Promise<'cloudflare' | 'node'>;
  confirm(opts: { message: string; initialValue?: boolean }): Promise<boolean>;
  intro(message: string): void;
  outro(message: string): void;
  note(message: string, title?: string): void;
  spinner(): { start(message: string): void; stop(message: string): void };
}

export const clackPrompts: PromptAdapter;
export const brandBanner: string;
