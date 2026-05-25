import type { AppConfig } from '@hono-preact/iso';

const SPECULATION_RULES_JSON =
  '{"prefetch":[{"where":{"and":[' +
  '{"href_matches":"/*"},' +
  '{"not":{"selector_matches":"[data-no-prefetch]"}}' +
  ']},"eagerness":"moderate"}]}';

export const SPECULATION_RULES_TAG = `<script type="speculationrules">${SPECULATION_RULES_JSON}</script>`;

export function speculationRulesTag(config: AppConfig): string {
  return config.speculation === true ? SPECULATION_RULES_TAG : '';
}
