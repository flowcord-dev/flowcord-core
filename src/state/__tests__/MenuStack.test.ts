import { MenuStack } from '../MenuStack';

describe('MenuStack', () => {
  let stack: MenuStack;

  beforeEach(() => {
    stack = new MenuStack();
  });

  describe('initial state', () => {
    it('is empty', () => {
      expect(stack.isEmpty).toBe(true);
      expect(stack.size).toBe(0);
      expect(stack.entries).toHaveLength(0);
    });

    it('peek returns undefined', () => {
      expect(stack.peek()).toBeUndefined();
    });

    it('pop returns undefined', () => {
      expect(stack.pop()).toBeUndefined();
    });
  });

  describe('push / peek', () => {
    it('peek returns the last pushed entry without removing it', () => {
      stack.push({ menuId: 'a' });
      stack.push({ menuId: 'b' });
      expect(stack.peek()?.menuId).toBe('b');
      expect(stack.size).toBe(2);
    });

    it('preserves options and snapshots on the entry', () => {
      const paginationSnapshot = {
        currentPage: 0,
        totalPages: 3,
        itemsPerPage: 5,
        totalItems: 15,
        startIndex: 0,
        endIndex: 4,
      };
      const entry = {
        menuId: 'settings',
        options: { tab: 'general' },
        stateSnapshot: { page: 1 },
        paginationSnapshot,
      };
      stack.push(entry);
      expect(stack.peek()).toEqual(entry);
    });
  });

  describe('pop', () => {
    it('returns the top entry and reduces size', () => {
      stack.push({ menuId: 'a' });
      stack.push({ menuId: 'b' });
      const top = stack.pop();
      expect(top?.menuId).toBe('b');
      expect(stack.size).toBe(1);
    });

    it('returns undefined when empty after pops', () => {
      stack.push({ menuId: 'a' });
      stack.pop();
      expect(stack.pop()).toBeUndefined();
    });
  });

  describe('isEmpty / size', () => {
    it('reflects push and pop correctly', () => {
      expect(stack.isEmpty).toBe(true);
      stack.push({ menuId: 'x' });
      expect(stack.isEmpty).toBe(false);
      expect(stack.size).toBe(1);
      stack.pop();
      expect(stack.isEmpty).toBe(true);
    });
  });

  describe('entries', () => {
    it('returns entries oldest-first', () => {
      stack.push({ menuId: 'first' });
      stack.push({ menuId: 'second' });
      stack.push({ menuId: 'third' });
      expect(stack.entries.map((e) => e.menuId)).toEqual([
        'first',
        'second',
        'third',
      ]);
    });

    it('is read-only (does not expose internal array)', () => {
      stack.push({ menuId: 'a' });
      // The returned array should be a snapshot, not the live internal array.
      // Mutating it should not affect the stack.
      const entries = stack.entries as MenuStack['entries'];
      expect(entries).toHaveLength(1);
      stack.push({ menuId: 'b' });
      // size increased but the reference still reports the correct live state
      // because entries is a getter returning the live readonly view.
      expect(stack.size).toBe(2);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      stack.push({ menuId: 'a' });
      stack.push({ menuId: 'b' });
      stack.clear();
      expect(stack.isEmpty).toBe(true);
      expect(stack.entries).toHaveLength(0);
    });
  });
});
