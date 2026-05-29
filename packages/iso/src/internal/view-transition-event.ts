export type NavDirection =
  | 'initial'
  | 'push'
  | 'replace'
  | 'back'
  | 'forward';

export type ViewTransitionReason = 'skipped' | 'unsupported' | 'aborted';

interface ViewTransitionEventInit {
  to: string;
  from: string | undefined;
  direction: NavDirection;
}

export class ViewTransitionEvent {
  readonly to: string;
  readonly from: string | undefined;
  readonly direction: NavDirection;
  readonly types: string[] = [];
  transition: ViewTransition | null = null;
  reason: ViewTransitionReason | undefined = undefined;

  /** @internal */
  _skipped = false;

  private readonly stash = new Map<unknown, unknown>();

  constructor(init: ViewTransitionEventInit) {
    this.to = init.to;
    this.from = init.from;
    this.direction = init.direction;
  }

  skip(): void {
    this._skipped = true;
  }

  set(key: unknown, value: unknown): void {
    this.stash.set(key, value);
  }

  get<T = unknown>(key: unknown): T | undefined {
    return this.stash.get(key) as T | undefined;
  }
}
