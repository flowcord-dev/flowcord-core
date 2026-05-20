/**
 * Integration tests — hook lifecycle ordering.
 *
 * Verifies that onEnter, onLeave, beforeRender, afterRender fire in the
 * correct order for both initial render and menu navigation transitions.
 */
import { ButtonStyle } from 'discord.js';
import { MenuBuilder } from '../../menu/MenuBuilder';
import { goTo, goBack, closeMenu } from '../../action';
import { createTestSession } from '../createTestSession';
import type { MenuSessionLike } from '../../context/MenuContext';
import { click, findButtonId } from './helpers';

/**
 * Yield to the microtask queue so that any async work immediately following
 * sendPayload() (e.g. afterRender hooks) has a chance to complete before
 * we assert on the captured log.
 */
const nextTick = () => new Promise<void>((r) => setImmediate(r));

describe('hook lifecycle', () => {
  it('fires setup → onEnter → beforeRender → afterRender on initial render', async () => {
    const order: string[] = [];

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setup(() => { order.push('setup'); })
        .onEnter(() => { order.push('onEnter'); })
        .beforeRender(() => { order.push('beforeRender'); })
        .afterRender(() => { order.push('afterRender'); })
        .setEmbeds(() => [])
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();
    await nextTick(); // afterRender runs after sendPayload resolves

    expect(order).toEqual(['setup', 'onEnter', 'beforeRender', 'afterRender']);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('fires onLeave on the departing menu before onEnter on the arriving menu', async () => {
    const order: string[] = [];

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .onLeave(() => { order.push('main:onLeave'); })
        .setEmbeds(() => [])
        .setButtons(() => [
          { label: 'Go Detail', style: ButtonStyle.Primary, action: goTo('detail') },
        ])
        .setTrackedInHistory()
        .build();
    }

    function makeDetail(session: MenuSessionLike) {
      return new MenuBuilder(session, 'detail')
        .onEnter(() => { order.push('detail:onEnter'); })
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

    expect(order).toEqual(['main:onLeave', 'detail:onEnter']);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('fires beforeRender and afterRender on every render cycle', async () => {
    const renderHooks: string[] = [];

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .beforeRender(() => { renderHooks.push('before'); })
        .afterRender(() => { renderHooks.push('after'); })
        .setEmbeds(() => [])
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();
    await nextTick(); // afterRender runs after sendPayload resolves

    // First render
    expect(renderHooks).toEqual(['before', 'after']);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('async hooks are awaited before proceeding', async () => {
    const log: string[] = [];
    let resolved = false;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .onEnter(async () => {
          await new Promise<void>((res) => setTimeout(res, 10));
          resolved = true;
          log.push('async:onEnter done');
        })
        .afterRender(() => { log.push('afterRender'); })
        .setEmbeds(() => [])
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();
    await nextTick(); // afterRender runs after sendPayload resolves

    // afterRender runs after onEnter completes
    expect(resolved).toBe(true);
    expect(log).toEqual(['async:onEnter done', 'afterRender']);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('onEnter fires again on goBack() return', async () => {
    const enterLog: string[] = [];

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .onEnter(() => { enterLog.push('main:enter'); })
        .setEmbeds(() => [])
        .setButtons(() => [
          { label: 'Go Detail', style: ButtonStyle.Primary, action: goTo('detail') },
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .setTrackedInHistory()
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

    // Navigate to detail
    const goId = findButtonId(adapter.lastRender!, 'Go Detail');
    adapter.enqueueComponent(click(goId!));
    await adapter.waitForNextRender();

    // Go back to main — onEnter should fire again
    const backId = findButtonId(adapter.lastRender!, 'Back');
    adapter.enqueueComponent(click(backId!));
    await adapter.waitForNextRender();

    expect(enterLog).toEqual(['main:enter', 'main:enter']);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });
});
