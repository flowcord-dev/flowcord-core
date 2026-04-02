/**
 * MenuRenderer — Renders menus to Discord in either embeds or display components mode.
 *
 * Handles:
 * - Dual rendering modes (embeds vs layout/Components v2)
 * - Mode transitions (followUp + delete on embed ↔ layout switch)
 * - Reserved button injection
 * - Component ID namespacing on output
 * - Pagination expansion (paginatedGroup → action rows)
 * - Message send/edit/update strategies
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  FileBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  Routes,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type Message,
  type MessageActionRowComponentBuilder,
  type MessageComponentInteraction,
} from 'discord.js';
import type { MenuInstance } from './MenuInstance';
import type { MenuContext } from '../context/MenuContext';
import type { ResolvedBehavior } from '../types/behavior';
import type {
  ActionRowConfig,
  ButtonConfig,
  ComponentConfig,
  ContainerConfig,
  FileConfig,
  MediaGalleryConfig,
  ModalConfig,
  PaginatedGroupConfig,
  PaginationState,
  RenderMode,
  SectionConfig,
  SelectConfig,
  SeparatorConfig,
  TextDisplayConfig,
  ThumbnailConfig,
} from '../types/common';
import {
  buildReservedButtonRow,
  injectReservedButtons,
  type ReservedButtonsOptions,
} from '../components/reservedButtons';

/**
 * Tracks how the last message was sent so we know the right update strategy.
 */
type LastUpdateSource =
  | 'editReply'
  | 'component'
  | 'followUp'
  | 'messageCollect';

export class MenuRenderer {
  private static readonly MAX_EMBED_COMPONENT_ROWS = 5;
  private static readonly MAX_BUTTONS_PER_ROW = 5;

  private _activeMessage: Message | null = null;
  private _activeMessageMode: RenderMode | null = null;
  private _activeMessageEphemeral = false;
  private _activeMessageIsFollowUp = false;
  private _lastUpdateSource: LastUpdateSource | null = null;

  /**
   * The actual ephemeral state used for deferReply — may differ from
   * definition.ephemeral for async factories where the caller provides the
   * flag. Set once after deferReply so the first render uses the real state.
   */
  private _deferEphemeral: boolean | null = null;

  /** The last component interaction received — used for .update() */
  private _lastComponentInteraction: MessageComponentInteraction | null =
    null;

  /** Whether we need to use followUp instead of editReply (after message collection) */
  private _isReset = false;

  /**
   * Disposal config stored by setMessageCollected(), consumed on the next
   * sendPayload call when _isReset is true.
   */
  private _pendingDisposalConfig: Pick<
    ResolvedBehavior,
    | 'oldMessageDisposal'
    | 'closedMessage'
    | 'ephemeralFallbackDisposal'
  > = {
    oldMessageDisposal: 'stripComponents',
    closedMessage: '*Menu closed*',
    ephemeralFallbackDisposal: 'stripComponents',
  };

  get activeMessageMode(): RenderMode | null {
    return this._activeMessageMode;
  }

  /**
   * Called after message collection so the next render disposes the old
   * message and posts a new one via followUp.
   */
  setMessageCollected(
    config: Pick<
      ResolvedBehavior,
      | 'oldMessageDisposal'
      | 'closedMessage'
      | 'ephemeralFallbackDisposal'
    >,
  ): void {
    this._isReset = true;
    this._pendingDisposalConfig = config;
  }

  /**
   * Record the actual ephemeral state used for deferReply.
   * Called by MenuSession immediately after deferReply so the first render
   * sets _activeMessageEphemeral to the real Discord message state rather
   * than definition.ephemeral (which may differ for async factories).
   */
  seedDeferEphemeral(ephemeral: boolean): void {
    this._deferEphemeral = ephemeral;
  }

  /** Set the latest component interaction for .update() calls. */
  setLastComponentInteraction(
    interaction: MessageComponentInteraction,
  ): void {
    this._lastComponentInteraction = interaction;
  }

  // -----------------------------------------------------------------------
  // Main render pipeline
  // -----------------------------------------------------------------------

  /**
   * Execute a full render cycle for the current menu.
   * Calls definition setters, builds the payload, and sends/updates the Discord message.
   */
  async render(
    menuInstance: MenuInstance,
    ctx: MenuContext,
    commandInteraction: ChatInputCommandInteraction,
    behavior: ResolvedBehavior,
  ): Promise<void> {
    const definition = menuInstance.definition;
    const newMode = definition.mode;

    // Clear and rebuild action registrations
    menuInstance.clearActions();

    let payload: RenderPayload;

    if (newMode === 'embeds') {
      payload = await this.buildEmbedsRender(menuInstance, ctx);
    } else {
      payload = await this.buildLayoutRender(menuInstance, ctx);
    }

    // Send or update the message based on current state
    await this.sendPayload(
      payload,
      newMode,
      commandInteraction,
      behavior,
    );
  }

  /**
   * Send the cancel state — clear components and show cancellation message.
   */
  async renderCancelled(
    commandInteraction: ChatInputCommandInteraction,
  ): Promise<void> {
    // Layout-mode messages have the IsComponentsV2 flag permanently set.
    // Any edit must include the flag and use display components instead of content.
    const payload: Record<string, unknown> =
      this._activeMessageMode === 'layout'
        ? {
            components: [
              new TextDisplayBuilder().setContent(
                '*Command Cancelled*',
              ),
            ],
            embeds: [],
            content: '',
            flags: MessageFlags.IsComponentsV2,
          }
        : {
            content: '*Command Cancelled*',
            embeds: [],
            components: [],
          };

    try {
      if (this._lastComponentInteraction && !this._isReset) {
        await this._lastComponentInteraction.update(payload);
      } else if (
        this._activeMessage &&
        !this._activeMessageEphemeral
      ) {
        await this._activeMessage.edit(payload);
      } else {
        await this.editEphemeralMessage(commandInteraction, payload);
      }
    } catch {
      // Best-effort cleanup — interaction may have expired
    }
  }

  /**
   * Send the close state — remove interactive components from the message.
   */
  async renderClosed(
    commandInteraction: ChatInputCommandInteraction,
  ): Promise<void> {
    // Layout-mode messages require the IsComponentsV2 flag on all edits.
    const payload: Record<string, unknown> =
      this._activeMessageMode === 'layout'
        ? {
            components: [
              new TextDisplayBuilder().setContent(
                '-# This menu has expired.',
              ),
            ],
            embeds: [],
            content: '',
            flags: MessageFlags.IsComponentsV2,
          }
        : {
            components: [],
          };

    try {
      if (this._lastComponentInteraction && !this._isReset) {
        await this._lastComponentInteraction.update(payload);
      } else if (
        this._activeMessage &&
        !this._activeMessageEphemeral
      ) {
        await this._activeMessage.edit(payload);
      } else {
        await this.editEphemeralMessage(commandInteraction, payload);
      }
    } catch {
      // Best-effort cleanup
    }
  }

  // -----------------------------------------------------------------------
  // Embed mode rendering
  // -----------------------------------------------------------------------

  private async buildEmbedsRender(
    menuInstance: MenuInstance,
    ctx: MenuContext,
  ): Promise<RenderPayload> {
    const definition = menuInstance.definition;
    let embeds: EmbedBuilder[] = [];
    let buttons: ButtonConfig[] = [];
    let selectConfig: SelectConfig | null = null;

    // Pre-compute list pagination state so setters can use ctx.pagination
    if (definition.listPagination) {
      const totalItems =
        await definition.listPagination.getTotalQuantityItems(ctx);
      const itemsPerPage =
        definition.listPagination.itemsPerPage ?? 50;
      const totalPages = Math.max(
        1,
        Math.ceil(totalItems / itemsPerPage),
      );
      const currentPage =
        menuInstance.paginationState?.currentPage ?? 0;

      menuInstance.paginationState = {
        currentPage,
        totalPages,
        itemsPerPage,
        totalItems,
        startIndex: currentPage * itemsPerPage,
        endIndex: Math.min(
          (currentPage + 1) * itemsPerPage,
          totalItems,
        ),
      };

      // Update context so setters see the current pagination state
      (ctx as { pagination: PaginationState | null }).pagination =
        menuInstance.paginationState;
    }

    // Run button/select setters first so pagination can be computed before embeds.
    if (definition.setButtons) {
      buttons = (await definition.setButtons(ctx)) as ButtonConfig[];
    }

    if (definition.setSelectMenu) {
      selectConfig = (await definition.setSelectMenu(
        ctx,
      )) as SelectConfig;
    }

    // Handle button pagination (slice buttons for current page).
    // Auto-enable pagination when needed so embed rows never exceed Discord limits.
    const configuredButtonPagination =
      definition.setButtonsOptions?.pagination;
    const hasConfiguredButtonPagination =
      !!configuredButtonPagination;
    const maxButtonsWithoutPagination =
      this.getMaxEmbedButtonsPerPage(
        menuInstance,
        !!selectConfig,
        ctx,
        false,
      );
    const needsAutoButtonPagination =
      !hasConfiguredButtonPagination &&
      !definition.listPagination &&
      buttons.length > maxButtonsWithoutPagination;

    if (
      (hasConfiguredButtonPagination || needsAutoButtonPagination) &&
      buttons.length > 0
    ) {
      const fixedStartButtons = buttons.filter(
        (b) => b.fixedPosition === 'start',
      );
      const fixedEndButtons = buttons.filter(
        (b) => b.fixedPosition === 'end',
      );
      const pageableButtons = buttons.filter((b) => !b.fixedPosition);

      const requestedPerPage =
        configuredButtonPagination?.perPage ?? 25;
      const maxButtonsWithReservedRow =
        this.getMaxEmbedButtonsPerPage(
          menuInstance,
          !!selectConfig,
          ctx,
          true,
        );
      const fixedButtonsCount =
        fixedStartButtons.length + fixedEndButtons.length;
      const perPage = Math.max(
        1,
        Math.min(requestedPerPage, maxButtonsWithReservedRow),
      );
      const pageItemsPerPage = Math.max(
        1,
        perPage - fixedButtonsCount,
      );
      const totalPages = Math.max(
        1,
        Math.ceil(pageableButtons.length / pageItemsPerPage),
      );
      const currentPage =
        menuInstance.paginationState?.currentPage ?? 0;

      menuInstance.paginationState = {
        currentPage,
        totalPages,
        itemsPerPage: pageItemsPerPage,
        totalItems: pageableButtons.length,
        startIndex: currentPage * pageItemsPerPage,
        endIndex: Math.min(
          (currentPage + 1) * pageItemsPerPage,
          pageableButtons.length,
        ),
      };

      // Keep embeds in sync with the same page that button rows are using.
      (ctx as { pagination: PaginationState | null }).pagination =
        menuInstance.paginationState;

      // Register ALL button actions (pre-slice) so pagination page changes work
      menuInstance.registerButtonActions(buttons);

      // Slice for current page
      const pageButtons = pageableButtons.slice(
        menuInstance.paginationState.startIndex,
        menuInstance.paginationState.endIndex,
      );
      buttons = [
        ...fixedStartButtons,
        ...pageButtons,
        ...fixedEndButtons,
      ];
    } else {
      // No button pagination (or list pagination already computed) — register button actions
      menuInstance.registerButtonActions(buttons);
    }

    // Run embed setter after final pagination state is known.
    if (definition.setEmbeds) {
      embeds = await definition.setEmbeds(ctx);
    }

    // Register select and modal actions
    if (selectConfig) {
      menuInstance.registerSelectAction(selectConfig);
    }

    if (definition.setModal) {
      const modalConfigs = await definition.setModal(ctx);
      menuInstance.registerModalConfigs(
        modalConfigs as ModalConfig | ModalConfig[],
      );
    }

    // Register reserved button actions
    this.registerReservedActions(menuInstance, ctx);

    // Build reserved button row
    const reservedOpts = this.buildReservedButtonsOptions(
      menuInstance,
      'embeds',
      ctx,
    );
    const reservedRow = buildReservedButtonRow(reservedOpts);

    // Build Discord.js action rows
    const actionRows = this.buildEmbedActionRows(
      menuInstance,
      buttons,
      reservedRow,
      selectConfig,
    );

    // Add pagination footer to embeds
    if (
      menuInstance.paginationState &&
      menuInstance.paginationState.totalPages > 1 &&
      embeds.length > 0
    ) {
      const ps = menuInstance.paginationState;
      const lastEmbed = embeds[embeds.length - 1];
      const footerText = `Page ${ps.currentPage + 1} of ${ps.totalPages}`;
      const existingFooter = lastEmbed.data.footer?.text;
      lastEmbed.setFooter({
        text: existingFooter
          ? `${existingFooter} • ${footerText}`
          : footerText,
      });
    }

    return {
      mode: 'embeds',
      embeds,
      components: actionRows,
    };
  }

  // -----------------------------------------------------------------------
  // Layout mode rendering
  // -----------------------------------------------------------------------

  private async buildLayoutRender(
    menuInstance: MenuInstance,
    ctx: MenuContext,
  ): Promise<RenderPayload> {
    const definition = menuInstance.definition;
    let components: ComponentConfig[] = [];

    // Pre-compute list pagination state so setLayout can use ctx.pagination
    if (definition.listPagination) {
      const totalItems =
        await definition.listPagination.getTotalQuantityItems(ctx);
      const itemsPerPage =
        definition.listPagination.itemsPerPage ?? 50;
      const totalPages = Math.max(
        1,
        Math.ceil(totalItems / itemsPerPage),
      );
      const currentPage =
        menuInstance.paginationState?.currentPage ?? 0;

      menuInstance.paginationState = {
        currentPage,
        totalPages,
        itemsPerPage,
        totalItems,
        startIndex: currentPage * itemsPerPage,
        endIndex: Math.min(
          (currentPage + 1) * itemsPerPage,
          totalItems,
        ),
      };

      // Update context so setLayout sees the current pagination state
      (ctx as { pagination: PaginationState | null }).pagination =
        menuInstance.paginationState;
    }

    if (definition.setLayout) {
      components = (await definition.setLayout(
        ctx,
      )) as ComponentConfig[];
    }

    // Expand paginatedGroup markers
    components = this.expandPaginatedGroups(components, menuInstance);

    // Register all actions from the layout tree
    menuInstance.registerLayoutActions(components);

    // Register modal if defined
    if (definition.setModal) {
      const modalConfigs = await definition.setModal(ctx);
      menuInstance.registerModalConfigs(
        modalConfigs as ModalConfig | ModalConfig[],
      );
    }

    // Register reserved button actions
    this.registerReservedActions(menuInstance, ctx);

    // Build and inject reserved button row
    const reservedOpts = this.buildReservedButtonsOptions(
      menuInstance,
      'layout',
      ctx,
    );
    const reservedRow = buildReservedButtonRow(reservedOpts);
    if (reservedRow) {
      components = injectReservedButtons(components, reservedRow);
    }

    // Convert to Discord.js builders
    const discordComponents = this.serializeLayoutComponents(
      components,
      menuInstance,
    );

    return {
      mode: 'layout',
      layoutComponents: discordComponents,
    };
  }

  // -----------------------------------------------------------------------
  // Payload sending
  // -----------------------------------------------------------------------

  private async sendPayload(
    payload: RenderPayload,
    newMode: RenderMode,
    commandInteraction: ChatInputCommandInteraction,
    behavior: ResolvedBehavior,
  ): Promise<void> {
    const { ephemeral } = behavior;
    const modeChanged =
      this._activeMessageMode !== null &&
      this._activeMessageMode !== newMode;
    const ephemeralChanged =
      this._activeMessage !== null &&
      this._activeMessageEphemeral !== ephemeral;

    const discordPayload = this.buildDiscordPayload(payload, newMode);

    if (ephemeralChanged) {
      // Ephemeral state changed — dispose old message, send new as followUp.
      await this.disposeOldMessage(behavior, commandInteraction);
      const followUpPayload = ephemeral
        ? this.makeEphemeral(discordPayload)
        : discordPayload;
      const newMessage =
        await commandInteraction.followUp(followUpPayload);
      this._activeMessage = newMessage as Message;
      this._activeMessageEphemeral = ephemeral;
      this._activeMessageIsFollowUp = true;
      this._lastComponentInteraction = null;
      this._lastUpdateSource = 'followUp';
    } else if (modeChanged) {
      // Mode transition — dispose old message, send new as followUp.
      await this.disposeOldMessage(behavior, commandInteraction);
      const followUpPayload = ephemeral
        ? this.makeEphemeral(discordPayload)
        : discordPayload;
      const newMessage =
        await commandInteraction.followUp(followUpPayload);
      this._activeMessage = newMessage as Message;
      this._activeMessageEphemeral = ephemeral;
      this._activeMessageIsFollowUp = true;
      this._lastUpdateSource = 'followUp';
    } else if (this._isReset) {
      // After message collection — dispose old message and post new as followUp.
      const pendingDisposalConfig = this._pendingDisposalConfig;
      this._isReset = false;
      await this.disposeOldMessage(
        pendingDisposalConfig,
        commandInteraction,
      );
      const followUpPayload = ephemeral
        ? this.makeEphemeral(discordPayload)
        : discordPayload;
      const newMessage =
        await commandInteraction.followUp(followUpPayload);
      this._activeMessage = newMessage as Message;
      this._activeMessageEphemeral = ephemeral;
      this._activeMessageIsFollowUp = true;
      this._lastUpdateSource = 'followUp';
    } else if (
      behavior.updateMode === 'postNew' &&
      this._activeMessage !== null
    ) {
      // postNew mode — dispose old message and always post a new one.
      if (this._lastComponentInteraction) {
        // Acknowledge the component interaction without editing the message.
        await this._lastComponentInteraction.deferUpdate();
        this._lastComponentInteraction = null;
      }
      await this.disposeOldMessage(behavior, commandInteraction);
      const followUpPayload = ephemeral
        ? this.makeEphemeral(discordPayload)
        : discordPayload;
      const newMessage =
        await commandInteraction.followUp(followUpPayload);
      this._activeMessage = newMessage as Message;
      this._activeMessageEphemeral = ephemeral;
      this._activeMessageIsFollowUp = true;
      this._lastUpdateSource = 'followUp';
    } else if (this._lastComponentInteraction) {
      // We have a component interaction to update
      await this._lastComponentInteraction.update(discordPayload);
      this._lastComponentInteraction = null;
      this._lastUpdateSource = 'component';
    } else if (this._activeMessage) {
      // Existing message — edit it.
      // Ephemeral messages cannot be edited via Message.edit() (REST);
      // route through the interaction token instead.
      if (this._activeMessageEphemeral) {
        await this.editEphemeralMessage(
          commandInteraction,
          discordPayload,
        );
      } else {
        await this._activeMessage.edit(discordPayload);
      }
      this._lastUpdateSource = 'editReply';
    } else {
      // First render — editReply on the deferred reply.
      // Use _deferEphemeral (the actual state passed to deferReply) if set,
      // so _activeMessageEphemeral reflects the real Discord message state
      // rather than definition.ephemeral (which can diverge for async factories).
      const message =
        await commandInteraction.editReply(discordPayload);
      this._activeMessage = message as Message;
      this._activeMessageEphemeral =
        this._deferEphemeral ?? ephemeral;
      this._activeMessageIsFollowUp = false;
      this._deferEphemeral = null;
      this._lastUpdateSource = 'editReply';
    }

    this._activeMessageMode = newMode;
  }

  /**
   * Add MessageFlags.Ephemeral to a payload, preserving any flags already
   * present (e.g. IsComponentsV2 for layout-mode messages). Discord flags are
   * a bitmask, so the existing value must be OR-ed rather than replaced.
   */
  private makeEphemeral(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const existing =
      typeof payload.flags === 'number' ? payload.flags : 0;
    return { ...payload, flags: existing | MessageFlags.Ephemeral };
  }

  /**
   * Dispose the current active message according to the resolved disposal
   * strategy. Called whenever a new message is about to be posted in its place.
   *
   * - stripComponents: remove interactive components, leave content
   * - delete: delete if non-ephemeral; fall back to ephemeralFallbackDisposal
   *   if the message is ephemeral (Discord does not allow deleting ephemeral messages)
   * - replaceWithClosed: replace content with the closedMessage string
   */
  private async disposeOldMessage(
    behavior: Pick<
      ResolvedBehavior,
      | 'oldMessageDisposal'
      | 'ephemeralFallbackDisposal'
      | 'closedMessage'
    >,
    commandInteraction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!this._activeMessage) return;

    const disposal = this._activeMessageEphemeral
      ? behavior.oldMessageDisposal === 'delete'
        ? behavior.ephemeralFallbackDisposal
        : behavior.oldMessageDisposal
      : behavior.oldMessageDisposal;

    try {
      if (disposal === 'delete') {
        await this.deleteOldMessage();
      } else if (disposal === 'replaceWithClosed') {
        const closePayload = {
          content: behavior.closedMessage,
          embeds: [],
          components: [],
        };
        if (this._activeMessageEphemeral) {
          await this.editEphemeralMessage(
            commandInteraction,
            closePayload,
          );
        } else {
          await this._activeMessage.edit(closePayload);
        }
        this._activeMessage = null;
      } else {
        // stripComponents
        const stripPayload = { components: [] };
        if (this._activeMessageEphemeral) {
          await this.editEphemeralMessage(
            commandInteraction,
            stripPayload,
          );
        } else {
          await this._activeMessage.edit(stripPayload);
        }
        this._activeMessage = null;
      }
    } catch {
      // Best-effort — message may have expired
      this._activeMessage = null;
    }

    this._lastComponentInteraction = null;
  }

  private buildDiscordPayload(
    payload: RenderPayload,
    mode: RenderMode,
  ): Record<string, unknown> {
    if (mode === 'layout' && payload.layoutComponents) {
      return {
        components: payload.layoutComponents,
        embeds: [],
        content: '',
        flags: MessageFlags.IsComponentsV2,
      };
    }

    return {
      embeds: payload.embeds ?? [],
      components: payload.components ?? [],
      content: payload.content ?? '',
    };
  }

  /**
   * Edit the current ephemeral message via the appropriate interaction token
   * endpoint. Ephemeral messages cannot be edited via Message.edit() (REST).
   *
   * - Original deferred reply → editReply() targets @original
   * - FollowUp message → PATCH webhookMessage(id) targets the specific message
   */
  private async editEphemeralMessage(
    commandInteraction: ChatInputCommandInteraction,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (this._activeMessageIsFollowUp && this._activeMessage) {
      await commandInteraction.client.rest.patch(
        Routes.webhookMessage(
          commandInteraction.applicationId,
          commandInteraction.token,
          this._activeMessage.id,
        ),
        { body: data },
      );
    } else {
      await commandInteraction.editReply(data);
    }
  }

  private async deleteOldMessage(): Promise<void> {
    if (!this._activeMessage) return;
    try {
      await this._activeMessage.delete();
    } catch {
      // Message may already be deleted
    }
    this._activeMessage = null;
    this._lastComponentInteraction = null;
  }

  // -----------------------------------------------------------------------
  // Embed action row building
  // -----------------------------------------------------------------------

  buildEmbedActionRows(
    menuInstance: MenuInstance,
    buttons: ButtonConfig[],
    reservedRow: ActionRowConfig | null,
    selectConfig?: SelectConfig | null,
  ): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] =
      [];

    // Build select menu row first (takes a full row)
    if (selectConfig) {
      const selectRow =
        new ActionRowBuilder<MessageActionRowComponentBuilder>();
      const selectId = selectConfig.id ?? '__select';
      const namespacedId = menuInstance.idManager.namespace(selectId);

      // Clone the builder and set the namespaced ID
      const selectBuilder = selectConfig.builder;
      // Set the namespaced custom ID on the builder directly
      selectBuilder.setCustomId(namespacedId);
      selectRow.addComponents(selectBuilder);
      rows.push(selectRow);
    }

    // Build content button rows (max 5 buttons per row)
    const contentButtons = buttons.filter(
      (b) => !b.id?.startsWith('__reserved'),
    );
    for (let i = 0; i < contentButtons.length; i += 5) {
      const chunk = contentButtons.slice(i, i + 5);
      const row =
        new ActionRowBuilder<MessageActionRowComponentBuilder>();
      for (let j = 0; j < chunk.length; j++) {
        const btn = chunk[j];
        row.addComponents(this.buildButtonBuilder(btn, menuInstance));
      }
      rows.push(row);
    }

    // Build reserved button row
    if (reservedRow) {
      const row =
        new ActionRowBuilder<MessageActionRowComponentBuilder>();
      for (const child of reservedRow.children) {
        if (child.type !== 'button') continue;
        const namespacedId = menuInstance.idManager.namespace(
          child.id ?? '__reserved',
        );
        const builder = new ButtonBuilder()
          .setCustomId(namespacedId)
          .setLabel(child.label)
          .setStyle(child.style)
          .setDisabled(child.disabled ?? false);
        row.addComponents(builder);
      }
      rows.push(row);
    }

    return rows;
  }

  private getMaxEmbedButtonsPerPage(
    menuInstance: MenuInstance,
    hasSelectMenu: boolean,
    ctx: MenuContext,
    forceReservedRow: boolean,
  ): number {
    const canGoBack = ctx.session.canGoBack;
    const hasReservedRow =
      forceReservedRow ||
      menuInstance.definition.isCancellable ||
      (menuInstance.definition.isReturnable && canGoBack);

    const reservedRows = hasReservedRow ? 1 : 0;
    const selectRows = hasSelectMenu ? 1 : 0;
    const availableButtonRows = Math.max(
      1,
      MenuRenderer.MAX_EMBED_COMPONENT_ROWS -
        reservedRows -
        selectRows,
    );

    return availableButtonRows * MenuRenderer.MAX_BUTTONS_PER_ROW;
  }

  // -----------------------------------------------------------------------
  // Layout serialization to Discord.js builders
  // -----------------------------------------------------------------------

  /**
   * Convert framework ComponentConfig[] to Discord.js top-level component builders.
   * These are used with the IsComponentsV2 message flag.
   */
  private serializeLayoutComponents(
    components: ComponentConfig[],
    menuInstance: MenuInstance,
  ): unknown[] {
    const result: unknown[] = [];

    for (const component of components) {
      const serialized = this.serializeComponent(
        component,
        menuInstance,
      );
      if (serialized) {
        result.push(serialized);
      }
    }

    return result;
  }

  private serializeComponent(
    component: ComponentConfig,
    menuInstance: MenuInstance,
  ): unknown {
    switch (component.type) {
      case 'text_display':
        return this.serializeTextDisplay(component);
      case 'section':
        return this.serializeSection(component, menuInstance);
      case 'container':
        return this.serializeContainer(component, menuInstance);
      case 'separator':
        return this.serializeSeparator(component);
      case 'thumbnail':
        return this.serializeThumbnail(component);
      case 'media_gallery':
        return this.serializeMediaGallery(component);
      case 'file':
        return this.serializeFile(component);
      case 'action_row':
        return this.serializeActionRow(component, menuInstance);
      default:
        return null;
    }
  }

  private serializeTextDisplay(
    config: TextDisplayConfig,
  ): TextDisplayBuilder {
    return new TextDisplayBuilder().setContent(config.content);
  }

  private serializeSection(
    config: SectionConfig,
    menuInstance: MenuInstance,
  ): SectionBuilder {
    const builder = new SectionBuilder();

    for (const textItem of config.text) {
      if (typeof textItem === 'string') {
        builder.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(textItem),
        );
      } else {
        builder.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(textItem.content),
        );
      }
    }

    if (config.accessory.type === 'thumbnail') {
      builder.setThumbnailAccessory(
        new ThumbnailBuilder().setURL(config.accessory.url),
      );
    } else if (config.accessory.type === 'button') {
      builder.setButtonAccessory(
        this.buildButtonBuilder(config.accessory, menuInstance),
      );
    }

    return builder;
  }

  private serializeContainer(
    config: ContainerConfig,
    menuInstance: MenuInstance,
  ): ContainerBuilder {
    const builder = new ContainerBuilder();

    if (config.accentColor !== undefined) {
      builder.setAccentColor(config.accentColor);
    }
    if (config.spoiler) {
      builder.setSpoiler(true);
    }

    for (const child of config.children) {
      this.addToContainer(builder, child, menuInstance);
    }

    return builder;
  }

  private serializeSeparator(
    config: SeparatorConfig,
  ): SeparatorBuilder {
    const builder = new SeparatorBuilder();
    if (config.divider !== undefined) {
      builder.setDivider(config.divider);
    }
    if (config.spacing) {
      builder.setSpacing(
        config.spacing === 'small'
          ? SeparatorSpacingSize.Small
          : SeparatorSpacingSize.Large,
      );
    }
    return builder;
  }

  private serializeThumbnail(
    config: ThumbnailConfig,
  ): ThumbnailBuilder {
    const builder = new ThumbnailBuilder().setURL(config.url);
    if (config.description) {
      builder.setDescription(config.description);
    }
    return builder;
  }

  private serializeMediaGallery(
    config: MediaGalleryConfig,
  ): MediaGalleryBuilder {
    const builder = new MediaGalleryBuilder();
    for (const item of config.items) {
      const itemBuilder = new MediaGalleryItemBuilder().setURL(
        item.url,
      );
      if (item.description) {
        itemBuilder.setDescription(item.description);
      }
      builder.addItems(itemBuilder);
    }
    return builder;
  }

  private serializeFile(config: FileConfig): FileBuilder {
    return new FileBuilder().setURL(config.url);
  }

  /**
   * Add a child component to a ContainerBuilder using the correct typed method.
   * ContainerBuilder requires specific add*Components methods per type.
   */
  private addToContainer(
    builder: ContainerBuilder,
    child: ComponentConfig,
    menuInstance: MenuInstance,
  ): void {
    switch (child.type) {
      case 'text_display':
        builder.addTextDisplayComponents(
          this.serializeTextDisplay(child),
        );
        break;
      case 'section':
        builder.addSectionComponents(
          this.serializeSection(child, menuInstance),
        );
        break;
      case 'separator':
        builder.addSeparatorComponents(
          this.serializeSeparator(child),
        );
        break;
      case 'media_gallery':
        builder.addMediaGalleryComponents(
          this.serializeMediaGallery(child),
        );
        break;
      case 'file':
        builder.addFileComponents(this.serializeFile(child));
        break;
      case 'action_row':
        builder.addActionRowComponents(
          this.serializeActionRow(child, menuInstance),
        );
        break;
      default:
        break;
    }
  }

  private serializeActionRow(
    config: ActionRowConfig,
    menuInstance: MenuInstance,
  ): ActionRowBuilder<MessageActionRowComponentBuilder> {
    const row =
      new ActionRowBuilder<MessageActionRowComponentBuilder>();

    for (const child of config.children) {
      if (child.type === 'button') {
        row.addComponents(
          this.buildButtonBuilder(child, menuInstance),
        );
      } else if (child.type === 'select') {
        const selectId = child.id ?? '__select';
        const namespacedId =
          menuInstance.idManager.namespace(selectId);
        child.builder.setCustomId(namespacedId);
        row.addComponents(child.builder);
      }
    }

    return row;
  }

  // -----------------------------------------------------------------------
  // Button builder helper
  // -----------------------------------------------------------------------

  /**
   * Build a Discord.js ButtonBuilder from a ButtonConfig.
   * Link buttons use setURL(), all others use setCustomId().
   */
  private buildButtonBuilder(
    btn: ButtonConfig,
    menuInstance: MenuInstance,
  ): ButtonBuilder {
    const builder = new ButtonBuilder()
      .setLabel(btn.label)
      .setStyle(btn.style)
      .setDisabled(btn.disabled ?? false);

    if (btn.style === ButtonStyle.Link) {
      if (!btn.url) {
        throw new Error(
          `[FlowCord] Link button is missing required "url" ` +
            `(id: ${btn.id ?? 'unknown'}, label: ${btn.label ?? 'unknown'})`,
        );
      }
      builder.setURL(btn.url);
    } else {
      const id = btn.id ?? `__btn_${menuInstance['_actionMap'].size}`;
      const namespacedId = menuInstance.idManager.namespace(id);
      builder.setCustomId(namespacedId);
    }

    if (btn.emoji) builder.setEmoji(btn.emoji);
    return builder;
  }

  // -----------------------------------------------------------------------
  // Paginated group expansion
  // -----------------------------------------------------------------------

  /**
   * Walk the component tree and expand PaginatedGroupConfig markers into
   * action rows for the current page.
   */
  private expandPaginatedGroups(
    components: ComponentConfig[],
    menuInstance: MenuInstance,
  ): ComponentConfig[] {
    const result: ComponentConfig[] = [];

    for (const component of components) {
      if (component.type === 'paginated_group') {
        const expanded = this.expandPaginatedGroup(
          component,
          menuInstance,
        );
        result.push(...expanded);
      } else if (component.type === 'container') {
        result.push({
          ...component,
          children: this.expandPaginatedGroups(
            component.children,
            menuInstance,
          ),
        });
      } else {
        result.push(component);
      }
    }

    return result;
  }

  private expandPaginatedGroup(
    group: PaginatedGroupConfig,
    menuInstance: MenuInstance,
  ): ActionRowConfig[] {
    const allButtons = group.buttons;
    const perPage = group.options?.perPage ?? 25;
    const totalPages = Math.max(
      1,
      Math.ceil(allButtons.length / perPage),
    );
    const currentPage =
      menuInstance.paginationState?.currentPage ?? 0;

    menuInstance.paginationState = {
      currentPage,
      totalPages,
      itemsPerPage: perPage,
      totalItems: allButtons.length,
      startIndex: currentPage * perPage,
      endIndex: Math.min(
        (currentPage + 1) * perPage,
        allButtons.length,
      ),
    };

    const pageButtons = allButtons.slice(
      menuInstance.paginationState.startIndex,
      menuInstance.paginationState.endIndex,
    );

    // Split into action rows (max 5 per row)
    const rows: ActionRowConfig[] = [];
    for (let i = 0; i < pageButtons.length; i += 5) {
      rows.push({
        type: 'action_row',
        children: pageButtons.slice(i, i + 5),
      });
    }

    return rows;
  }

  // -----------------------------------------------------------------------
  // Reserved buttons
  // -----------------------------------------------------------------------

  buildReservedButtonsOptions(
    menuInstance: MenuInstance,
    mode: RenderMode,
    ctx?: MenuContext,
  ): ReservedButtonsOptions {
    const paginationConfig =
      menuInstance.definition.listPagination ??
      menuInstance.definition.setButtonsOptions?.pagination;

    // Only show Back if the definition allows it AND there's somewhere to go
    const canGoBack = ctx?.session.canGoBack ?? true;

    return {
      showBack: menuInstance.definition.isReturnable && canGoBack,
      showCancel: menuInstance.definition.isCancellable,
      pagination: menuInstance.paginationState,
      stableButtons: paginationConfig?.stableButtons ?? true,
      mode,
      labels: paginationConfig?.labels
        ? {
            next: paginationConfig.labels.next,
            previous: paginationConfig.labels.previous,
          }
        : undefined,
    };
  }

  /**
   * Register actions for reserved buttons (back, cancel, next, previous).
   * These are handled by the session, but we need them in the action map
   * so the routing logic picks them up via the standard path.
   */
  private registerReservedActions(
    menuInstance: MenuInstance,
    ctx?: MenuContext,
  ): void {
    // Reserved buttons are handled directly by the session via their IDs.
    // We register placeholder actions so resolveAction returns non-undefined
    // for them (the session checks reserved IDs before calling the action).
    const canGoBack = ctx?.session.canGoBack ?? true;
    if (menuInstance.definition.isReturnable && canGoBack) {
      menuInstance.registerAction('__reserved_back', async () => {
        /* handled by session */
      });
    }
    if (menuInstance.definition.isCancellable) {
      menuInstance.registerAction('__reserved_cancel', async () => {
        /* handled by session */
      });
    }
    if (menuInstance.paginationState) {
      menuInstance.registerAction('__reserved_previous', async () => {
        /* handled by session */
      });
      menuInstance.registerAction('__reserved_next', async () => {
        /* handled by session */
      });
    }
  }
}

// -----------------------------------------------------------------------
// Internal types
// -----------------------------------------------------------------------

interface RenderPayload {
  mode: RenderMode;
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  content?: string;
  layoutComponents?: unknown[];
}
