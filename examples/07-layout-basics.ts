/**
 * Example 07 — Layout Basics
 *
 * Introduces the layout (Components v2) rendering mode as an alternative to
 * the embed-based mode used in examples 01–06.
 *
 * Slash command: /panel
 *
 * Concepts shown:
 *   - setLayout() instead of setEmbeds() + setButtons()
 *   - text(), separator(), container(), actionRow(), button()
 *   - setCancellable() in layout mode (reserved Cancel button)
 *   - Per-render state toggling (ping/pong counter)
 */

import { ButtonStyle, SlashCommandBuilder } from 'discord.js';
// Local dev (flowcord-core repo only):
// import {
//   type FlowCord,
//   MenuBuilder,
//   text,
//   separator,
//   container,
//   actionRow,
//   button,
// } from '../src/index.ts';
import {
  type FlowCord,
  MenuBuilder,
  text,
  separator,
  container,
  actionRow,
  button,
} from '@flowcord/core';

type PanelState = {
  pings: number;
};

// --- Slash command definitions ---
export const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription(
      'Open the FlowCord example info panel (layout mode)',
    )
    .toJSON(),
];

// --- Menu registration ---
export function register(flowcord: FlowCord): void {
  flowcord.registerMenu('panel', (session) =>
    new MenuBuilder<PanelState>(session, 'panel')
      .setLayout((ctx) => {
        const pings = ctx.state.get('pings') ?? 0;

        return [
          container({
            accentColor: 0x5865f2,
            children: [
              text('# FlowCord Example Bot'),
              text(
                'A demo bot showcasing the FlowCord menu framework.\n' +
                  'This panel is rendered in **layout mode** (Components v2).',
              ),
              separator({ divider: true }),
              text('**Available example commands:**'),
              text(
                '`/weather`  — Example 01: quickstart (embeds mode)\n' +
                  '`/cookbook` — Example 02: multi-menu navigation\n' +
                  '`/workout`  — Example 03: state & lifecycle\n' +
                  '`/party`    — Example 04: sub-menu continuation\n' +
                  '`/event`    — Example 05: selects & modals\n' +
                  '`/shop`     — Example 06: pagination & guards',
              ),
            ],
          }),
          separator({ spacing: 'small' }),
          text(
            pings === 0
              ? '*Click Ping to test button interactions in layout mode.*'
              : `Pong! You've pinged **${pings}** time${pings === 1 ? '' : 's'}.`,
          ),
          actionRow([
            button({
              label: 'Ping',
              style: ButtonStyle.Primary,
              action: async (ctx) => {
                const prev = ctx.state.get('pings') ?? 0;
                ctx.state.set('pings', prev + 1);
              },
            }),
            button({
              label: 'Reset',
              style: ButtonStyle.Secondary,
              disabled: pings === 0,
              action: async (ctx) => {
                ctx.state.set('pings', 0);
              },
            }),
          ]),
        ];
      })
      .setCancellable()
      .build(),
  );
}
