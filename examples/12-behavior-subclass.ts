/**
 * Example 12 — Behavior Defaults and Overrides via MenuBuilder Subclass
 *
 * Demonstrates how a MenuBuilder subclass can set class-level ephemeral
 * behavior that participates in the full resolution hierarchy.
 *
 * Slash commands:
 *   /private-default  — subclass sets classDefault: ephemeral=true
 *                       (can be overridden by .setEphemeral(false) or session/global)
 *   /private-forced   — subclass sets classOverride: ephemeral=true
 *                       (wins over .setEphemeral(false), yields to session/global override)
 *
 * Priority chain (highest → lowest):
 *   globalOverride → sessionOverride → classOverride
 *     → explicit (.setEphemeral) → classDefault → sessionDefault → globalDefault → false
 *
 * Concepts shown:
 *   - Extending MenuBuilder with _setDefaultBehavior()
 *   - Extending MenuBuilder with _setOverrideBehavior()
 *   - How .setEphemeral() interacts with class-level behavior
 *   - Registering menus from subclass instances
 */

import {
  EmbedBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} from 'discord.js';
// Local dev (flowcord-core repo only):
// import {
//   type FlowCord,
//   type MenuSessionLike,
//   MenuBuilder,
//   closeMenu,
// } from '../src/index.ts';
import {
  type FlowCord,
  type MenuSessionLike,
  MenuBuilder,
  closeMenu,
} from '@flowcord/core';

// ---------------------------------------------------------------------------
// Subclass A — classDefault: ephemeral=true
//
// Menus built with this class are ephemeral by default, but callers can
// override it per-menu with .setEphemeral(false), or the bot owner can
// force public replies via a session/global override policy.
// ---------------------------------------------------------------------------
class PrivateMenuBuilder extends MenuBuilder {
  constructor(session: MenuSessionLike, name: string) {
    super(session, name);
    this._setDefaultBehavior({ ephemeral: true });
  }
}

// ---------------------------------------------------------------------------
// Subclass B — classOverride: ephemeral=true
//
// Menus built with this class are always ephemeral regardless of
// .setEphemeral(false) on the builder. Only a session or global override
// policy can force them public.
// ---------------------------------------------------------------------------
class AlwaysPrivateMenuBuilder extends MenuBuilder {
  constructor(session: MenuSessionLike, name: string) {
    super(session, name);
    this._setOverrideBehavior({ ephemeral: true });
  }
}

// ---------------------------------------------------------------------------
// Slash command definitions
// ---------------------------------------------------------------------------
export const commands = [
  new SlashCommandBuilder()
    .setName('private-default')
    .setDescription(
      'Ephemeral by default — .setEphemeral(false) can make it public',
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('private-forced')
    .setDescription(
      'Always ephemeral — classOverride wins over .setEphemeral(false)',
    )
    .toJSON(),
];

// ---------------------------------------------------------------------------
// Menu registrations
// ---------------------------------------------------------------------------
export function register(flowcord: FlowCord): void {
  // --- Menu 1: classDefault ephemeral ---
  //
  // Because PrivateMenuBuilder uses _setDefaultBehavior, .setEphemeral(false)
  // here wins (explicit > classDefault) and the reply will be public.
  // Remove .setEphemeral(false) and the reply goes back to ephemeral.
  flowcord.registerMenu('private-default', (session) =>
    new PrivateMenuBuilder(session, 'private-default')
      .setEphemeral(false) // explicit=false beats classDefault=true → public
      .setEmbeds(() => [
        new EmbedBuilder()
          .setTitle('Default-Ephemeral Menu')
          .setDescription(
            'This builder defaults to ephemeral, but `.setEphemeral(false)` made it public.\n\n' +
              'Try removing `.setEphemeral(false)` from the registration — it will go back to ephemeral.',
          )
          .setColor(0x5865f2),
      ])
      .setButtons(() => [
        {
          label: 'Close',
          style: ButtonStyle.Secondary,
          action: closeMenu(),
        },
      ])
      .build(),
  );

  // --- Menu 2: classOverride ephemeral ---
  //
  // AlwaysPrivateMenuBuilder uses _setOverrideBehavior, so classOverride=true
  // wins over explicit=false. This reply will always be ephemeral.
  // Only a session/global override policy can make it public.
  flowcord.registerMenu('private-forced', (session) =>
    new AlwaysPrivateMenuBuilder(session, 'private-forced')
      .setEphemeral(false) // explicit=false, but classOverride=true wins → still ephemeral
      .setEmbeds(() => [
        new EmbedBuilder()
          .setTitle('Override-Ephemeral Menu')
          .setDescription(
            'This builder uses `_setOverrideBehavior`, so `.setEphemeral(false)` has no effect.\n\n' +
              'The reply is always ephemeral unless the engine is configured with a ' +
              'session or global override policy that forces `ephemeral: false`.',
          )
          .setColor(0xed4245),
      ])
      .setButtons(() => [
        {
          label: 'Close',
          style: ButtonStyle.Secondary,
          action: closeMenu(),
        },
      ])
      .build(),
  );
}
