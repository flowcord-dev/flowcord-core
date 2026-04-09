/**
 * Integration tests — session lifecycle.
 *
 * Tests navigate, goBack, close, cancel, guard failure using
 * createTestSession + SimulatedAdapter. All tests run fully in-process
 * with no Discord.js connection.
 */
import { ButtonStyle } from 'discord.js';
import { MenuBuilder } from '../../menu/MenuBuilder';
import { goTo, goBack, closeMenu, guard, pipeline } from '../../action';
import { createTestSession } from '../createTestSession';
import type { MenuSessionLike } from '../../context/MenuContext';
import { click, findButtonId, reservedClick } from './helpers';

// ---------------------------------------------------------------------------
// Menu factories
// ---------------------------------------------------------------------------

function makeMain(session: MenuSessionLike) {
  return new MenuBuilder(session, 'main')
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

function makeCancellable(session: MenuSessionLike) {
  return new MenuBuilder(session, 'main')
    .setEmbeds(() => [])
    .setButtons(() => [])
    .setCancellable()
    .build();
}

function makeGuarded(session: MenuSessionLike) {
  return new MenuBuilder(session, 'main')
    .setEmbeds(() => [])
    .setButtons(() => [
      {
        label: 'Blocked',
        style: ButtonStyle.Primary,
        action: pipeline(
          guard(async () => false, 'Access denied'),
          goTo('detail'),
        ),
      },
      { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
    ])
    .build();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('session lifecycle', () => {
  it('renders initial menu on start', async () => {
    const { adapter, startSession } = createTestSession({ main: makeMain, detail: makeDetail });
    const done = startSession('main');

    await adapter.waitForNextRender();

    expect(adapter.lastRender).not.toBeNull();
    expect(adapter.renders).toHaveLength(1);

    // Clean up — close the session
    const closeId = findButtonId(adapter.lastRender!, 'Close');
    expect(closeId).not.toBeNull();
    adapter.enqueueComponent(click(closeId!));
    await done;
    expect(adapter.terminals[0]?.reason).toBe('closed');
  });

  it('navigates to detail menu via goTo()', async () => {
    const { adapter, startSession } = createTestSession({ main: makeMain, detail: makeDetail });
    const done = startSession('main');

    await adapter.waitForNextRender();

    const goDetailId = findButtonId(adapter.lastRender!, 'Go Detail');
    expect(goDetailId).not.toBeNull();
    adapter.enqueueComponent(click(goDetailId!));
    await adapter.waitForNextRender();

    expect(adapter.renders).toHaveLength(2);

    // Navigate back via goBack() action button
    const backId = findButtonId(adapter.lastRender!, 'Back');
    expect(backId).not.toBeNull();
    adapter.enqueueComponent(click(backId!));
    await adapter.waitForNextRender();

    expect(adapter.renders).toHaveLength(3);

    // Close from main
    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
    expect(adapter.terminals[0]?.reason).toBe('closed');
  });

  it('goBack() via reserved Back button returns to previous menu', async () => {
    const { adapter, startSession } = createTestSession({ main: makeMain, detail: makeDetail });
    const done = startSession('main');

    await adapter.waitForNextRender();

    const goDetailId = findButtonId(adapter.lastRender!, 'Go Detail');
    adapter.enqueueComponent(click(goDetailId!));
    await adapter.waitForNextRender();

    // Use reserved back button (injected by setReturnable)
    const reservedBack = reservedClick(adapter.lastRender!, '__reserved_back', 'detail');
    adapter.enqueueComponent(reservedBack);
    await adapter.waitForNextRender();

    expect(adapter.renders).toHaveLength(3);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
    expect(adapter.terminals[0]?.reason).toBe('closed');
  });

  it('cancel via reserved Cancel button ends session with reason=cancelled', async () => {
    const { adapter, startSession } = createTestSession({ main: makeCancellable });
    const done = startSession('main');

    await adapter.waitForNextRender();

    const cancelId = reservedClick(adapter.lastRender!, '__reserved_cancel', 'main');
    adapter.enqueueComponent(cancelId);
    await done;

    expect(adapter.terminals[0]?.reason).toBe('cancelled');
  });

  it('closeMenu() action ends session with reason=closed', async () => {
    const { adapter, startSession } = createTestSession({ main: makeMain, detail: makeDetail });
    const done = startSession('main');

    await adapter.waitForNextRender();

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;

    expect(adapter.terminals[0]?.reason).toBe('closed');
  });

  it('endPromise resolves to the terminal reason', async () => {
    const { adapter, startSession } = createTestSession({ main: makeMain, detail: makeDetail });
    const done = startSession('main');

    await adapter.waitForNextRender();

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));

    const reason = await adapter.endPromise;
    expect(reason).toBe('closed');
    await done;
  });

  it('guard failure does not navigate — menu re-renders on same page', async () => {
    const { adapter, startSession } = createTestSession({ main: makeGuarded, detail: makeDetail });
    const done = startSession('main');

    await adapter.waitForNextRender();
    const renderCountBefore = adapter.renderCount;

    const blockedId = findButtonId(adapter.lastRender!, 'Blocked');
    adapter.enqueueComponent(click(blockedId!));

    // Session should re-render (guard failure re-renders current menu)
    await adapter.waitForNextRender();
    expect(adapter.renderCount).toBe(renderCountBefore + 1);

    // Session should still be on 'main' — it did not navigate to 'detail'
    // (we can verify by checking the 'Blocked' button is still present)
    const stillHasBlocked = findButtonId(adapter.lastRender!, 'Blocked');
    expect(stillHasBlocked).not.toBeNull();

    // Clean up — close the session so the queue doesn't leave open handles
    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
    expect(adapter.terminals[0]?.reason).toBe('closed');
  });

  it('initialSessionState is readable in the first menu render', async () => {
    let capturedValue: unknown;

    function makeReader(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setup((ctx) => { capturedValue = ctx.sessionState.get('greeting'); })
        .setEmbeds(() => [])
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession(
      { main: makeReader },
      { initialSessionState: { greeting: 'hello' } },
    );
    const done = startSession('main');
    await adapter.waitForNextRender();

    expect(capturedValue).toBe('hello');

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });
});
