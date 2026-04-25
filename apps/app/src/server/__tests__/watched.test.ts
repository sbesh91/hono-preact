// apps/app/src/server/__tests__/watched.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetForTests,
  getWatched,
  listWatched,
  markWatched,
  removeWatched,
  setNotes,
  setPhoto,
  unmarkWatched,
} from '../watched.js';

beforeEach(() => {
  __resetForTests();
});

describe('watched store', () => {
  it('markWatched creates a record with watchedAt > 0 and empty notes', async () => {
    await markWatched(42);
    const rec = await getWatched(42);
    expect(rec).not.toBeNull();
    expect(rec!.movieId).toBe(42);
    expect(rec!.watchedAt).toBeGreaterThan(0);
    expect(rec!.notes).toBe('');
    expect(rec!.photo).toBeUndefined();
  });

  it('markWatched twice is a no-op (watchedAt unchanged on second call)', async () => {
    await markWatched(42);
    const first = (await getWatched(42))!.watchedAt;
    await new Promise((r) => setTimeout(r, 5));
    await markWatched(42);
    const second = (await getWatched(42))!.watchedAt;
    expect(second).toBe(first);
  });

  it('unmarkWatched removes the record entirely', async () => {
    await markWatched(42);
    await unmarkWatched(42);
    expect(await getWatched(42)).toBeNull();
    expect(await listWatched()).toEqual([]);
  });

  it('setNotes on an unwatched id creates a record with watchedAt=0', async () => {
    await setNotes(42, 'great movie');
    const rec = await getWatched(42);
    expect(rec).not.toBeNull();
    expect(rec!.watchedAt).toBe(0);
    expect(rec!.notes).toBe('great movie');
  });

  it('setNotes on an already-watched id preserves watchedAt', async () => {
    await markWatched(42);
    const before = (await getWatched(42))!.watchedAt;
    await setNotes(42, 'updated');
    const after = (await getWatched(42))!;
    expect(after.watchedAt).toBe(before);
    expect(after.notes).toBe('updated');
  });

  it('setPhoto stores bytes and content-type', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await setPhoto(42, { contentType: 'image/png', bytes, filename: 'x.png' });
    const rec = await getWatched(42);
    expect(rec!.photo).toEqual({ contentType: 'image/png', bytes, filename: 'x.png' });
  });

  it('setPhoto on an unwatched id creates a record with watchedAt=0', async () => {
    await setPhoto(42, {
      contentType: 'image/png',
      bytes: new Uint8Array([0]),
      filename: 'x.png',
    });
    const rec = await getWatched(42);
    expect(rec).not.toBeNull();
    expect(rec!.watchedAt).toBe(0);
  });

  it('removeWatched empties the record', async () => {
    await markWatched(42);
    await markWatched(7);
    await removeWatched(42);
    expect(await getWatched(42)).toBeNull();
    const list = await listWatched();
    expect(list.map((r) => r.movieId)).toEqual([7]);
  });

  it('listWatched returns all current records', async () => {
    await markWatched(1);
    await markWatched(2);
    await markWatched(3);
    const list = await listWatched();
    expect(list.map((r) => r.movieId).sort()).toEqual([1, 2, 3]);
  });
});
