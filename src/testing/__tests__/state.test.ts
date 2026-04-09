/**
 * Integration tests — menu-local state and session state.
 *
 * Tests state persistence, setPreserveStateOnReturn(), and session state
 * sharing across menus.
 */
import { ButtonStyle } from 'discord.js';
import { MenuBuilder } from '../../menu/MenuBuilder';
import { goTo, goBack, closeMenu } from '../../action';
import { createTestSession } from '../createTestSession';
import type { MenuSessionLike } from '../../context/MenuContext';
import { click, findButtonId } from './helpers';

describe('menu-local state', () => {
  it('state is initialized via setup() and persists across re-renders', async () => {
    let capturedCount = -1;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setup((ctx) => { ctx.state.set('count', 0); })
        .setEmbeds(() => [])
        .setButtons(() => [
          {
            label: 'Increment',
            style: ButtonStyle.Primary,
            action: async (ctx) => {
              const n = (ctx.state.get('count') as number) + 1;
              ctx.state.set('count', n);
              capturedCount = n;
            },
          },
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    const incId = findButtonId(adapter.lastRender!, 'Increment');
    adapter.enqueueComponent(click(incId!));
    await adapter.waitForNextRender();
    expect(capturedCount).toBe(1);

    adapter.enqueueComponent(click(incId!));
    await adapter.waitForNextRender();
    expect(capturedCount).toBe(2);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('menu-local state resets when re-entering a menu without setPreserveStateOnReturn()', async () => {
    const capturedCounts: number[] = [];

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setup((ctx) => { ctx.state.set('count', 0); })
        .onEnter((ctx) => { capturedCounts.push(ctx.state.get('count') as number); })
        .setEmbeds(() => [])
        .setButtons(() => [
          {
            label: 'Increment',
            style: ButtonStyle.Primary,
            action: async (ctx) => {
              ctx.state.set('count', (ctx.state.get('count') as number) + 1);
            },
          },
          { label: 'Go Detail', style: ButtonStyle.Secondary, action: goTo('detail') },
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .setTrackedInHistory() // tracked but NOT preserveStateOnReturn
        .build();
    }

    function makeDetail(session: MenuSessionLike) {
      return new MenuBuilder(session, 'detail')
        .setEmbeds(() => [])
        .setButtons(() => [
          { label: 'Back', style: ButtonStyle.Secondary, action: goBack() },
        ])
        .setReturnable()
        .setFallbackMenu('main')
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain, detail: makeDetail });
    const done = startSession('main');
    await adapter.waitForNextRender();

    // Increment state to 3
    const incId = findButtonId(adapter.lastRender!, 'Increment');
    for (let i = 0; i < 3; i++) {
      adapter.enqueueComponent(click(incId!));
      await adapter.waitForNextRender();
    }

    // Navigate away and back — state should reset since no preserveStateOnReturn
    const goId = findButtonId(adapter.lastRender!, 'Go Detail');
    adapter.enqueueComponent(click(goId!));
    await adapter.waitForNextRender();

    const backId = findButtonId(adapter.lastRender!, 'Back');
    adapter.enqueueComponent(click(backId!));
    await adapter.waitForNextRender();

    // onEnter fires on return — count should be reset to 0 by setup()
    expect(capturedCounts).toEqual([0, 0]); // first enter + return enter (reset)

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('setPreserveStateOnReturn() keeps menu-local state when going back', async () => {
    const capturedCounts: number[] = [];

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setup((ctx) => { ctx.state.set('count', 0); })
        .onEnter((ctx) => { capturedCounts.push(ctx.state.get('count') as number); })
        .setEmbeds(() => [])
        .setButtons(() => [
          {
            label: 'Increment',
            style: ButtonStyle.Primary,
            action: async (ctx) => {
              ctx.state.set('count', (ctx.state.get('count') as number) + 1);
            },
          },
          { label: 'Go Detail', style: ButtonStyle.Secondary, action: goTo('detail') },
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .setTrackedInHistory()
        .setPreserveStateOnReturn()
        .build();
    }

    function makeDetail(session: MenuSessionLike) {
      return new MenuBuilder(session, 'detail')
        .setEmbeds(() => [])
        .setButtons(() => [
          { label: 'Back', style: ButtonStyle.Secondary, action: goBack() },
        ])
        .setReturnable()
        .setFallbackMenu('main')
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain, detail: makeDetail });
    const done = startSession('main');
    await adapter.waitForNextRender();

    // Increment to 5
    const incId = findButtonId(adapter.lastRender!, 'Increment');
    for (let i = 0; i < 5; i++) {
      adapter.enqueueComponent(click(incId!));
      await adapter.waitForNextRender();
    }

    // Navigate away and back
    const goId = findButtonId(adapter.lastRender!, 'Go Detail');
    adapter.enqueueComponent(click(goId!));
    await adapter.waitForNextRender();

    const backId = findButtonId(adapter.lastRender!, 'Back');
    adapter.enqueueComponent(click(backId!));
    await adapter.waitForNextRender();

    // State restored to 5 (not reset to 0)
    expect(capturedCounts).toEqual([0, 5]);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });
});

describe('session state', () => {
  it('sessionState is shared across menus within a session', async () => {
    let detailSawValue: unknown;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setup((ctx) => { ctx.sessionState.set('shared', 'hello'); })
        .setEmbeds(() => [])
        .setButtons(() => [
          { label: 'Go Detail', style: ButtonStyle.Primary, action: goTo('detail') },
        ])
        .setTrackedInHistory()
        .build();
    }

    function makeDetail(session: MenuSessionLike) {
      return new MenuBuilder(session, 'detail')
        .setup((ctx) => { detailSawValue = ctx.sessionState.get('shared'); })
        .setEmbeds(() => [])
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain, detail: makeDetail });
    const done = startSession('main');
    await adapter.waitForNextRender();

    const goId = findButtonId(adapter.lastRender!, 'Go Detail');
    adapter.enqueueComponent(click(goId!));
    await adapter.waitForNextRender();

    expect(detailSawValue).toBe('hello');

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('initialSessionState is available in setup() of the first menu', async () => {
    let capturedRole: unknown;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setup((ctx) => { capturedRole = ctx.sessionState.get('role'); })
        .setEmbeds(() => [])
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession(
      { main: makeMain },
      { initialSessionState: { role: 'admin' } },
    );
    const done = startSession('main');
    await adapter.waitForNextRender();

    expect(capturedRole).toBe('admin');

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('sessionState mutations from one menu are visible in subsequent menus', async () => {
    const values: unknown[] = [];

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setEmbeds(() => [])
        .setButtons(() => [
          {
            label: 'Go Detail',
            style: ButtonStyle.Primary,
            action: async (ctx) => {
              ctx.sessionState.set('step', 'visited-main');
              return goTo('detail')(ctx);
            },
          },
        ])
        .setTrackedInHistory()
        .build();
    }

    function makeDetail(session: MenuSessionLike) {
      return new MenuBuilder(session, 'detail')
        .setup((ctx) => { values.push(ctx.sessionState.get('step')); })
        .setEmbeds(() => [])
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain, detail: makeDetail });
    const done = startSession('main');
    await adapter.waitForNextRender();

    const goId = findButtonId(adapter.lastRender!, 'Go Detail');
    adapter.enqueueComponent(click(goId!));
    await adapter.waitForNextRender();

    expect(values).toEqual(['visited-main']);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });
});
