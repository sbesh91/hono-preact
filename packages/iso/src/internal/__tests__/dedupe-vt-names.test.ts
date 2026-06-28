// @vitest-environment happy-dom
// Regression (#199): hold-alive keeps the outgoing route mounted through a
// transition, so an outgoing element can still carry a view-transition-name the
// incoming route re-claimed on a different element. __dedupeOutgoingVtNames
// clears the outgoing duplicate (keeping the incoming endpoint) so the new VT
// snapshot has no "duplicate view-transition-name".
import { describe, it, expect, afterEach } from 'vitest';
import { __dedupeOutgoingVtNames } from '../route-change.js';

function named(name: string): HTMLElement {
  const el = document.createElement('div');
  el.style.setProperty('view-transition-name', name);
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('__dedupeOutgoingVtNames', () => {
  it('clears the outgoing element when the incoming route re-claimed the name', () => {
    const outgoing = named('task-title-t4'); // held outgoing route's element
    const oldNamed = new Map<string, HTMLElement>([
      ['task-title-t4', outgoing],
    ]);
    const incoming = named('task-title-t4'); // incoming route's morph endpoint

    __dedupeOutgoingVtNames(oldNamed);

    expect(outgoing.style.getPropertyValue('view-transition-name')).toBe('');
    expect(incoming.style.getPropertyValue('view-transition-name')).toBe(
      'task-title-t4'
    );
  });

  it('leaves a persistent name untouched when no other element re-claimed it', () => {
    const chrome = named('layout-title'); // parent-layout chrome, single use
    const oldNamed = new Map<string, HTMLElement>([['layout-title', chrome]]);

    __dedupeOutgoingVtNames(oldNamed);

    expect(chrome.style.getPropertyValue('view-transition-name')).toBe(
      'layout-title'
    );
  });

  it('skips an outgoing element already detached from the document', () => {
    const detached = document.createElement('div');
    detached.style.setProperty('view-transition-name', 'gone');
    // not appended -> not connected
    const oldNamed = new Map<string, HTMLElement>([['gone', detached]]);
    // A live element re-using the name should be left alone; the detached one is
    // not in the live tree so it cannot collide.
    const live = named('gone');

    __dedupeOutgoingVtNames(oldNamed);

    expect(live.style.getPropertyValue('view-transition-name')).toBe('gone');
  });

  it('only clears the names that are actually duplicated', () => {
    const outA = named('a'); // will be duplicated
    const outB = named('b'); // stays unique
    const oldNamed = new Map<string, HTMLElement>([
      ['a', outA],
      ['b', outB],
    ]);
    named('a'); // incoming re-claims "a" only

    __dedupeOutgoingVtNames(oldNamed);

    expect(outA.style.getPropertyValue('view-transition-name')).toBe('');
    expect(outB.style.getPropertyValue('view-transition-name')).toBe('b');
  });
});
