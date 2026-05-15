const ADJECTIVES = [
  'sweeping', 'intimate', 'electrifying', 'bittersweet', 'audacious',
  'tender', 'pulse-pounding', 'meditative', 'kaleidoscopic', 'unsparing',
];
const VERBS = [
  'follows', 'reimagines', 'chronicles', 'subverts', 'celebrates',
  'interrogates', 'reframes', 'unspools',
];
const PRAISE = [
  'lead performance', 'production design', 'sound mix',
  'practical effects', 'editing rhythm', 'climactic third act',
];
const REACTIONS = [
  'returned for repeat viewings', 'flooded social media with quotes',
  'kept it in theaters for months', 'made it the year\'s sleeper hit',
  'turned it into a TikTok phenomenon',
];
const FILLER = [
  'In a season crowded with sequels, it stands apart for its conviction.',
  'It earns its runtime without ever feeling slack.',
  'The result feels both classical and unmistakably contemporary.',
  'Few films this year have inspired stronger debate.',
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(arr: readonly T[], seed: number, offset: number): T {
  return arr[((seed + offset * 2654435761) >>> 0) % arr.length];
}

export function generateSummary(movieId: string): string {
  const s = hash(movieId);
  const adj = pick(ADJECTIVES, s, 0);
  const verb = pick(VERBS, s, 1);
  const praise = pick(PRAISE, s, 2);
  const reaction = pick(REACTIONS, s, 3);
  const filler1 = pick(FILLER, s, 4);
  const filler2 = pick(FILLER, s, 5);
  return (
    `A ${adj} drama that ${verb} a small ensemble across a single ` +
    `transformative year. Critics praised the ${praise}; audiences ${reaction}. ` +
    `${filler1} ${filler2}`
  );
}
