/**
 * FlowCord Examples — Unified Bot Entry Point
 *
 * Runs all 13 example menus as a single bot with one shared Client and FlowCord
 * instance. This mirrors how you would structure a real multi-menu Discord bot.
 *
 * Setup:
 *   1. npm run flow:setup        — create .env from .env.example
 *   2. Fill in .env              — add DISCORD_BOT_TOKEN and APP_ID
 *   3. npm run flow              — start the bot
 *
 * Slash commands are registered automatically on startup.
 * Set DEV_GUILD_ID in .env for instant registration (recommended during development).
 * Leave DEV_GUILD_ID blank to register globally (may take up to 1 hour to propagate).
 *
 * Available commands once running:
 *   /weather   — Example 01: basic menu with state
 *   /cookbook  — Example 02: multi-menu navigation
 *   /workout   — Example 03: state management & lifecycle hooks
 *   /party     — Example 04: sub-menu with continuation
 *   /event     — Example 05: select menus & modals
 *   /shop      — Example 06: pagination & guards
 *   /panel     — Example 07: layout mode basics (Components v2)
 *   /guide     — Example 08: layout sections & link button accessories (see issue #8)
 *   /hub       — Example 09: layout mode navigation (goTo / Back)
 *   /showcase  — Example 10: embeds ↔ layout mode transitions
 *   /explorer  — Example 11: layout paginated group (paginatedGroup)
 *   /subclass  — Example 12: ephemeral behavior + subclassing
 *   /behavior  — Example 13: behavior policy settings (setMessageCleanup, deleteUserMessages)

 */

import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
// Local dev (flowcord-core repo only):
// import { FlowCord } from '../src/index.ts';
import { FlowCord } from '@flowcord/core';

import {
  register as registerQuickstart,
  commands as quickstartCommands,
} from './01-quickstart.ts';
import {
  register as registerCookbook,
  commands as cookbookCommands,
} from './02-multi-menu-navigation.ts';
import {
  register as registerWorkout,
  commands as workoutCommands,
} from './03-state-and-lifecycle.ts';
import {
  register as registerParty,
  commands as partyCommands,
} from './04-sub-menu-continuation.ts';
import {
  register as registerEvent,
  commands as eventCommands,
} from './05-selects-and-modals.ts';
import {
  register as registerShop,
  commands as shopCommands,
} from './06-pagination-and-guards.ts';
import {
  register as registerPanel,
  commands as panelCommands,
} from './07-layout-basics.ts';
import {
  register as registerGuide,
  commands as guideCommands,
} from './08-layout-sections.ts';
import {
  register as registerHub,
  commands as hubCommands,
} from './09-layout-navigation.ts';
import {
  register as registerShowcase,
  commands as showcaseCommands,
} from './10-mode-transitions.ts';
import {
  register as registerExplorer,
  commands as explorerCommands,
} from './11-layout-paginated-group.ts';
import {
  register as registerSubclass,
  commands as subclassCommands,
} from './12-behavior-subclass.ts';
import {
  register as registerBehavior,
  commands as behaviorCommands,
} from './13-behavior-policy.ts';

// --- Bot setup ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
const flowcord = new FlowCord({ client });

// --- Register all menus ---
registerQuickstart(flowcord);
registerCookbook(flowcord);
registerWorkout(flowcord);
registerParty(flowcord);
registerEvent(flowcord);
registerShop(flowcord);
registerPanel(flowcord);
registerGuide(flowcord);
registerHub(flowcord);
registerShowcase(flowcord);
registerExplorer(flowcord);
registerSubclass(flowcord);
registerBehavior(flowcord);

// --- Slash command definitions ---
const allCommands = [
  ...quickstartCommands,
  ...cookbookCommands,
  ...workoutCommands,
  ...partyCommands,
  ...eventCommands,
  ...shopCommands,
  ...panelCommands,
  ...guideCommands,
  ...hubCommands,
  ...showcaseCommands,
  ...explorerCommands,
  ...subclassCommands,
  ...behaviorCommands,
];

// --- Register slash commands on ready, then log in ---
client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user?.tag}`);

  const token = process.env.DISCORD_BOT_TOKEN!;
  const appId = process.env.APP_ID!;
  const guildId = process.env.DEV_GUILD_ID;

  const rest = new REST().setToken(token);

  try {
    if (guildId) {
      await rest.put(
        Routes.applicationGuildCommands(appId, guildId),
        { body: allCommands },
      );
      console.log(
        `Slash commands registered to guild ${guildId} (instant).`,
      );
    } else {
      await rest.put(Routes.applicationCommands(appId), {
        body: allCommands,
      });
      console.log(
        'Slash commands registered globally (may take up to 1 hour to propagate).',
      );
    }
  } catch (error) {
    console.error('Failed to register slash commands:', error);
    process.exit(1);
  }
});

// --- Interaction handler ---
// Menu names match command names, so commandName routes directly to the right menu.
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await flowcord.handleInteraction(
      interaction,
      interaction.commandName,
    );
  } else if (interaction.isMessageComponent()) {
    flowcord.routeComponentInteraction(interaction);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
