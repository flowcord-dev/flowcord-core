/**
 * Unit tests for reservedButtons — button row generation, injection, and counts.
 */
import { ButtonStyle } from 'discord.js';
import {
  buildReservedButtonRow,
  countReservedButtons,
  injectReservedButtons,
  reservedButtons,
} from '../reservedButtons';
import type { PaginationState, ComponentConfig } from '../../types';

function makePagination(currentPage: number, totalPages: number): PaginationState {
  const itemsPerPage = 10;
  const totalItems = totalPages * itemsPerPage;
  const startIndex = currentPage * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage - 1, totalItems - 1);
  return { currentPage, totalPages, itemsPerPage, totalItems, startIndex, endIndex };
}

const BASE_OPTIONS = {
  showBack: false,
  showCancel: false,
  pagination: null,
  stableButtons: true,
  mode: 'embeds' as const,
};

// ---------------------------------------------------------------------------
// buildReservedButtonRow
// ---------------------------------------------------------------------------

describe('buildReservedButtonRow', () => {
  it('returns null when no buttons apply', () => {
    const row = buildReservedButtonRow(BASE_OPTIONS);
    expect(row).toBeNull();
  });

  it('builds cancel-only row', () => {
    const row = buildReservedButtonRow({ ...BASE_OPTIONS, showCancel: true });
    expect(row).not.toBeNull();
    expect(row!.children).toHaveLength(1);
    const btn = row!.children[0] as { id: string; style: ButtonStyle };
    expect(btn.id).toBe('__reserved_cancel');
    expect(btn.style).toBe(ButtonStyle.Danger);
  });

  it('builds back-only row', () => {
    const row = buildReservedButtonRow({ ...BASE_OPTIONS, showBack: true });
    expect(row).not.toBeNull();
    expect(row!.children).toHaveLength(1);
    const btn = row!.children[0] as { id: string };
    expect(btn.id).toBe('__reserved_back');
  });

  it('builds both back and cancel', () => {
    const row = buildReservedButtonRow({ ...BASE_OPTIONS, showBack: true, showCancel: true });
    expect(row!.children).toHaveLength(2);
    const ids = (row!.children as { id: string }[]).map((b) => b.id);
    expect(ids).toContain('__reserved_back');
    expect(ids).toContain('__reserved_cancel');
  });

  it('previous button is disabled on first page (stableButtons=true)', () => {
    const row = buildReservedButtonRow({
      ...BASE_OPTIONS,
      pagination: makePagination(0, 3),
    });
    const prev = (row!.children as { id: string; disabled?: boolean }[]).find(
      (b) => b.id === '__reserved_previous',
    );
    expect(prev).toBeDefined();
    expect(prev!.disabled).toBe(true);
  });

  it('next button is disabled on last page (stableButtons=true)', () => {
    const row = buildReservedButtonRow({
      ...BASE_OPTIONS,
      pagination: makePagination(2, 3),
    });
    const next = (row!.children as { id: string; disabled?: boolean }[]).find(
      (b) => b.id === '__reserved_next',
    );
    expect(next).toBeDefined();
    expect(next!.disabled).toBe(true);
  });

  it('previous and next are enabled on a middle page', () => {
    const row = buildReservedButtonRow({
      ...BASE_OPTIONS,
      pagination: makePagination(1, 3),
    });
    const btns = row!.children as { id: string; disabled?: boolean }[];
    const prev = btns.find((b) => b.id === '__reserved_previous');
    const next = btns.find((b) => b.id === '__reserved_next');
    expect(prev!.disabled).toBe(false);
    expect(next!.disabled).toBe(false);
  });

  it('layout mode adds page counter button between previous and next', () => {
    const row = buildReservedButtonRow({
      ...BASE_OPTIONS,
      mode: 'layout',
      pagination: makePagination(1, 3),
    });
    const ids = (row!.children as { id: string }[]).map((b) => b.id);
    expect(ids).toContain('__reserved_page_counter');
    // Counter should be between previous and next
    const prevIdx = ids.indexOf('__reserved_previous');
    const counterIdx = ids.indexOf('__reserved_page_counter');
    const nextIdx = ids.indexOf('__reserved_next');
    expect(prevIdx).toBeLessThan(counterIdx);
    expect(counterIdx).toBeLessThan(nextIdx);
  });

  it('page counter is always disabled', () => {
    const row = buildReservedButtonRow({
      ...BASE_OPTIONS,
      mode: 'layout',
      pagination: makePagination(1, 3),
    });
    const counter = (row!.children as { id: string; disabled?: boolean }[]).find(
      (b) => b.id === '__reserved_page_counter',
    );
    expect(counter!.disabled).toBe(true);
  });

  it('embeds mode does NOT include page counter', () => {
    const row = buildReservedButtonRow({
      ...BASE_OPTIONS,
      mode: 'embeds',
      pagination: makePagination(1, 3),
    });
    const ids = (row!.children as { id: string }[]).map((b) => b.id);
    expect(ids).not.toContain('__reserved_page_counter');
  });

  it('uses custom labels', () => {
    const row = buildReservedButtonRow({
      ...BASE_OPTIONS,
      showBack: true,
      showCancel: true,
      labels: { back: 'Go Back', cancel: 'Quit' },
    });
    const btns = row!.children as { id: string; label: string }[];
    expect(btns.find((b) => b.id === '__reserved_back')!.label).toBe('Go Back');
    expect(btns.find((b) => b.id === '__reserved_cancel')!.label).toBe('Quit');
  });

  it('stableButtons=false hides previous on first page', () => {
    const row = buildReservedButtonRow({
      ...BASE_OPTIONS,
      stableButtons: false,
      pagination: makePagination(0, 3),
    });
    const ids = (row!.children as { id: string }[]).map((b) => b.id);
    expect(ids).not.toContain('__reserved_previous');
    expect(ids).toContain('__reserved_next');
  });

  it('stableButtons=false hides next on last page', () => {
    const row = buildReservedButtonRow({
      ...BASE_OPTIONS,
      stableButtons: false,
      pagination: makePagination(2, 3),
    });
    const ids = (row!.children as { id: string }[]).map((b) => b.id);
    expect(ids).toContain('__reserved_previous');
    expect(ids).not.toContain('__reserved_next');
  });
});

// ---------------------------------------------------------------------------
// countReservedButtons
// ---------------------------------------------------------------------------

describe('countReservedButtons', () => {
  it('returns 0 when no buttons', () => {
    expect(countReservedButtons(BASE_OPTIONS)).toBe(0);
  });

  it('counts cancel = 1', () => {
    expect(countReservedButtons({ ...BASE_OPTIONS, showCancel: true })).toBe(1);
  });

  it('counts back + cancel = 2', () => {
    expect(countReservedButtons({ ...BASE_OPTIONS, showBack: true, showCancel: true })).toBe(2);
  });

  it('counts pagination in embeds mode (stable): previous + next = 2', () => {
    const count = countReservedButtons({
      ...BASE_OPTIONS,
      pagination: makePagination(1, 3),
    });
    expect(count).toBe(2);
  });

  it('counts pagination in layout mode (stable): previous + counter + next = 3', () => {
    const count = countReservedButtons({
      ...BASE_OPTIONS,
      mode: 'layout',
      pagination: makePagination(1, 3),
    });
    expect(count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// injectReservedButtons
// ---------------------------------------------------------------------------

describe('injectReservedButtons', () => {
  const row = buildReservedButtonRow({ ...BASE_OPTIONS, showCancel: true })!;

  it('appends row when no placeholder present', () => {
    const components: ComponentConfig[] = [{ type: 'text_display', content: 'hi' }];
    const result = injectReservedButtons(components, row);
    expect(result).toHaveLength(2);
    expect(result[1]).toBe(row);
  });

  it('replaces placeholder at top level', () => {
    const components: ComponentConfig[] = [
      { type: 'text_display', content: 'hi' },
      reservedButtons(),
    ];
    const result = injectReservedButtons(components, row);
    expect(result).toHaveLength(2);
    expect(result[1]).toBe(row);
  });

  it('replaces placeholder inside a container', () => {
    const components: ComponentConfig[] = [
      {
        type: 'container',
        children: [{ type: 'text_display', content: 'hi' }, reservedButtons()],
      },
    ];
    const result = injectReservedButtons(components, row);
    expect(result).toHaveLength(1);
    const container = result[0] as { type: string; children: ComponentConfig[] };
    expect(container.children[1]).toBe(row);
  });
});

// ---------------------------------------------------------------------------
// reservedButtons() placeholder factory
// ---------------------------------------------------------------------------

describe('reservedButtons()', () => {
  it('returns a placeholder config', () => {
    const placeholder = reservedButtons();
    expect(placeholder.type).toBe('reserved_buttons_placeholder');
  });
});
