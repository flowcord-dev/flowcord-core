# FlowCord Architecture

This document explains how FlowCord works under the hood. It covers the session lifecycle, interaction loop, component ID management, rendering pipeline, and navigation system.

---

## Table of Contents

- [High-Level Overview](#high-level-overview)
- [Session Lifecycle](#session-lifecycle)
- [The Interaction Loop](#the-interaction-loop)
- [Component ID Management](#component-id-management)
- [Rendering Pipeline](#rendering-pipeline)
- [Navigation System](#navigation-system)
- [State Architecture](#state-architecture)
- [Modal Handling](#modal-handling)
- [Lifecycle Hook Execution](#lifecycle-hook-execution)
- [Sub-Menu & Continuation System](#sub-menu--continuation-system)
- [Pagination System](#pagination-system)
- [Error Handling](#error-handling)
- [Session Persistence & Scope](#session-persistence--scope)

---

## High-Level Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         FlowCord                                 │
│  (Facade — delegates everything to MenuEngine)                   │
├──────────────────────────────────────────────────────────────────┤
│                        MenuEngine                                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐  │
│  │ MenuRegistry │ │ ActionReg.   │ │ HookRegistry (global)    │  │
│  │ name→factory │ │ (reserved)   │ │ onEnter, onLeave, etc.   │  │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ Active Sessions Map<sessionId, MenuSession>                  ││
│  │  ┌─────────────────────────────────────────────────────────┐ ││
│  │  │ MenuSession (one per slash command invocation)          │ ││
│  │  │  • MenuStack (navigation history)                       │ ││
│  │  │  • MenuInstance (current menu + actions + state)        │ ││
│  │  │  • MenuRenderer (Discord message rendering)             │ ││
│  │  │  • LifecycleManager (hook emission)                     │ ││
│  │  │  • StateStore (session-wide state)                      │ ││
│  │  └─────────────────────────────────────────────────────────┘ ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

### Key Classes

| Class                  | Responsibility                                                        |
| ---------------------- | --------------------------------------------------------------------- |
| **FlowCord**           | Public API facade; delegates to `MenuEngine`                          |
| **MenuEngine**         | Manages registries, creates/destroys sessions, routes interactions    |
| **MenuSession**        | Core interaction loop for a single user session                       |
| **MenuInstance**       | Runtime wrapper for a single menu definition (actions, modals, state) |
| **MenuBuilder**        | Fluent API for defining menu configurations                           |
| **MenuRenderer**       | Converts menu definitions into Discord message payloads               |
| **MenuStack**          | LIFO stack for navigation history                                     |
| **StateStore**         | Session-wide key-value store                                          |
| **StateAccessor\<T\>** | Typed per-menu state wrapper                                          |
| **LifecycleManager**   | Emits lifecycle hooks (global + per-menu)                             |
| **ComponentIdManager** | Encodes/decodes session + menu info in component custom IDs           |
| **NavigationTracer**   | Optional debug logging of menu transitions                            |

---

## Session Lifecycle

A session begins when a user triggers a slash command and ends when the menu closes, times out, or is cancelled.

```
User runs /command
       │
       ▼
┌──────────────────────┐
│ FlowCord             │
│ .handleInteraction() │
│      │               │
│      ▼               │
│ MenuEngine           │
│  .handleInteraction()│
│      │               │
│      ▼               │
│ Creates MenuSession  │──── UUID session ID
│  .initialize()       │
│      │               │
│      ▼               │
│ interaction.         │
│   deferReply()       │
│      │               │
│      ▼               │
│ navigateTo(menuName) │──── Creates MenuInstance from factory
│      │               │
│      ▼               │
│ processMenus()       │──── Main interaction loop (see below)
│      │               │
│      ▼               │
│ Session ends         │──── Engine removes session from map
└──────────────────────┘
```

### Session States

A session transitions through these states:

1. **Initializing** — `deferReply()` called, first menu being created
2. **Active** — Processing the interaction loop
3. **Completed** — User closed the menu or called `close()`
4. **Cancelled** — User pressed the Cancel button
5. **Timed out** — No interaction within the timeout window

---

## The Interaction Loop

The heart of FlowCord is the `processMenus()` loop inside `MenuSession`. It runs continuously until the session ends:

```
while (session is active) {
    │
    ▼
┌────────────────────────┐
│ 1. Check for pending   │
│    modal interaction   │──── If modal is active, await modal submit
│         │              │     then continue loop
│         ▼              │
│ 2. RENDER CYCLE        │
│    a. beforeRender     │──── Lifecycle hook
│    b. Run setEmbeds/   │
│       setButtons/      │──── Build Discord message payload
│       setLayout        │
│    c. Send or update   │──── Discord API call
│       message          │
│    d. afterRender      │──── Lifecycle hook
│         │              │
│         ▼              │
│ 3. AWAIT INTERACTION   │
│    Collect component   │──── Race: button/select vs timeout
│    interaction         │     (or message reply, or mixed)
│         │              │
│         ▼              │
│ 4. DISPATCH            │
│    a. Parse customId   │──── Extract session/menu/component info
│    b. Resolve action   │──── Look up action callback
│    c. Execute action   │──── Run the callback
│    d. onAction hook    │──── Lifecycle hook
│         │              │
│         ▼              │
│ 5. CHECK NAVIGATION    │
│    Did action call     │──── If yes: loop continues with new menu
│    goTo/goBack/close?  │──── If no: re-render current menu (auto-refresh)
└────────────────────────┘
```

### Key Behaviors

- **Auto re-render**: If an action does NOT navigate (no `goTo`, `goBack`, `close`), the loop automatically re-runs the render cycle. This is why you can just mutate `ctx.state` in a button action and the embed updates.
- **Navigation detection**: The session tracks a `_didNavigate` flag. Navigation actions set it to `true`. The loop checks this flag to decide whether to re-render or start a new menu.
- **Hard refresh**: `ctx.hardRefresh()` destroys and recreates the current `MenuInstance` from the factory function. Useful when the menu structure changes (e.g., different buttons based on updated data).

---

## Component ID Management

Discord requires unique `customId` strings for interactive components. FlowCord automatically manages these by encoding session metadata into each component's ID.

### Format

```
fc:{sessionId}:{menuName}:{componentIndex}
```

Example: `fc:a1b2c3d4:settings:3`

### How It Works

1. **On render**: `ComponentIdManager` assigns sequential indices to each interactive component (buttons, selects). The session ID and menu name are embedded in the custom ID.
2. **On interaction**: `ComponentIdManager.parse(customId)` extracts the session ID, menu name, and component index.
3. **Routing**: `MenuEngine.routeComponentInteraction()` uses the parsed session ID to find the correct `MenuSession`, which then uses the component index to resolve the action callback.

This encoding scheme:

- Prevents cross-session collisions
- Allows the engine to route interactions without a central registry
- Supports multiple concurrent sessions for different users

---

## Rendering Pipeline

The `MenuRenderer` handles conversion from FlowCord's internal representation to Discord API payloads.

### Embeds Mode

```
MenuDefinition                Discord Payload
┌──────────────────┐           ┌───────────────────────┐
│ setEmbeds(ctx)   │────>      │ embeds: [...]         │
│ → EmbedBuilder[] │           │                       │
│                  │           │ components: [         │
│ setButtons(ctx)  │────>      │   ActionRow(buttons), │
│ → ButtonConfig[] │           │   ActionRow(buttons), │
│                  │           │   ActionRow(select),  │
│ setSelectMenu()  │────>      │   ActionRow(reserved) │
│ → SelectConfig   │           │ ]                     │
│                  │           │                       │
│ reserved buttons │────>      │ (Cancel, Back,        │
│ (auto-generated) │           │  Next, Previous)      │
└──────────────────┘           └───────────────────────┘
```

### Layout Mode

```
MenuDefinition                Discord Payload
┌──────────────────┐           ┌───────────────────────┐
│ setLayout(ctx)   │────>      │ components: [         │
│ → ComponentConfig│           │   Container(...),     │
│                  │           │   Section(...),       │
│                  │           │   ActionRow(buttons), │
│                  │           │   Separator,          │
│                  │           │   TextDisplay,        │
│                  │           │ ]                     │
│                  │           │ flags: IsComponentsV2 │
└──────────────────┘           └───────────────────────┘
```

### Button Layout Algorithm

Discord allows max 5 buttons per action row and max 5 action rows total. The renderer:

1. Collects all buttons from `setButtons()`
2. Applies pagination if configured (split into pages)
3. Injects reserved buttons (Cancel, Back, Next, Previous)
4. Groups into action rows of 5
5. Validates the total doesn't exceed Discord's limits

---

## Navigation System

### Menu Stack

Navigation uses a LIFO (Last In, First Out) stack:

```
User flow: Main → Settings → Profile → (Back) → Settings → (Back) → Main

Stack after each step:
1. Main opened:     []                  (Main is current, not in stack)
2. → Settings:      [Main]              (Main pushed, Settings is current)
3. → Profile:       [Main, Settings]    (Settings pushed, Profile is current)
4. ← Back:          [Main]              (Settings popped & restored as current)
5. ← Back:          []                  (Main popped & restored as current)
6. ← Back:          (session closes)    (stack empty, no fallback)
```

### History Tracking

Only menus with `.setTrackedInHistory()` are pushed onto the stack. This lets you create "pass-through" menus (like confirmations) that don't appear in the back-navigation path.

### Fallback Menus

When `goBack()` is called on an empty stack:

- **No fallback**: Session closes
- **With fallback**: Navigates to the fallback menu instead of closing

This is useful for menus accessible both directly (via slash command) and via navigation from another menu.

### Menu Recreation on goBack

When popping a menu from the stack, FlowCord creates a new `MenuInstance` from the saved menu id and options.

- **Default behavior**: state is recreated (`setup()` runs), so the menu reflects current data.
- **Opt-in restore**: menus configured with `.setPreserveStateOnReturn()` snapshot menu state and pagination before navigation, then restore those snapshots when returning via `goBack()`.

---

## State Architecture

```
┌──────────────────────────────────────────────┐
│ MenuSession                                  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ sessionState: StateStore<TSessionState>│  │
│  │ (shared across all menus in session)   │  │
│  │                                        │  │
│  │  .get('key')  .set('key', value)       │  │
│  │  .has('key')  .delete('key')           │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ MenuInstance (current menu)            │  │
│  │                                        │  │
│  │  ┌──────────────────────────────────┐  │  │
│  │  │ state: StateAccessor<TState>     │  │  │
│  │  │ (scoped to this menu instance)   │  │  │
│  │  │                                  │  │  │
│  │  │  .get('count')  → typed value    │  │  │
│  │  │  .set('count', 5)                │  │  │
│  │  │  .merge({ count: 5, name: 'x' }) │  │  │
│  │  │  .current → readonly snapshot    │  │  │
│  │  └──────────────────────────────────┘  │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### State Lifecycle

- **Menu state** is created fresh by default when a menu instance is recreated.
- **Preserved menu state** is available when a menu opts into `.setPreserveStateOnReturn()`, which restores previously snapshotted state and pagination on `goBack()`.
- **Session state** persists for the entire session lifetime and can be strongly typed via `StateStore<TSessionState>`.

---

## Modal Handling

Modals follow a special flow because Discord requires them to be shown in response to an interaction (not deferred):

```
Button click (opensModal: true)
       │
       ▼
┌──────────────────────────┐
│ Session detects modal    │
│ trigger button           │
│       │                  │
│       ▼                  │
│ interaction.showModal()  │──── Discord shows modal to user
│       │                  │
│       ▼                  │
│ Set _isModalActive=true  │
│       │                  │
│       ▼                  │
│ Loop re-enters           │
│ awaitModalInteraction()  │──── Wait for submit or timeout
│       │                  │
│       ▼                  │
│ Modal submitted          │
│       │                  │
│       ▼                  │
│ Execute onSubmit()       │──── Run modal's callback
│       │                  │
│       ▼                  │
│ Auto re-render           │──── Menu updates with new state
└──────────────────────────┘
```

### Key Modal Behaviors

- **Auto re-render**: After `onSubmit` runs, the menu automatically re-renders. You don't need to call `hardRefresh()`.
- **State mutation**: The `onSubmit` callback receives the same `ctx` as other callbacks. Just mutate `ctx.state` or `ctx.sessionState`.
- **Multiple modals**: Each modal has an `id` field. Buttons reference modals via `opensModal: 'modal-id'`.
- **Validation in onSubmit**: If validation fails, set an error message in state and return. The auto re-render will display it.

---

## Lifecycle Hook Execution

### Execution Order

Hooks fire in a defined order during the menu lifecycle:

```
Menu factory called
       │
       ▼
    setup()                  ← One-time initialization
       │
       ▼
    onEnter                  ← Menu entered
       │
       ▼
┌─── RENDER LOOP ───────────────────────────┐
│      │                                    │
│      ▼                                    │
│   beforeRender             ← Before build │
│      │                                    │
│      ▼                                    │
│   (build embeds/buttons/layout)           │
│   (send/update Discord message)           │
│      │                                    │
│      ▼                                    │
│   afterRender              ← After send   │
│      │                                    │
│      ▼                                    │
│   (await interaction)                     │
│      │                                    │
│      ▼                                    │
│   (execute action)                        │
│      │                                    │
│      ▼                                    │
│   onAction                 ← After action │
│      │                                    │
│      ▼                                    │
│   onNext / onPrevious      ← Pagination   │
│      │                                    │
│      ▼                                    │
│   (if no navigation: loop back to render) │
└───────────────────────────────────────────┘
       │
       ▼ (navigation or close)
    onCancel                 ← If cancelled
       │
       ▼
    onLeave                  ← Menu leaving
```

### Global vs Menu Hooks

The `LifecycleManager` fires hooks in this order:

1. **Global hooks** (registered via `HookRegistry`) — fire for every menu
2. **Menu-specific hooks** (defined via `MenuBuilder.onEnter()`, etc.) — fire for this menu only

---

## Sub-Menu & Continuation System

Sub-menus enable parent–child relationships between menus where the parent can receive a result from the child.

### Flow

```
Parent Menu
    │
    ▼
ctx.openSubMenu('child', {
  someData: 123,
  onComplete: async (parentCtx, result) => {
    // Handle child's result
  }
})
    │
    ▼
┌─────────────────────────────────────┐
│ Session pushes continuation:        │
│   { menuName: 'child',              │
│     onComplete: <callback> }        │
│                                     │
│ Session navigates to 'child'        │
│ (parent pushed to stack)            │
└─────────────────────────────────────┘
    │
    ▼
Child Menu runs
    │
    ▼
ctx.complete({ picked: 'item-42' })
    │
    ▼
┌─────────────────────────────────────┐
│ Session calls goBack() with result  │
│                                     │
│ Parent menu popped from stack       │
│ Parent menu re-created from factory │
│                                     │
│ Continuations executed:             │
│   onComplete(parentCtx, result)     │
│   → parentCtx.state.set(...)        │
│                                     │
│ Parent re-renders with updated state│
└─────────────────────────────────────┘
```

### Continuation Stack

Continuations are stored as an array on the session. Multiple sub-menus can push continuations. When `goBack()` fires, the session checks if the completing menu name matches any continuation and executes the callback.

---

## Pagination System

### Button Pagination

When `setButtons()` is called with `{ pagination: { perPage: N } }`:

1. The renderer collects all buttons from the callback
2. Separates **fixed-position** buttons (`fixedPosition: 'start'` or `'end'`)
3. Splits remaining buttons into pages of size N
4. On each render, shows only the current page's buttons + fixed buttons
5. Automatically adds Next/Previous reserved buttons

```
All buttons: [A, B, C, D, E, F, G]  (perPage: 3)
Fixed start: [X]
Fixed end:   [Y]

Page 1: [X] [A] [B] [C] [Y] [◀ Prev] [Next ▶]
Page 2: [X] [D] [E] [F] [Y] [◀ Prev] [Next ▶]
Page 3: [X] [G] [Y]         [◀ Prev]
```

### List Pagination

List pagination is controlled by the menu, not the renderer. The `PaginationState` object is computed before render:

```ts
interface PaginationState {
  currentPage: number; // 1-indexed
  totalPages: number;
  itemsPerPage: number;
  totalItems: number;
  startIndex: number; // For Array.slice() (inclusive)
  endIndex: number; // For Array.slice() (exclusive)
}
```

The `setEmbeds()` or `setLayout()` callback reads `ctx.pagination` and slices data accordingly. FlowCord manages the current page and adds Next/Previous buttons automatically.

---

## Error Handling

### Session-Level Error Handler

```ts
const flowcord = new FlowCord({
  client,
  onError: async (session, error) => {
    // Custom error handling
    console.error(`Session ${session.id} error:`, error);
  },
});
```

If no `onError` is provided, FlowCord uses a default handler that replies with an ephemeral error message.

### Guard Errors

`GuardFailedError` is a special error type thrown by guard actions. It is caught by the session's action dispatcher and does NOT propagate to the error handler. Instead, the menu simply re-renders (the guard failure message can be used in UI feedback).

### Action Errors

If a button/select action throws a non-guard error, it propagates to the session-level error handler. The session is terminated.

### Timeout

When the interaction collector times out, the session renders a "closed" state (disabled components) and cleans up. No error is thrown.

---

## Session Persistence & Scope

FlowCord sessions are **entirely in-memory and process-scoped**. This is an intentional design boundary, not a missing feature.

### What this means

- All session state (`StateStore`, `StateAccessor`, `MenuStack`, navigation history) lives in the `MenuEngine._sessions` map for the lifetime of the process.
- Timeouts are backed by Discord.js's collector mechanism — they are not stored anywhere durable.
- If the bot process restarts (deployment, crash, host migration), all active sessions are lost. Users with open menus will see their interactions fail or time out silently.

### What FlowCord is designed for

FlowCord is optimized for **short-lived, synchronous interactive flows** — things that complete in one sitting:

- Multi-step setup wizards
- Confirmation dialogs
- Paginated lists and selection menus
- Inline forms with modals

The default timeout (120 seconds) reflects this. Even with a custom timeout, sessions should be treated as transient UI shells, not durable state containers.

### What FlowCord is NOT designed for

Avoid using FlowCord sessions as the source of truth for anything that needs to survive across:

- Bot restarts or deployments
- Extended time periods (hours, days)

A **multi-day poll**, for example, is a poor fit for a FlowCord session. Each vote is a discrete, stateless interaction — there is no ongoing session to maintain. The appropriate architecture stores votes in a database, handles each button click independently, and uses a scheduled task to close the poll after the deadline.

### Recommended pattern: externally-backed state

The resilient pattern is to treat FlowCord as a **presentation layer only**, with meaningful state living in a database:

```
User triggers /command
        │
        ▼
FlowCord session starts  ←── ephemeral, process-scoped
        │
        ▼
Render callbacks read from ──► external cache (e.g. node-cache)
  cache or DB directly              │
                                    │ invalidated when data changes,
                                    │ shared across all sessions
        │
        ▼
Button action fires
        │
        ├── Update ctx.state       (immediate UI feedback)
        ├── Write to DB            (durable — survives restarts)
        └── Invalidate cache       (keeps other sessions consistent)
        │
        ▼
If session is interrupted, user re-runs /command
        │
        ▼
Render reads from cache/DB ──► user picks up where they left off
```

### sessionState vs. an external cache

These serve different purposes and should not be conflated:

| | `sessionState` | External cache (e.g. node-cache) |
|---|---|---|
| **Scope** | Single session | Shared across all sessions |
| **Lifetime** | Dies with the session | Independent of any session |
| **Invalidation** | Not possible externally | Explicit, on your terms |
| **Best used for** | Passing context between menus within a flow | DB query results, shared lookups |

Use `sessionState` for ephemeral inter-menu context — data that only makes sense within the current flow (e.g. a selection in one menu that a later menu needs to act on). For DB-backed data, querying directly in render callbacks or action handlers is perfectly valid and the simplest starting point. An external cache (e.g. node-cache) is an optional optimization on top of that — worth adding when the same data is read frequently across multiple sessions, when you need explicit invalidation as records change, or when response latency matters (discord.js recommends this approach for autocomplete handlers for the same reason).

With this separation, FlowCord handles the interactive UX and Discord API concerns, your database owns persistent state, and your cache layer manages read performance and consistency. A process restart is a minor inconvenience — the user re-opens the menu — rather than data loss.
