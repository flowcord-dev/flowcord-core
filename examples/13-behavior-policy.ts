/**
 * Example 13 — Behavior Policy: setMessageCleanup, deleteUserMessages,
 *              and interaction-level behavior overrides.
 *
 * Slash command: /behavior-hub
 *
 * Menu flow:
 *   hub ──► postnew-delete        messageCleanup:'postAndDelete'
 *       ──► postnew-replace       messageCleanup:'postAndReplace' + closedMessage
 *       ──► postnew-strip         messageCleanup:'postAndStrip'  (explicit baseline)
 *       ──► collect-edit          setMessageHandler + deleteUserMessages:true (edit default)
 *       ──► collect-postnew       setMessageHandler + deleteUserMessages:true + messageCleanup:'postAndStrip'
 *       ──► ephemeral-fb          setEphemeral + messageCleanup:'postAndDelete'
 *                                   + ephemeralFallback:'replace'
 *       ──► interaction-override  per-button behavior overrides on an otherwise edit menu
 *
 * What to look for:
 *
 *  postnew-delete        Click the counter several times. Each click should DELETE the previous
 *                        message and post a fresh one at the bottom of chat.
 *
 *  postnew-replace       Same flow, but the previous message is replaced with
 *                        "📦 This menu was replaced." instead of being deleted.
 *
 *  postnew-strip         Same flow. The previous message keeps its content but loses its
 *                        buttons (components stripped).
 *
 *  collect-edit          Type something in the channel.
 *                        • Your message should be deleted (deleteUserMessages:true).
 *                        • The bot message should update IN PLACE showing what you typed.
 *                          No repost — the message stays where it is.
 *
 *  collect-postnew       Same, but the bot message is stripped and a NEW message is posted
 *                        at the bottom of chat (messageCleanup:'postAndStrip').
 *
 *  ephemeral-fb          The menu is ephemeral, so clicking the counter triggers postAndDelete.
 *                        Discord does not allow bots to delete ephemeral messages, so the
 *                        ephemeralFallback:'replace' fires — you should see
 *                        "🔒 Ephemeral — cannot delete." appear on each old message
 *                        instead of it disappearing.
 *
 *  interaction-override  The menu defaults to edit, but individual buttons carry
 *                        a behavior override:
 *                        • "Normal click" — no override, edits in place (default).
 *                        • "postAndDelete click" — behavior:{ messageCleanup:'postAndDelete' }
 *                          only THIS click deletes the old message and reposts; next click reverts.
 *                        • "Reveal secret" — behavior:{ ephemeral:true, messageCleanup:'postAndStrip' }
 *                          shows a one-off ephemeral message; next click is public again.
 *
 * Concepts shown:
 *   - setMessageCleanup() with all four modes
 *   - ephemeralFallback option on 'postAndDelete' mode
 *   - closedMessage option on 'postAndReplace' mode
 *   - deleteUserMessages option
 *   - edit vs postAndStrip after message collection
 *   - setEphemeral() + ephemeralFallbackDisposal interaction
 *   - Per-button behavior overrides (interaction-level)
 *   - Transient ephemeral via per-button behavior
 */

import {
  EmbedBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} from 'discord.js';
// Local dev (flowcord-core repo only):
// import {
//   type FlowCord,
//   MenuBuilder,
//   goTo,
//   closeMenu,
// } from '../src/index.ts';
import {
  type FlowCord,
  MenuBuilder,
  goTo,
  closeMenu,
} from '@flowcord/core';

// ---------------------------------------------------------------------------
// Slash command definition
// ---------------------------------------------------------------------------
export const commands = [
  new SlashCommandBuilder()
    .setName('behavior-hub')
    .setDescription(
      'Interactive testbed for behavior policy settings',
    )
    .toJSON(),
];

// ---------------------------------------------------------------------------
// Menu registrations
// ---------------------------------------------------------------------------
export function register(flowcord: FlowCord): void {
  // -------------------------------------------------------------------------
  // Hub — entry point, navigate to each demo
  // -------------------------------------------------------------------------
  flowcord.registerMenu('behavior-hub', (session) =>
    new MenuBuilder(session, 'behavior-hub')
      .setTrackedInHistory()
      .setEmbeds(() => [
        new EmbedBuilder()
          .setTitle('Behavior Policy Testbed')
          .setDescription(
            'Choose a demo below.\n\n' +
              '**postAndDelete** — each click deletes the previous message and reposts\n' +
              '**postAndReplace** — each click replaces the previous message with a closed notice\n' +
              '**postAndStrip** — each click strips components from the previous message\n' +
              '**Collect (edit)** — type a reply; your message is deleted, bot message updates in place\n' +
              '**Collect (postAndStrip)** — type a reply; your message is deleted, bot message is stripped and reposted\n' +
              '**Ephemeral + fallback** — ephemeral postAndDelete; delete falls back to replace\n' +
              '**Interaction overrides** — per-button behavior; one button reposts, one reveals an ephemeral message',
          )
          .setColor(0x5865f2),
      ])
      .setButtons(() => [
        {
          label: 'postAndDelete',
          style: ButtonStyle.Primary,
          action: goTo('behavior-postnew-delete'),
        },
        {
          label: 'postAndReplace',
          style: ButtonStyle.Primary,
          action: goTo('behavior-postnew-replace'),
        },
        {
          label: 'postAndStrip',
          style: ButtonStyle.Primary,
          action: goTo('behavior-postnew-strip'),
        },
        {
          label: 'Collect (edit)',
          style: ButtonStyle.Success,
          action: goTo('behavior-collect-edit'),
        },
        {
          label: 'Collect (postAndStrip)',
          style: ButtonStyle.Success,
          action: goTo('behavior-collect-postnew'),
        },
        {
          label: 'Ephemeral + fallback',
          style: ButtonStyle.Secondary,
          action: goTo('behavior-ephemeral-fb'),
        },
        {
          label: 'Interaction overrides',
          style: ButtonStyle.Secondary,
          action: goTo('behavior-interaction-override'),
        },
        {
          label: 'Close',
          style: ButtonStyle.Danger,
          action: closeMenu(),
        },
      ])
      .build(),
  );

  // -------------------------------------------------------------------------
  // Demo 1 — postAndDelete
  //
  // messageCleanup:'postAndDelete' → post a new message and delete the old one
  //
  // Expected: clicking "Click me" repeatedly produces a growing list of
  // deleted messages and a single up-to-date one at the bottom.
  // -------------------------------------------------------------------------
  flowcord.registerMenu('behavior-postnew-delete', (session) =>
    new MenuBuilder<{ count: number }>(
      session,
      'behavior-postnew-delete',
    )
      .setMessageCleanup('postAndDelete')
      .setup((ctx) => ctx.state.set('count', 0))
      .setEmbeds((ctx) => [
        new EmbedBuilder()
          .setTitle('postNew + delete')
          .setDescription(
            `Clicks: **${ctx.state.get('count')}**\n\n` +
              'Each click should DELETE the previous message and post a new one here.',
          )
          .setColor(0xed4245),
      ])
      .setButtons((ctx) => [
        {
          label: `Click me (${ctx.state.get('count')})`,
          style: ButtonStyle.Danger,
          action: async (ctx) =>
            ctx.state.set('count', ctx.state.get('count') + 1),
        },
      ])
      .setReturnable()
      .build(),
  );

  // -------------------------------------------------------------------------
  // Demo 2 — postAndReplace + closedMessage
  //
  // messageCleanup:'postAndReplace' → post a new message and replace the old
  //   one with the closedMessage string
  //
  // Expected: previous messages show "📦 This menu was replaced." with no
  // buttons; the latest message is at the bottom with the updated count.
  // -------------------------------------------------------------------------
  flowcord.registerMenu('behavior-postnew-replace', (session) =>
    new MenuBuilder<{ count: number }>(
      session,
      'behavior-postnew-replace',
    )
      .setMessageCleanup('postAndReplace', {
        closedMessage: '📦 This menu was replaced.',
      })
      .setup((ctx) => ctx.state.set('count', 0))
      .setEmbeds((ctx) => [
        new EmbedBuilder()
          .setTitle('postNew + replaceWithClosed')
          .setDescription(
            `Clicks: **${ctx.state.get('count')}**\n\n` +
              'Each click should replace the previous message with "📦 This menu was replaced."',
          )
          .setColor(0xfee75c),
      ])
      .setButtons((ctx) => [
        {
          label: `Click me (${ctx.state.get('count')})`,
          style: ButtonStyle.Primary,
          action: async (ctx) =>
            ctx.state.set('count', ctx.state.get('count') + 1),
        },
      ])
      .setReturnable()
      .build(),
  );

  // -------------------------------------------------------------------------
  // Demo 3 — postAndStrip (explicit baseline)
  //
  // messageCleanup:'postAndStrip' → post a new message and strip interactive
  //   components from the old one (this is the message-collection default)
  //
  // Expected: previous messages retain their embed/content but have no
  // buttons; the latest message is at the bottom with the updated count.
  // -------------------------------------------------------------------------
  flowcord.registerMenu('behavior-postnew-strip', (session) =>
    new MenuBuilder<{ count: number }>(
      session,
      'behavior-postnew-strip',
    )
      .setMessageCleanup('postAndStrip')
      .setup((ctx) => ctx.state.set('count', 0))
      .setEmbeds((ctx) => [
        new EmbedBuilder()
          .setTitle('postNew + stripComponents')
          .setDescription(
            `Clicks: **${ctx.state.get('count')}**\n\n` +
              'Each click should strip the buttons from the previous message (content stays).',
          )
          .setColor(0x57f287),
      ])
      .setButtons((ctx) => [
        {
          label: `Click me (${ctx.state.get('count')})`,
          style: ButtonStyle.Success,
          action: async (ctx) =>
            ctx.state.set('count', ctx.state.get('count') + 1),
        },
      ])
      .setReturnable()
      .build(),
  );

  // -------------------------------------------------------------------------
  // Demo 4a — message collection, edit (default messageCleanup)
  //
  // deleteUserMessages:true → the user's typed message is deleted (best-effort)
  // messageCleanup not set (defaults to 'edit') → the bot message is edited
  //   in place with the updated state; no repost, no disposal of the old message
  //
  // Expected:
  //   1. Prompt appears asking you to type something.
  //   2. You type a message in the channel.
  //   3. Your message disappears (deleteUserMessages:true).
  //   4. The SAME bot message updates in place to show what you sent.
  //      The message does not move — no new followUp is posted.
  // -------------------------------------------------------------------------
  flowcord.registerMenu('behavior-collect-edit', (session) =>
    new MenuBuilder<{ collected: string | null }>(
      session,
      'behavior-collect-edit',
    )
      .setMessageCleanup('edit')
      .setup((ctx) => ctx.state.set('collected', null))
      .setEmbeds((ctx) => {
        const collected = ctx.state.get('collected');
        return [
          new EmbedBuilder()
            .setTitle('Collect — editInPlace')
            .setDescription(
              collected === null
                ? '**Type anything in this channel.**\n\n' +
                    'Your message will be deleted. This bot message will update in place.'
                : `**You sent:** ${collected}\n\nYour message was deleted. This message was edited in place.`,
            )
            .setColor(0xeb459e),
        ];
      })
      .setMessageHandler(
        async (ctx, text) => {
          ctx.state.set('collected', text);
        },
        { behavior: { deleteUserMessages: true } },
      )
      .setReturnable()
      .build(),
  );

  // -------------------------------------------------------------------------
  // Demo 4b — message collection, postAndStrip (explicit messageCleanup)
  //
  // deleteUserMessages:true → the user's typed message is deleted (best-effort)
  // messageCleanup:'postAndStrip' → the old bot message is stripped and a new
  //   one is posted at the bottom of chat with the updated state
  //
  // Expected:
  //   1. Prompt appears asking you to type something.
  //   2. You type a message in the channel.
  //   3. Your message disappears (deleteUserMessages:true).
  //   4. The prompt message has its buttons stripped.
  //   5. A NEW message appears at the bottom of chat showing what you sent.
  // -------------------------------------------------------------------------
  flowcord.registerMenu('behavior-collect-postnew', (session) =>
    new MenuBuilder<{ collected: string | null }>(
      session,
      'behavior-collect-postnew',
    )
      .setMessageCleanup('postAndStrip')
      .setup((ctx) => ctx.state.set('collected', null))
      .setEmbeds((ctx) => {
        const collected = ctx.state.get('collected');
        return [
          new EmbedBuilder()
            .setTitle('Collect — postNew')
            .setDescription(
              collected === null
                ? '**Type anything in this channel.**\n\n' +
                    'Your message will be deleted. The bot will strip this message and repost at the bottom.'
                : `**You sent:** ${collected}\n\nYour message was deleted. This is the reposted result.`,
            )
            .setColor(0xfee75c),
        ];
      })
      .setMessageHandler(
        async (ctx, text) => {
          ctx.state.set('collected', text);
        },
        { behavior: { deleteUserMessages: true } },
      )
      .setReturnable()
      .build(),
  );

  // -------------------------------------------------------------------------
  // Demo 5 — ephemeral + postAndDelete + ephemeralFallback
  //
  // setEphemeral()  → this menu is only visible to the invoking user
  // messageCleanup:'postAndDelete'  → post a new message and delete the old one
  // ephemeralFallback:'replace'  → Discord prevents bots from deleting ephemeral
  //   messages, so this fallback fires instead, replacing the old message with
  //   the closedMessage string
  //
  // Expected: clicking "Click me" shows the OLD ephemeral message replaced
  // with "🔒 Ephemeral — cannot delete." rather than disappearing.
  // -------------------------------------------------------------------------
  flowcord.registerMenu('behavior-ephemeral-fb', (session) =>
    new MenuBuilder<{ count: number }>(
      session,
      'behavior-ephemeral-fb',
    )
      .setEphemeral()
      .setMessageCleanup('postAndDelete', {
        ephemeralFallback: 'replace',
        closedMessage: '🔒 Ephemeral — cannot delete.',
      })
      .setup((ctx) => ctx.state.set('count', 0))
      .setEmbeds((ctx) => [
        new EmbedBuilder()
          .setTitle('Ephemeral + ephemeralFallback')
          .setDescription(
            `Clicks: **${ctx.state.get('count')}**\n\n` +
              'This menu is ephemeral. Disposal is set to `delete`, but Discord does not\n' +
              'allow deleting ephemeral messages, so the **ephemeralFallback** fires:\n' +
              'the old message should show **"🔒 Ephemeral — cannot delete."** instead.',
          )
          .setColor(0xfee75c),
      ])
      .setButtons((ctx) => [
        {
          label: `Click me (${ctx.state.get('count')})`,
          style: ButtonStyle.Primary,
          action: async (ctx) =>
            ctx.state.set('count', ctx.state.get('count') + 1),
        },
      ])
      .setReturnable()
      .build(),
  );

  // -------------------------------------------------------------------------
  // Demo 6 — Interaction-level behavior overrides
  //
  // The menu has NO explicit messageCleanup — it defaults to 'edit'.
  // Each button carries its own behavior override for just that click:
  //
  //   Normal click       — no override → edits in place (default).
  //   postAndDelete click — behavior:{ messageCleanup:'postAndDelete' }
  //                        Only THIS click deletes the old message and reposts at the
  //                        bottom. On the NEXT click the menu reverts to edit.
  //   Reveal secret      — behavior:{ ephemeral:true, messageCleanup:'postAndStrip' }
  //                        Posts one ephemeral message showing a "secret". The NEXT
  //                        click is public again (ephemeral reverts to menu default).
  //
  // Expected:
  //   1. "Normal" increments the counter and edits the message in place.
  //   2. "postAndDelete" increments, deletes the old message, reposts at the bottom.
  //      The NEXT click goes back to editing in place.
  //   3. "Reveal secret" posts an ephemeral message. After you click any button
  //      on that ephemeral message, the next render is public again.
  // -------------------------------------------------------------------------
  flowcord.registerMenu('behavior-interaction-override', (session) =>
    new MenuBuilder<{ count: number }>(
      session,
      'behavior-interaction-override',
    )
      // No setMessageCleanup — defaults to 'edit'.
      .setup((ctx) => ctx.state.set('count', 0))
      .setEmbeds((ctx) => [
        new EmbedBuilder()
          .setTitle('Interaction-Level Behavior Overrides')
          .setDescription(
            `Clicks: **${ctx.state.get('count')}**\n\n` +
              '**Normal** — edits in place (menu default).\n' +
              '**postNew** — deletes old message and reposts (per-button override, reverts after).\n' +
              '**Reveal secret** — one-shot ephemeral postNew (reverts to public on next click).',
          )
          .setColor(0x5865f2),
      ])
      .setButtons((ctx) => [
        {
          label: `Normal (${ctx.state.get('count')})`,
          style: ButtonStyle.Secondary,
          // No behavior override — uses menu/framework default (editInPlace).
          action: async (ctx) =>
            ctx.state.set('count', ctx.state.get('count') + 1),
        },
        {
          label: `postAndDelete (${ctx.state.get('count')})`,
          style: ButtonStyle.Primary,
          // Per-button override: only this click deletes + reposts.
          behavior: {
            messageCleanup: 'postAndDelete',
          },
          action: async (ctx) =>
            ctx.state.set('count', ctx.state.get('count') + 1),
        },
        {
          label: '🔍 Reveal secret',
          style: ButtonStyle.Success,
          // Per-button override: posts ONE ephemeral message.
          // On the next interaction (any button on the ephemeral message)
          // the menu resolves back to the default (public, edit).
          behavior: {
            ephemeral: true,
            messageCleanup: 'postAndStrip',
          },
          action: async (ctx) =>
            ctx.state.set('count', ctx.state.get('count') + 1),
        },
      ])
      .setReturnable()
      .build(),
  );
}
