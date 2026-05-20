/**
 * Integration tests — message-collection and mixed interaction menus.
 *
 * Covers setMessageHandler() (pure message menus) and mixed menus that
 * race a button click against a text message reply.
 */
import { ButtonStyle } from 'discord.js';
import { MenuBuilder } from '../../menu/MenuBuilder';
import { closeMenu } from '../../action';
import { createTestSession } from '../createTestSession';
import type { MenuSessionLike } from '../../context/MenuContext';
import { click, findButtonId, message } from './helpers';

describe('message-collection menus', () => {
  it('message handler receives the message content', async () => {
    let captured: string | null = null;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setEmbeds(() => [])
        .setMessageHandler(async (ctx, response) => {
          captured = response;
          // Close after handling so the session ends cleanly
          await closeMenu()(ctx);
        })
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    adapter.enqueueMessage(message('hello world'));
    await done;

    expect(captured).toBe('hello world');
  });

  it('message handler is called on each message', async () => {
    const received: string[] = [];
    let callCount = 0;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setEmbeds(() => [])
        .setMessageHandler(async (ctx, response) => {
          received.push(response);
          callCount++;
          if (callCount >= 2) {
            await closeMenu()(ctx);
          }
        })
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    adapter.enqueueMessage(message('first'));
    await adapter.waitForNextRender(); // re-render after first message

    adapter.enqueueMessage(message('second'));
    await done;

    expect(received).toEqual(['first', 'second']);
  });
});

describe('mixed interaction menus (buttons + message handler)', () => {
  it('message wins the race — handler is called', async () => {
    let msgHandled: string | null = null;
    let btnClicked = false;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setEmbeds(() => [])
        .setButtons(() => [
          {
            label: 'Action',
            style: ButtonStyle.Primary,
            action: async () => { btnClicked = true; },
          },
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .setMessageHandler(async (ctx, response) => {
          msgHandled = response;
          await closeMenu()(ctx);
        })
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    // Enqueue a message — should win the race against awaitComponent
    adapter.enqueueMessage(message('typed text'));
    await done;

    expect(msgHandled).toBe('typed text');
    expect(btnClicked).toBe(false);
  });

  it('button wins the race — action is called, not message handler', async () => {
    let msgHandled: string | null = null;
    let btnClicked = false;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setEmbeds(() => [])
        .setButtons(() => [
          {
            label: 'Action',
            style: ButtonStyle.Primary,
            action: async () => { btnClicked = true; },
          },
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .setMessageHandler(async (_ctx, response) => {
          msgHandled = response;
        })
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    const actionId = findButtonId(adapter.lastRender!, 'Action');
    adapter.enqueueComponent(click(actionId!));
    await adapter.waitForNextRender();

    expect(btnClicked).toBe(true);
    expect(msgHandled).toBeNull();

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });
});
