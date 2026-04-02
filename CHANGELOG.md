# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-alpha.0] - 2026-03-24

### Added

- Core `FlowCord` facade and `MenuEngine` for session management
- `MenuBuilder` fluent API with full TypeScript generics for typed state
- Dual render modes: embeds mode (traditional Discord embeds + buttons) and layout mode (Components v2)
- Lifecycle hook system: `onEnter`, `onLeave`, `beforeRender`, `afterRender`, `onAction`, `onCancel`, `onNext`, `onPrevious`
- Built-in navigation actions: `goTo`, `goBack`, `closeMenu`, `openModal`
- Composable action pipelines with `pipeline()` and `guard()`
- Session-wide `StateStore` and menu-local `StateAccessor` with full type safety
- Navigation history stack (`MenuStack`) with state preservation on return
- Sub-menu continuation pattern via `openSubMenu` / `ctx.complete()`
- Button pagination and list pagination support
- Modal form handling
- Component ID namespacing to prevent cross-session collisions
- Plugin registries: `MenuRegistry`, `ActionRegistry`, `HookRegistry`
- Navigation tracing via `NavigationTracer`
- Six example files covering quickstart through advanced patterns

[Unreleased]: https://github.com/flowcord-dev/flowcord-js/compare/v0.1.0-alpha.0...HEAD
[0.1.0-alpha.0]: https://github.com/flowcord-dev/flowcord-js/releases/tag/v0.1.0-alpha.0
