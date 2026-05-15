import { movieData } from './movie.js';

export type BoxOfficeStats = {
  budget: number;
  revenue: number;
  openingWeekend: number;
  screens: number;
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateBoxOffice(movieId: string): BoxOfficeStats {
  const detail = movieData[movieId];
  const s = hash(movieId);

  const budget = detail?.budget && detail.budget > 0
    ? detail.budget
    : 50_000_000 + (s % 200) * 1_000_000;

  const revenue = detail?.revenue && detail.revenue > 0
    ? detail.revenue
    : Math.floor(budget * (1.2 + (s % 30) / 10));

  const openingWeekend = Math.floor(revenue * (0.15 + (s % 20) / 100));
  const screens = 2500 + (s % 1500);

  return { budget, revenue, openingWeekend, screens };
}
