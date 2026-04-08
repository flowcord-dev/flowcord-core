/**
 * DiscordAdapter — production FlowCordAdapter implementation.
 *
 * Wraps a ChatInputCommandInteraction and implements all I/O operations
 * by delegating to Discord.js API calls. All state that previously lived
 * on MenuRenderer (_activeMessage, _lastComponentInteraction, etc.) now
 * lives here.
 *
 * Receives normalized, JSON-serializable payloads from MenuRenderer and
 * converts them back to Discord.js API options before sending.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ChannelSelectMenuBuilder,
  MentionableSelectMenuBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  Routes,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  UserSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type Message,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { FlowCordAdapter } from './FlowCordAdapter';
import type {
  AwaitOptions,
  NormalizedComponentInteraction,
  NormalizedMessage,
  NormalizedModal,
  NormalizedModalSubmission,
  NormalizedRenderPayload,
  NormalizedSelectComponent,
  NormalizedTerminalPayload,
} from './types';
import type { RenderMode } from '../types/common';

type LastUpdateSource =
  | 'editReply'
  | 'component'
  | 'followUp'
  | 'messageCollect';

export class DiscordAdapter implements FlowCordAdapter {
  private readonly _commandInteraction: ChatInputCommandInteraction;

  // State previously on MenuRenderer
  private _activeMessage: Message | null = null;
  private _activeMessageMode: RenderMode | null = null;
  private _activeMessageEphemeral = false;
  private _activeMessageIsFollowUp = false;
  private _lastUpdateSource: LastUpdateSource | null = null;
  private _lastComponentInteraction: MessageComponentInteraction | null = null;
  private _isReset = false;
  private _deferEphemeral: boolean | null = null;
  /** Stored from last layout render for postAndStrip disposal */
  private _lastStrippedLayoutComponents: unknown[] | null = null;

  constructor(interaction: ChatInputCommandInteraction) {
    this._commandInteraction = interaction;
  }

  // -----------------------------------------------------------------------
  // FlowCordAdapter implementation
  // -----------------------------------------------------------------------

  async deferReply(options: { ephemeral: boolean }): Promise<void> {
    await this._commandInteraction.deferReply(
      options.ephemeral ? { flags: MessageFlags.Ephemeral } : {},
    );
    this._deferEphemeral = options.ephemeral;
  }

  async sendPayload(payload: NormalizedRenderPayload): Promise<void> {
    // Store the pre-computed stripped layout components for postAndStrip disposal
    if (payload.strippedLayoutComponents !== undefined) {
      this._lastStrippedLayoutComponents = payload.strippedLayoutComponents;
    } else if (payload.mode !== 'layout') {
      this._lastStrippedLayoutComponents = null;
    }

    const { behavior, mode: newMode } = payload;
    const { ephemeral } = behavior;

    const modeChanged =
      this._activeMessageMode !== null && this._activeMessageMode !== newMode;
    const ephemeralChanged =
      this._activeMessage !== null &&
      this._activeMessageEphemeral !== ephemeral;

    const discordPayload = this._buildDiscordPayload(payload);

    if (ephemeralChanged || modeChanged) {
      // Mode or ephemeral transition — dispose old message, post new as followUp.
      await this._disposeOldMessage(behavior);
      const followUpPayload = ephemeral
        ? this._makeEphemeral(discordPayload)
        : discordPayload;
      const newMessage =
        await this._commandInteraction.followUp(followUpPayload);
      this._activeMessage = newMessage as Message;
      this._activeMessageEphemeral = ephemeral;
      this._activeMessageIsFollowUp = true;
      this._lastComponentInteraction = null;
      this._lastUpdateSource = 'followUp';
    } else if (this._isReset) {
      this._isReset = false;
      if (behavior.messageCleanup !== 'edit') {
        // postAnd*: dispose old message and post updated menu as followUp.
        await this._disposeOldMessage(behavior);
        const followUpPayload = ephemeral
          ? this._makeEphemeral(discordPayload)
          : discordPayload;
        const newMessage =
          await this._commandInteraction.followUp(followUpPayload);
        this._activeMessage = newMessage as Message;
        this._activeMessageEphemeral = ephemeral;
        this._activeMessageIsFollowUp = true;
        this._lastUpdateSource = 'followUp';
      } else {
        // edit (default after message collection): edit existing message in place.
        if (this._activeMessageEphemeral) {
          await this._editEphemeralMessage(discordPayload);
        } else if (this._activeMessage) {
          await this._activeMessage.edit(discordPayload);
        }
        this._lastUpdateSource = 'editReply';
      }
    } else if (
      behavior.messageCleanup !== 'edit' &&
      this._activeMessage !== null
    ) {
      // postAnd* mode — dispose old and always post a new one.
      if (this._lastComponentInteraction) {
        await this._lastComponentInteraction.deferUpdate();
        this._lastComponentInteraction = null;
      }
      await this._disposeOldMessage(behavior);
      const followUpPayload = ephemeral
        ? this._makeEphemeral(discordPayload)
        : discordPayload;
      const newMessage =
        await this._commandInteraction.followUp(followUpPayload);
      this._activeMessage = newMessage as Message;
      this._activeMessageEphemeral = ephemeral;
      this._activeMessageIsFollowUp = true;
      this._lastUpdateSource = 'followUp';
    } else if (
      this._lastComponentInteraction &&
      !this._lastComponentInteraction.deferred &&
      !this._lastComponentInteraction.replied
    ) {
      await this._lastComponentInteraction.update(discordPayload);
      this._lastComponentInteraction = null;
      this._lastUpdateSource = 'component';
    } else if (this._activeMessage) {
      // Existing message — edit it.
      if (this._activeMessageEphemeral) {
        await this._editEphemeralMessage(discordPayload);
      } else {
        await this._activeMessage.edit(discordPayload);
      }
      this._lastUpdateSource = 'editReply';
    } else {
      // First render — editReply on the deferred reply.
      const message =
        await this._commandInteraction.editReply(discordPayload);
      this._activeMessage = message as Message;
      this._activeMessageEphemeral =
        this._deferEphemeral ?? ephemeral;
      this._activeMessageIsFollowUp = false;
      this._deferEphemeral = null;
      this._lastUpdateSource = 'editReply';
    }

    this._activeMessageMode = newMode;
  }

  async awaitComponent(
    options: AwaitOptions,
  ): Promise<NormalizedComponentInteraction> {
    if (!this._activeMessage) {
      return new Promise((_, reject) =>
        reject(new Error('No active message to await components on')),
      );
    }

    const interaction = await this._activeMessage.awaitMessageComponent({
      filter: (i) => i.user.id === options.userId,
      time: options.timeout,
    });

    this._lastComponentInteraction = interaction;

    return this._wrapComponentInteraction(interaction);
  }

  async awaitMessage(options: AwaitOptions): Promise<NormalizedMessage> {
    const channel = this._commandInteraction.channel;
    if (!channel || !('awaitMessages' in channel)) {
      throw new Error('Channel does not support message collection');
    }

    const collected = await (
      channel as {
        awaitMessages: (opts: Record<string, unknown>) => Promise<{ first: () => Message | undefined }>;
      }
    ).awaitMessages({
      filter: (msg: Message) => msg.author.id === options.userId,
      max: 1,
      time: options.timeout,
      errors: ['time'],
    });

    const message = collected.first();
    if (!message) throw new Error('No message collected');

    this._isReset = true;

    return {
      content: message.content,
      raw: message,
      delete: async () => {
        try {
          await message.delete();
        } catch {
          // Best-effort — may not have permissions
        }
      },
    };
  }

  async showModal(
    modal: NormalizedModal,
    triggerInteraction: NormalizedComponentInteraction,
  ): Promise<void> {
    // Store the trigger interaction so awaitModal can call awaitModalSubmit on it.
    this._pendingModalInteraction = triggerInteraction.raw;
    // showModal must be called on the raw (non-deferred) interaction.
    await triggerInteraction.raw.showModal(modal);
    // Clear last component interaction — the modal now owns the pending state.
    this._lastComponentInteraction = null;
  }

  async awaitModal(options: AwaitOptions): Promise<NormalizedModalSubmission> {
    // awaitModalSubmit is called on the component interaction that triggered the modal.
    // This is stored in MenuSession._modalShowInteraction and passed through the adapter.
    // Since we don't have direct access here, MenuSession manages this via the
    // _modalShowInteraction field and calls awaitModal only when appropriate.
    // The DiscordAdapter receives the trigger interaction via showModal() — we need
    // to store it so awaitModal can call awaitModalSubmit on it.
    if (!this._pendingModalInteraction) {
      throw new Error('No pending modal interaction to await submit on');
    }

    const modalInteraction = await this._pendingModalInteraction.awaitModalSubmit({
      filter: (i: ModalSubmitInteraction) => i.user.id === options.userId,
      time: options.timeout,
    });

    this._pendingModalInteraction = null;

    return {
      getFieldValue: (customId: string) =>
        modalInteraction.fields.getTextInputValue(customId),
      raw: modalInteraction,
    };
  }

  async sendTerminalPayload(
    payload: NormalizedTerminalPayload,
  ): Promise<void> {
    const discordPayload: Record<string, unknown> =
      payload.mode === 'layout'
        ? {
            components: [
              new TextDisplayBuilder().setContent(payload.content),
            ],
            embeds: [],
            content: '',
            flags: MessageFlags.IsComponentsV2,
          }
        : payload.reason === 'closed'
          ? { components: [] }
          : {
              content: payload.content,
              embeds: [],
              components: [],
            };

    try {
      if (this._lastComponentInteraction && !this._isReset) {
        await this._lastComponentInteraction.update(
          discordPayload as Parameters<MessageComponentInteraction['update']>[0],
        );
      } else if (this._activeMessage && !this._activeMessageEphemeral) {
        await this._activeMessage.edit(
          discordPayload as Parameters<Message['edit']>[0],
        );
      } else {
        await this._editEphemeralMessage(discordPayload);
      }
    } catch {
      // Best-effort cleanup — interaction may have expired
    }
  }

  // -----------------------------------------------------------------------
  // State setters called by MenuSession during the interaction loop
  // -----------------------------------------------------------------------

  /** Called after a component interaction is received outside awaitComponent. */
  setLastComponentInteraction(
    interaction: MessageComponentInteraction,
  ): void {
    this._lastComponentInteraction = interaction;
  }

  /** Called after message collection to signal the next render should repost. */
  setMessageCollected(): void {
    this._isReset = true;
  }

  /**
   * Record the actual ephemeral state used for deferReply.
   * Called by MenuSession after deferReply for sync factories.
   */
  seedDeferEphemeral(ephemeral: boolean): void {
    this._deferEphemeral = ephemeral;
  }

  /** Current active message mode — needed by MenuSession for terminal renders. */
  get activeMessageMode(): RenderMode | null {
    return this._activeMessageMode;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private _pendingModalInteraction: MessageComponentInteraction | null = null;

  /** Store the trigger interaction for awaitModal to call awaitModalSubmit on. */
  setPendingModalInteraction(
    interaction: MessageComponentInteraction,
  ): void {
    this._pendingModalInteraction = interaction;
  }

  private _buildDiscordPayload(
    payload: NormalizedRenderPayload,
  ): Record<string, unknown> {
    if (payload.mode === 'layout' && payload.layoutComponents) {
      return {
        components: payload.layoutComponents,
        embeds: [],
        content: '',
        flags: MessageFlags.IsComponentsV2,
      };
    }

    return {
      embeds: payload.embeds ?? [],
      components: payload.components
        ? this._reconstructActionRows(payload)
        : [],
      content: '',
    };
  }

  /**
   * For embeds-mode payloads: the components array carries serialized action
   * rows (plain API objects). Discord.js editReply/update accepts these directly
   * as long as they conform to the API shape — no reconstruction needed.
   * This method exists as a pass-through to make the intent explicit and allow
   * future reconstruction if Discord.js requires builder instances.
   */
  private _reconstructActionRows(
    payload: NormalizedRenderPayload,
  ): unknown[] {
    return payload.components ?? [];
  }

  private _makeEphemeral(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const existing =
      typeof payload.flags === 'number' ? payload.flags : 0;
    return { ...payload, flags: existing | MessageFlags.Ephemeral };
  }

  private async _disposeOldMessage(
    behavior: Pick<
      NormalizedRenderPayload['behavior'],
      'messageCleanup' | 'ephemeralFallbackDisposal' | 'closedMessage'
    >,
  ): Promise<void> {
    if (!this._activeMessage) return;

    const effectiveCleanup =
      this._activeMessageEphemeral &&
      behavior.messageCleanup === 'postAndDelete'
        ? behavior.ephemeralFallbackDisposal === 'replace'
          ? 'postAndReplace'
          : 'postAndStrip'
        : behavior.messageCleanup;

    const isLayout = this._activeMessageMode === 'layout';

    try {
      if (effectiveCleanup === 'postAndDelete') {
        await this._deleteOldMessage();
      } else if (effectiveCleanup === 'postAndReplace') {
        const closePayload: Record<string, unknown> = isLayout
          ? {
              components: [
                new TextDisplayBuilder().setContent(behavior.closedMessage),
              ],
              embeds: [],
              content: '',
              flags: MessageFlags.IsComponentsV2,
            }
          : {
              content: behavior.closedMessage,
              embeds: [],
              components: [],
            };
        if (this._activeMessageEphemeral) {
          await this._editEphemeralMessage(closePayload);
        } else {
          await this._activeMessage.edit(closePayload);
        }
        this._activeMessage = null;
      } else {
        // postAndStrip
        let stripPayload: Record<string, unknown>;
        if (isLayout) {
          const strippedComponents =
            this._lastStrippedLayoutComponents &&
            this._lastStrippedLayoutComponents.length > 0
              ? this._lastStrippedLayoutComponents
              : [new TextDisplayBuilder().setContent(behavior.closedMessage)];
          stripPayload = {
            components: strippedComponents,
            embeds: [],
            content: '',
            flags: MessageFlags.IsComponentsV2,
          };
        } else {
          stripPayload = { components: [] };
        }

        if (this._activeMessageEphemeral) {
          await this._editEphemeralMessage(stripPayload);
        } else {
          await this._activeMessage.edit(stripPayload);
        }
        this._activeMessage = null;
      }
    } catch {
      this._activeMessage = null;
    }

    this._lastComponentInteraction = null;
  }

  private async _editEphemeralMessage(
    data: Record<string, unknown>,
  ): Promise<void> {
    if (this._activeMessageIsFollowUp && this._activeMessage) {
      await this._commandInteraction.client.rest.patch(
        Routes.webhookMessage(
          this._commandInteraction.applicationId,
          this._commandInteraction.token,
          this._activeMessage.id,
        ),
        { body: data },
      );
    } else {
      await this._commandInteraction.editReply(data);
    }
  }

  private async _deleteOldMessage(): Promise<void> {
    if (!this._activeMessage) return;
    try {
      await this._activeMessage.delete();
    } catch {
      // May already be deleted
    }
    this._activeMessage = null;
    this._lastComponentInteraction = null;
  }

  private _wrapComponentInteraction(
    interaction: MessageComponentInteraction,
  ): NormalizedComponentInteraction {
    const isSelect = interaction.isAnySelectMenu();
    return {
      customId: interaction.customId,
      type: isSelect ? 'select' : 'button',
      userId: interaction.user.id,
      values: isSelect
        ? (interaction as { values: string[] }).values
        : undefined,
      deferUpdate: async () => {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferUpdate();
        }
      },
      raw: interaction,
    };
  }

  /**
   * Reconstruct a Discord.js select menu builder from serialized API data.
   * Used when DiscordAdapter needs to re-send select menu components.
   * ComponentType values: StringSelect=3, UserSelect=5, RoleSelect=6,
   * MentionableSelect=7, ChannelSelect=8
   */
  static reconstructSelectBuilder(
    data: NormalizedSelectComponent,
  ):
    | StringSelectMenuBuilder
    | UserSelectMenuBuilder
    | RoleSelectMenuBuilder
    | MentionableSelectMenuBuilder
    | ChannelSelectMenuBuilder {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = data as any;
    switch (raw.type) {
      case 3:
        return new StringSelectMenuBuilder(raw);
      case 5:
        return new UserSelectMenuBuilder(raw);
      case 6:
        return new RoleSelectMenuBuilder(raw);
      case 7:
        return new MentionableSelectMenuBuilder(raw);
      case 8:
        return new ChannelSelectMenuBuilder(raw);
      default:
        return new StringSelectMenuBuilder();
    }
  }
}
