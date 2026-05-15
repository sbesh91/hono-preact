export type CastMember = { name: string; role: string };

const NAMES = [
  'Auli\'i Cravalho', 'Dwayne Johnson', 'Awkwafina', 'Pedro Pascal',
  'Zendaya', 'Timothée Chalamet', 'Florence Pugh', 'Cynthia Erivo',
  'Ariana Grande', 'Hugh Grant', 'Anya Taylor-Joy', 'Paul Mescal',
  'Denzel Washington', 'Margot Robbie', 'Ryan Gosling', 'Emma Stone',
  'Lupita Nyong\'o', 'Daniel Kaluuya', 'Saoirse Ronan', 'Jacob Elordi',
];
const ROLES = ['Lead', 'Co-lead', 'Supporting', 'Antagonist', 'Mentor', 'Ensemble'];

/** Tiny deterministic 32-bit hash so we don't pull in a dep. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateCast(movieId: string): CastMember[] {
  const seed = hash(movieId);
  const out: CastMember[] = [];
  const used = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const nameIdx = (seed + i * 2654435761) >>> 0;
    let pick = nameIdx % NAMES.length;
    while (used.has(NAMES[pick])) pick = (pick + 1) % NAMES.length;
    used.add(NAMES[pick]);
    const role = ROLES[i % ROLES.length];
    out.push({ name: NAMES[pick], role });
  }
  return out;
}
