/**
 * Minimal stubs for Discord.js types used in test sessions.
 *
 * These stubs satisfy TypeScript's structural type requirements without
 * requiring a live Discord.js client or connection. Properties that are
 * not needed by the framework's test path throw descriptive errors if
 * accidentally accessed, making test failures easy to diagnose.
 *
 * Used by createTestSession() to wire up MenuSession/MenuEngine without
 * any real Discord.js infrastructure.
 */
import type { ChatInputCommandInteraction, Client } from 'discord.js';

/**
 * Build a stub ChatInputCommandInteraction for test sessions.
 * Only the fields actually accessed by MenuSession (after the adapter
 * refactor) need to be real values: user.id, client.
 */
export function buildStubInteraction(
  userId: string,
  client: Client<true>,
): ChatInputCommandInteraction {
  const stub: Record<string, unknown> = {
    user: {
      id: userId,
      displayName: 'TestUser',
      displayAvatarURL: () => '',
    },
    client,
    // channel is not accessed by MenuSession after the adapter refactor —
    // all I/O goes through FlowCordAdapter.
    channel: null,
    applicationId: 'test-app-id',
    token: 'test-token',
    guildId: null,
    deferred: false,
    replied: false,
    // Provide no-op stubs for methods MenuEngine's defaultOnError may call
    editReply: async () => ({}),
    reply: async () => ({}),
    deferReply: async () => {},
    followUp: async () => ({}),
  };

  return stub as unknown as ChatInputCommandInteraction;
}

/**
 * Build a minimal stub Discord.js Client<true> for test sessions.
 * The client is placed on ctx.client; consumers can cast and access
 * only the fields they stub themselves.
 */
export function buildStubClient(): Client<true> {
  const stub: Record<string, unknown> = {
    user: {
      id: 'test-bot-id',
      tag: 'TestBot#0000',
    },
    rest: {
      patch: async () => ({}),
    },
    // Proxy other accesses with a descriptive error
  };

  return new Proxy(stub, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (typeof key === 'symbol') return undefined;
      throw new Error(
        `[FlowCord test] Stub Client accessed unknown property: "${String(key)}". ` +
          `Add it to buildStubClient() or mock it in your test.`,
      );
    },
  }) as unknown as Client<true>;
}
