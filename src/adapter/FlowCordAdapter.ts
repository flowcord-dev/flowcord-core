/**
 * FlowCordAdapter — abstracts all Discord I/O from the session loop.
 *
 * Three implementations are expected:
 * - DiscordAdapter (production): delegates to Discord.js API calls
 * - SimulatedAdapter (tests): queue-based test double
 * - DevUIAdapter (future): WebSocket bridge to a hot-reload dev UI
 *
 * MenuRenderer normalizes all builder instances to plain API objects before
 * calling sendPayload(), so all adapter implementations receive JSON-serializable
 * data only — no Discord.js builder instances cross this boundary.
 */
import type {
  AwaitOptions,
  NormalizedComponentInteraction,
  NormalizedMessage,
  NormalizedModal,
  NormalizedModalSubmission,
  NormalizedRenderPayload,
  NormalizedTerminalPayload,
} from './types';
import type { RenderMode } from '../types/common';

export interface FlowCordAdapter {
  /**
   * The render mode of the currently active message, or null if no message
   * has been sent yet. Used by MenuSession to determine the correct terminal
   * payload mode (embeds vs layout) on close/cancel.
   */
  readonly activeMessageMode: RenderMode | null;
  /**
   * Defer the initial slash command reply.
   * Called once at session start before any rendering.
   */
  deferReply(options: { ephemeral: boolean }): Promise<void>;

  /**
   * Send or update the menu message with the normalized payload.
   * The behavior field inside the payload tells the adapter how to handle
   * the previous message (edit in place, post-and-delete, post-and-strip, etc.).
   */
  sendPayload(payload: NormalizedRenderPayload): Promise<void>;

  /**
   * Wait for the next component interaction (button click or select change).
   * Resolves with the normalized interaction wrapper.
   * Rejects or resolves with a sentinel when timeout is reached.
   */
  awaitComponent(
    options: AwaitOptions,
  ): Promise<NormalizedComponentInteraction>;

  /**
   * Wait for the next text message from the user (message collection mode).
   */
  awaitMessage(options: AwaitOptions): Promise<NormalizedMessage>;

  /**
   * Show a modal to the user, triggered by a component interaction.
   * The modal has already been serialized to a plain API object.
   */
  showModal(
    modal: NormalizedModal,
    triggerInteraction: NormalizedComponentInteraction,
  ): Promise<void>;

  /**
   * Wait for the user to submit the modal (or dismiss it).
   */
  awaitModal(
    options: AwaitOptions,
  ): Promise<NormalizedModalSubmission>;

  /**
   * Send the terminal state (closed / cancelled / timeout).
   * Called once when the session loop exits.
   */
  sendTerminalPayload(
    payload: NormalizedTerminalPayload,
  ): Promise<void>;
}
