import { StateStore } from '../StateStore';

describe('StateStore', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  describe('get / set', () => {
    it('returns undefined for unknown keys', () => {
      expect(store.get('missing')).toBeUndefined();
    });

    it('stores and retrieves a value', () => {
      store.set('count', 42);
      expect(store.get('count')).toBe(42);
    });

    it('overwrites an existing value', () => {
      store.set('name', 'alice');
      store.set('name', 'bob');
      expect(store.get('name')).toBe('bob');
    });

    it('handles different value types', () => {
      store.set('str', 'hello');
      store.set('num', 99);
      store.set('bool', true);
      store.set('obj', { nested: true });
      store.set('arr', [1, 2, 3]);

      expect(store.get('str')).toBe('hello');
      expect(store.get('num')).toBe(99);
      expect(store.get('bool')).toBe(true);
      expect(store.get('obj')).toEqual({ nested: true });
      expect(store.get('arr')).toEqual([1, 2, 3]);
    });
  });

  describe('has', () => {
    it('returns false when key is absent', () => {
      expect(store.has('x')).toBe(false);
    });

    it('returns true after set', () => {
      store.set('x', 0);
      expect(store.has('x')).toBe(true);
    });

    it('returns false after delete', () => {
      store.set('x', 0);
      store.delete('x');
      expect(store.has('x')).toBe(false);
    });
  });

  describe('delete', () => {
    it('returns true when key existed', () => {
      store.set('k', 1);
      expect(store.delete('k')).toBe(true);
    });

    it('returns false when key did not exist', () => {
      expect(store.delete('nope')).toBe(false);
    });

    it('removes the value', () => {
      store.set('k', 1);
      store.delete('k');
      expect(store.get('k')).toBeUndefined();
    });
  });

  describe('size', () => {
    it('starts at 0', () => {
      expect(store.size).toBe(0);
    });

    it('increments with set, decrements with delete', () => {
      store.set('a', 1);
      store.set('b', 2);
      expect(store.size).toBe(2);
      store.delete('a');
      expect(store.size).toBe(1);
    });
  });

  describe('keys', () => {
    it('yields all stored keys', () => {
      store.set('x', 1);
      store.set('y', 2);
      expect([...store.keys()].sort()).toEqual(['x', 'y']);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      store.set('a', 1);
      store.set('b', 2);
      store.clear();
      expect(store.size).toBe(0);
      expect(store.get('a')).toBeUndefined();
    });
  });

  describe('typed access', () => {
    it('preserves type safety when parameterized', () => {
      const typed = new StateStore<{ gold: number; name: string }>();
      typed.set('gold', 100);
      typed.set('name', 'hero');
      expect(typed.get('gold')).toBe(100);
      expect(typed.get('name')).toBe('hero');
    });
  });
});
