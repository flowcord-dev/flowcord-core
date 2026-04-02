/**
 * Example 13 — Behavior Policy: updateMode, oldMessageDisposal, deleteUserMessages
 *
 * Tests all new BehaviorConfig fields added in the behavior-policy-extensions branch.
 *
 * Slash command: /behavior-test
 *
 * Menu flow:
 *   hub ──► postnew-delete      updateMode:'postNew' + disposal:'delete'
 *       ──► postnew-replace     updateMode:'postNew' + disposal:'replaceWithClosed' + closedMessage
 *       ──► postnew-strip       updateMode:'postNew' + disposal:'stripComponents'  (baseline)
 *       ──► collect-editInPlace setMessageHandler + deleteUserMessages:true (editInPlace default)
 *       ──► collect-postNew     setMessageHandler + deleteUserMessages:true + updateMode:'postNew'
 *       ──► ephemeral-fb        setEphemeral + updateMode:'postNew' + disposal:'delete'
 *                                 + ephemeralFallback:'replaceWithClosed'
 *
 * What to look for:
 *
 *  postnew-delete        Click the counter several times. Each click should DELETE the previous
 *                        message and post a fresh one at the bottom of chat.
 *
 *  postnew-replace       Same flow, but the previous message is replaced with
 *                        "📦 This menu was replaced." instead of being deleted.
 *
 *  postnew-strip         Same flow with the default disposal. The previous message keeps its
 *                        content but loses its buttons (components stripped).
 *
 *  collect-editInPlace   Type something in the channel.
 *                        • Your message should be deleted (deleteUserMessages:true).
 *                        • The bot message should update IN PLACE showing what you typed.
 *                          No repost — the message stays where it is.
 *
 *  collect-postNew       Same, but the bot message is stripped and a NEW message is posted
 *                        at the bottom of chat (updateMode:'postNew').
 *
 *  ephemeral-fb          The menu is ephemeral, so clicking the counter triggers postNew.
 *                        Discord does not allow bots to delete ephemeral messages, so the
 *                        'delete' disposal falls back to 'replaceWithClosed' — you should
 *                        see "🔒 Ephemeral — cannot delete." appear on each old message
 *                        instead of it disappearing.
 *
 * Concepts shown:
 *   - setUpdateMode()
 *   - setOldMessageDisposal() with all three modes
 *   - ephemeralFallback option on 'delete' mode
 *   - closedMessage option
 *   - deleteUserMessages option
 *   - editInPlace vs postNew after message collection
 *   - setEphemeral() + ephemeralFallbackDisposal interaction
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
      .setEmbeds(() => [
        new EmbedBuilder()
          .setTitle('Behavior Policy Testbed')
          .setDescription(
            'Choose a demo below.\n\n' +
              '**postNew + delete** — each click deletes the previous message and reposts\n' +
              '**postNew + replace** — each click replaces the previous message with a closed notice\n' +
              '**postNew + strip** — each click strips components from the previous message (default)\n' +
              '**Collect (editInPlace)** — type a reply; your message is deleted, bot message updates in place\n' +
              '**Collect (postNew)** — type a reply; your message is deleted, bot message is stripped and reposted\n' +
              '**Ephemeral + fallback** — ephemeral postNew; delete falls back to replaceWithClosed',
          )
          .setColor(0x5865f2),
      ])
      .setButtons(() => [
        {
          label: 'postNew + delete',
          style: ButtonStyle.Primary,
          action: goTo('behavior-postnew-delete'),
        },
        {
          label: 'postNew + replace',
          style: ButtonStyle.Primary,
          action: goTo('behavior-postnew-replace'),
        },
        {
          label: 'postNew + strip',
          style: ButtonStyle.Primary,
          action: goTo('behavior-postnew-strip'),
        },
        {
          label: 'Collect (editInPlace)',
          style: ButtonStyle.Success,
          action: goTo('behavior-collect-edit'),
        },
        {
          label: 'Collect (postNew)',
          style: ButtonStyle.Success,
          action: goTo('behavior-collect-postnew'),
        },
        {
          label: 'Ephemeral + fallback',
          style: ButtonStyle.Secondary,
          action: goTo('behavior-ephemeral-fb'),
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
  // Demo 1 — postNew + delete
  //
  // updateMode:'postNew'  → a new message is posted on every interaction
  // oldMessageDisposal:'delete' → the previous message is deleted each time
  //
  // Expected: clicking "Click me" repeatedly produces a growing list of
  // deleted messages and a single up-to-date one at the bottom.
  // -------------------------------------------------------------------------
  flowcord.registerMenu('behavior-postnew-delete', (session) =>
    new MenuBuilder<{ count: number }>(
      session,
      'behavior-postnew-delete',
    )
      .setUpdateMode('postNew')
      .setOldMessageDisposal('delete')
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
  // Demo 2 — postNew + replaceWithClosed + closedMessage
  //
  // updateMode:'postNew'  → new message posted on every interaction
  // oldMessageDisposal:'replaceWithClosed' → previous message replaced with
  //   the closedMessage string instead of being deleted
  //
  // Expected: previous messages show "📦 This menu was replaced." with no
  // buttons; the latest message is at the bottom with the updated count.
  // -------------------------------------------------------------------------
  flowcord.registerMenu('behavior-postnew-replace', (session) =>
    new MenuBuilder<{ count: number }>(
      session,
      'behavior-postnew-replace',
    )
      .setUpdateMode('postNew')
      .setOldMessageDisposal('replaceWithClosed', {
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
  // Demo 3 — postNew + stripComponents (default disposal, baseline)
  //
  // updateMode:'postNew'  → new message posted on every interaction
  // oldMessageDisposal:'stripComponents' → previous message keeps its embed
  //   but the buttons are removed (this is the default, shown for comparison)
  //
  // Expected: previous messages retain their embed/content but have no
  // buttons; the latest message is at the bottom with the updated count.
  // -------------------------------------------------------------------------
  flowcord.registerMenu('behavior-postnew-strip', (session) =>
    new MenuBuilder<{ count: number }>(
      session,
      'behavior-postnew-strip',
    )
      .setUpdateMode('postNew')
      .setOldMessageDisposal('stripComponents')
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
  // Demo 4a — message collection, editInPlace (default updateMode)
  //
  // deleteUserMessages:true → the user's typed message is deleted (best-effort)
  // updateMode not set (defaults to 'editInPlace') → the bot message is edited
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
      .setOldMessageDisposal('stripComponents', {
        deleteUserMessages: true,
      })
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
      .setMessageHandler(async (ctx, text) => {
        ctx.state.set('collected', text);
      })
      .setReturnable()
      .build(),
  );

  // -------------------------------------------------------------------------
  // Demo 4b — message collection, postNew (explicit updateMode)
  //
  // deleteUserMessages:true → the user's typed message is deleted (best-effort)
  // updateMode:'postNew' → the old bot message is stripped and a new one is
  //   posted at the bottom of chat with the updated state
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
      .setUpdateMode('postNew')
      .setOldMessageDisposal('delete', {
        deleteUserMessages: true,
      })
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
      .setMessageHandler(async (ctx, text) => {
        ctx.state.set('collected', text);
      })
      .setReturnable()
      .build(),
  );

  // -------------------------------------------------------------------------
  // Demo 5 — ephemeral + postNew + delete + ephemeralFallback
  //
  // setEphemeral()  → this menu is only visible to the invoking user
  // updateMode:'postNew'  → new message posted on every interaction
  // oldMessageDisposal:'delete'  → attempts to delete the old message
  // ephemeralFallback:'replaceWithClosed'  → Discord prevents bots from
  //   deleting ephemeral messages, so this fallback fires instead, replacing
  //   the old message with the closedMessage string
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
      .setUpdateMode('postNew')
      .setOldMessageDisposal('delete', {
        ephemeralFallback: 'replaceWithClosed',
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
}
