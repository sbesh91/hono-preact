import { HonoRequestContext } from '@hono-preact/iso/internal';
import { useContext } from 'preact/hooks';

export const HonoContext = HonoRequestContext;

export function useHonoContext() {
  return useContext(HonoContext);
}
