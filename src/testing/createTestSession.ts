/**
 * createTestSession — factory for wiring up a MenuSession backed by a
 * SimulatedAdapter for deterministic, in-process testing.
 *
 * Usage:
 *
 *   const { adapter, startSession } = createTestSession({ main: mainFactory });
 *   const done = startSession('main');              // not awaited — runs concurrently
 *   await adapter.waitForNextRender();              // wait for first render
 *   adapter.enqueueComponent(click('Next'));
 *   await adapter.waitForNextRender();              // wait for next render
 *   adapter.enqueueComponent(click('Close'));
 *   await done;                                     // wait for session end
 */
import type { CreateMenuDefinitionFn } from '../registry/MenuRegistry';
import type { BehaviorPolicy } from '../types/behavior';
import { MenuEngine } from '../engine/MenuEngine';
import { SimulatedAdapter } from './SimulatedAdapter';
import { EventLog } from './EventLog';
import { buildStubClient, buildStubInteraction } from './stubs';

export interface CreateTestSessionOptions {
  /** User ID used for interaction filtering (default: 'test-user') */
  userId?: string;
  /** Pre-seed the session's StateStore before initialize() is called */
  initialSessionState?: Record<string, unknown>;
  /** Global behavior policy override */
  behavior?: BehaviorPolicy;
  /** Safety timeout in ms for interaction queues (default: 5000) */
  safetyTimeout?: number;
}

export interface TestSessionHandle {
  adapter: SimulatedAdapter;
  eventLog: EventLog;
  engine: MenuEngine;
  /**
   * Start the session for the given menu. Do NOT await this immediately —
   * it runs concurrently with your test. Use adapter.waitForNextRender()
   * to synchronize with the session loop.
   *
   * @param menuName - Name of the registered menu to start
   * @param options - Options forwarded to the menu factory
   */
  startSession(
    menuName: string,
    options?: Record<string, unknown>,
  ): Promise<void>;
}

/**
 * Create a self-contained test session with a SimulatedAdapter and EventLog.
 *
 * @param menus - Map of menu name → factory function to register
 * @param options - Optional configuration (userId, initialSessionState, etc.)
 */
export function createTestSession(
  menus: Record<string, CreateMenuDefinitionFn>,
  options: CreateTestSessionOptions = {},
): TestSessionHandle {
  const userId = options.userId ?? 'test-user';
  const safetyTimeout = options.safetyTimeout ?? 5000;

  const client = buildStubClient();
  const adapter = new SimulatedAdapter({ safetyTimeout });
  const eventLog = new EventLog();

  const engine = new MenuEngine({
    client,
    timeout: safetyTimeout,
    behavior: options.behavior,
  });

  // Register all provided menus
  for (const [name, factory] of Object.entries(menus)) {
    engine.registerMenu(name, factory);
  }

  const interaction = buildStubInteraction(userId, client);

  function startSession(
    menuName: string,
    menuOptions?: Record<string, unknown>,
  ): Promise<void> {
    const session = engine.createSession(interaction, adapter, eventLog);

    // Seed initial session state before the loop starts
    if (options.initialSessionState) {
      for (const [key, value] of Object.entries(
        options.initialSessionState,
      )) {
        session.sessionState.set(key, value);
      }
    }

    return session.initialize(menuName, menuOptions);
  }

  return { adapter, eventLog, engine, startSession };
}
