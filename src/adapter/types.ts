/**
 * Normalized, JSON-serializable payload types used by the FlowCordAdapter.
 *
 * All Discord.js builder instances are converted to plain objects by
 * MenuRenderer before these types are passed to the adapter. DiscordAdapter
 * converts them back to Discord API options; SimulatedAdapter and DevUIAdapter
 * store or transmit them as-is.
 */
import type {
  APIActionRowComponent,
  APIComponentInMessageActionRow,
  APIEmbed,
  APIMessageComponent,
  APIModalInteractionResponseCallbackData,
  APISelectMenuComponent,
} from 'discord-api-types/v10';
import type {
  Message,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import type { RenderMode } from '../types/common';

// ---------------------------------------------------------------------------
// Render behavior (subset of ResolvedBehavior relevant to the send cycle)
// ---------------------------------------------------------------------------

/**
 * The resolved behavior fields that affect how a payload is sent and how the
 * previous message is disposed. Included in NormalizedRenderPayload so:
 * - DiscordAdapter knows which disposal mode to apply
 * - SimulatedAdapter captures the resolved behavior for test assertions
 */
export interface NormalizedRenderBehavior {
  messageCleanup: 'edit' | 'postAndDelete' | 'postAndStrip' | 'postAndReplace';
  ephemeral: boolean;
  ephemeralFallbackDisposal: 'strip' | 'replace';
  closedMessage: string;
  deleteUserMessages: boolean;
}

// ---------------------------------------------------------------------------
// Normalized render payload
// ---------------------------------------------------------------------------

/**
 * JSON-serializable representation of a menu render cycle.
 *
 * Embeds mode: carries embeds (APIEmbed[]) and components (action rows).
 * Layout mode: carries layoutComponents (Components v2 tree).
 *
 * All builder instances have been converted to plain API objects via .toJSON().
 */
export interface NormalizedRenderPayload {
  mode: RenderMode;
  /** Embeds mode — plain embed objects */
  embeds?: APIEmbed[];
  /** Embeds mode — serialized action rows */
  components?: APIActionRowComponent<APIComponentInMessageActionRow>[];
  /** Layout mode — serialized Components v2 top-level components */
  layoutComponents?: APIMessageComponent[];
  /**
   * Layout mode — pre-computed stripped version of layoutComponents with
   * interactive elements removed. Stored by DiscordAdapter for use in
   * postAndStrip disposal on the next render cycle.
   */
  strippedLayoutComponents?: APIMessageComponent[];
  /** Resolved behavior for this render cycle */
  behavior: NormalizedRenderBehavior;
}

/**
 * JSON-serializable terminal state payload (closed / cancelled / timeout).
 *
 * Terminal states always produce a plain string — the behavior system does
 * not make them richer. The mode field tells DiscordAdapter whether to wrap
 * the content in a TextDisplayBuilder (layout mode) or send as plain content
 * (embeds mode).
 */
export interface NormalizedTerminalPayload {
  reason: 'closed' | 'cancelled' | 'timeout';
  content: string;
  mode: RenderMode;
}

// ---------------------------------------------------------------------------
// Normalized interaction wrappers
// ---------------------------------------------------------------------------

/**
 * Options passed to adapter await methods.
 */
export interface AwaitOptions {
  timeout: number;
  userId: string;
}

/**
 * Normalized wrapper around a MessageComponentInteraction.
 * The session loop uses only the normalized surface; the raw Discord object
 * is preserved so ctx.interaction can expose it to consumer code.
 */
export interface NormalizedComponentInteraction {
  customId: string;
  type: 'button' | 'select';
  userId: string;
  /** Selected values for select menu interactions; undefined for buttons */
  values?: string[];
  deferUpdate(): Promise<void>;
  /** The underlying Discord.js interaction, available via ctx.interaction */
  raw: MessageComponentInteraction;
}

/**
 * Normalized wrapper around a collected Message reply.
 */
export interface NormalizedMessage {
  content: string;
  /** The underlying Discord.js Message object */
  raw: Message;
  delete(): Promise<void>;
}

/**
 * Normalized wrapper around a ModalSubmitInteraction.
 */
export interface NormalizedModalSubmission {
  getFieldValue(customId: string): string;
  /** The underlying Discord.js ModalSubmitInteraction */
  raw: ModalSubmitInteraction;
}

/**
 * Serialized modal data passed to adapter.showModal().
 * ModalBuilder.toJSON() returns this type.
 */
export type NormalizedModal = APIModalInteractionResponseCallbackData;

/**
 * Serialized select menu component — used internally for reconstruction.
 */
export type NormalizedSelectComponent = APISelectMenuComponent;
