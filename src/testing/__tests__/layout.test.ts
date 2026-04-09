/**
 * Integration tests — layout mode menus (Discord Components v2).
 *
 * Tests setLayout() rendering, button interactions inside layout action rows,
 * navigation between layout menus, and the cancel reserved button.
 */
import { ButtonStyle } from 'discord.js';
import { MenuBuilder } from '../../menu/MenuBuilder';
import { goTo, goBack, closeMenu } from '../../action';
import { createTestSession } from '../createTestSession';
import type { MenuSessionLike } from '../../context/MenuContext';
import { click, findButtonId, reservedClick } from './helpers';

describe('layout mode rendering', () => {
  it('layout menu payload has mode=layout and layoutComponents', async () => {
    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setLayout(() => [
          { type: 'text_display', content: 'Hello layout' },
          {
            type: 'action_row',
            children: [
              { type: 'button' as const, label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
            ],
          },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    expect(adapter.lastRender!.mode).toBe('layout');
    expect(adapter.lastRender!.layoutComponents).toBeDefined();
    expect(Array.isArray(adapter.lastRender!.layoutComponents)).toBe(true);
    // embeds/components fields should not be present
    expect(adapter.lastRender!.embeds).toBeUndefined();
    expect(adapter.lastRender!.components).toBeUndefined();

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    expect(closeId).not.toBeNull();
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('buttons inside layout action rows are interactive', async () => {
    let clicked = false;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setLayout(() => [
          { type: 'text_display', content: 'Press the button' },
          {
            type: 'action_row',
            children: [
              {
                type: 'button' as const,
                label: 'Click Me',
                style: ButtonStyle.Primary,
                action: async () => { clicked = true; },
              },
              { type: 'button' as const, label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
            ],
          },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    const btnId = findButtonId(adapter.lastRender!, 'Click Me');
    expect(btnId).not.toBeNull();

    adapter.enqueueComponent(click(btnId!));
    await adapter.waitForNextRender();

    expect(clicked).toBe(true);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('layout components include text_display content in the serialized payload', async () => {
    const TEXT = 'Unique layout text content';

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setLayout(() => [
          { type: 'text_display', content: TEXT },
          {
            type: 'action_row',
            children: [
              { type: 'button' as const, label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
            ],
          },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    // Verify the text content is serialized into layoutComponents
    const payloadStr = JSON.stringify(adapter.lastRender!.layoutComponents);
    expect(payloadStr).toContain(TEXT);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });
});

describe('layout mode navigation', () => {
  it('navigates from layout menu to layout menu and back', async () => {
    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setLayout(() => [
          { type: 'text_display', content: 'Main' },
          {
            type: 'action_row',
            children: [
              { type: 'button' as const, label: 'Go Detail', style: ButtonStyle.Primary, action: goTo('detail') },
              { type: 'button' as const, label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
            ],
          },
        ])
        .setTrackedInHistory()
        .build();
    }

    function makeDetail(session: MenuSessionLike) {
      return new MenuBuilder(session, 'detail')
        .setLayout(() => [
          { type: 'text_display', content: 'Detail' },
          {
            type: 'action_row',
            children: [
              { type: 'button' as const, label: 'Back', style: ButtonStyle.Secondary, action: goBack() },
            ],
          },
        ])
        .setReturnable()
        .setFallbackMenu('main')
        .build();
    }

    const { adapter, startSession } = createTestSession({
      main: makeMain,
      detail: makeDetail,
    });
    const done = startSession('main');
    await adapter.waitForNextRender();

    expect(adapter.lastRender!.mode).toBe('layout');

    const goId = findButtonId(adapter.lastRender!, 'Go Detail');
    adapter.enqueueComponent(click(goId!));
    await adapter.waitForNextRender();

    expect(adapter.lastRender!.mode).toBe('layout');
    // detail layout should contain 'Detail' text
    expect(JSON.stringify(adapter.lastRender!.layoutComponents)).toContain('Detail');

    const backId = findButtonId(adapter.lastRender!, 'Back');
    adapter.enqueueComponent(click(backId!));
    await adapter.waitForNextRender();

    // Back to main
    expect(JSON.stringify(adapter.lastRender!.layoutComponents)).toContain('Main');

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });
});

describe('layout mode — cancel button', () => {
  it('setCancellable() injects cancel reserved button; clicking it closes the session', async () => {
    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setLayout(() => [
          { type: 'text_display', content: 'Cancellable menu' },
        ])
        .setCancellable()
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    // Cancel button is reserved — use reservedClick helper
    const cancelInteraction = reservedClick(
      adapter.lastRender!,
      '__reserved_cancel',
      'main',
    );
    adapter.enqueueComponent(cancelInteraction);
    await done;

    expect(adapter.terminals[0]?.reason).toBe('cancelled');
  });
});
