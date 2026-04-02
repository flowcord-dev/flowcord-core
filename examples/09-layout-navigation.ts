/**
 * Example 09 — Layout Navigation
 *
 * Demonstrates navigating between menus in layout mode, including the
 * reserved Back button and goTo() / goBack() in a Components v2 context.
 *
 * Slash command: /hub
 * Flow: Hub → Category Detail
 *
 * Concepts shown:
 *   - setLayout() with setTrackedInHistory() and setReturnable()
 *   - goTo() / goBack() in layout mode
 *   - Reserved Back button injected into a layout-mode message
 *   - container() with accentColor for visual hierarchy
 *   - Passing options through goTo() and reading them in the target menu
 */

import { ButtonStyle, SlashCommandBuilder } from 'discord.js';
// Local dev (flowcord-core repo only):
// import {
//   type FlowCord,
//   MenuBuilder,
//   goTo,
//   text,
//   separator,
//   container,
//   actionRow,
//   button,
// } from '../src/index.ts';
import {
  type FlowCord,
  MenuBuilder,
  goTo,
  text,
  separator,
  container,
  actionRow,
  button,
} from '@flowcord/core';

// --- Slash command definitions ---
export const commands = [
  new SlashCommandBuilder()
    .setName('hub')
    .setDescription('Navigate between layout-mode menus')
    .toJSON(),
];

// --- Data ---
interface Category {
  id: string;
  label: string;
  emoji: string;
  color: number;
  description: string;
  topics: string[];
}

const categories: Category[] = [
  {
    id: 'basics',
    label: 'Basics',
    emoji: '📖',
    color: 0x5865f2,
    description:
      'Core FlowCord concepts: menus, sessions, and navigation.',
    topics: [
      'MenuBuilder — define menus with a fluent builder',
      'registerMenu() — attach menus to a FlowCord instance',
      'goTo() / goBack() — navigate the menu stack',
      'setCancellable() — add a reserved Cancel button',
    ],
  },
  {
    id: 'state',
    label: 'State & Hooks',
    emoji: '🔄',
    color: 0x57f287,
    description:
      'Per-render state, session state, and lifecycle hooks.',
    topics: [
      'ctx.state — scoped to the current menu render',
      'ctx.session.state — persists across the whole session',
      'onEnter / onLeave — run logic on menu transitions',
      'beforeRender / afterRender — wrap every render cycle',
    ],
  },
  {
    id: 'layout',
    label: 'Layout Mode',
    emoji: '🎨',
    color: 0xfee75c,
    description:
      'Components v2 (display components) rendering with rich layout primitives.',
    topics: [
      'setLayout() — replaces setEmbeds() + setButtons()',
      'container() — grouping with optional accent color',
      'section() — text + thumbnail or button accessory',
      'paginatedGroup() — framework-managed button pagination',
    ],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    emoji: '⚙️',
    color: 0xed4245,
    description:
      'Guards, behavior policies, and sub-menu continuation.',
    topics: [
      'guard() — conditionally block navigation actions',
      'pipeline() — compose multiple actions in sequence',
      'setPreserveStateOnReturn() — keep state when navigating back',
      'BehaviorConfig — configure timeouts, disposal, and ephemeral',
    ],
  },
];

// --- Menu registration ---
export function register(flowcord: FlowCord): void {
  // ---------------------------------------------------------------------------
  // Hub — top-level category picker
  // ---------------------------------------------------------------------------
  flowcord.registerMenu('hub', (session) =>
    new MenuBuilder(session, 'hub')
      .setLayout(() => [
        container({
          accentColor: 0x5865f2,
          children: [
            text('# FlowCord Hub'),
            text(
              'Select a category below to explore FlowCord concepts.\n' +
                'This menu uses **layout mode** with `goTo()` navigation.',
            ),
          ],
        }),
        separator({ divider: true }),
        actionRow(
          categories.map((cat) =>
            button({
              label: `${cat.emoji} ${cat.label}`,
              style: ButtonStyle.Primary,
              action: goTo('hub-detail', { categoryId: cat.id }),
            }),
          ),
        ),
      ])
      .setEphemeral()
      .setCancellable()
      .setTrackedInHistory() // hub-detail can goBack() to here
      .build(),
  );

  // ---------------------------------------------------------------------------
  // Category Detail — shows topics for the selected category
  // ---------------------------------------------------------------------------
  flowcord.registerMenu('hub-detail', (session, options) => {
    const categoryId = options?.categoryId as string;
    const cat = categories.find((c) => c.id === categoryId)!;

    return new MenuBuilder(session, 'hub-detail')
      .setLayout(() => [
        container({
          accentColor: cat.color,
          children: [
            text(`# ${cat.emoji} ${cat.label}`),
            text(cat.description),
            separator({ divider: true }),
            text('**Topics covered:**'),
            text(cat.topics.map((t) => `• ${t}`).join('\n')),
          ],
        }),
      ])
      .setReturnable() // injects the reserved ← Back button
      .setFallbackMenu('hub') // if opened directly (no stack), Back → hub
      .build();
  });
}
