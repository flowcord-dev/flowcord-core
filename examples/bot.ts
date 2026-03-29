/**
 * FlowCord Examples — Unified Bot Entry Point
 *
 * Runs all 6 example menus as a single bot with one shared Client and FlowCord
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
 *   /weather         — Example 01: basic menu with state
 *   /secret-weather  — Example 01: ephemeral menu
 *   /cookbook        — Example 02: multi-menu navigation
 *   /workout         — Example 03: state management & lifecycle hooks
 *   /party           — Example 04: sub-menu with continuation
 *   /event           — Example 05: select menus & modals
 *   /shop            — Example 06: pagination & guards
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

// --- Bot setup ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const flowcord = new FlowCord({ client });

// --- Register all menus ---
registerQuickstart(flowcord);
registerCookbook(flowcord);
registerWorkout(flowcord);
registerParty(flowcord);
registerEvent(flowcord);
registerShop(flowcord);

// --- Slash command definitions ---
const allCommands = [
  ...quickstartCommands,
  ...cookbookCommands,
  ...workoutCommands,
  ...partyCommands,
  ...eventCommands,
  ...shopCommands,
];

// --- Register slash commands on ready, then log in ---
client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user?.tag}`);

  const token = process.env.DISCORD_BOT_TOKEN!;
  const appId = process.env.APP_ID!;
  const guildId = process.env.DEV_GUILD_ID;

  const rest = new REST().setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(appId, guildId), {
      body: allCommands,
    });
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
