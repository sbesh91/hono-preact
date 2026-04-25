export type WatchedRecord = {
  movieId: number;
  watchedAt: number;
  notes: string;
  photo?: { contentType: string; bytes: Uint8Array<ArrayBuffer>; filename: string };
};

const store = new Map<number, WatchedRecord>();

export async function listWatched(): Promise<WatchedRecord[]> {
  return [...store.values()];
}

export async function getWatched(id: number): Promise<WatchedRecord | null> {
  return store.get(id) ?? null;
}

export async function markWatched(id: number): Promise<void> {
  const existing = store.get(id);
  if (existing && existing.watchedAt > 0) return;
  store.set(id, {
    movieId: id,
    watchedAt: Date.now(),
    notes: existing?.notes ?? '',
    photo: existing?.photo,
  });
}

// Called from toggle actions (watch/unwatch). Same operation as removeWatched
// but named separately so call sites read semantically at the action layer.
export async function unmarkWatched(id: number): Promise<void> {
  store.delete(id);
}

export async function setNotes(id: number, notes: string): Promise<void> {
  const existing = store.get(id);
  store.set(id, {
    movieId: id,
    watchedAt: existing?.watchedAt ?? 0,
    notes,
    photo: existing?.photo,
  });
}

export async function setPhoto(
  id: number,
  photo: { contentType: string; bytes: Uint8Array<ArrayBuffer>; filename: string }
): Promise<void> {
  const existing = store.get(id);
  store.set(id, {
    movieId: id,
    watchedAt: existing?.watchedAt ?? 0,
    notes: existing?.notes ?? '',
    photo,
  });
}

export async function removeWatched(id: number): Promise<void> {
  store.delete(id);
}

export function __resetForTests(): void {
  store.clear();
}
