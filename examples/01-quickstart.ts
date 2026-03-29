/**
 * Example 01 — Quick Start
 *
 * Bare-bones FlowCord setup with a single slash command in a brand new bot.
 * This is the minimum code needed to get a FlowCord menu working.
 *
 * Slash commands: /weather, /secret-weather
 * Shows the current weather for a fictional city and lets the user refresh it.
 *
 * Concepts shown:
 *   - Registering a menu with flowcord.registerMenu()
 *   - ctx.state for per-menu state
 *   - setEmbeds() and setButtons() basics
 *   - setup() for one-time state initialization
 *   - closeMenu() and setCancellable() for closing
 *   - setEphemeral(true) for user-only messages
 */

import { EmbedBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
// Local dev (flowcord-core repo only): import { type FlowCord, MenuBuilder, closeMenu } from '../src/index.ts';
import { type FlowCord, MenuBuilder, closeMenu } from '@flowcord/core';

// --- Slash command definitions ---
export const commands = [
  new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Check the weather in Cerulean City')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('secret-weather')
    .setDescription('Get a secret weather report (only visible to you)')
    .toJSON(),
];

// --- Fake data ---
const weatherConditions = [
  '☀️ Sunny',
  '🌧️ Rainy',
  '⛈️ Stormy',
  '🌤️ Partly Cloudy',
  '❄️ Snowy',
];

function getRandomWeather() {
  const condition =
    weatherConditions[Math.floor(Math.random() * weatherConditions.length)];
  const temp = Math.floor(Math.random() * 35) + 5; // 5–40°C
  return { condition, temp };
}

// --- Menu registration ---
export function register(flowcord: FlowCord): void {
  flowcord.registerMenu('weather', (session) =>
    new MenuBuilder(session, 'weather')
      .setup((ctx) => {
        // Initialize state with random weather
        const weather = getRandomWeather();
        ctx.state.set('condition', weather.condition);
        ctx.state.set('temp', weather.temp);
      })
      .setEmbeds((ctx) => [
        new EmbedBuilder()
          .setTitle('🌍 Weather Report — Cerulean City')
          .setDescription(
            `**Condition:** ${ctx.state.get('condition')}\n` +
              `**Temperature:** ${ctx.state.get('temp')}°C`
          )
          .setColor(0x3498db)
          .setFooter({ text: 'Press Refresh to check again' })
          .setTimestamp(),
      ])
      .setButtons(() => [
        {
          label: '🔄 Refresh',
          style: ButtonStyle.Primary,
          action: async (ctx) => {
            const weather = getRandomWeather();
            ctx.state.set('condition', weather.condition);
            ctx.state.set('temp', weather.temp);
            // No navigation — menu re-renders automatically with new state
          },
        },
        {
          label: 'Close',
          style: ButtonStyle.Secondary,
          action: closeMenu(),
        },
      ])
      .setCancellable() // Adds a Cancel button
      .build()
  );

  flowcord.registerMenu('secret-weather', (session) =>
    new MenuBuilder(session, 'secret-weather')
      .setEmbeds(() => [
        new EmbedBuilder()
          .setTitle('🤫 Secret Weather Report')
          .setDescription('This message is only visible to you!')
          .setColor(0x9b59b6),
      ])
      .setButtons(() => [
        {
          label: 'Close',
          style: ButtonStyle.Secondary,
          action: closeMenu(),
        },
      ])
      .setEphemeral(true) // Message only visible to user
      .build()
  );
}
