/**
 * Example 10 — Mode Transitions
 *
 * Tests navigation between embeds-mode and layout-mode menus.
 * Each transition (embeds → layout, layout → embeds) triggers the
 * renderer's followUp + delete cycle to swap the message type.
 *
 * Slash command: /showcase
 * Flow: Feature List (embeds) → Feature Detail (layout) → Feature List (embeds)
 *
 * Concepts shown:
 *   - Navigating from an embeds-mode menu to a layout-mode menu
 *   - Navigating back from layout to embeds (the reverse transition)
 *   - Both transitions go through MenuRenderer.sendPayload's modeChanged branch,
 *     which calls followUp() on the command interaction and deletes the old message
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
//   text,
//   separator,
//   container,
//   section,
//   thumbnail,
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
  section,
  thumbnail,
  actionRow,
  button,
} from '@flowcord/core';

// --- Slash command definitions ---
export const commands = [
  new SlashCommandBuilder()
    .setName('showcase')
    .setDescription(
      'Browse FlowCord features (tests embeds ↔ layout transitions)',
    )
    .toJSON(),
];

// --- Data ---
interface Feature {
  id: string;
  name: string;
  emoji: string;
  color: number;
  tagline: string;
  description: string;
  highlights: string[];
  thumbnailUrl: string;
}

const features: Feature[] = [
  {
    id: 'navigation',
    name: 'Navigation',
    emoji: '🧭',
    color: 0x5865f2,
    tagline: 'Multi-menu flows with back-stack history',
    description:
      'FlowCord manages a navigation stack so users can move forward and ' +
      'back through menus without you writing any routing logic.',
    highlights: [
      'goTo() pushes a menu onto the session stack',
      'goBack() returns to the previous menu',
      'setTrackedInHistory() / setReturnable() control stack behavior',
      'setFallbackMenu() handles direct deep-links with no prior history',
    ],
    thumbnailUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
  },
  {
    id: 'state',
    name: 'State Management',
    emoji: '💾',
    color: 0x57f287,
    tagline: 'Per-render and per-session typed state',
    description:
      'Two scopes of state let you persist data across a session or ' +
      'keep it local to a single menu render.',
    highlights: [
      'ctx.state — scoped to the current menu, reset on navigation',
      'ctx.session.state — persists for the lifetime of the session',
      'setPreserveStateOnReturn() keeps menu state when navigating back',
      'State is typed via the MenuBuilder TState generic',
    ],
    thumbnailUrl: 'https://cdn.discordapp.com/embed/avatars/1.png',
  },
  {
    id: 'layout',
    name: 'Layout Mode',
    emoji: '🎨',
    color: 0xfee75c,
    tagline: 'Components v2 rendering with display primitives',
    description:
      "setLayout() enables Discord's Components v2 flag and unlocks " +
      'display components: containers, sections, thumbnails, and more.',
    highlights: [
      'setLayout() replaces setEmbeds() + setButtons()',
      'container(), section(), text(), separator() for rich layouts',
      'section() supports thumbnail or button accessories',
      'paginatedGroup() for framework-managed button pages',
    ],
    thumbnailUrl: 'https://cdn.discordapp.com/embed/avatars/2.png',
  },
  {
    id: 'guards',
    name: 'Guards & Pipelines',
    emoji: '🛡️',
    color: 0xed4245,
    tagline: 'Composable pre-action validation',
    description:
      'guard() lets you block or redirect an action before it runs. ' +
      'pipeline() composes multiple guards and actions into one.',
    highlights: [
      'guard(fn) — throw GuardFailedError to abort with a message',
      'pipeline(guard, action) — compose multiple steps in sequence',
      'Guards receive the full MenuContext for state-aware checks',
      'Pair with ctx.session.state for cross-menu validation',
    ],
    thumbnailUrl: 'https://cdn.discordapp.com/embed/avatars/3.png',
  },
];

// --- Menu registration ---
export function register(flowcord: FlowCord): void {
  // ---------------------------------------------------------------------------
  // Menu 1: Feature List — EMBEDS mode
  //
  // When the user picks a feature, goTo() navigates to 'showcase-detail'
  // which is in LAYOUT mode. The renderer detects the mode change and sends
  // a followUp message (layout), then deletes this embeds message.
  // ---------------------------------------------------------------------------
  flowcord.registerMenu('showcase', (session) =>
    new MenuBuilder(session, 'showcase')
      .setEmbeds(() => [
        new EmbedBuilder()
          .setTitle('✨ FlowCord Feature Showcase')
          .setDescription(
            'Select a feature to view its detail page.\n\n' +
              features
                .map((f) => `**${f.emoji} ${f.name}** — ${f.tagline}`)
                .join('\n'),
          )
          .setColor(0x5865f2)
          .setFooter({
            text: 'Detail pages use layout mode (Components v2)',
          }),
      ])
      .setButtons(() =>
        features.map((f) => ({
          label: `${f.emoji} ${f.name}`,
          style: ButtonStyle.Primary,
          action: goTo('showcase-detail', { featureId: f.id }),
        })),
      )
      .setCancellable()
      .setTrackedInHistory() // showcase-detail can goBack() here
      .build(),
  );

  // ---------------------------------------------------------------------------
  // Menu 2: Feature Detail — LAYOUT mode
  //
  // Rendered after navigating from the embeds list above. The renderer detects
  // the mode change (embeds → layout) on first render here.
  //
  // When the user presses Back, goBack() returns to 'showcase' (embeds mode).
  // The renderer detects the reverse transition (layout → embeds) and again
  // sends a followUp + deletes the layout message.
  // ---------------------------------------------------------------------------
  flowcord.registerMenu('showcase-detail', (session, options) => {
    const featureId = options?.featureId as string;
    const feature = features.find((f) => f.id === featureId)!;

    return new MenuBuilder(session, 'showcase-detail')
      .setLayout(() => [
        section({
          text: [
            `# ${feature.emoji} ${feature.name}`,
            feature.tagline,
          ],
          accessory: thumbnail({
            url: feature.thumbnailUrl,
            description: feature.name,
          }),
        }),
        separator({ divider: true }),
        container({
          accentColor: feature.color,
          children: [
            text(feature.description),
            separator({ spacing: 'small' }),
            text('**Highlights:**'),
            ...feature.highlights.map((h) => text(`• ${h}`)),
          ],
        }),
        separator({ spacing: 'small' }),
        actionRow([
          button({
            label: '🔖 Bookmark',
            style: ButtonStyle.Secondary,
            action: async (ctx) => {
              const bookmarks =
                (ctx.sessionState.get('bookmarks') as string[]) ?? [];
              if (!bookmarks.includes(feature.id)) {
                ctx.sessionState.set('bookmarks', [
                  ...bookmarks,
                  feature.id,
                ]);
              }
            },
          }),
        ]),
      ])
      .setReturnable() // ← Back returns to showcase (embeds mode — triggers layout → embeds transition)
      .setFallbackMenu('showcase')
      .build();
  });
}
