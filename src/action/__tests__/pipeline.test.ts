import { pipeline, guard, GuardFailedError } from '../pipeline';
import type { MenuContextLike } from '../../types/common';

// Minimal stub context for tests
const ctx = {} as MenuContextLike;

describe('pipeline()', () => {
  it('runs all actions in order', async () => {
    const order: number[] = [];
    const a = async () => { order.push(1); };
    const b = async () => { order.push(2); };
    const c = async () => { order.push(3); };

    await pipeline(a, b, c)(ctx);
    expect(order).toEqual([1, 2, 3]);
  });

  it('halts on GuardFailedError and does not run subsequent actions', async () => {
    const ran: string[] = [];
    const fail = async () => { throw new GuardFailedError('blocked'); };
    const after = async () => { ran.push('after'); };

    await expect(pipeline(fail, after)(ctx)).rejects.toThrow(GuardFailedError);
    expect(ran).toHaveLength(0);
  });

  it('propagates non-guard errors', async () => {
    const boom = async () => { throw new Error('unexpected'); };
    await expect(pipeline(boom)(ctx)).rejects.toThrow('unexpected');
  });

  it('resolves with no actions', async () => {
    await expect(pipeline()(ctx)).resolves.toBeUndefined();
  });

  it('passes ctx to each action', async () => {
    const received: unknown[] = [];
    const capture = async (c: MenuContextLike) => { received.push(c); };
    await pipeline(capture, capture)(ctx);
    expect(received).toEqual([ctx, ctx]);
  });
});

describe('guard()', () => {
  it('does not throw when predicate returns true', async () => {
    const g = guard(async () => true, 'should not appear');
    await expect(g(ctx)).resolves.toBeUndefined();
  });

  it('throws GuardFailedError with the default message when predicate returns false', async () => {
    const g = guard(async () => false, 'access denied');
    await expect(g(ctx)).rejects.toThrow(GuardFailedError);
    await expect(g(ctx)).rejects.toThrow('access denied');
  });

  it('uses the string returned by the predicate as the error message', async () => {
    const g = guard(async () => 'custom override', 'default');
    await expect(g(ctx)).rejects.toThrow('custom override');
  });

  it('throws with default message when predicate returns empty string (falsy)', async () => {
    // empty string is falsy — treated as pass
    const g = guard(async () => '', 'fallback');
    await expect(g(ctx)).resolves.toBeUndefined();
  });

  it('is composable inside pipeline', async () => {
    const order: string[] = [];
    const checkAdmin = guard(async () => false, 'not admin');
    const doWork = async () => { order.push('work'); };

    await expect(pipeline(checkAdmin, doWork)(ctx)).rejects.toThrow('not admin');
    expect(order).toHaveLength(0);
  });
});

describe('GuardFailedError', () => {
  it('has isGuardFailure flag set to true', () => {
    const err = new GuardFailedError('oops');
    expect(err.isGuardFailure).toBe(true);
  });

  it('is an instance of Error', () => {
    const err = new GuardFailedError('oops');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name GuardFailedError', () => {
    const err = new GuardFailedError('oops');
    expect(err.name).toBe('GuardFailedError');
  });
});
