/**
 * Integration tests — list pagination.
 *
 * Tests setListPagination(), ctx.pagination state, and reserved
 * next/previous button navigation.
 */
import { ButtonStyle, EmbedBuilder } from 'discord.js';
import { MenuBuilder } from '../../menu/MenuBuilder';
import { closeMenu } from '../../action';
import { createTestSession } from '../createTestSession';
import type { MenuSessionLike } from '../../context/MenuContext';
import type { PaginationState } from '../../types';
import { click, findButtonId, reservedClick } from './helpers';

/** Capture pagination state from inside a render callback. */
function capturePagination(session: MenuSessionLike): {
  startSession: ReturnType<typeof createTestSession>['startSession'];
  adapter: ReturnType<typeof createTestSession>['adapter'];
  getLastPagination: () => PaginationState | null;
} {
  // This is a helper factory — not the actual pattern, just for the describe block below.
  // Use createTestSession directly in each test instead.
  throw new Error('Use createTestSession directly');
}

describe('list pagination', () => {
  it('ctx.pagination is populated on first render', async () => {
    let capturedPagination: PaginationState | null = null;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setListPagination({ getTotalQuantityItems: () => 25, itemsPerPage: 10 })
        .setEmbeds((ctx) => {
          capturedPagination = ctx.pagination;
          return [new EmbedBuilder().setDescription('page')];
        })
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    expect(capturedPagination).not.toBeNull();
    expect(capturedPagination!.currentPage).toBe(0);
    expect(capturedPagination!.totalPages).toBe(3); // ceil(25/10)
    expect(capturedPagination!.itemsPerPage).toBe(10);
    expect(capturedPagination!.startIndex).toBe(0);
    expect(capturedPagination!.endIndex).toBe(10); // exclusive upper bound

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('clicking next advances to the next page', async () => {
    const paginationHistory: PaginationState[] = [];

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setListPagination({ getTotalQuantityItems: () => 20, itemsPerPage: 10 })
        .setEmbeds((ctx) => {
          if (ctx.pagination) paginationHistory.push({ ...ctx.pagination });
          return [new EmbedBuilder().setDescription('page')];
        })
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    const nextInteraction = reservedClick(adapter.lastRender!, '__reserved_next', 'main');
    adapter.enqueueComponent(nextInteraction);
    await adapter.waitForNextRender();

    expect(paginationHistory.length).toBe(2);
    expect(paginationHistory[1]!.currentPage).toBe(1);
    expect(paginationHistory[1]!.startIndex).toBe(10);
    expect(paginationHistory[1]!.endIndex).toBe(20); // exclusive upper bound

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('clicking previous goes back to the previous page', async () => {
    let currentPage = -1;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setListPagination({ getTotalQuantityItems: () => 30, itemsPerPage: 10 })
        .setEmbeds((ctx) => {
          if (ctx.pagination) currentPage = ctx.pagination.currentPage;
          return [new EmbedBuilder().setDescription('page')];
        })
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    // Go to page 1
    adapter.enqueueComponent(reservedClick(adapter.lastRender!, '__reserved_next', 'main'));
    await adapter.waitForNextRender();
    expect(currentPage).toBe(1);

    // Go back to page 0
    adapter.enqueueComponent(reservedClick(adapter.lastRender!, '__reserved_previous', 'main'));
    await adapter.waitForNextRender();
    expect(currentPage).toBe(0);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('previous button is disabled on first page', async () => {
    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setListPagination({ getTotalQuantityItems: () => 20, itemsPerPage: 10 })
        .setEmbeds(() => [new EmbedBuilder().setDescription('page')])
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    // Find previous button in payload and check disabled flag
    const payload = adapter.lastRender!;
    const allComponents = payload.components ?? [];
    let prevDisabled: boolean | undefined;
    for (const row of allComponents) {
      for (const comp of row.components as unknown as Record<string, unknown>[]) {
        if (
          typeof comp['custom_id'] === 'string' &&
          (comp['custom_id'] as string).endsWith('__reserved_previous')
        ) {
          prevDisabled = comp['disabled'] as boolean | undefined;
        }
      }
    }
    expect(prevDisabled).toBe(true);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });

  it('next button is disabled on last page', async () => {
    let currentPage = 0;

    function makeMain(session: MenuSessionLike) {
      return new MenuBuilder(session, 'main')
        .setListPagination({ getTotalQuantityItems: () => 20, itemsPerPage: 10 })
        .setEmbeds((ctx) => {
          if (ctx.pagination) currentPage = ctx.pagination.currentPage;
          return [new EmbedBuilder().setDescription('page')];
        })
        .setButtons(() => [
          { label: 'Close', style: ButtonStyle.Danger, action: closeMenu() },
        ])
        .build();
    }

    const { adapter, startSession } = createTestSession({ main: makeMain });
    const done = startSession('main');
    await adapter.waitForNextRender();

    // Navigate to last page
    adapter.enqueueComponent(reservedClick(adapter.lastRender!, '__reserved_next', 'main'));
    await adapter.waitForNextRender();
    expect(currentPage).toBe(1); // last page (total=20, perPage=10 → 2 pages, 0-indexed last = 1)

    // Check next button is disabled
    const payload = adapter.lastRender!;
    const allComponents = payload.components ?? [];
    let nextDisabled: boolean | undefined;
    for (const row of allComponents) {
      for (const comp of row.components as unknown as Record<string, unknown>[]) {
        if (
          typeof comp['custom_id'] === 'string' &&
          (comp['custom_id'] as string).endsWith('__reserved_next')
        ) {
          nextDisabled = comp['disabled'] as boolean | undefined;
        }
      }
    }
    expect(nextDisabled).toBe(true);

    const closeId = findButtonId(adapter.lastRender!, 'Close');
    adapter.enqueueComponent(click(closeId!));
    await done;
  });
});
