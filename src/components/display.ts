/**
 * Component helper functions for FlowCord.
 *
 * These return framework component configs — NOT Discord.js builders.
 * The MenuRenderer converts these to Discord API payloads at send time.
 *
 * Helpers integrate with the action system (buttons/selects carry handlers)
 * and ID namespacing is automatic.
 */
import type {
  ActionRowConfig,
  ButtonConfig,
  ButtonPaginationOptions,
  ComponentConfig,
  ContainerConfig,
  FileConfig,
  MediaGalleryConfig,
  MediaGalleryItemConfig,
  MenuContextLike,
  PaginatedGroupConfig,
  SectionConfig,
  SelectConfig,
  SeparatorConfig,
  TextDisplayConfig,
  ThumbnailConfig,
  Action,
  SelectAction,
} from '../types';
import type { ButtonStyle } from 'discord.js';

// ---------------------------------------------------------------------------
// Embed-Core Components
// ---------------------------------------------------------------------------

export interface ButtonOptions<TCtx = MenuContextLike> {
  label: string;
  style: ButtonStyle;
  id?: string;
  disabled?: boolean;
  emoji?: string;
  url?: string;
  opensModal?: boolean | string;
  action?: Action<TCtx>;
}

/** Create a button component with an associated action. */
export function button<TCtx = MenuContextLike>(
  opts: ButtonOptions<TCtx>
): ButtonConfig<TCtx> {
  return {
    type: 'button',
    label: opts.label,
    style: opts.style,
    id: opts.id,
    disabled: opts.disabled,
    emoji: opts.emoji,
    url: opts.url,
    opensModal: opts.opensModal,
    action: opts.action,
  };
}

export interface SelectOptions<TCtx = MenuContextLike> {
  builder: SelectConfig['builder'];
  id?: string;
  onSelect?: SelectAction<TCtx>;
}

/** Create a select menu config with an associated action. */
export function select<TCtx = MenuContextLike>(
  opts: SelectOptions<TCtx>
): SelectConfig<TCtx> {
  return {
    type: 'select',
    builder: opts.builder,
    id: opts.id,
    onSelect: opts.onSelect,
  };
}

/** Create an action row containing buttons and/or select menus. */
export function actionRow<TCtx = MenuContextLike>(
  children: (ButtonConfig<TCtx> | SelectConfig<TCtx>)[]
): ActionRowConfig<TCtx> {
  return {
    type: 'action_row',
    children,
  };
}

// ---------------------------------------------------------------------------
// Layout Components
// ---------------------------------------------------------------------------

/** Create a text display component. Supports markdown. */
export function text(content: string): TextDisplayConfig {
  return { type: 'text_display', content };
}

export interface SectionOptions<TCtx = MenuContextLike> {
  text: (string | TextDisplayConfig)[];
  accessory: ButtonConfig<TCtx> | ThumbnailConfig;
}

/** Create a section with text content and an accessory (button or thumbnail). */
export function section<TCtx = MenuContextLike>(
  opts: SectionOptions<TCtx>
): SectionConfig<TCtx> {
  return {
    type: 'section',
    text: opts.text,
    accessory: opts.accessory,
  };
}

export interface ContainerOptions<TCtx = MenuContextLike> {
  accentColor?: number;
  spoiler?: boolean;
  children: ComponentConfig<TCtx>[];
}

/** Create a container that groups components with an optional accent color. */
export function container<TCtx = MenuContextLike>(
  opts: ContainerOptions<TCtx>
): ContainerConfig<TCtx> {
  return {
    type: 'container',
    accentColor: opts.accentColor,
    spoiler: opts.spoiler,
    children: opts.children,
  };
}

export interface SeparatorOptions {
  divider?: boolean;
  spacing?: 'small' | 'large';
}

/** Create a separator between components. */
export function separator(opts?: SeparatorOptions): SeparatorConfig {
  return {
    type: 'separator',
    divider: opts?.divider,
    spacing: opts?.spacing,
  };
}

export interface ThumbnailOptions {
  url: string;
  description?: string;
  spoiler?: boolean;
}

/** Create a thumbnail image (used as section accessory). */
export function thumbnail(opts: ThumbnailOptions): ThumbnailConfig {
  return {
    type: 'thumbnail',
    url: opts.url,
    description: opts.description,
    spoiler: opts.spoiler,
  };
}

// ---------------------------------------------------------------------------
// Media Gallery
// ---------------------------------------------------------------------------

/** Create a media gallery with one or more media items. */
export function mediaGallery(
  items: MediaGalleryItemConfig[]
): MediaGalleryConfig {
  return {
    type: 'media_gallery',
    items,
  };
}

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------

export interface FileOptions {
  url: string;
  spoiler?: boolean;
}

/** Create a file attachment display. */
export function file(opts: FileOptions): FileConfig {
  return {
    type: 'file',
    url: opts.url,
    spoiler: opts.spoiler,
  };
}

// ---------------------------------------------------------------------------
// Paginated Group (layout mode only)
// ---------------------------------------------------------------------------

/**
 * Mark a set of buttons for framework-managed pagination.
 * The renderer slices the button array per page, creating action rows automatically.
 * Only one paginatedGroup per layout is supported.
 */
export function paginatedGroup<TCtx = MenuContextLike>(
  buttons: ButtonConfig<TCtx>[],
  options?: ButtonPaginationOptions
): PaginatedGroupConfig<TCtx> {
  return {
    type: 'paginated_group',
    buttons,
    options,
  };
}
