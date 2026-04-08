<p align="center">
  <img src="https://img.shields.io/npm/v/@flowcord/core?style=flat-square" alt="npm version" />
  <img src="https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white" alt="discord.js v14" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

# FlowCord

**Lifecycle-driven interactive menu framework for Discord.js**

FlowCord replaces the boilerplate of managing component collectors, interaction state, and multi-step flows with a declarative, builder-based API. Define menus as self-contained units with embeds, buttons, selects, and modals — FlowCord handles the interaction loop, navigation stack, pagination, and session lifecycle automatically.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [FlowCord Instance](#flowcord-instance)
  - [Menu Builder](#menu-builder)
  - [Menu Context](#menu-context)
  - [Navigation](#navigation)
  - [State Management](#state-management)
  - [Lifecycle Hooks](#lifecycle-hooks)
  - [Buttons](#buttons)
  - [Select Menus](#select-menus)
  - [Modals](#modals)
  - [Pagination](#pagination)
  - [Sub-Menus & Continuations](#sub-menus--continuations)
  - [Guards & Pipelines](#guards--pipelines)
  - [Fallback Menus](#fallback-menus)
  - [Ephemeral Menus](#ephemeral-menus)
  - [Behavior Policy](#behavior-policy)
  - [Navigation Tracing](#navigation-tracing)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Running the Examples Locally](#running-the-examples-locally)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Declarative menu definitions** — Use the fluent `MenuBuilder` API to define embeds, buttons, selects, and modals in one place
- **Automatic interaction loop** — FlowCord manages the render → await → dispatch cycle; no manual collectors needed
- **Navigation stack** — Built-in `goTo()`, `goBack()`, and `closeMenu()` with automatic history tracking
- **Typed menu + session state** — Per-menu `StateAccessor<TState>` and strongly-typed `StateStore<TSessionState>` for cross-menu data
- **Lifecycle hooks** — `onEnter`, `onLeave`, `beforeRender`, `afterRender`, `onAction`, `onCancel`, and pagination hooks
- **Button & list pagination** — Automatic page splitting with configurable items per page
- **Sub-menus & continuations** — Parent–child menu patterns with typed result passing via `openSubMenu()` and `complete()`
- **Guards & pipelines** — Composable action middleware for permission checks and validation
- **Modal support** — Single or multiple modals per menu with automatic re-rendering after submission
- **Ephemeral menu support** — Per-menu or session-wide ephemeral control, with configurable transition handling between ephemeral and non-ephemeral menus
- **Behavior policy system** — Configurable defaults and overrides at global, session, builder, and per-interaction levels for `ephemeral`, `messageCleanup`, and more; extensible to future behaviors
- **Session timeout** — Configurable inactivity timeout with automatic cleanup
- **Navigation tracing** — Optional debug tracing of all menu transitions

---

## Installation

> **This package is currently in alpha.** The API may change between releases.

```bash
npm install @flowcord/core@next discord.js
```

> **Peer dependency**: FlowCord requires **discord.js v14.x** or later.

Once a stable release is published, the `@next` tag will no longer be needed.

---

## Quick Start

Get a bot with an interactive menu running in under 5 minutes.

```ts
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ButtonStyle,
} from 'discord.js';
import { FlowCord, MenuBuilder, closeMenu } from '@flowcord/core';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const flowcord = new FlowCord({ client });

// Register a simple menu
flowcord.registerMenu('hello', (session) =>
  new MenuBuilder(session, 'hello')
    .setEmbeds(() => [
      new EmbedBuilder()
        .setTitle('👋 Hello!')
        .setDescription('Welcome to FlowCord. Click a button below.')
        .setColor(0x5865f2),
    ])
    .setButtons(() => [
      {
        label: 'Say Hi',
        style: ButtonStyle.Primary,
        action: async (ctx) => {
          ctx.state.set('greeted', true);
          // Menu re-renders automatically after action
        },
      },
      {
        label: 'Close',
        style: ButtonStyle.Danger,
        action: closeMenu(),
      },
    ])
    .setCancellable()
    .build(),
);

// Route interactions
client.on('interactionCreate', async (interaction) => {
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === 'hello'
  ) {
    await flowcord.handleInteraction(interaction, 'hello');
  } else if (interaction.isMessageComponent()) {
    flowcord.routeComponentInteraction(interaction);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
```

That's it! The `/hello` command will display an embed with two buttons. FlowCord handles the interaction collector, re-rendering, and session cleanup automatically.

---

## Core Concepts

### FlowCord Instance

The `FlowCord` class is the main entry point. It wraps the internal `MenuEngine` and provides three essential methods:

```ts
const flowcord = new FlowCord({
  client, // Your Discord.js Client
  timeout: 120_000, // Session timeout in ms (default: 2 minutes)
  onError: async (session, error) => {
    console.error('FlowCord error:', error);
  },
  enableTracing: false, // Enable navigation tracing (default: false)
  behavior: {
    // Optional: global behavior policy (see Behavior Policy)
    default: { ephemeral: false },
    override: { ephemeral: true },
  },
});

// Register menus
flowcord.registerMenu('menu-name', menuFactory);

// Handle slash commands → starts a new session
await flowcord.handleInteraction(
  interaction,
  'menu-name',
  commandOptions, // Passed to the menu factory as ctx.options
  interactionOptions, // { entryEphemeral?, behavior? }
);

// Route button/select clicks → dispatches to active session
flowcord.routeComponentInteraction(interaction);
```

### Menu Builder

Menus are defined using the fluent `MenuBuilder` API. Each menu is a self-contained unit that defines how it renders and responds to interactions.

```ts
flowcord.registerMenu('my-menu', (session, options) =>
  new MenuBuilder(session, 'my-menu', options)
    .setEmbeds((ctx) => [...])        // Required: what to display
    .setButtons((ctx) => [...])       // Optional: buttons below the embed
    .setSelectMenu((ctx) => ({...}))  // Optional: select menu (instead of or with buttons)
    .setModal((ctx) => ({...}))       // Optional: modal dialogs
    .setCancellable()                 // Adds a ✕ Cancel button
    .setReturnable()                  // Adds a ← Back button
    .setTrackedInHistory()            // Enables goBack() to return here
    .setPreserveStateOnReturn()       // Optional: restore menu state when returning via goBack()
    .setEphemeral()                   // Optional: visible only to the invoking user
    .onEnter((ctx) => {...})          // Lifecycle hook
    .build()
);
```

> **Render modes**: FlowCord supports two mutually exclusive render modes:
>
> - **Embeds mode** (`.setEmbeds()` + `.setButtons()` / `.setSelectMenu()`) — Traditional Discord embeds with action rows
> - **Layout mode** (`.setLayout()`) — Discord Components v2 display components
>
> You cannot mix modes within a single menu.

### Menu Context

Every callback receives a `MenuContext` object (`ctx`) providing access to state, navigation, and the current environment:

```ts
interface MenuContext<TState, TSessionState> {
  // State
  state: StateAccessor<TState>; // Typed per-menu state
  sessionState: StateStore<TSessionState>; // Typed session-wide state

  // Navigation
  goTo(
    menuId: string,
    options?: Record<string, unknown>,
  ): Promise<void>;
  goBack(result?: unknown): Promise<void>;
  close(): Promise<void>;
  hardRefresh(): Promise<void>;
  openSubMenu(menuId: string, opts: SubMenuOptions): Promise<void>;
  complete(result?: unknown): Promise<void>;

  // References
  session: MenuSessionLike;
  menu: MenuInstanceLike;
  client: Client<true>;
  interaction: Interaction;
  options: Record<string, unknown>;
  pagination: PaginationState | null;
}
```

### Navigation

FlowCord maintains a navigation stack. When you call `goTo()`, the current menu is pushed onto the stack (if `setTrackedInHistory()` was called). Calling `goBack()` pops the stack and restores the previous menu.

```ts
// Navigate forward
action: async (ctx) => {
  await ctx.goTo('settings', { userId: '123' });
};

// Go back to previous menu
action: goBack();

// Close the entire session
action: closeMenu();

// Use built-in action factories for cleaner code
import { goTo, goBack, closeMenu } from '@flowcord/core';

action: goTo('settings', { userId: '123' });
action: goBack();
action: closeMenu();
```

### State Management

FlowCord provides two levels of state:

**Menu State** (`ctx.state`) — Typed, scoped to the current menu.

```ts
type MyMenuState = { count: number; name: string };

new MenuBuilder<MyMenuState>(session, 'counter')
  .setup((ctx) => {
    ctx.state.set('count', 0);
    ctx.state.set('name', 'Counter');
  })
  .setEmbeds((ctx) => [
    new EmbedBuilder().setTitle(`Count: ${ctx.state.get('count')}`),
  ])
  .setButtons((ctx) => [
    {
      label: '+1',
      style: ButtonStyle.Primary,
      action: async (ctx) => {
        ctx.state.set('count', ctx.state.get('count') + 1);
      },
    },
  ]);
```

By default, menu state is recreated when returning via `goBack()`. For workflows that should resume exactly where they left off, opt in:

```ts
new MenuBuilder<MyMenuState>(session, 'counter')
  .setTrackedInHistory()
  .setPreserveStateOnReturn();
```

**Session State** (`ctx.sessionState`) — Shared across all menus in a session, and can be strongly typed by passing a session state type as the second `MenuBuilder` generic.

```ts
type SessionState = { selectedItem: string };

// In menu A
new MenuBuilder<MyMenuState, SessionState>(
  session,
  'menu-a',
).setButtons(() => [
  {
    label: 'Pick',
    style: ButtonStyle.Primary,
    action: async (ctx) => {
      ctx.sessionState.set('selectedItem', item);
    },
  },
]);

// In menu B (later in the same session)
const item = ctx.sessionState.get('selectedItem');
```

### Lifecycle Hooks

Hooks fire at specific points in the menu lifecycle:

| Hook           | When it fires                                                |
| -------------- | ------------------------------------------------------------ |
| `setup()`      | Once, when the menu factory runs (before `onEnter`)          |
| `onEnter`      | Menu entered (first time or via navigation)                  |
| `beforeRender` | Before embeds/buttons/layout callbacks run                   |
| `afterRender`  | After the Discord message is sent/updated                    |
| `onAction`     | After any custom button/select action executes               |
| `onNext`       | After pagination advances to next page                       |
| `onPrevious`   | After pagination goes back a page                            |
| `onLeave`      | Menu is being left (goTo, goBack, or close)                  |
| `onCancel`     | Session cancelled via Cancel button (fires before `onLeave`) |

```ts
new MenuBuilder(session, 'my-menu')
  .setup(async (ctx) => {
    // Parse options, initialize state
    const data = await fetchData(ctx.options.id);
    ctx.state.set('data', data);
  })
  .onEnter(async (ctx) => {
    console.log(`User entered ${ctx.menu.name}`);
  })
  .beforeRender(async (ctx) => {
    // Fetch fresh data before each render
    const freshData = await fetchData(ctx.options.id);
    ctx.state.set('data', freshData);
  })
  .onLeave(async (ctx) => {
    // Cleanup
  });
```

### Buttons

Buttons are the primary interactive element. Each button has a label, style, and an action callback:

```ts
.setButtons((ctx) => [
  {
    label: 'View Details',
    style: ButtonStyle.Primary,
    action: async (ctx) => {
      await ctx.goTo('item-detail', { itemId: '123' });
    },
  },
  {
    label: 'Edit',
    style: ButtonStyle.Secondary,
    emoji: '✏️',
    opensModal: true,  // Opens the menu's default modal
  },
  {
    label: 'Delete',
    style: ButtonStyle.Danger,
    disabled: !ctx.state.get('canDelete'),
    action: pipeline(
      guard(async () => hasPermission(), 'No permission to delete'),
      async (ctx) => { await deleteItem(); await ctx.goBack(); }
    ),
  },
  {
    label: 'Always Visible',
    style: ButtonStyle.Secondary,
    fixedPosition: 'start',   // Pinned at top across pagination pages
    action: goBack(),
  },
])
```

**Button properties:**
| Property | Type | Description |
|----------|------|-------------|
| `label` | `string` | Button text |
| `style` | `ButtonStyle` | Discord button style (Primary, Secondary, Success, Danger) |
| `action` | `Action` | Callback when clicked |
| `id` | `string?` | Optional custom ID |
| `disabled` | `boolean?` | Disable the button |
| `emoji` | `string?` | Emoji to display |
| `opensModal` | `boolean \| string?` | Opens a modal (`true` = default, `string` = specific modal ID) |
| `fixedPosition` | `'start' \| 'end'?` | Pin button across pagination pages |
| `url` | `string?` | Makes it a link button (no action) |

### Select Menus

Use any Discord.js select menu builder (String, Role, User, Channel, Mentionable):

```ts
import { StringSelectMenuBuilder } from 'discord.js';

.setSelectMenu((ctx) => ({
  builder: new StringSelectMenuBuilder()
    .setPlaceholder('Pick a color')
    .addOptions(
      { label: 'Red', value: 'red', emoji: '🔴' },
      { label: 'Blue', value: 'blue', emoji: '🔵' },
      { label: 'Green', value: 'green', emoji: '🟢' },
    ),
  onSelect: async (ctx, values) => {
    ctx.state.set('color', values[0]);
    // Menu re-renders automatically
  },
}))
```

### Modals

Define modals on a menu, then trigger them from buttons:

```ts
import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';

new MenuBuilder(session, 'profile')
  .setModal(() => ({
    builder: new ModalBuilder()
      .setCustomId('edit-profile')
      .setTitle('Edit Profile')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('nickname')
            .setLabel('Nickname')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('bio')
            .setLabel('Bio')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false),
        ),
      ),
    onSubmit: async (ctx, fields) => {
      const nickname = fields.getTextInputValue('nickname');
      const bio = fields.getTextInputValue('bio');
      ctx.state.set('nickname', nickname);
      ctx.state.set('bio', bio);
      // Menu re-renders automatically after modal submit
    },
  }))
  .setButtons(() => [
    {
      label: 'Edit Profile',
      style: ButtonStyle.Primary,
      opensModal: true, // Opens the single modal
    },
  ]);
```

**Multiple modals**: Return an array from `.setModal()`, each with a unique `id`:

```ts
.setModal(() => [
  { id: 'add-item', builder: addModalBuilder, onSubmit: handleAdd },
  { id: 'edit-item', builder: editModalBuilder, onSubmit: handleEdit },
])
.setButtons(() => [
  { label: 'Add', style: ButtonStyle.Success, opensModal: 'add-item' },
  { label: 'Edit', style: ButtonStyle.Primary, opensModal: 'edit-item' },
])
```

### Pagination

**Button pagination** — Split large button arrays across pages automatically:

```ts
.setButtons(
  (ctx) => items.map((item) => ({
    label: item.name,
    style: ButtonStyle.Primary,
    action: async (ctx) => await ctx.goTo('detail', { itemId: item.id }),
  })),
  { pagination: { perPage: 5 } }  // 5 buttons per page + auto Next/Previous
)
```

**List pagination** — Page through data items with full control over rendering:

```ts
.setListPagination({
  getTotalQuantityItems: async (ctx) => ctx.state.get('items').length,
  itemsPerPage: 10,
})
.setEmbeds((ctx) => {
  const items = ctx.state.get('items');
  const { startIndex, endIndex, currentPage, totalPages } = ctx.pagination!;
  const page = items.slice(startIndex, endIndex);

  return [
    new EmbedBuilder()
      .setTitle(`Items (Page ${currentPage}/${totalPages})`)
      .setDescription(page.map((i) => `• ${i.name}`).join('\n'))
  ];
})
```

### Sub-Menus & Continuations

The sub-menu pattern lets a parent menu open a child menu and receive a result when the child completes:

```ts
// Parent menu
.setButtons((ctx) => [{
  label: 'Select Item',
  style: ButtonStyle.Primary,
  action: async (ctx) => {
    await ctx.openSubMenu('item-picker', {
      items: ctx.state.get('availableItems'),
      onComplete: async (parentCtx, result) => {
        // Called when child calls ctx.complete(result)
        parentCtx.state.set('selectedItem', result);
      },
    });
  },
}])

// Child menu ('item-picker')
flowcord.registerMenu('item-picker', (session, options) =>
  new MenuBuilder(session, 'item-picker', options)
    .setButtons((ctx) =>
      ctx.options.items.map((item) => ({
        label: item.name,
        style: ButtonStyle.Primary,
        action: async (ctx) => {
          await ctx.complete(item);  // Returns to parent with result
        },
      }))
    )
    .build()
);
```

### Guards & Pipelines

Compose multiple actions into a sequential pipeline with guard checks:

```ts
import { pipeline, guard } from '@flowcord/core';

const requireAdmin = guard(
  async (ctx) => ctx.options.isAdmin === true,
  'You need admin permissions for this action.'
);

const requireUnlocked = guard(
  async (ctx) => !ctx.state.get('locked'),
  'This item is currently locked.'
);

// In a button:
{
  label: 'Delete',
  style: ButtonStyle.Danger,
  action: pipeline(
    requireAdmin,
    requireUnlocked,
    async (ctx) => {
      await deleteItem(ctx.state.get('itemId'));
      await ctx.goBack();
    }
  ),
}
```

If any guard fails, the pipeline halts and throws a `GuardFailedError` with the failure message. The menu re-renders without executing subsequent actions.

`guard()` and `pipeline()` are generic over the menu context, so they can preserve your custom and typed context end-to-end.

### Fallback Menus

When a menu can be opened directly (via slash command) or navigated to from a parent, use `setFallbackMenu()` to control where `goBack()` goes when the navigation stack is empty:

```ts
new MenuBuilder(session, 'item-detail')
  .setFallbackMenu('item-list') // goBack() → item-list when stack is empty
  .setReturnable()
  .build();
```

Without a fallback, `goBack()` on an empty stack closes the session.

### Ephemeral Menus

Ephemeral messages are only visible to the user who triggered the interaction. Mark a menu ephemeral with `.setEphemeral()` on the builder:

```ts
flowcord.registerMenu('private-menu', (session) =>
  new MenuBuilder(session, 'private-menu')
    .setEphemeral()
    .setEmbeds(() => [...])
    .build()
);
```

**Async factory timing**: Discord requires `deferReply` to be called within 3 seconds of the interaction. For async factory functions, FlowCord must defer before awaiting the factory — which means it cannot read `setEphemeral()` from the builder in time. Pass `entryEphemeral` in the interaction options when your factory is async:

```ts
// Sync factory — setEphemeral() is sufficient, no entryEphemeral needed
flowcord.registerMenu('sync-menu', (session) =>
  new MenuBuilder(session, 'sync-menu').setEphemeral().setEmbeds(() => [...]).build()
);

// Async factory — must also pass entryEphemeral
flowcord.registerMenu('async-menu', async (session) => {
  const data = await fetchData();
  return new MenuBuilder(session, 'async-menu')
    .setEphemeral()
    .setEmbeds(() => [...])
    .build();
});

await flowcord.handleInteraction(interaction, 'async-menu', {}, { entryEphemeral: true });
```

**Transitions**: When navigating between ephemeral and non-ephemeral menus, FlowCord handles the transition automatically — sending a new `followUp` message and disposing the outgoing message according to the `messageCleanup` behavior (see [Behavior Policy](#behavior-policy) below). The default is to edit in place. Ephemeral messages cannot be deleted via Discord REST; the `ephemeralFallbackDisposal` behavior controls what happens in that case.

---

### Behavior Policy

The behavior policy system controls menu behaviors at multiple levels with a clear resolution hierarchy:

```
globalOverride → sessionOverride → classOverride (_setOverrideBehavior)
  → interactionExplicit (behavior on button/select/modal/message handler)
  → explicit (setEphemeral / setMessageCleanup / entryEphemeral)
    → interactionTypeDefault → classDefault (_setDefaultBehavior) → sessionDefault → globalDefault → framework default
```

Each level has a `default` (applied when no more-specific level declares a value) and an `override` (applied regardless of more-specific declarations, but still yielding to higher-level overrides).

#### Configurable behaviors

| Field                       | Default           | Description                                                                                                                                                                                                                                                                 |
| --------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ephemeral`                 | `false`           | Whether the menu reply is visible only to the invoking user                                                                                                                                                                                                                 |
| `messageCleanup`            | `'edit'`          | `'edit'`: edit the existing message in place. `'postAndStrip'`: post a new message and strip components from the old one. `'postAndDelete'`: post a new message and delete the old one. `'postAndReplace'`: post a new message and replace the old one with `closedMessage` |
| `ephemeralFallbackDisposal` | `'strip'`         | Fallback for `'postAndDelete'` when the message is ephemeral (Discord cannot delete ephemeral messages via REST). `'strip'` or `'replace'`                                                                                                                                  |
| `closedMessage`             | `'*Menu closed*'` | Content shown when `messageCleanup` is `'postAndReplace'` or `ephemeralFallbackDisposal` is `'replace'`                                                                                                                                                                     |
| `deleteUserMessages`        | `false`           | Whether to attempt deleting the user's typed message (best-effort, requires permissions) after `setMessageHandler` collects it                                                                                                                                              |

#### Global policy

Set on the `FlowCord` constructor; applies to all sessions:

```ts
const flowcord = new FlowCord({
  client,
  behavior: {
    default: { ephemeral: false, messageCleanup: 'edit' },
    override: { ephemeral: true }, // forces all menus ephemeral regardless of builder
  },
});
```

#### Session policy

Set per-invocation via `handleInteraction`; applies to all menus in that session:

```ts
await flowcord.handleInteraction(
  interaction,
  'my-menu',
  {},
  {
    entryEphemeral: true, // async factory timing; explicit priority
    behavior: {
      default: { ephemeral: true, messageCleanup: 'postAndDelete' },
      override: { messageCleanup: 'postAndStrip' }, // all menus in this session always repost+strip
    },
  },
);
```

#### Builder-level setters

```ts
new MenuBuilder(session, 'my-menu')
  .setEphemeral()
  .setMessageCleanup('postAndDelete', {
    ephemeralFallback: 'replace',
    closedMessage: '*This menu has moved.*',
  })
  .setEmbeds(() => [...])
  .build()
```

`setMessageCleanup` uses discriminated overloads — `ephemeralFallback` and `closedMessage` are only available on the variants where they apply:

```ts
// 'postAndDelete' variant — ephemeralFallback and closedMessage available
.setMessageCleanup('postAndDelete', { ephemeralFallback: 'replace', closedMessage: '...' })

// 'postAndReplace' variant — closedMessage available
.setMessageCleanup('postAndReplace', { closedMessage: 'Session ended.' })

// 'edit' or 'postAndStrip' — no additional options
.setMessageCleanup('edit')
.setMessageCleanup('postAndStrip')
```

#### Per-interaction behavior overrides

Buttons, selects, modals, and message handlers accept an optional `behavior` field that overrides behavior for just that one render cycle. On the next interaction, behavior reverts to the menu/session/global defaults:

```ts
.setButtons((ctx) => [
  {
    label: 'Show Secret',
    style: ButtonStyle.Secondary,
    behavior: { ephemeral: true }, // this one click renders ephemeral
    action: async (ctx) => {
      ctx.state.set('showSecret', true);
    },
  },
  {
    label: 'Repost',
    style: ButtonStyle.Secondary,
    behavior: { messageCleanup: 'postAndStrip' }, // repost just this once
    action: async (ctx) => { /* ... */ },
  },
])
```

#### Subclass defaults and overrides

`MenuBuilder` exposes two protected methods for builder subclasses to establish class-level behavior without exposing it as a per-menu public API:

```ts
class AdminMenuBuilder extends MenuBuilder {
  constructor(session, name, options) {
    super(session, name, options);
    // Default: menus are ephemeral by default unless any policy overrides
    this._setDefaultBehavior({ ephemeral: true });
    // Override: menus always repost unless session/global forces otherwise
    this._setOverrideBehavior({ messageCleanup: 'postAndStrip' });
  }
}
```

**Extensibility**: `BehaviorConfig` is the single extension point. Adding a new behavior only requires a new optional field there — no structural changes to the policy system.

---

### Navigation Tracing

Enable tracing to record all menu transitions for debugging:

```ts
const flowcord = new FlowCord({ client, enableTracing: true });

// After a session completes, inspect traces:
const events = flowcord.tracer.events;
// [{ from: 'main', to: 'settings', sessionId: '...', userId: '...', timestamp: ... }, ...]
```

---

## API Reference

### `FlowCord`

| Method                                                                           | Description                                                                      |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `new FlowCord(config)`                                                           | Create instance with `{ client, timeout?, onError?, enableTracing?, behavior? }` |
| `registerMenu(name, factory)`                                                    | Register a menu factory function                                                 |
| `handleInteraction(interaction, menuName, commandOptions?, interactionOptions?)` | Start a new session from a slash command                                         |
| `routeComponentInteraction(interaction)`                                         | Route a button/select interaction to an active session                           |
| `isFlowCordInteraction(customId)`                                                | Check if a `customId` belongs to a FlowCord session                              |
| `getSession(sessionId)`                                                          | Get an active session by ID                                                      |
| `activeSessionCount`                                                             | Number of currently active sessions                                              |

### `MenuBuilder<TState, TSessionState, TCtx, TMode>`

| Method                                       | Mode   | Description                                                                           |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `.setup(fn)`                                 | Any    | One-time initialization                                                               |
| `.setEmbeds(fn)`                             | Embeds | Embed rendering callback                                                              |
| `.setButtons(fn, options?)`                  | Embeds | Button array callback (optional pagination)                                           |
| `.setSelectMenu(fn)`                         | Embeds | Select menu callback                                                                  |
| `.setLayout(fn)`                             | Layout | Components v2 layout callback                                                         |
| `.setModal(fn)`                              | Any    | Modal config callback (single or array)                                               |
| `.setMessageHandler(fn)`                     | Any    | Handle text message replies                                                           |
| `.setCancellable()`                          | Any    | Add Cancel button                                                                     |
| `.setReturnable()`                           | Any    | Add Back button                                                                       |
| `.setTrackedInHistory()`                     | Any    | Push to nav stack when leaving                                                        |
| `.setPreserveStateOnReturn()`                | Any    | Restore previous menu state snapshot when returning via goBack                        |
| `.setFallbackMenu(id, options?)`             | Any    | Fallback for goBack on empty stack                                                    |
| `.setEphemeral(ephemeral?)`                  | Any    | Mark menu as ephemeral (visible only to invoking user)                                |
| `.setMessageCleanup(mode, options?)`         | Any    | `'edit'` (default), `'postAndStrip'`, `'postAndDelete'`, or `'postAndReplace'`        |
| `_setDefaultBehavior(config)` _(protected)_  | Any    | Subclass hook: class-level defaults, lowest priority in hierarchy                     |
| `_setOverrideBehavior(config)` _(protected)_ | Any    | Subclass hook: class-level overrides, wins over explicit but yields to session/global |
| `.setListPagination(options)`                | Any    | Configure list pagination                                                             |
| `.onEnter(fn)`                               | Any    | Hook: menu entered                                                                    |
| `.onLeave(fn)`                               | Any    | Hook: menu leaving                                                                    |
| `.onCancel(fn)`                              | Any    | Hook: session cancelled                                                               |
| `.beforeRender(fn)`                          | Any    | Hook: before render cycle                                                             |
| `.afterRender(fn)`                           | Any    | Hook: after render cycle                                                              |
| `.onNext(fn)`                                | Any    | Hook: page advanced                                                                   |
| `.onPrevious(fn)`                            | Any    | Hook: page reversed                                                                   |
| `.onAction(fn)`                              | Any    | Hook: custom action executed                                                          |
| `.extendContext(fn)`                         | Any    | Add custom properties to context                                                      |
| `.fromDefinition(def)`                       | Any    | Configure from object literal                                                         |
| `.build()`                                   | —      | Produce the final `MenuDefinition`                                                    |

### Built-in Actions

| Function                    | Description                                                 |
| --------------------------- | ----------------------------------------------------------- |
| `goTo(menuId, options?)`    | Navigate to another menu                                    |
| `goBack(result?)`           | Return to previous menu (optional result for continuations) |
| `closeMenu()`               | End the session                                             |
| `openModal(modalId?)`       | Open a modal dialog                                         |
| `pipeline(...actions)`      | Sequential action composition                               |
| `guard(predicate, message)` | Guard middleware — halts pipeline on failure                |

---

## Examples

The [`examples/`](./examples/) directory contains runnable examples demonstrating FlowCord's features:

| Example                                                                   | Description                                                     |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`01-quickstart.ts`](./examples/01-quickstart.ts)                         | Bare-bones setup — single command, single menu, under 5 minutes |
| [`02-multi-menu-navigation.ts`](./examples/02-multi-menu-navigation.ts)   | Multiple menus with navigation between them                     |
| [`03-state-and-lifecycle.ts`](./examples/03-state-and-lifecycle.ts)       | Menu state, session state, and lifecycle hooks                  |
| [`04-sub-menu-continuation.ts`](./examples/04-sub-menu-continuation.ts)   | Parent–child menu pattern with result passing                   |
| [`05-selects-and-modals.ts`](./examples/05-selects-and-modals.ts)         | Select menus and modal forms                                    |
| [`06-pagination-and-guards.ts`](./examples/06-pagination-and-guards.ts)   | Button pagination, list pagination, and guard pipelines         |
| [`07-layout-basics.ts`](./examples/07-layout-basics.ts)                   | Components v2 layout mode basics                                |
| [`08-layout-sections.ts`](./examples/08-layout-sections.ts)               | Layout sections with text and accessories                       |
| [`09-layout-navigation.ts`](./examples/09-layout-navigation.ts)           | Multi-menu navigation in layout mode                            |
| [`10-mode-transitions.ts`](./examples/10-mode-transitions.ts)             | Transitioning between embeds and layout modes                   |
| [`11-layout-paginated-group.ts`](./examples/11-layout-paginated-group.ts) | Paginated groups in layout mode                                 |
| [`12-behavior-subclass.ts`](./examples/12-behavior-subclass.ts)           | Builder subclass with default/override behaviors                |
| [`13-behavior-policy.ts`](./examples/13-behavior-policy.ts)               | Global, session, and per-interaction behavior policies          |

---

## Running the Examples Locally

The examples share a single bot entry point ([`examples/bot.ts`](./examples/bot.ts)) that registers all menus, handles slash commands, and manages the interaction loop — mirroring how you'd structure a real multi-menu bot.

**1. Clone the repo and install dependencies**

```bash
git clone https://github.com/flowcord-dev/flowcord-core.git
cd flowcord-core
npm install
```

**2. Create your `.env` file**

```bash
npm run flow:setup
```

This copies `.env.example` to `.env`. Open it and fill in your credentials:

```env
DISCORD_BOT_TOKEN=your-bot-token-here
APP_ID=your-application-id-here

# Recommended for development: slash commands register instantly to this guild
# Leave blank to register globally (may take up to 1 hour to propagate)
DEV_GUILD_ID=your-guild-id-here
```

**3. Start the bot**

```bash
npm run flow
```

On startup the bot registers all slash commands (guild-scoped if `DEV_GUILD_ID` is set, global otherwise), then comes online. All example commands will be available immediately.

**Available commands**

| Command     | Example                    |
| ----------- | -------------------------- |
| `/weather`  | 01 — Quick Start           |
| `/cookbook` | 02 — Multi-Menu Navigation |
| `/workout`  | 03 — State & Lifecycle     |
| `/party`    | 04 — Sub-Menu Continuation |
| `/event`    | 05 — Select Menus & Modals |
| `/shop`     | 06 — Pagination & Guards   |

**Working on the framework itself**

Each example file imports from `@flowcord/core` by default. To run against your local source instead, uncomment the `../src/index.ts` line at the top of any example file (and comment out the `@flowcord/core` line):

```ts
// Uncomment for local dev:
import { FlowCord, MenuBuilder, closeMenu } from '../src/index.ts';
// import { FlowCord, MenuBuilder, closeMenu } from '@flowcord/core';
```

---

## Architecture

For a deep dive into FlowCord's internals — the interaction loop, session lifecycle, component ID management, and rendering pipeline — see [**ARCHITECTURE.md**](./ARCHITECTURE.md).

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

[Apache 2.0](./LICENSE)
