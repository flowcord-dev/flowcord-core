/**
 * Example 08 — Layout Sections
 *
 * Demonstrates section-based layouts with thumbnail and button accessories.
 *
 * Slash command: /guide
 *
 * Concepts shown:
 *   - section() with thumbnail() accessory
 *   - section() with link button() accessory (see notes below)
 *   - text() for content that doesn't need a paired visual element
 *   - container() for grouped plain-text content
 *   - setCancellable() in layout mode
 *
 * Notes on section() usage:
 *   - Discord requires sections to have an accessory. The accessory field is
 *     required in FlowCord's types to enforce this at compile time.
 *   - Link buttons (ButtonStyle.Link) as section accessories may or may not be
 *     supported by Discord's API. This example includes one to test that path —
 *     if it fails, the console error from handleInteraction will show the
 *     specific field validation error.
 */

import { ButtonStyle, SlashCommandBuilder } from 'discord.js';
// Local dev (flowcord-core repo only):
// import {
//   type FlowCord,
//   MenuBuilder,
//   text,
//   separator,
//   container,
//   section,
//   thumbnail,
//   button,
//   actionRow,
// } from '../src/index.ts';
import {
  type FlowCord,
  MenuBuilder,
  text,
  separator,
  container,
  section,
  thumbnail,
  button,
  actionRow,
} from '@flowcord/core';

// --- Types ---
type GuideState = { read: boolean };

// --- Slash command definitions ---
export const commands = [
  new SlashCommandBuilder()
    .setName('guide')
    .setDescription(
      'Browse the FlowCord getting started guide (layout sections)',
    )
    .toJSON(),
];

// --- Menu registration ---
export function register(flowcord: FlowCord): void {
  flowcord.registerMenu('guide', (session) =>
    new MenuBuilder<GuideState>(session, 'guide')
      .setLayout((ctx) => {
        const read = ctx.state.get('read') ?? false;

        return [
          // Section with thumbnail accessory
          section({
            text: [
              '## Getting Started with FlowCord',
              'FlowCord is a lifecycle-driven menu framework for Discord.js.',
            ],
            accessory: thumbnail({
              url: 'https://cdn.discordapp.com/embed/avatars/0.png',
              description: 'FlowCord',
            }),
          }),
          separator({ divider: true }),

          // Plain text() inside a container for content without a visual pairing
          container({
            children: [
              text('**Step 1 — Install**'),
              text('`npm install @flowcord/core`'),
              separator({ spacing: 'small' }),
              text('**Step 2 — Register a menu**'),
              text(
                'Call `flowcord.registerMenu()` with a `MenuBuilder`.',
              ),
            ],
          }),
          separator({ spacing: 'small' }),

          // Section with a link button accessory — testing this path against the API.
          // If Discord does not support link buttons as section accessories, the
          // console error will include the specific field validation message.
          section({
            text: [
              '**Step 3 — Read the docs**',
              'Full API reference and guides on the docs site.',
            ],
            accessory: button({
              label: 'Open Docs',
              style: ButtonStyle.Link,
              url: 'https://flowcord-dev.github.io/flowcord-guide/',
            }),
          }),
          separator({ spacing: 'small' }),

          text(
            read
              ? '✅ Marked as read!'
              : "*Mark this guide as read when you're done.*",
          ),
          actionRow([
            button({
              label: read ? 'Unmark' : 'Mark as Read',
              style: read
                ? ButtonStyle.Secondary
                : ButtonStyle.Success,
              action: async (ctx) => {
                ctx.state.set('read', !ctx.state.get('read'));
              },
            }),
          ]),
        ];
      })
      .setCancellable()
      .build(),
  );
}
