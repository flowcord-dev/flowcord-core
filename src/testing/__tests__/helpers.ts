/**
 * Shared test helpers for integration tests.
 *
 * These keep test files focused on behavior rather than payload traversal.
 * Acceptable complexity here since these are internal framework tests and
 * authors know the payload shape.
 */
import { ButtonStyle } from 'discord.js';
import type {
  NormalizedComponentInteraction,
  NormalizedRenderPayload,
  NormalizedMessage,
  NormalizedModalSubmission,
} from '../../adapter/types';
import { ComponentIdManager } from '../../components/ComponentIdManager';

/**
 * Walk a NormalizedRenderPayload and return the first button with a
 * matching label (case-insensitive). Searches both embeds-mode components
 * and layout-mode layoutComponents recursively.
 *
 * Returns null if not found.
 */
export function findButtonId(
  payload: NormalizedRenderPayload,
  label: string,
): string | null {
  const target = label.toLowerCase();

  // Embeds mode: payload.components → action rows → buttons (raw API JSON, snake_case)
  if (payload.components) {
    for (const row of payload.components) {
      for (const component of row.components as unknown as Record<string, unknown>[]) {
        if (
          typeof component['label'] === 'string' &&
          component['label'].toLowerCase() === target &&
          typeof component['custom_id'] === 'string'
        ) {
          return component['custom_id'];
        }
      }
    }
  }

  // Layout mode: walk recursively
  if (payload.layoutComponents) {
    const result = findInLayoutComponents(
      payload.layoutComponents as unknown[],
      target,
    );
    if (result) return result;
  }

  return null;
}

function findInLayoutComponents(
  components: unknown[],
  label: string,
): string | null {
  for (const comp of components) {
    if (typeof comp !== 'object' || comp === null) continue;
    const c = comp as Record<string, unknown>;

    // Action row or container — recurse into children/components
    if (Array.isArray(c['components'])) {
      const result = findInLayoutComponents(
        c['components'] as unknown[],
        label,
      );
      if (result) return result;
    }
    if (Array.isArray(c['children'])) {
      const result = findInLayoutComponents(
        c['children'] as unknown[],
        label,
      );
      if (result) return result;
    }
    if (Array.isArray(c['items'])) {
      const result = findInLayoutComponents(c['items'] as unknown[], label);
      if (result) return result;
    }

    // Button — check label
    if (
      typeof c['label'] === 'string' &&
      c['label'].toLowerCase() === label &&
      typeof c['custom_id'] === 'string'
    ) {
      return c['custom_id'];
    }
  }
  return null;
}

/**
 * Build a fake NormalizedComponentInteraction for a button click.
 *
 * The `raw` stub provides the minimum surface that MenuSession.handleComponentInteraction
 * reads: customId, deferred, replied, deferUpdate().
 */
export function click(
  customId: string,
  userId = 'test-user',
): NormalizedComponentInteraction {
  const raw = {
    customId,
    deferred: false,
    replied: false,
    deferUpdate: async () => { raw.deferred = true; },
    isAnySelectMenu: () => false,
    isButton: () => true,
    user: { id: userId },
  } as unknown as import('discord.js').MessageComponentInteraction;

  return {
    customId,
    type: 'button' as const,
    userId,
    deferUpdate: async () => { raw.deferred = true; },
    raw,
  };
}

/**
 * Build a fake NormalizedMessage for message-collection menus.
 */
export function message(
  content: string,
): NormalizedMessage {
  return {
    content,
    raw: null as unknown as import('discord.js').Message,
    delete: async () => {},
  };
}

/**
 * Build a fake NormalizedModalSubmission.
 *
 * The `raw` stub provides the minimum surface that MenuSession.handleModalSubmit reads:
 * - deferUpdate()
 * - fields.getField(id).value
 */
export function modalSubmit(
  fields: Record<string, string>,
): NormalizedModalSubmission {
  const raw = {
    deferred: false,
    replied: false,
    deferUpdate: async () => { raw.deferred = true; },
    fields: {
      getField: (id: string) => ({ value: fields[id] ?? '' }),
    },
  } as unknown as import('discord.js').ModalSubmitInteraction;

  return {
    getFieldValue: (id: string) => fields[id] ?? '',
    raw,
  };
}

/**
 * Build a reserved button click by constructing the namespaced customId
 * from a rendered payload. Pass a reserved ID like '__reserved_cancel'.
 *
 * Falls back to direct namespace construction using the sessionId extracted
 * from any existing namespaced custom_id in the payload.
 */
export function reservedClick(
  payload: NormalizedRenderPayload,
  reservedId: string,
  menuId: string,
  userId = 'test-user',
): NormalizedComponentInteraction {
  // Extract sessionId from any existing custom_id in the payload
  const sessionId = extractSessionId(payload);
  if (!sessionId) {
    throw new Error(
      `reservedClick: could not extract sessionId from payload. ` +
        `Does the menu have at least one interactive component?`,
    );
  }
  const manager = new ComponentIdManager(sessionId, menuId);
  return click(manager.namespace(reservedId), userId);
}

function extractSessionId(payload: NormalizedRenderPayload): string | null {
  // Try embeds components first (raw API JSON, snake_case)
  if (payload.components) {
    for (const row of payload.components) {
      for (const comp of row.components as unknown as Record<string, unknown>[]) {
        if (typeof comp['custom_id'] === 'string') {
          const parsed = ComponentIdManager.parse(comp['custom_id']);
          if (parsed) return parsed.sessionId;
        }
      }
    }
  }

  // Try layout components
  if (payload.layoutComponents) {
    const found = findCustomIdInLayout(
      payload.layoutComponents as unknown[],
    );
    if (found) {
      const parsed = ComponentIdManager.parse(found);
      if (parsed) return parsed.sessionId;
    }
  }

  return null;
}

function findCustomIdInLayout(components: unknown[]): string | null {
  for (const comp of components) {
    if (typeof comp !== 'object' || comp === null) continue;
    const c = comp as Record<string, unknown>;

    if (typeof c['custom_id'] === 'string') return c['custom_id'];

    for (const key of ['components', 'children', 'items']) {
      if (Array.isArray(c[key])) {
        const result = findCustomIdInLayout(c[key] as unknown[]);
        if (result) return result;
      }
    }
  }
  return null;
}

/**
 * Convenience: build a button customId directly from parts (for embeds-mode menus
 * where the sessionId is unknown — extract from the rendered payload instead).
 */
export function buttonCustomId(
  sessionId: string,
  menuId: string,
  componentId: string,
): string {
  return new ComponentIdManager(sessionId, menuId).namespace(componentId);
}
