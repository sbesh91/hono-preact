import type {
  ServerMiddleware,
  ClientMiddleware,
  Scope,
} from './define-middleware.js';
import type { StreamObserver } from './define-stream-observer.js';

export type AppUseElement =
  | ServerMiddleware<Scope>
  | ClientMiddleware
  | StreamObserver<unknown, unknown>;

export type AppConfig = {
  use?: ReadonlyArray<AppUseElement>;
};

export function defineApp(config: AppConfig): AppConfig {
  return config;
}
