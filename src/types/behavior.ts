/**
 * Behavior configuration for FlowCord menus.
 *
 * Controls how menus behave at render time. Each field is optional — unset
 * fields fall through to the next level in the resolution hierarchy.
 *
 * Current behaviors:
 * - ephemeral: whether the menu is visible only to the invoking user
 * - messageCleanup: how the current message is handled on the next render cycle
 * - ephemeralFallbackDisposal: fallback when messageCleanup is 'postAndDelete' but message is ephemeral
 * - closedMessage: the string shown when messageCleanup is 'postAndReplace'
 * - deleteUserMessages: whether to delete the user's typed message after setMessageHandler collects it
 * - timeoutMessage: the string shown when the session ends due to inactivity
 *
 * Designed for extension: additional behaviors are added as new optional
 * fields here without changing the policy structure.
 */
export interface BehaviorConfig {
  /**
   * Whether the menu reply is visible only to the invoking user.
   * When undefined, falls through to the next level in the hierarchy.
   */
  ephemeral?: boolean;

  /**
   * How this menu's message is handled on the next render cycle — whether
   * triggered by a same-menu interaction or navigation away.
   * - 'edit': edit the existing message in place (default)
   * - 'postAndDelete': post a new message and delete the old one
   * - 'postAndStrip': post a new message and strip interactive components from the old one
   * - 'postAndReplace': post a new message and replace the old one with closedMessage
   */
  messageCleanup?:
    | 'edit'
    | 'postAndDelete'
    | 'postAndStrip'
    | 'postAndReplace';

  /**
   * Fallback used when messageCleanup is 'postAndDelete' but the active
   * message is ephemeral (Discord does not allow bots to delete ephemeral messages).
   * - 'strip' (default): strip interactive components from the old message
   * - 'replace': replace the old message with closedMessage
   * Has no effect when messageCleanup is not 'postAndDelete'.
   */
  ephemeralFallbackDisposal?: 'strip' | 'replace';

  /**
   * The message content shown when messageCleanup is 'postAndReplace' or when
   * ephemeralFallbackDisposal is 'replace'.
   * Defaults to '*Menu closed*'.
   */
  closedMessage?: string;

  /**
   * Whether to attempt deleting the user's typed message after
   * setMessageHandler collects it (best-effort, requires permissions).
   * Defaults to false.
   */
  deleteUserMessages?: boolean;

  /**
   * The message content shown when the session ends due to inactivity (timeout).
   * Defaults to '*This interaction has timed out.*'.
   */
  timeoutMessage?: string;
}

/**
 * A behavior policy pairs a default config with an override config.
 *
 * - `default`: applied when no more-specific level has declared a value.
 * - `override`: applied regardless of what more-specific levels declare,
 *   but still yields to higher-level overrides (e.g. global override wins
 *   over session override).
 *
 * Used at the global (FlowCordConfig) and session (handleInteraction) levels.
 */
export interface BehaviorPolicy {
  default?: BehaviorConfig;
  override?: BehaviorConfig;
}

/**
 * The behavior declared by a MenuBuilder.
 *
 * - `explicit`: set via setEphemeral(), setUpdateMode(), setOldMessageDisposal(),
 *   or entryEphemeral. Overrides class defaults and inherited session/global
 *   defaults, but yields to session and global overrides, and to class-level
 *   overrides.
 * - `classDefault`: set via _setDefaultBehavior() in a MenuBuilder subclass.
 *   Applied when nothing more specific declares a value. Lower priority than
 *   explicit declarations and session/global defaults.
 * - `classOverride`: set via _setOverrideBehavior() in a MenuBuilder subclass.
 *   Overrides explicit declarations from the same builder, but still yields to
 *   session and global overrides.
 */
export interface MenuBehavior {
  explicit?: BehaviorConfig;
  classDefault?: BehaviorConfig;
  classOverride?: BehaviorConfig;
}

/**
 * Per-interaction behavior overrides. Applied for the single render cycle
 * triggered by a specific button, select, message handler, or modal submit.
 * On the next interaction the behavior resolves from menu/session/global config
 * as normal unless that interaction also declares an override.
 *
 * All fields from BehaviorConfig are permitted, including `ephemeral`.
 * Setting `ephemeral` here causes that one render cycle to post as ephemeral
 * (or revert to public), useful for transiently revealing private information
 * on an otherwise public menu. It does NOT persistently change the menu's
 * ephemeral state — the initial deferReply ephemeral is still controlled by
 * setEphemeral() / entryEphemeral only.
 *
 * Resolution hierarchy with interaction behaviors included:
 *   globalOverride → sessionOverride → classOverride
 *     → interactionExplicit
 *     → menuExplicit
 *     → interactionTypeDefault → classDefault → sessionDefault → globalDefault → framework default
 */
export type InteractionBehavior = BehaviorConfig;

/**
 * Resolved behavior for a single render cycle.
 * All fields are concrete values — no undefined after resolution.
 */
export interface ResolvedBehavior {
  ephemeral: boolean;
  messageCleanup:
    | 'edit'
    | 'postAndDelete'
    | 'postAndStrip'
    | 'postAndReplace';
  ephemeralFallbackDisposal: 'strip' | 'replace';
  closedMessage: string;
  deleteUserMessages: boolean;
  timeoutMessage: string;
}

/**
 * Resolve the effective behavior for a menu render by walking the hierarchy
 * from highest to lowest priority:
 *
 *   globalOverride → sessionOverride → classOverride
 *     → interactionExplicit → menuExplicit
 *     → interactionTypeDefault → classDefault → sessionDefault → globalDefault → framework default
 *
 * @param interactionBehavior - Per-interaction override from the button/select/handler/modal config.
 *   Sits above menuExplicit so a specific interaction can override the menu's own declaration.
 * @param interactionTypeDefaults - Defaults for this category of interaction (e.g. message handlers
 *   default to postAndStrip). Sits below menuExplicit so an explicit setMessageCleanup() still wins.
 */
export function resolveBehavior(
  builderBehavior: MenuBehavior | undefined,
  sessionPolicy: BehaviorPolicy | undefined,
  globalPolicy: BehaviorPolicy | undefined,
  interactionBehavior?: InteractionBehavior,
  interactionTypeDefaults?: InteractionBehavior,
): ResolvedBehavior {
  return {
    ephemeral: resolveField(
      'ephemeral',
      builderBehavior,
      sessionPolicy,
      globalPolicy,
      false,
      interactionBehavior,
      interactionTypeDefaults,
    ),
    messageCleanup: resolveField(
      'messageCleanup',
      builderBehavior,
      sessionPolicy,
      globalPolicy,
      'edit',
      interactionBehavior,
      interactionTypeDefaults,
    ),
    ephemeralFallbackDisposal: resolveField(
      'ephemeralFallbackDisposal',
      builderBehavior,
      sessionPolicy,
      globalPolicy,
      'strip',
      interactionBehavior,
      interactionTypeDefaults,
    ),
    closedMessage: resolveField(
      'closedMessage',
      builderBehavior,
      sessionPolicy,
      globalPolicy,
      '*Menu closed*',
      interactionBehavior,
      interactionTypeDefaults,
    ),
    deleteUserMessages: resolveField(
      'deleteUserMessages',
      builderBehavior,
      sessionPolicy,
      globalPolicy,
      false,
      interactionBehavior,
      interactionTypeDefaults,
    ),
    timeoutMessage: resolveField(
      'timeoutMessage',
      builderBehavior,
      sessionPolicy,
      globalPolicy,
      '*This interaction has timed out.*',
      interactionBehavior,
      interactionTypeDefaults,
    ),
  };
}

function resolveField<T>(
  key: keyof BehaviorConfig,
  builder: MenuBehavior | undefined,
  session: BehaviorPolicy | undefined,
  global: BehaviorPolicy | undefined,
  fallback: T,
  interactionBehavior?: InteractionBehavior,
  interactionTypeDefaults?: InteractionBehavior,
): T {
  return (
    (global?.override?.[key] as T | undefined) ??
    (session?.override?.[key] as T | undefined) ??
    (builder?.classOverride?.[key] as T | undefined) ??
    (interactionBehavior?.[key] as T | undefined) ??
    (builder?.explicit?.[key] as T | undefined) ??
    (interactionTypeDefaults?.[key] as T | undefined) ??
    (builder?.classDefault?.[key] as T | undefined) ??
    (session?.default?.[key] as T | undefined) ??
    (global?.default?.[key] as T | undefined) ??
    fallback
  );
}
