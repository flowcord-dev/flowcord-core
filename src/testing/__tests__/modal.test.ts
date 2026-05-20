/**
 * Integration tests — modal flow.
 *
 * Tests declarative opensModal button → modal shown → submit → onSubmit callback.
 * Uses SimulatedAdapter's enqueueModalSubmit() as the mechanism for providing
 * modal field values.
 */
import { ButtonStyle, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { MenuBuilder } from '../../menu/MenuBuilder';
import { closeMenu } from '../../action';
import { createTestSession } from '../createTestSession';
import type { MenuSessionLike } from '../../context/MenuContext';
import { click, findButtonId, modalSubmit } from './helpers';

/** The raw button ID used in the modal button (before namespacing). */
const OPEN_MODAL_BTN = 'open-modal';
const MODAL_ID = 'my-modal';

function buildModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle('Test Modal')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('name-field')
          .setLabel('Your Name')
          .setStyle(TextInputStyle.Short),
      ),
    );
}

describe('modal flow (declarative opensModal)', () => {
  it('onSubmit receives field values from the modal submission', async () => {
    let submittedName: string | null = null;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setEmbeds(() => [])
        .setButtons(() => [
          {
            label: 'Open Modal',
            style: ButtonStyle.Primary,
            id: OPEN_MODAL_BTN,
            opensModal: MODAL_ID,
          },
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .setModal(() => [
          {
            id: MODAL_ID,
            builder: buildModal(),
            onSubmit: async (_ctx, fields) => {
              submittedName = (fields.getField('name-field') as { value: string }).value;
            },
          },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    // Find the namespaced customId for the open-modal button
    const openModalId = findButtonId(adapter.lastRender!, 'Open Modal');
    expect(openModalId).not.toBeNull();

    // Click opens the modal (no render occurs — modal is shown, session awaits submit)
    // Enqueue both click and modal submit before waiting for the next render.
    adapter.enqueueComponent(click(openModalId!));
    adapter.enqueueModalSubmit(modalSubmit({ 'name-field': 'Alice' }));
    await adapter.waitForNextRender();

    expect(submittedName).toBe('Alice');

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('menu re-renders after modal submit — render count increments', async () => {
    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setEmbeds(() => [])
        .setButtons(() => [
          {
            label: 'Open Modal',
            style: ButtonStyle.Primary,
            id: OPEN_MODAL_BTN,
            opensModal: MODAL_ID,
          },
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .setModal(() => [
          {
            id: MODAL_ID,
            builder: buildModal(),
            onSubmit: async () => {}, // no-op submit
          },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    const openModalId = findButtonId(adapter.lastRender!, 'Open Modal');
    const rendersBefore = adapter.renderCount;

    adapter.enqueueComponent(click(openModalId!));
    adapter.enqueueModalSubmit(modalSubmit({}));
    await adapter.waitForNextRender();

    expect(adapter.renderCount).toBe(rendersBefore + 1);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('modal can be submitted multiple times in a loop', async () => {
    const submittedNames: string[] = [];

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setEmbeds(() => [])
        .setButtons(() => [
          {
            label: 'Open Modal',
            style: ButtonStyle.Primary,
            id: OPEN_MODAL_BTN,
            opensModal: MODAL_ID,
          },
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .setModal(() => [
          {
            id: MODAL_ID,
            builder: buildModal(),
            onSubmit: async (_ctx, fields) => {
              submittedNames.push((fields.getField('name-field') as { value: string }).value);
            },
          },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    const openModalId = findButtonId(adapter.lastRender!, 'Open Modal');

    // Submit the modal twice
    for (const name of ['Alice', 'Bob']) {
      adapter.enqueueComponent(click(openModalId!));
      adapter.enqueueModalSubmit(modalSubmit({ 'name-field': name }));
      await adapter.waitForNextRender();
    }

    expect(submittedNames).toEqual(['Alice', 'Bob']);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });
});
