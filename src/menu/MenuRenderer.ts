/**
 * MenuRenderer — Renders menus in either embeds or layout (Components v2) mode.
 *
 * Handles:
 * - Dual rendering modes (embeds vs layout/Components v2)
 * - Reserved button injection
 * - Component ID namespacing on output
 * - Pagination expansion (paginatedGroup → action rows)
 * - Normalization of Discord.js builders to plain API objects
 *
 * All I/O (message send/edit/update/disposal) is delegated to FlowCordAdapter.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  FileBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { MenuInstance } from './MenuInstance';
import type { MenuContext } from '../context/MenuContext';
import type {
  InteractionBehavior,
  ResolvedBehavior,
} from '../types/behavior';
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
import type { FlowCordAdapter } from '../adapter/FlowCordAdapter';
import type { NormalizedRenderPayload } from '../adapter/types';

export class MenuRenderer {
  private static readonly MAX_EMBED_COMPONENT_ROWS = 5;
  private static readonly MAX_BUTTONS_PER_ROW = 5;

  /**
   * Pending per-interaction behavior override. Set by the session after a
   * button/select/modal/message interaction, consumed by the next render cycle
   * via consumeInteractionBehavior(). After consumption it is cleared so
   * subsequent renders see no interaction override.
   */
  private _pendingInteractionBehavior:
    | InteractionBehavior
    | undefined = undefined;

  /**
   * Store the per-interaction behavior override from the triggering button,
   * select, message handler, or modal. Consumed once by the next render cycle.
   */
  setNextInteractionBehavior(
    behavior: InteractionBehavior | undefined,
  ): void {
    this._pendingInteractionBehavior = behavior;
  }

  /**
   * Consume and return the pending interaction behavior, clearing it so
   * subsequent renders see no override unless set again.
   */
  consumeInteractionBehavior(): InteractionBehavior | undefined {
    const b = this._pendingInteractionBehavior;
    this._pendingInteractionBehavior = undefined;
    return b;
  }

  /**
   * Called on navigation to strip display-level interaction behaviors
   * (ephemeral) from the pending state while preserving cleanup behaviors
   * (messageCleanup, ephemeralFallbackDisposal, closedMessage, deleteUserMessages).
   * Cleanup behaviors describe what happens to the departing menu's message and
   * must survive navigation to be applied when the destination menu renders.
   */
  clearDisplayBehaviors(): void {
    if (!this._pendingInteractionBehavior) return;
    const { ephemeral: _, ...rest } =
      this._pendingInteractionBehavior;
    this._pendingInteractionBehavior =
      Object.keys(rest).length > 0 ? rest : undefined;
  }

  // -----------------------------------------------------------------------
  // Main render pipeline
  // -----------------------------------------------------------------------

  /**
   * Execute a full render cycle for the current menu.
   * Calls definition setters, normalizes all builders to plain API objects,
   * and delegates sending to the FlowCordAdapter.
   */
  async render(
    menuInstance: MenuInstance,
    ctx: MenuContext,
    adapter: FlowCordAdapter,
    behavior: ResolvedBehavior,
  ): Promise<NormalizedRenderPayload> {
    const definition = menuInstance.definition;
    const newMode = definition.mode;

    // Clear and rebuild action registrations
    menuInstance.clearActions();

    let payload: NormalizedRenderPayload;

    if (newMode === 'embeds') {
      payload = await this.buildEmbedsRender(
        menuInstance,
        ctx,
        behavior,
      );
    } else {
      payload = await this.buildLayoutRender(
        menuInstance,
        ctx,
        behavior,
      );
    }

    await adapter.sendPayload(payload);
    return payload;
  }

  // -----------------------------------------------------------------------
  // Embed mode rendering
  // -----------------------------------------------------------------------

  private async buildEmbedsRender(
    menuInstance: MenuInstance,
    ctx: MenuContext,
    behavior: ResolvedBehavior,
  ): Promise<NormalizedRenderPayload> {
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
      embeds: embeds.map((e) => e.toJSON()),
      components: actionRows.map((r) => r.toJSON()),
      behavior: {
        messageCleanup: behavior.messageCleanup,
        ephemeral: behavior.ephemeral,
        ephemeralFallbackDisposal: behavior.ephemeralFallbackDisposal,
        closedMessage: behavior.closedMessage,
        deleteUserMessages: behavior.deleteUserMessages,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Layout mode rendering
  // -----------------------------------------------------------------------

  private async buildLayoutRender(
    menuInstance: MenuInstance,
    ctx: MenuContext,
    behavior: ResolvedBehavior,
  ): Promise<NormalizedRenderPayload> {
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

    // Serialize full layout tree to plain API objects
    const discordComponents = this.serializeLayoutComponents(
      components,
      menuInstance,
    );
    const layoutComponents = (
      discordComponents as Array<{ toJSON(): unknown }>
    ).map((component) => component.toJSON());

    // Pre-compute stripped layout (interactive elements removed) for postAndStrip disposal
    const strippedTree = this.stripLayoutInteractives(components);
    const strippedBuilders =
      strippedTree.length > 0
        ? this.serializeLayoutComponents(strippedTree, menuInstance)
        : [
            new TextDisplayBuilder().setContent(
              behavior.closedMessage,
            ),
          ];
    const strippedLayoutComponents = (
      strippedBuilders as Array<{ toJSON(): unknown }>
    ).map((builder) => builder.toJSON());

    return {
      mode: 'layout',
      layoutComponents:
        layoutComponents as NormalizedRenderPayload['layoutComponents'],
      strippedLayoutComponents:
        strippedLayoutComponents as NormalizedRenderPayload['strippedLayoutComponents'],
      behavior: {
        messageCleanup: behavior.messageCleanup,
        ephemeral: behavior.ephemeral,
        ephemeralFallbackDisposal: behavior.ephemeralFallbackDisposal,
        closedMessage: behavior.closedMessage,
        deleteUserMessages: behavior.deleteUserMessages,
      },
    };
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
      (btn) => !btn.id?.startsWith('__reserved'),
    );
    for (let idx = 0; idx < contentButtons.length; idx += 5) {
      const actionRowButtons = contentButtons.slice(idx, idx + 5);
      const row =
        new ActionRowBuilder<MessageActionRowComponentBuilder>();
      for (const button of actionRowButtons) {
        row.addComponents(
          this.buildButtonBuilder(button, menuInstance),
        );
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
  // Layout strip helper
  // -----------------------------------------------------------------------

  /**
   * Walk a layout component tree and strip interactive elements for the
   * stripComponents disposal payload:
   *
   * - action_row → removed (empty Discord v2 action rows are invalid)
   * - section with button accessory → button is disabled in place
   *   (removing it entirely would make the section invalid)
   * - section with thumbnail accessory → kept unchanged
   * - container → recursed; empty result containers are kept (they can have
   *   accent colors / spoiler that are still meaningful)
   * - everything else (text_display, separator, thumbnail, media_gallery,
   *   file) → kept unchanged
   */
  private stripLayoutInteractives(
    components: ComponentConfig[],
  ): ComponentConfig[] {
    const result: ComponentConfig[] = [];
    for (const component of components) {
      if (component.type === 'action_row') {
        // Remove action rows wholesale
        continue;
      } else if (component.type === 'section') {
        if (component.accessory.type === 'button') {
          result.push({
            ...component,
            accessory: { ...component.accessory, disabled: true },
          });
        } else {
          result.push(component);
        }
      } else if (component.type === 'container') {
        result.push({
          ...component,
          children: this.stripLayoutInteractives(component.children),
        });
      } else {
        result.push(component);
      }
    }
    return result;
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
