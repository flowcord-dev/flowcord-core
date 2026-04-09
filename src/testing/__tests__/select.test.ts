/**
 * Integration tests — select menu interactions.
 *
 * Tests setSelectMenu() builder API, onSelect callback dispatch, and
 * re-render behaviour after a selection.
 */
import {
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { MenuBuilder } from '../../menu/MenuBuilder';
import { closeMenu } from '../../action';
import { createTestSession } from '../createTestSession';
import type { MenuSessionLike } from '../../context/MenuContext';
import { click, findButtonId, findSelectId, select } from './helpers';

const SELECT_ID = 'my-select';

function buildSelectMenu() {
  return new StringSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Option A')
        .setValue('a'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Option B')
        .setValue('b'),
    );
}

describe('select menu', () => {
  it('onSelect receives the selected values', async () => {
    let capturedValues: string[] | null = null;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setEmbeds(() => [])
        .setSelectMenu(() => ({
          builder: buildSelectMenu(),
          onSelect: async (_ctx, values) => {
            capturedValues = values;
          },
        }))
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    const selectId = findSelectId(adapter.lastRender!);
    expect(selectId).not.toBeNull();

    adapter.enqueueComponent(select(selectId!, ['a']));
    await adapter.waitForNextRender();

    expect(capturedValues).toEqual(['a']);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('menu re-renders after a selection', async () => {
    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setEmbeds(() => [])
        .setSelectMenu(() => ({
          builder: buildSelectMenu(),
          onSelect: async () => {},
        }))
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    const rendersBefore = adapter.renderCount;
    const selectId = findSelectId(adapter.lastRender!);

    adapter.enqueueComponent(select(selectId!, ['b']));
    await adapter.waitForNextRender();

    expect(adapter.renderCount).toBe(rendersBefore + 1);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('select can be used multiple times', async () => {
    const allValues: string[][] = [];

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setEmbeds(() => [])
        .setSelectMenu(() => ({
          builder: buildSelectMenu(),
          onSelect: async (_ctx, values) => {
            allValues.push(values);
          },
        }))
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    const selectId = findSelectId(adapter.lastRender!);

    for (const vals of [['a'], ['b'], ['a', 'b']]) {
      adapter.enqueueComponent(select(selectId!, vals));
      await adapter.waitForNextRender();
    }

    expect(allValues).toEqual([['a'], ['b'], ['a', 'b']]);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('select custom_id is namespaced in the payload', async () => {
    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setEmbeds(() => [])
        .setSelectMenu(() => ({
          builder: buildSelectMenu(),
          onSelect: async () => {},
        }))
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    const selectId = findSelectId(adapter.lastRender!);
    // The framework assigns its own internal ID ('__select') and namespaces it with
    // the session prefix. The raw builder custom_id is NOT preserved in the payload.
    expect(selectId).not.toBeNull();
    // Should be namespaced: contains a ':' separator (sessionId:menuId:componentId format)
    expect(selectId).toContain(':');

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });
});
