/**
 * Example 11 — Layout Paginated Group
 *
 * Demonstrates paginatedGroup() in layout mode: framework-managed button
 * pagination within a Components v2 layout.
 *
 * Slash command: /explorer
 *
 * Concepts shown:
 *   - paginatedGroup() for automatic button page slicing in layout mode
 *   - ButtonPaginationOptions: perPage, stableButtons, labels
 *   - Combining paginatedGroup() with other layout components
 *   - Button actions inside a paginated group updating per-render state
 */

import { ButtonStyle, SlashCommandBuilder } from 'discord.js';
// Local dev (flowcord-core repo only):
// import {
//   type FlowCord,
//   MenuBuilder,
//   text,
//   separator,
//   container,
//   paginatedGroup,
//   button,
// } from '../src/index.ts';
import {
  type FlowCord,
  MenuBuilder,
  text,
  separator,
  container,
  paginatedGroup,
  button,
} from '@flowcord/core';

// --- Types ---
type ExplorerState = { selectedId: string | null };

interface Body {
  id: string;
  label: string;
  emoji: string;
  type: string;
  description: string;
}

// --- Data (10 bodies → 3 pages at perPage: 4) ---
const bodies: Body[] = [
  {
    id: 'mercury',
    label: 'Mercury',
    emoji: '⚫',
    type: 'Rocky planet',
    description:
      'Closest planet to the Sun. Extreme temperature swings with no atmosphere to retain heat.',
  },
  {
    id: 'venus',
    label: 'Venus',
    emoji: '🟡',
    type: 'Rocky planet',
    description:
      'Hottest planet in the solar system due to its thick CO₂ atmosphere and greenhouse effect.',
  },
  {
    id: 'earth',
    label: 'Earth',
    emoji: '🌍',
    type: 'Rocky planet',
    description:
      'The only known planet to harbour life. 71% of the surface is covered by water.',
  },
  {
    id: 'mars',
    label: 'Mars',
    emoji: '🔴',
    type: 'Rocky planet',
    description:
      'The Red Planet. Home to Olympus Mons, the tallest volcano in the solar system.',
  },
  {
    id: 'jupiter',
    label: 'Jupiter',
    emoji: '🟠',
    type: 'Gas giant',
    description:
      'Largest planet in the solar system. The Great Red Spot is a storm larger than Earth.',
  },
  {
    id: 'saturn',
    label: 'Saturn',
    emoji: '🪐',
    type: 'Gas giant',
    description:
      'Iconic ring system made of ice and rock. Less dense than water.',
  },
  {
    id: 'uranus',
    label: 'Uranus',
    emoji: '🔵',
    type: 'Ice giant',
    description:
      'Rotates on its side with an axial tilt of 98°. Has faint rings and 27 known moons.',
  },
  {
    id: 'neptune',
    label: 'Neptune',
    emoji: '💙',
    type: 'Ice giant',
    description:
      'Farthest planet from the Sun. Fastest winds in the solar system at up to 2,100 km/h.',
  },
  {
    id: 'pluto',
    label: 'Pluto',
    emoji: '⚪',
    type: 'Dwarf planet',
    description:
      'Reclassified as a dwarf planet in 2006. Has a heart-shaped nitrogen ice plain.',
  },
  {
    id: 'moon',
    label: 'Moon',
    emoji: '🌕',
    type: "Earth's moon",
    description:
      "Earth's only natural satellite. Stabilizes Earth's axial tilt and drives ocean tides.",
  },
];

// --- Slash command definitions ---
export const commands = [
  new SlashCommandBuilder()
    .setName('explorer')
    .setDescription(
      'Browse solar system bodies (tests paginatedGroup in layout mode)',
    )
    .toJSON(),
];

// --- Menu registration ---
export function register(flowcord: FlowCord): void {
  flowcord.registerMenu('explorer', (session) =>
    new MenuBuilder<ExplorerState>(session, 'explorer')
      .setLayout((ctx) => {
        const selectedId = ctx.state.get('selectedId') ?? null;
        const selected =
          bodies.find((b) => b.id === selectedId) ?? null;

        return [
          container({
            accentColor: 0x5865f2,
            children: [
              text('# 🌌 Solar System Explorer'),
              text(
                'Select a body from the paginated list below to view its details.\n' +
                  'Use the **Next** and **Previous** buttons to page through all 10 entries.',
              ),
            ],
          }),
          separator({ divider: true }),
          paginatedGroup(
            bodies.map((b) =>
              button({
                label: `${b.emoji} ${b.label}`,
                style:
                  selectedId === b.id
                    ? ButtonStyle.Primary
                    : ButtonStyle.Secondary,
                action: async (ctx) => {
                  ctx.state.set('selectedId', b.id);
                },
              }),
            ),
            { perPage: 4, stableButtons: true },
          ),
          separator({ spacing: 'small' }),
          selected
            ? container({
                accentColor: 0x57f287,
                children: [
                  text(`## ${selected.emoji} ${selected.label}`),
                  text(`*${selected.type}*`),
                  text(selected.description),
                ],
              })
            : text('*Select a body above to see its details.*'),
        ];
      })
      .setCancellable()
      .build(),
  );
}
