/**
 * MenuSession — One per user command invocation.
 *
 * Manages the interaction loop lifecycle, state, navigation stack,
 * and delegates rendering/lifecycle to appropriate managers.
 */
import { randomUUID } from 'node:crypto';

import {
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';

import { DiscordAdapter } from '../adapter/DiscordAdapter';
import type { FlowCordAdapter } from '../adapter/FlowCordAdapter';
import type {
  NormalizedComponentInteraction,
  NormalizedTerminalPayload,
} from '../adapter/types';
import { EventLog, type SessionEvent } from '../tracing/EventLog';
import type { HookName, MenuHooks } from '../lifecycle/hooks';
import type {
  MenuContext,
  MenuSessionLike,
  SubMenuOptions,
} from '../context/MenuContext';
import type { Action } from '../types/common';
import { GuardFailedError } from '../action/pipeline';
import { StateStore } from '../state/StateStore';
import { MenuStack } from '../state/MenuStack';
import type { MenuStackEntry } from '../state/MenuStack';
import { MenuInstance } from '../menu/MenuInstance';
import { MenuRenderer } from '../menu/MenuRenderer';
import { LifecycleManager } from '../lifecycle/LifecycleManager';
import { ComponentIdManager } from '../components/ComponentIdManager';
import type { MenuDefinition } from '../registry/MenuRegistry';
import {
  resolveBehavior,
  type BehaviorPolicy,
  type InteractionBehavior,
} from '../types/behavior';
import type {
  HandleInteractionOptions,
  MenuEngine,
} from './MenuEngine';

/**
 * Returns true if a factory function is declared async.
 * Used to decide whether deferReply can wait for the factory result
 * (sync) or must fire immediately with a caller-provided ephemeral flag
 * (async, to stay within Discord's 3-second acknowledgement window).
 */
function isAsyncFactory(fn: unknown): boolean {
  return (
    typeof fn === 'function' &&
    fn.constructor.name === 'AsyncFunction'
  );
}

/** Continuation registered by openSubMenu — fired when the sub-menu calls goBack. */
interface Continuation {
  menuName: string;
  onComplete: (ctx: MenuContext, result?: unknown) => Promise<void>;
}

export class MenuSession implements MenuSessionLike {
  readonly id: string;
  readonly sessionState: StateStore;

  private readonly _engine: MenuEngine;
  private readonly _commandInteraction: ChatInputCommandInteraction;
  private readonly _adapter: FlowCordAdapter;
  private readonly _stack: MenuStack;
  private readonly _renderer: MenuRenderer;
  private readonly _lifecycleManager: LifecycleManager;

  private _currentMenu: MenuInstance | null = null;
  private _isCancelled = false;
  private _isCompleted = false;

  private get _isDone(): boolean {
    return this._isCancelled || this._isCompleted;
  }
  private _sessionBehavior: BehaviorPolicy | undefined = undefined;
  private readonly _eventLog: EventLog | undefined;

  /**
   * Tracks whether navigation happened during the current action.
   * When true the main loop skips auto-refresh and jumps straight
   * to the new menu's enter → render cycle.
   */
  private _didNavigate = false;

  /**
   * Tracks whether the current action requested a hard refresh.
   * When true the main loop re-runs the menu factory before rendering.
   */
  private _didHardRefresh = false;

  /** Pending continuations for sub-menu completion. */
  private readonly _continuations: Continuation[] = [];

  /** Result stored by ctx.complete() for sub-menu return. */
  private _completionResult: unknown = undefined;

  /** Whether the current sub-menu returned via ctx.complete() vs a plain goBack(). */
  private _didComplete = false;

  /** Options that were used to create the current menu (kept for hardRefresh). */
  private _currentOptions: Record<string, unknown> | undefined;

  /** The most recent interaction (updated on every component/modal interaction). */
  private _latestInteraction: Interaction;

  constructor(
    engine: MenuEngine,
    interaction: ChatInputCommandInteraction,
    adapter?: FlowCordAdapter,
    eventLog?: EventLog,
  ) {
    this.id = randomUUID().slice(0, 12);
    this.sessionState = new StateStore();
    this._engine = engine;
    this._commandInteraction = interaction;
    this._adapter = adapter ?? new DiscordAdapter(interaction);
    this._stack = new MenuStack();
    this._renderer = new MenuRenderer();
    this._lifecycleManager = new LifecycleManager();
    this._latestInteraction = interaction;
    this._eventLog = eventLog;

    // Apply global hooks from the engine's HookRegistry
    engine.hookRegistry.applyTo(this._lifecycleManager);
  }

  get client(): Client<true> {
    return this._commandInteraction.client;
  }

  get currentMenu(): MenuInstance | null {
    return this._currentMenu;
  }

  get isCancelled(): boolean {
    return this._isCancelled;
  }

  get isCompleted(): boolean {
    return this._isCompleted;
  }

  /** Whether goBack() has somewhere to go (stack or fallback menu). */
  get canGoBack(): boolean {
    return (
      !this._stack.isEmpty ||
      !!this._currentMenu?.definition.fallbackMenu
    );
  }

  // -----------------------------------------------------------------------
  // Public lifecycle API
  // -----------------------------------------------------------------------

  /**
   * Initialize the session: defer reply, create initial menu, enter main loop.
   *
   * For sync factory functions, the factory is run first so that
   * `setEphemeral()` on the MenuBuilder is respected without any extra params.
   * For async factory functions, `ephemeral` must be passed explicitly since
   * we must defer before awaiting the factory to stay within Discord's 3-second
   * acknowledgement window.
   */
  async initialize(
    menuName: string,
    options?: Record<string, unknown>,
    interactionOptions?: HandleInteractionOptions,
  ): Promise<void> {
    this._sessionBehavior = interactionOptions?.behavior;

    const factory = this._engine.menuRegistry.getFactory(menuName);
    if (!factory) {
      throw new Error(`Menu "${menuName}" is not registered.`);
    }

    if (isAsyncFactory(factory)) {
      // Async factory: defer immediately before any user code runs.
      // Resolve ephemeral from the hierarchy using entryEphemeral at the
      // explicit level (same priority as setEphemeral on the builder), since
      // we cannot read the definition before deferring.
      const entryBehavior =
        interactionOptions?.entryEphemeral === undefined
          ? undefined
          : {
              explicit: {
                ephemeral: interactionOptions.entryEphemeral,
              },
            };

      const behavior = resolveBehavior(
        entryBehavior,
        this._sessionBehavior,
        this._engine.globalBehavior,
      );
      await this._adapter.deferReply({
        ephemeral: behavior.ephemeral,
      });
      await this.navigateTo(menuName, options);
    } else {
      // Sync factory: run it first so setEphemeral() on the builder is read,
      // then resolve the full hierarchy before deferring.
      const definition = factory(this, options) as MenuDefinition;
      if (
        definition !== null &&
        typeof (definition as unknown as Record<string, unknown>)
          .then === 'function'
      ) {
        throw new Error(
          `Menu factory for "${menuName}" returned a Promise but is not declared async. ` +
            `Use an async function: async (session, options) => new MenuBuilder(...).build()`,
        );
      }
      const behavior = resolveBehavior(
        definition.behavior,
        this._sessionBehavior,
        this._engine.globalBehavior,
      );
      await this._adapter.deferReply({
        ephemeral: behavior.ephemeral,
      });
      // Replicate the initial navigateTo steps (no previous menu to leave)
      this._currentOptions = options;
      const instance = new MenuInstance(definition, this.id);
      this._currentMenu = instance;
      if (definition.setup) {
        const ctx = this.buildContext(instance);
        await definition.setup(ctx);
      }
      const ctx = this.buildContext(instance);
      await this._emitHook('onEnter', ctx, definition.hooks);
      this._didNavigate = true;
    }

    await this.processMenus();

    // Clean up after loop exits
    this._engine.removeSession(this.id);
  }

  /**
   * Navigate to a registered menu.
   */
  async navigateTo(
    menuId: string,
    options?: Record<string, unknown>,
  ): Promise<void> {
    const previousMenuId = this._currentMenu?.name ?? null;
    const factory = this._engine.menuRegistry.getFactory(menuId);
    if (!factory) {
      throw new Error(`Menu "${menuId}" is not registered.`);
    }

    // If we have a current menu that's tracked, push it to history
    if (this._currentMenu?.definition.isTrackedInHistory) {
      const entry: MenuStackEntry = {
        menuId: this._currentMenu.name,
        options: this._currentOptions,
      };

      // Snapshot state + pagination for menus that preserve state on return
      if (this._currentMenu.definition.preserveStateOnReturn) {
        entry.stateSnapshot = structuredClone(
          this._currentMenu.stateAccessor.current,
        );
        entry.paginationSnapshot = this._currentMenu.paginationState
          ? { ...this._currentMenu.paginationState }
          : null;
      }

      this._stack.push(entry);
    }

    // Fire onLeave on current menu
    if (this._currentMenu) {
      const ctx = this.buildContext(this._currentMenu);
      await this._emitHook(
        'onLeave',
        ctx,
        this._currentMenu.definition.hooks,
      );
    }

    // Trace navigation
    if (this._engine.tracer && this._currentMenu) {
      this._engine.tracer.record({
        from: this._currentMenu.name,
        to: menuId,
        sessionId: this.id,
        userId: this._commandInteraction.user.id,
        timestamp: Date.now(),
      });
    }

    // Create new menu
    this._currentOptions = options;
    const definition = await factory(this, options);
    const instance = new MenuInstance(definition, this.id);
    this._currentMenu = instance;

    // Run setup if defined
    if (definition.setup) {
      const ctx = this.buildContext(instance);
      await definition.setup(ctx);
    }

    // Fire onEnter
    const ctx = this.buildContext(instance);
    await this._emitHook('onEnter', ctx, definition.hooks);

    this._emitEvent({
      kind: 'navigation',
      from: previousMenuId,
      to: menuId,
      timestamp: Date.now(),
    });
    this._didNavigate = true;
  }

  /**
   * Go back to the previous menu on the stack.
   */
  async goBack(result?: unknown): Promise<void> {
    const previousMenuId = this._currentMenu?.name ?? null;
    const entry = this._stack.pop();
    if (!entry) {
      // Navigate to fallback WITHOUT pushing current menu to stack
      // (prevents circular navigation when the menu was opened directly)
      const fallbackMenu = this._currentMenu?.definition.fallbackMenu;
      if (fallbackMenu) {
        await this._activateFallbackMenu(
          fallbackMenu,
          this._currentMenu?.definition.fallbackMenuOptions,
        );
        return;
      }

      await this.close();
      return;
    }

    const completedMenuName = this._currentMenu?.name;

    // Fire onLeave on current
    if (this._currentMenu) {
      const ctx = this.buildContext(this._currentMenu);
      await this._emitHook(
        'onLeave',
        ctx,
        this._currentMenu.definition.hooks,
      );
    }

    // Recreate the previous menu
    const factory = this._engine.menuRegistry.getFactory(
      entry.menuId,
    );
    if (!factory) {
      throw new Error(
        `Menu "${entry.menuId}" is not registered (cannot go back).`,
      );
    }

    this._currentOptions = entry.options;
    const definition = await factory(this, entry.options);
    const instance = new MenuInstance(definition, this.id);
    this._currentMenu = instance;

    // Restore snapshotted state or run setup
    if (entry.stateSnapshot) {
      instance.stateAccessor.reset(entry.stateSnapshot);
      if (entry.paginationSnapshot) {
        instance.paginationState = { ...entry.paginationSnapshot };
      }
      // Skip setup — state is already initialized from snapshot
    } else if (definition.setup) {
      const ctx = this.buildContext(instance);
      await definition.setup(ctx);
    }

    // Fire onEnter
    const ctx = this.buildContext(instance);
    await this._emitHook('onEnter', ctx, definition.hooks);

    this._emitEvent({
      kind: 'navigation',
      from: previousMenuId,
      to: entry.menuId,
      timestamp: Date.now(),
    });

    // Execute continuations from sub-menu completion
    if (completedMenuName) {
      await this.executeContinuations(completedMenuName, result, ctx);
    }

    this._didNavigate = true;
  }

  /**
   * Navigate to a fallback menu without pushing the current menu onto the
   * history stack — prevents circular navigation when a menu was opened
   * directly rather than navigated to from a parent.
   */
  private async _activateFallbackMenu(
    fallbackMenu: string,
    fallbackMenuOptions?: Record<string, unknown>,
  ): Promise<void> {
    const previousMenuId = this._currentMenu?.name ?? null;
    const factory =
      this._engine.menuRegistry.getFactory(fallbackMenu);
    if (!factory) {
      throw new Error(
        `Fallback menu "${fallbackMenu}" is not registered.`,
      );
    }

    if (this._currentMenu) {
      const ctx = this.buildContext(this._currentMenu);
      await this._emitHook(
        'onLeave',
        ctx,
        this._currentMenu.definition.hooks,
      );
    }

    this._currentOptions = fallbackMenuOptions;
    const definition = await factory(this, fallbackMenuOptions);
    const instance = new MenuInstance(definition, this.id);
    this._currentMenu = instance;

    if (definition.setup) {
      const ctx = this.buildContext(instance);
      await definition.setup(ctx);
    }

    const ctx = this.buildContext(instance);
    await this._emitHook('onEnter', ctx, definition.hooks);

    this._emitEvent({
      kind: 'navigation',
      from: previousMenuId,
      to: fallbackMenu,
      timestamp: Date.now(),
    });
    this._didNavigate = true;
  }

  /**
   * End the session.
   */
  async close(): Promise<void> {
    if (this._currentMenu) {
      const ctx = this.buildContext(this._currentMenu);
      await this._emitHook(
        'onLeave',
        ctx,
        this._currentMenu.definition.hooks,
      );
    }
    const closeBehavior = resolveBehavior(
      this._currentMenu?.definition.behavior,
      this._sessionBehavior,
      this._engine.globalBehavior,
    );
    const closePayload: NormalizedTerminalPayload = {
      reason: 'closed',
      content: closeBehavior.closedMessage,
      mode: this._adapter.activeMessageMode ?? 'embeds',
    };
    await this._adapter.sendTerminalPayload(closePayload);
    this._emitEvent({
      kind: 'session:end',
      reason: 'closed',
      payload: closePayload,
      timestamp: Date.now(),
    });
    this._isCompleted = true;
  }

  /**
   * Cancel the session.
   */
  async cancel(): Promise<void> {
    if (this._currentMenu) {
      const ctx = this.buildContext(this._currentMenu);
      await this._emitHook(
        'onCancel',
        ctx,
        this._currentMenu.definition.hooks,
      );
      await this._emitHook(
        'onLeave',
        ctx,
        this._currentMenu.definition.hooks,
      );
    }
    const cancelBehavior = resolveBehavior(
      this._currentMenu?.definition.behavior,
      this._sessionBehavior,
      this._engine.globalBehavior,
    );
    const cancelPayload: NormalizedTerminalPayload = {
      reason: 'cancelled',
      content: cancelBehavior.closedMessage,
      mode: this._adapter.activeMessageMode ?? 'embeds',
    };
    await this._adapter.sendTerminalPayload(cancelPayload);
    this._emitEvent({
      kind: 'session:end',
      reason: 'cancelled',
      payload: cancelPayload,
      timestamp: Date.now(),
    });
    this._isCancelled = true;
  }

  /**
   * Hard refresh — re-run the menu factory from scratch.
   */
  async hardRefresh(): Promise<void> {
    if (!this._currentMenu) return;
    const menuId = this._currentMenu.name;
    const factory = this._engine.menuRegistry.getFactory(menuId);
    if (!factory) return;

    const definition = await factory(this, this._currentOptions);
    const instance = new MenuInstance(definition, this.id);
    this._currentMenu = instance;

    // Run setup
    if (definition.setup) {
      const ctx = this.buildContext(instance);
      await definition.setup(ctx);
    }

    this._didHardRefresh = true;
  }

  /**
   * Open a sub-menu with an onComplete continuation.
   */
  async openSubMenu(
    menuId: string,
    opts: SubMenuOptions,
  ): Promise<void> {
    // Extract options (everything except onComplete)
    // Register continuation before navigating

    const { onComplete, ...navOptions } = opts;
    this._continuations.push({
      menuName: menuId,
      onComplete: onComplete as (
        ctx: MenuContext,
        result?: unknown,
      ) => Promise<void>,
    });

    await this.navigateTo(menuId, navOptions);
  }

  /**
   * Mark the current sub-menu as complete with a result.
   * Immediately returns to the parent menu and passes the result to onComplete.
   */
  async complete(result?: unknown): Promise<void> {
    this._completionResult = result;
    this._didComplete = true;

    if (this.canGoBack) {
      await this.goBack(result);
    }
  }

  /**
   * Route an externally-received component interaction to this session.
   * Called by MenuEngine when a component interaction arrives whose
   * customId parses to this session.
   */
  handleExternalInteraction(
    _interaction: MessageComponentInteraction,
  ): void {
    // This is used by the engine for routing — the actual processing
    // happens in the main loop via awaitMessageComponent.
    // For now, external routing defers to the collector pattern.
    // The engine will call this when it intercepts interactions
    // that match this session's ID.
    return;
  }

  // -----------------------------------------------------------------------
  // Event logging helpers
  // -----------------------------------------------------------------------

  private _emitEvent(event: SessionEvent): void {
    this._eventLog?.record(event);
  }

  private async _emitHook(
    name: HookName,
    ctx: MenuContext,
    menuHooks?: MenuHooks,
  ): Promise<void> {
    await this._lifecycleManager.emit(name, ctx, menuHooks);
    this._emitEvent({
      kind: 'hook',
      menuId: ctx.menu.name,
      hookName: name,
      timestamp: Date.now(),
    });
  }

  private async _timeout(): Promise<void> {
    const timeoutBehavior = resolveBehavior(
      this._currentMenu?.definition.behavior,
      this._sessionBehavior,
      this._engine.globalBehavior,
    );
    const timeoutPayload: NormalizedTerminalPayload = {
      reason: 'timeout',
      content: timeoutBehavior.timeoutMessage,
      mode: this._adapter.activeMessageMode ?? 'embeds',
    };
    await this._adapter.sendTerminalPayload(timeoutPayload);
    this._emitEvent({
      kind: 'session:end',
      reason: 'timeout',
      payload: timeoutPayload,
      timestamp: Date.now(),
    });
    this._isCompleted = true;
  }

  // -----------------------------------------------------------------------
  // Main interaction loop
  // -----------------------------------------------------------------------

  /**
   * The core event loop. Processes menus until the session ends.
   *
   * Flow per iteration:
   * 1. beforeRender hook
   * 2. Run definition setters (embeds/buttons/layout) + build payload
   * 3. Send or update the Discord message
   * 4. afterRender hook
   * 5. Await interaction (component / message / modal race)
   * 6. Dispatch: reserved button → session method, custom → action callback
   * 7. onAction hook (for custom actions)
   * 8. If navigated → loop continues with new menu's enter+render
   * 9. If not navigated → auto-refresh (re-run setters, update message)
   */
  private async processMenus(): Promise<void> {
    const timeout = this._engine.timeout;

    while (!this._isDone) {
      if (!this._currentMenu) break;

      // Reset navigation flags
      this._didNavigate = false;
      this._didHardRefresh = false;

      // --- Pending modal (action triggered openModal in previous iteration) ---
      const modalDirective = await this._handlePendingModal(timeout);
      if (modalDirective === 'break') break;
      if (modalDirective === 'continue') continue;

      // --- Render cycle ---
      // Behavior is resolved inside renderCurrentMenu, incorporating any
      // pending interaction-level overrides set by the previous interaction.
      await this.renderCurrentMenu();

      // Check if the session ended during rendering (e.g., onEnter navigated away)
      if (this._isDone) break;
      if (this._didNavigate) continue; // Navigation happened during hooks

      // --- Await interaction ---
      await this._awaitInteractionByType(timeout);

      // Check exit conditions after interaction
      if (this._isDone) break;
      if (this._didNavigate) {
        // Strip display-level behaviors (ephemeral) from pending state —
        // they belong to the source menu. Cleanup behaviors are preserved
        // so the departing menu's cleanup applies when the destination renders.
        this._renderer.clearDisplayBehaviors();
      }
    }
  }

  private async _awaitInteractionByType(
    timeout: number,
  ): Promise<void> {
    const responseType = this._currentMenu?.getResponseType();
    if (responseType === 'message') {
      await this.awaitMessageReply(timeout);
    } else if (responseType === 'mixed') {
      await this.awaitMixedInteraction(timeout);
    } else {
      await this.awaitComponentInteraction(timeout);
    }
  }

  /**
   * Handles a pending modal submission from the previous iteration.
   * Returns 'break' when the loop should exit, 'continue' when it should
   * skip to the next iteration, and 'next' when no modal was pending.
   *
   * The interaction that triggered the modal already called showModal(), so
   * rendering is skipped and we go straight to awaiting the modal submit.
   */
  private async _handlePendingModal(
    timeout: number,
  ): Promise<'break' | 'continue' | 'next'> {
    if (
      !this._currentMenu?.isModalActive ||
      !this._currentMenu.activeModal
    ) {
      return 'next';
    }

    const outcome = await this.awaitModalInteraction(timeout);
    if (this._isDone) return 'break';
    if (this._didNavigate) {
      // Strip display-level behaviors (ephemeral) from pending state —
      // they belong to the source menu. Cleanup behaviors are preserved
      // so the departing menu's cleanup applies when the destination renders.
      this._renderer.clearDisplayBehaviors();
      return 'continue';
    }
    if (outcome === 'timeout') return 'break';
    return 'continue'; // Re-render after modal outcome
  }

  /**
   * Execute a full render cycle for the current menu.
   * Resolves behavior here so it can incorporate any pending interaction-level
   * overrides that were stored by the previous interaction dispatch.
   */
  private async renderCurrentMenu(): Promise<void> {
    if (!this._currentMenu) return;

    // Consume interaction behavior set by the previous interaction.
    // Cleared after consumption so it doesn't bleed into future renders.
    // Cleanup fields (messageCleanup etc.) come from the departing menu's resolved
    // state and are already encoded in interactionBehavior at interactionExplicit level.
    const interactionBehavior =
      this._renderer.consumeInteractionBehavior();

    const behavior = resolveBehavior(
      this._currentMenu.definition.behavior,
      this._sessionBehavior,
      this._engine.globalBehavior,
      interactionBehavior,
    );

    const ctx = this.buildContext(this._currentMenu);

    // beforeRender hook
    await this._emitHook(
      'beforeRender',
      ctx,
      this._currentMenu.definition.hooks,
    );

    // Delegate to renderer (calls setters, builds payload, sends message)
    const renderPayload = await this._renderer.render(
      this._currentMenu,
      ctx,
      this._adapter,
      behavior,
    );
    this._emitEvent({
      kind: 'render',
      menuId: this._currentMenu.name,
      payload: renderPayload,
      timestamp: Date.now(),
    });

    // afterRender hook
    await this._emitHook(
      'afterRender',
      ctx,
      this._currentMenu.definition.hooks,
    );
  }

  // -----------------------------------------------------------------------
  // Interaction collection
  // -----------------------------------------------------------------------

  /**
   * Await a component interaction (button or select menu click).
   */
  private async awaitComponentInteraction(
    timeout: number,
  ): Promise<void> {
    if (!this._adapter.activeMessageMode) return;

    try {
      const normalized = await this._adapter.awaitComponent({
        userId: this._commandInteraction.user.id,
        timeout,
      });
      await this.handleComponentInteraction(normalized.raw);
    } catch (error) {
      // awaitMessageComponent rejects on timeout with a specific collector error.
      // Re-throw real errors so they aren't silently swallowed.
      const isTimeout =
        error instanceof Error &&
        (error.message.includes('time') ||
          error.message.includes('Collector'));
      if (isTimeout) {
        await this._timeout();
      } else {
        throw error;
      }
    }
  }

  /**
   * Await a text message reply.
   */
  private async awaitMessageReply(timeout: number): Promise<void> {
    try {
      const normalizedMsg = await this._adapter.awaitMessage({
        userId: this._commandInteraction.user.id,
        timeout,
      });
      await this._processMessageResult(normalizedMsg);
    } catch {
      await this._timeout();
    }
  }

  /**
   * Await either a component interaction or a message reply (mixed mode).
   * Races both collectors via the adapter — first to resolve wins.
   */
  private async awaitMixedInteraction(
    timeout: number,
  ): Promise<void> {
    if (!this._adapter.activeMessageMode) return;

    const userId = this._commandInteraction.user.id;

    const result = await Promise.race([
      this._adapter
        .awaitComponent({ userId, timeout })
        .then((i) => ({ type: 'component' as const, normalized: i })),
      this._adapter.awaitMessage({ userId, timeout }).then((msg) => ({
        type: 'message' as const,
        normalizedMsg: msg,
      })),
    ]).catch(() => null);

    if (!result) {
      await this._timeout();
      return;
    }

    if (result.type === 'component') {
      await this.handleComponentInteraction(result.normalized.raw);
    } else if (result.type === 'message') {
      await this._processMessageResult(result.normalizedMsg);
    }
  }

  /**
   * Shared message-result handler: resolves departing behavior, optionally
   * deletes the user message, forwards cleanup to the next render cycle,
   * and dispatches to the menu's handleMessage handler.
   */
  private async _processMessageResult(
    normalizedMsg: Awaited<
      ReturnType<FlowCordAdapter['awaitMessage']>
    >,
  ): Promise<void> {
    if (!this._currentMenu) return;
    const menu = this._currentMenu;

    // The 'postAndStrip' default sits below menuExplicit, so an explicit
    // setMessageCleanup() on the menu still wins.
    const departingBehavior = resolveBehavior(
      menu.definition.behavior,
      this._sessionBehavior,
      this._engine.globalBehavior,
      menu.definition.messageHandlerBehavior,
      {
        messageCleanup: 'postAndStrip',
      } satisfies InteractionBehavior,
    );

    if (departingBehavior.deleteUserMessages) {
      await normalizedMsg.delete();
    }

    // deleteUserMessages has already been actioned; no need to persist it.
    this._renderer.setNextInteractionBehavior({
      messageCleanup: departingBehavior.messageCleanup,
      ephemeralFallbackDisposal:
        departingBehavior.ephemeralFallbackDisposal,
      closedMessage: departingBehavior.closedMessage,
    });

    const ctx = this.buildContext(menu);
    if (menu.definition.handleMessage) {
      await menu.definition.handleMessage(ctx, normalizedMsg.content);
    }
  }

  /**
   * Await a modal interaction — races modal submit against component/message
   * interactions (user might dismiss the modal and click a button instead).
   */
  private async awaitModalInteraction(
    timeout: number,
  ): Promise<'modal' | 'component' | 'message' | 'timeout'> {
    if (!this._currentMenu) return 'timeout';

    const userId = this._commandInteraction.user.id;
    const responseType = this._currentMenu.getResponseType();

    // Build the race contestants. Modal is always included.
    const racers: Promise<{
      type: 'modal' | 'component' | 'message';
      raw?: ModalSubmitInteraction;
      normalized?: NormalizedComponentInteraction;
      normalizedMsg?: Awaited<
        ReturnType<FlowCordAdapter['awaitMessage']>
      >;
    }>[] = [
      this._adapter
        .awaitModal({ userId, timeout })
        .then((sub) => ({ type: 'modal' as const, raw: sub.raw })),
    ];

    if (
      this._adapter.activeMessageMode &&
      (responseType === 'component' || responseType === 'mixed')
    ) {
      racers.push(
        this._adapter
          .awaitComponent({ userId, timeout })
          .then((interaction) => ({
            type: 'component' as const,
            normalized: interaction,
          })),
      );
    }

    if (responseType === 'message' || responseType === 'mixed') {
      racers.push(
        this._adapter
          .awaitMessage({ userId, timeout })
          .then((msg) => ({
            type: 'message' as const,
            normalizedMsg: msg,
          })),
      );
    }

    const result = await Promise.race(racers).catch(() => null);

    // Clear modal state
    if (this._currentMenu) {
      this._currentMenu.isModalActive = false;
    }

    if (!result) return 'timeout';

    if (result.type === 'modal' && result.raw) {
      await this.handleModalSubmit(result.raw);
      return 'modal';
    } else if (result.type === 'component' && result.normalized) {
      await this.handleComponentInteraction(result.normalized.raw);
      return 'component';
    } else if (result.type === 'message' && result.normalizedMsg) {
      await this._processMessageResult(result.normalizedMsg);
      return 'message';
    }

    return 'timeout';
  }

  // -----------------------------------------------------------------------
  // Interaction dispatch
  // -----------------------------------------------------------------------

  /**
   * Handle a component interaction (button click or select menu).
   * Parses the namespaced customId, checks for reserved buttons,
   * then dispatches to the action registered in the menu instance.
   */
  private async handleComponentInteraction(
    interaction: MessageComponentInteraction,
  ): Promise<void> {
    if (!this._currentMenu) return;

    // Track the latest interaction so ctx.interaction stays current
    this._latestInteraction = interaction as Interaction;

    const parsed = ComponentIdManager.parse(interaction.customId);
    if (!parsed) return;

    const componentId = parsed.componentId;

    // Determine if this button is a declarative modal trigger (opensModal).
    // Modal triggers must NOT be deferred — showModal() requires a raw interaction.
    // All other component interactions are auto-deferred so consumer actions
    // never need to worry about Discord's 3-second acknowledgement deadline.
    const isModalButton =
      this._currentMenu.isModalButton(componentId);

    if (
      !isModalButton &&
      !interaction.deferred &&
      !interaction.replied
    ) {
      await interaction.deferUpdate();
      // Adapter's sendPayload checks interaction.deferred before calling .update(),
      // so no explicit clear needed — it falls through to message.edit().
    }

    // --- Reserved button handling ---
    if (componentId === '__reserved_back') {
      // Resolve and store the departing menu's cleanup behaviors so they are
      // applied when the destination menu renders (same as custom button dispatch).
      const backDepartingBehavior = resolveBehavior(
        this._currentMenu.definition.behavior,
        this._sessionBehavior,
        this._engine.globalBehavior,
      );
      this._renderer.setNextInteractionBehavior({
        messageCleanup: backDepartingBehavior.messageCleanup,
        ephemeralFallbackDisposal:
          backDepartingBehavior.ephemeralFallbackDisposal,
        closedMessage: backDepartingBehavior.closedMessage,
        deleteUserMessages: backDepartingBehavior.deleteUserMessages,
      });
      await this.goBack(this._completionResult);
      this._completionResult = undefined;
      return;
    }

    if (componentId === '__reserved_cancel') {
      await this.cancel();
      return;
    }

    if (componentId === '__reserved_next') {
      await this.handlePaginationNext();
      return;
    }

    if (componentId === '__reserved_previous') {
      await this.handlePaginationPrevious();
      return;
    }

    // --- Select menu handling ---
    if (interaction.isAnySelectMenu()) {
      await this._handleSelectInteraction(interaction, componentId);
      return;
    }

    // --- Custom action dispatch (buttons) ---
    const action = this._currentMenu.resolveAction(componentId);
    if (!action) return;

    // Resolve departing cleanup from the current menu's perspective,
    // then forward display behaviors (ephemeral) raw and cleanup behaviors resolved.
    const buttonConfig =
      this._currentMenu.getButtonConfig(componentId);
    const buttonInteractionConfig = buttonConfig?.behavior;
    const buttonDepartingBehavior = resolveBehavior(
      this._currentMenu.definition.behavior,
      this._sessionBehavior,
      this._engine.globalBehavior,
      buttonInteractionConfig,
    );
    this._renderer.setNextInteractionBehavior({
      ephemeral: buttonInteractionConfig?.ephemeral,
      messageCleanup: buttonDepartingBehavior.messageCleanup,
      ephemeralFallbackDisposal:
        buttonDepartingBehavior.ephemeralFallbackDisposal,
      closedMessage: buttonDepartingBehavior.closedMessage,
      deleteUserMessages: buttonDepartingBehavior.deleteUserMessages,
    });

    const ctx = this.buildContext(this._currentMenu);

    // onAction hook fires before the action itself
    await this._emitHook(
      'onAction',
      ctx,
      this._currentMenu.definition.hooks,
    );
    this._emitEvent({
      kind: 'action',
      menuId: this._currentMenu.name,
      componentId,
      timestamp: Date.now(),
    });

    if (isModalButton) {
      await this._handleModalTrigger(interaction, componentId);
      return;
    }

    await this.executeAction(action, ctx);
    await this._showLegacyModal(interaction, componentId);
  }

  /**
   * Dispatch a select-menu interaction: resolves departing behavior, fires
   * onAction, and calls the registered onSelect handler.
   */
  private async _handleSelectInteraction(
    interaction: MessageComponentInteraction,
    componentId: string,
  ): Promise<void> {
    if (!this._currentMenu) return;

    const onSelect =
      this._currentMenu.resolveSelectAction(componentId) ??
      this._currentMenu.activeSelect?.onSelect;
    if (!onSelect) return;

    // Resolve departing cleanup from the current menu's perspective,
    // then forward display behaviors (ephemeral) raw and cleanup behaviors resolved.
    const selectConfig =
      this._currentMenu.getSelectConfig(componentId) ??
      this._currentMenu.activeSelect ??
      undefined;
    const selectInteractionConfig = selectConfig?.behavior;
    const selectDepartingBehavior = resolveBehavior(
      this._currentMenu.definition.behavior,
      this._sessionBehavior,
      this._engine.globalBehavior,
      selectInteractionConfig,
    );
    this._renderer.setNextInteractionBehavior({
      ephemeral: selectInteractionConfig?.ephemeral,
      messageCleanup: selectDepartingBehavior.messageCleanup,
      ephemeralFallbackDisposal:
        selectDepartingBehavior.ephemeralFallbackDisposal,
      closedMessage: selectDepartingBehavior.closedMessage,
      deleteUserMessages: selectDepartingBehavior.deleteUserMessages,
    });

    const ctx = this.buildContext(this._currentMenu);
    await this._emitHook(
      'onAction',
      ctx,
      this._currentMenu.definition.hooks,
    );
    this._emitEvent({
      kind: 'action',
      menuId: this._currentMenu.name,
      componentId,
      timestamp: Date.now(),
    });

    if (!interaction.isAnySelectMenu()) return;

    try {
      await onSelect(ctx, interaction.values);
    } catch (error) {
      if (error instanceof GuardFailedError) {
        ctx.state.set('__guardMessage', error.message);
        return;
      }
      throw error;
    }
  }

  /**
   * Show a declarative modal trigger button's modal on the raw (non-deferred)
   * interaction. Throws a descriptive error when no matching modal is found so
   * the developer sees the configuration mistake immediately.
   */
  private async _handleModalTrigger(
    interaction: MessageComponentInteraction,
    componentId: string,
  ): Promise<void> {
    if (!this._currentMenu) return;

    const modalId =
      this._currentMenu.getModalIdForButton(componentId);
    if (modalId) {
      // Sets _activeModal and _isModalActive on the instance
      await this._currentMenu.openModal(modalId);
      const modal = this._currentMenu.activeModal;
      if (modal) {
        const normalizedTrigger: NormalizedComponentInteraction = {
          customId: interaction.customId,
          type: 'button',
          userId: interaction.user.id,
          deferUpdate: async () => {
            if (!interaction.deferred && !interaction.replied) {
              await interaction.deferUpdate();
            }
          },
          raw: interaction,
        };
        await this._adapter.showModal(
          modal.builder.toJSON(),
          normalizedTrigger,
        );
        this._emitEvent({
          kind: 'modal:shown',
          menuId: this._currentMenu?.name ?? 'unknown',
          timestamp: Date.now(),
        });
        return;
      }
    }

    // Modal button pressed but no matching modal was found.
    // Defer to prevent Discord's "This interaction failed" timeout,
    // then throw so the developer sees the configuration error.
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
    throw new Error(
      `[FlowCord] Menu "${this._currentMenu.definition.name}": Button "${componentId}" ` +
        `is configured as a modal trigger but no matching modal was found ` +
        `(modalId: "${
          modalId ?? 'unknown'
        }"). Ensure setModal() registers a modal with the correct ID.`,
    );
  }

  /**
   * Legacy openModal() action support: if an action called openModal() and
   * set isModalActive, show the modal on the raw interaction.
   * Throws when the interaction was already deferred (developer error — they
   * should use opensModal on the button config instead).
   */
  private async _showLegacyModal(
    interaction: MessageComponentInteraction,
    componentId: string,
  ): Promise<void> {
    if (
      !this._currentMenu?.isModalActive ||
      !this._currentMenu.activeModal
    ) {
      return;
    }

    if (!interaction.deferred && !interaction.replied) {
      const normalizedTrigger: NormalizedComponentInteraction = {
        customId: interaction.customId,
        type: 'button',
        userId: interaction.user.id,
        deferUpdate: async () => {
          if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
          }
        },
        raw: interaction,
      };
      await this._adapter.showModal(
        this._currentMenu.activeModal.builder.toJSON(),
        normalizedTrigger,
      );
      this._emitEvent({
        kind: 'modal:shown',
        menuId: this._currentMenu.name,
        timestamp: Date.now(),
      });
    } else {
      this._currentMenu.isModalActive = false;
      throw new Error(
        `[FlowCord] Button "${componentId}" used openModal() action after the interaction was deferred. ` +
          `Use opensModal on the button configuration so the framework can call showModal() on a raw interaction.`,
      );
    }
  }

  /**
   * Handle a modal submission.
   */
  private async handleModalSubmit(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    if (!this._currentMenu) return;

    // Track the latest interaction so ctx.interaction stays current
    this._latestInteraction = interaction;

    // Defer the modal's reply so it doesn't timeout
    await interaction.deferUpdate();

    this._emitEvent({
      kind: 'modal:submit',
      menuId: this._currentMenu.name,
      timestamp: Date.now(),
    });

    const modalConfig = this._currentMenu.activeModal;
    if (!modalConfig) return;

    // Resolve departing cleanup from the current menu's perspective,
    // then forward display behaviors (ephemeral) raw and cleanup behaviors resolved.
    const modalInteractionConfig = modalConfig.behavior;
    const modalDepartingBehavior = resolveBehavior(
      this._currentMenu.definition.behavior,
      this._sessionBehavior,
      this._engine.globalBehavior,
      modalInteractionConfig,
    );
    this._renderer.setNextInteractionBehavior({
      ephemeral: modalInteractionConfig?.ephemeral,
      messageCleanup: modalDepartingBehavior.messageCleanup,
      ephemeralFallbackDisposal:
        modalDepartingBehavior.ephemeralFallbackDisposal,
      closedMessage: modalDepartingBehavior.closedMessage,
      deleteUserMessages: modalDepartingBehavior.deleteUserMessages,
    });

    if (!modalConfig.onSubmit) return;

    const ctx = this.buildContext(this._currentMenu);
    await modalConfig.onSubmit(ctx, interaction.fields);
  }

  /**
   * Execute an action with guard error handling and auto-refresh.
   */
  private async executeAction(
    action: Action,
    ctx: MenuContext,
  ): Promise<void> {
    try {
      await action(ctx);
    } catch (error) {
      if (error instanceof GuardFailedError) {
        // Show the guard's message as a prompt on the current menu state
        ctx.state.set('__guardMessage', error.message);
        return; // Auto-refresh will show the updated state
      }
      throw error;
    }
  }

  // -----------------------------------------------------------------------
  // Pagination
  // -----------------------------------------------------------------------

  private async handlePaginationNext(): Promise<void> {
    if (!this._currentMenu?.paginationState) return;
    const ps = this._currentMenu.paginationState;
    if (ps.currentPage < ps.totalPages - 1) {
      this._currentMenu.paginationState = {
        ...ps,
        currentPage: ps.currentPage + 1,
      };
    }

    const ctx = this.buildContext(this._currentMenu);
    await this._emitHook(
      'onNext',
      ctx,
      this._currentMenu.definition.hooks,
    );
  }

  private async handlePaginationPrevious(): Promise<void> {
    if (!this._currentMenu?.paginationState) return;
    const ps = this._currentMenu.paginationState;
    if (ps.currentPage > 0) {
      this._currentMenu.paginationState = {
        ...ps,
        currentPage: ps.currentPage - 1,
      };
    }

    const ctx = this.buildContext(this._currentMenu);
    await this._emitHook(
      'onPrevious',
      ctx,
      this._currentMenu.definition.hooks,
    );
  }

  // -----------------------------------------------------------------------
  // Sub-menu continuations
  // -----------------------------------------------------------------------

  /**
   * Execute registered continuations when returning from a sub-menu.
   */
  private async executeContinuations(
    completedMenuName: string,
    result: unknown,
    ctx: MenuContext,
  ): Promise<void> {
    const idx = this._continuations.findIndex(
      (c) => c.menuName === completedMenuName,
    );
    if (idx === -1) return;

    const continuation = this._continuations.splice(idx, 1)[0];
    if (this._didComplete) {
      await continuation.onComplete(
        ctx,
        result ?? this._completionResult,
      );
    }
    this._completionResult = undefined;
    this._didComplete = false;
  }

  // -----------------------------------------------------------------------
  // Context building
  // -----------------------------------------------------------------------

  /**
   * Build a MenuContext for the current menu instance.
   * All navigation methods are arrow functions to avoid `this` aliasing.
   */
  private buildContext(menuInstance: MenuInstance): MenuContext {
    const baseCtx: MenuContext = {
      session: this,
      menu: menuInstance,
      state: menuInstance.stateAccessor,
      sessionState: this.sessionState,
      client: this.client,
      interaction: this._latestInteraction,
      options: this._currentOptions ?? {},
      pagination: menuInstance.paginationState,
      env: 'discord',

      goTo: async (
        menuId: string,
        options?: Record<string, unknown>,
      ) => {
        await this.navigateTo(menuId, options);
      },
      goBack: async (result?: unknown) => {
        await this.goBack(result);
      },
      close: async () => {
        await this.close();
      },
      hardRefresh: async () => {
        await this.hardRefresh();
      },
      openSubMenu: async (menuId: string, opts: SubMenuOptions) => {
        await this.openSubMenu(menuId, opts);
      },
      complete: async (result?: unknown) => {
        await this.complete(result);
      },
    };

    // Apply context extensions (e.g., AdminMenuBuilder adds ctx.admin)
    let extendedCtx = baseCtx;
    for (const extension of menuInstance.definition
      .contextExtensions) {
      const extra = extension(baseCtx);
      extendedCtx = Object.assign(extendedCtx, extra);
    }

    return extendedCtx;
  }
}
