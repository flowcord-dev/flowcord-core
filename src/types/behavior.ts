/**
 * Behavior configuration for FlowCord menus.
 *
 * Controls how menus behave at render time. Each field is optional — unset
 * fields fall through to the next level in the resolution hierarchy.
 *
 * Current behaviors:
 * - ephemeral: whether the menu is visible only to the invoking user
 * - updateMode: whether menus edit in-place or always delete+repost
 * - oldMessageDisposal: how the old message is treated when it must be replaced
 * - ephemeralFallbackDisposal: fallback when disposal is 'delete' but message is ephemeral
 * - closedMessage: the string shown when disposal mode is 'replaceWithClosed'
 * - deleteUserMessages: whether to delete the user's typed message after setMessageHandler collects it
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
   * How the menu message is updated after each component interaction.
   * - 'editInPlace': edit/update the existing message in-place (default)
   * - 'postNew': dispose the old message and post a new one, keeping the
   *   active menu at the bottom of the chat log
   */
  updateMode?: 'editInPlace' | 'postNew';

  /**
   * How the old message is treated whenever it must be replaced:
   * on ephemeral-state changes, render-mode changes, updateMode 'postNew',
   * and after message collection via setMessageHandler.
   * - 'stripComponents': remove interactive components, leave content (default)
   * - 'delete': delete the message if possible; ephemeral messages fall back
   *   to ephemeralFallbackDisposal
   * - 'replaceWithClosed': replace content with the closedMessage string
   */
  oldMessageDisposal?: 'stripComponents' | 'delete' | 'replaceWithClosed';

  /**
   * Fallback disposal used when oldMessageDisposal is 'delete' but the
   * active message is ephemeral (Discord does not allow bots to delete
   * ephemeral messages).
   * - 'stripComponents' (default)
   * - 'replaceWithClosed'
   * Has no effect when oldMessageDisposal is not 'delete'.
   */
  ephemeralFallbackDisposal?: 'stripComponents' | 'replaceWithClosed';

  /**
   * The message content shown when oldMessageDisposal or
   * ephemeralFallbackDisposal is 'replaceWithClosed'.
   * Defaults to '*Menu closed*'.
   */
  closedMessage?: string;

  /**
   * Whether to attempt deleting the user's typed message after
   * setMessageHandler collects it (best-effort, requires permissions).
   * Defaults to false.
   */
  deleteUserMessages?: boolean;
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
 * Resolved behavior for a single render cycle.
 * All fields are concrete values — no undefined after resolution.
 */
export interface ResolvedBehavior {
  ephemeral: boolean;
  updateMode: 'editInPlace' | 'postNew';
  oldMessageDisposal: 'stripComponents' | 'delete' | 'replaceWithClosed';
  ephemeralFallbackDisposal: 'stripComponents' | 'replaceWithClosed';
  closedMessage: string;
  deleteUserMessages: boolean;
}

/**
 * Resolve the effective behavior for a menu render by walking the hierarchy
 * from highest to lowest priority:
 *
 *   globalOverride → sessionOverride → classOverride
 *     → explicit → classDefault → sessionDefault → globalDefault → framework default
 */
export function resolveBehavior(
  builderBehavior: MenuBehavior | undefined,
  sessionPolicy: BehaviorPolicy | undefined,
  globalPolicy: BehaviorPolicy | undefined
): ResolvedBehavior {
  return {
    ephemeral: resolveField('ephemeral', builderBehavior, sessionPolicy, globalPolicy, false),
    updateMode: resolveField('updateMode', builderBehavior, sessionPolicy, globalPolicy, 'editInPlace'),
    oldMessageDisposal: resolveField('oldMessageDisposal', builderBehavior, sessionPolicy, globalPolicy, 'stripComponents'),
    ephemeralFallbackDisposal: resolveField('ephemeralFallbackDisposal', builderBehavior, sessionPolicy, globalPolicy, 'stripComponents'),
    closedMessage: resolveField('closedMessage', builderBehavior, sessionPolicy, globalPolicy, '*Menu closed*'),
    deleteUserMessages: resolveField('deleteUserMessages', builderBehavior, sessionPolicy, globalPolicy, false),
  };
}

function resolveField<T>(
  key: keyof BehaviorConfig,
  builder: MenuBehavior | undefined,
  session: BehaviorPolicy | undefined,
  global: BehaviorPolicy | undefined,
  fallback: T
): T {
  return (
    (global?.override?.[key] as T | undefined) ??
    (session?.override?.[key] as T | undefined) ??
    (builder?.classOverride?.[key] as T | undefined) ??
    (builder?.explicit?.[key] as T | undefined) ??
    (builder?.classDefault?.[key] as T | undefined) ??
    (session?.default?.[key] as T | undefined) ??
    (global?.default?.[key] as T | undefined) ??
    fallback
  );
}
