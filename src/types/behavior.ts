/**
 * Behavior configuration for FlowCord menus.
 *
 * Controls how menus behave at render time. Each field is optional — unset
 * fields fall through to the next level in the resolution hierarchy.
 *
 * Current behaviors:
 * - ephemeral: whether the menu is visible only to the invoking user
 *
 * Designed for extension: additional behaviors (e.g. replyMode) are added
 * as new optional fields here without changing the policy structure.
 */
export interface BehaviorConfig {
  /**
   * Whether the menu reply is visible only to the invoking user.
   * When undefined, falls through to the next level in the hierarchy.
   */
  ephemeral?: boolean;
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
 * - `explicit`: set via setEphemeral() etc. Overrides inherited defaults but
 *   yields to session and global overrides.
 * - `override`: set via overrideEphemeral() etc. Overrides explicit values and
 *   inherited defaults, but still yields to session and global overrides.
 */
export interface MenuBehavior {
  explicit?: BehaviorConfig;
  override?: BehaviorConfig;
}

/**
 * Resolved behavior for a single render cycle.
 * All fields are concrete booleans — no undefined after resolution.
 */
export interface ResolvedBehavior {
  ephemeral: boolean;
}

/**
 * Resolve the effective behavior for a menu render by walking the hierarchy
 * from highest to lowest priority:
 *
 *   globalOverride → sessionOverride → builderOverride
 *     → builderExplicit → sessionDefault → globalDefault → hardcoded fallback
 */
export function resolveBehavior(
  builderBehavior: MenuBehavior | undefined,
  sessionPolicy: BehaviorPolicy | undefined,
  globalPolicy: BehaviorPolicy | undefined
): ResolvedBehavior {
  return {
    ephemeral: resolveField(
      'ephemeral',
      builderBehavior,
      sessionPolicy,
      globalPolicy
    ),
  };
}

function resolveField(
  key: keyof BehaviorConfig,
  builder: MenuBehavior | undefined,
  session: BehaviorPolicy | undefined,
  global: BehaviorPolicy | undefined
): boolean {
  return (
    global?.override?.[key] ??
    session?.override?.[key] ??
    builder?.override?.[key] ??
    builder?.explicit?.[key] ??
    session?.default?.[key] ??
    global?.default?.[key] ??
    false
  );
}
