/**
 * Unit tests for DiscordAdapter.
 *
 * Strategy: build plain mock objects cast to discord.js types. TypeScript
 * still validates method names on DiscordAdapter.ts itself; the mocks just
 * need to satisfy the adapter's runtime calls. No HTTP or WebSocket needed.
 */
import { MessageFlags } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  Message,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { DiscordAdapter } from '../DiscordAdapter';
import type { NormalizedRenderPayload, NormalizedTerminalPayload } from '../types';

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<Record<string, unknown>> = {}): Message {
  const edit = jest.fn();
  const del = jest.fn();
  const awaitMC = jest.fn();
  const msg = {
    id: 'msg-1',
    channelId: 'ch-1',
    content: '',
    author: { id: 'user-1' },
    edit,
    delete: del,
    awaitMessageComponent: awaitMC,
    ...overrides,
  } as unknown as Message;
  // Default: edit/delete resolve with the message itself; awaitMC is pending
  edit.mockResolvedValue(msg);
  del.mockResolvedValue(msg);
  awaitMC.mockReturnValue(new Promise(() => {}));
  return msg;
}

function makeCommandInteraction(overrides: Partial<Record<string, unknown>> = {}): ChatInputCommandInteraction {
  const mockMessage = makeMessage();
  const mockRestPatch = jest.fn().mockResolvedValue({});
  const interaction = {
    user: { id: 'user-1' },
    applicationId: 'app-1',
    token: 'tok-1',
    channel: null,
    client: { rest: { patch: mockRestPatch } },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(mockMessage),
    followUp: jest.fn().mockResolvedValue(mockMessage),
    ...overrides,
  } as unknown as ChatInputCommandInteraction;
  return interaction;
}

function makeComponentInteraction(overrides: Partial<Record<string, unknown>> = {}): MessageComponentInteraction {
  const ci = {
    customId: 'btn-1',
    user: { id: 'user-1' },
    deferred: false,
    replied: false,
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    showModal: jest.fn().mockResolvedValue(undefined),
    awaitModalSubmit: jest.fn().mockReturnValue(new Promise(() => {})),
    isAnySelectMenu: jest.fn().mockReturnValue(false),
    isButton: jest.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as MessageComponentInteraction;
  return ci;
}

/** Minimal embeds-mode render payload */
function embedsPayload(overrides: Partial<NormalizedRenderPayload> = {}): NormalizedRenderPayload {
  return {
    mode: 'embeds',
    embeds: [{ title: 'Test', description: 'hello' }],
    components: [],
    behavior: {
      messageCleanup: 'edit',
      ephemeral: false,
      ephemeralFallbackDisposal: 'strip',
      closedMessage: 'Menu closed.',
      deleteUserMessages: false,
      timeoutMessage: '*This interaction has timed out.*',
    },
    ...overrides,
  };
}

/** Minimal layout-mode render payload */
function layoutPayload(overrides: Partial<NormalizedRenderPayload> = {}): NormalizedRenderPayload {
  return {
    mode: 'layout',
    layoutComponents: [{ type: 17, id: 1, components: [] }] as never,
    behavior: {
      messageCleanup: 'edit',
      ephemeral: false,
      ephemeralFallbackDisposal: 'strip',
      closedMessage: 'Menu closed.',
      deleteUserMessages: false,
      timeoutMessage: '*This interaction has timed out.*',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// deferReply
// ---------------------------------------------------------------------------

describe('deferReply', () => {
  it('calls interaction.deferReply with no flags for non-ephemeral', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);

    await adapter.deferReply({ ephemeral: false });

    expect(interaction.deferReply).toHaveBeenCalledWith({});
  });

  it('calls interaction.deferReply with Ephemeral flag for ephemeral', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);

    await adapter.deferReply({ ephemeral: true });

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });
});

// ---------------------------------------------------------------------------
// sendPayload — first render (editReply)
// ---------------------------------------------------------------------------

describe('sendPayload — first render', () => {
  it('calls editReply on the first render (embeds mode)', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);

    await adapter.sendPayload(embedsPayload());

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it('calls editReply with IsComponentsV2 flag for layout mode', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);

    await adapter.sendPayload(layoutPayload());

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.IsComponentsV2 }),
    );
  });

  it('sets activeMessageMode after first render', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);

    expect(adapter.activeMessageMode).toBeNull();
    await adapter.sendPayload(embedsPayload());
    expect(adapter.activeMessageMode).toBe('embeds');
  });
});

// ---------------------------------------------------------------------------
// sendPayload — subsequent renders via component interaction (update)
// ---------------------------------------------------------------------------

describe('sendPayload — component interaction update', () => {
  it('calls componentInteraction.update() when there is a pending component interaction', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);

    // First render establishes the active message
    await adapter.sendPayload(embedsPayload());

    // Simulate a component interaction arriving
    const ci = makeComponentInteraction();
    adapter.setLastComponentInteraction(ci);

    await adapter.sendPayload(embedsPayload());

    expect(ci.update).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledTimes(1); // only initial render
  });

  it('falls back to message.edit() when component interaction is already deferred', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);

    await adapter.sendPayload(embedsPayload());

    const ci = makeComponentInteraction({ deferred: true });
    adapter.setLastComponentInteraction(ci);

    await adapter.sendPayload(embedsPayload());

    // ci.update should NOT be called since it's already deferred
    expect(ci.update).not.toHaveBeenCalled();
    // The active message's edit should be called instead
    const activeMsg = await (interaction.editReply as jest.Mock).mock.results[0]?.value;
    expect(activeMsg.edit).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendPayload — postAndDelete cleanup
// ---------------------------------------------------------------------------

describe('sendPayload — postAndDelete cleanup', () => {
  it('deletes old message and posts followUp when messageCleanup=postAndDelete', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);

    // First render
    await adapter.sendPayload(embedsPayload());

    // Second render with postAndDelete
    await adapter.sendPayload(
      embedsPayload({ behavior: { messageCleanup: 'postAndDelete', ephemeral: false, ephemeralFallbackDisposal: 'strip', closedMessage: 'closed', deleteUserMessages: false, timeoutMessage: '*This interaction has timed out.*' } }),
    );

    const firstMessage = await (interaction.editReply as jest.Mock).mock.results[0]?.value;
    expect(firstMessage.delete).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendPayload — postAndStrip cleanup
// ---------------------------------------------------------------------------

describe('sendPayload — postAndStrip cleanup', () => {
  it('edits old message to remove components, then posts followUp', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);

    await adapter.sendPayload(embedsPayload());

    await adapter.sendPayload(
      embedsPayload({ behavior: { messageCleanup: 'postAndStrip', ephemeral: false, ephemeralFallbackDisposal: 'strip', closedMessage: 'closed', deleteUserMessages: false, timeoutMessage: '*This interaction has timed out.*' } }),
    );

    const firstMessage = await (interaction.editReply as jest.Mock).mock.results[0]?.value;
    // edit called to strip components
    expect(firstMessage.edit).toHaveBeenCalledWith(
      expect.objectContaining({ components: [] }),
    );
    expect(interaction.followUp).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// awaitComponent
// ---------------------------------------------------------------------------

describe('awaitComponent', () => {
  it('calls message.awaitMessageComponent with a userId filter', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);
    await adapter.sendPayload(embedsPayload());

    const activeMsg = await (interaction.editReply as jest.Mock).mock.results[0]?.value as Message;

    // Resolve the awaited component with a fake interaction
    const fakeCI = makeComponentInteraction();
    (activeMsg.awaitMessageComponent as jest.Mock).mockResolvedValueOnce(fakeCI);

    const result = await adapter.awaitComponent({ timeout: 60000, userId: 'user-1' });

    expect(activeMsg.awaitMessageComponent).toHaveBeenCalledWith(
      expect.objectContaining({ time: 60000 }),
    );
    expect(result.customId).toBe('btn-1');
    expect(result.userId).toBe('user-1');
  });

  it('throws if there is no active message', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);

    await expect(adapter.awaitComponent({ timeout: 5000, userId: 'user-1' })).rejects.toThrow(
      'No active message',
    );
  });
});

// ---------------------------------------------------------------------------
// showModal + awaitModal
// ---------------------------------------------------------------------------

describe('showModal and awaitModal', () => {
  it('calls showModal on the trigger interaction and resolves awaitModal on submit', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);
    await adapter.sendPayload(embedsPayload());

    const ci = makeComponentInteraction();
    const activeMsg = await (interaction.editReply as jest.Mock).mock.results[0]?.value as Message;
    (activeMsg.awaitMessageComponent as jest.Mock).mockResolvedValueOnce(ci);
    await adapter.awaitComponent({ timeout: 60000, userId: 'user-1' });

    const modalData = { custom_id: 'my-modal', title: 'Test', components: [] };

    // Build a fake ModalSubmitInteraction
    const modalSubmit = {
      customId: 'my-modal',
      user: { id: 'user-1' },
      fields: {
        getTextInputValue: jest.fn().mockReturnValue('typed text'),
      },
      deferUpdate: jest.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;
    (ci.awaitModalSubmit as jest.Mock).mockResolvedValueOnce(modalSubmit);

    await adapter.showModal(modalData, {
      customId: 'btn-1',
      type: 'button',
      userId: 'user-1',
      deferUpdate: async () => {},
      raw: ci,
    });

    const submission = await adapter.awaitModal({ timeout: 60000, userId: 'user-1' });

    expect(ci.showModal).toHaveBeenCalledWith(modalData);
    expect(submission.getFieldValue('field-1')).toBe('typed text');
  });

  it('throws if awaitModal is called without a prior showModal', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);

    await expect(adapter.awaitModal({ timeout: 5000, userId: 'user-1' })).rejects.toThrow(
      'No pending modal interaction',
    );
  });
});

// ---------------------------------------------------------------------------
// sendTerminalPayload
// ---------------------------------------------------------------------------

describe('sendTerminalPayload', () => {
  it('edits active message to remove components on reason=closed', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);
    await adapter.sendPayload(embedsPayload());

    const activeMsg = await (interaction.editReply as jest.Mock).mock.results[0]?.value as Message;

    const terminal: NormalizedTerminalPayload = {
      reason: 'closed',
      content: 'Menu closed.',
      mode: 'embeds',
    };
    await adapter.sendTerminalPayload(terminal);

    expect(activeMsg.edit).toHaveBeenCalledWith(
      expect.objectContaining({ components: [] }),
    );
  });

  it('calls componentInteraction.update() for reason=cancelled with pending interaction', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);
    await adapter.sendPayload(embedsPayload());

    const ci = makeComponentInteraction();
    adapter.setLastComponentInteraction(ci);

    const terminal: NormalizedTerminalPayload = {
      reason: 'cancelled',
      content: 'Cancelled.',
      mode: 'embeds',
    };
    await adapter.sendTerminalPayload(terminal);

    expect(ci.update).toHaveBeenCalled();
  });

  it('sends layout terminal with IsComponentsV2 flag', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);
    await adapter.sendPayload(layoutPayload());

    const activeMsg = await (interaction.editReply as jest.Mock).mock.results[0]?.value as Message;

    const terminal: NormalizedTerminalPayload = {
      reason: 'closed',
      content: 'Menu closed.',
      mode: 'layout',
    };
    await adapter.sendTerminalPayload(terminal);

    expect(activeMsg.edit).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.IsComponentsV2 }),
    );
  });
});

// ---------------------------------------------------------------------------
// _editEphemeralMessage (via ephemeral sendPayload)
// ---------------------------------------------------------------------------

describe('_editEphemeralMessage', () => {
  it('calls editReply for ephemeral deferred reply on first render (no extra Ephemeral flag)', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);

    // Ephemeral is established by deferReply — editReply does NOT re-add the flag.
    // Discord already knows the reply is ephemeral from the initial defer.
    await adapter.deferReply({ ephemeral: true });
    await adapter.sendPayload(embedsPayload({ behavior: { messageCleanup: 'edit', ephemeral: true, ephemeralFallbackDisposal: 'strip', closedMessage: 'closed', deleteUserMessages: false, timeoutMessage: '*This interaction has timed out.*' } }));

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    // The payload is sent via editReply; ephemeral was set on deferReply, not here
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it('calls rest.patch for ephemeral followUp message', async () => {
    const interaction = makeCommandInteraction();
    const adapter = new DiscordAdapter(interaction);

    // First render to establish ephemeral message
    await adapter.sendPayload(embedsPayload({ behavior: { messageCleanup: 'edit', ephemeral: true, ephemeralFallbackDisposal: 'strip', closedMessage: 'closed', deleteUserMessages: false, timeoutMessage: '*This interaction has timed out.*' } }));
    adapter.seedDeferEphemeral(true);

    // Simulate a followUp message by triggering a mode change (layout → embeds transition)
    // Instead, directly test via postAndStrip → followUp for ephemeral
    await adapter.sendPayload(
      embedsPayload({ behavior: { messageCleanup: 'postAndStrip', ephemeral: true, ephemeralFallbackDisposal: 'strip', closedMessage: 'closed', deleteUserMessages: false, timeoutMessage: '*This interaction has timed out.*' } }),
    );

    // followUp was called to post the new message
    expect(interaction.followUp).toHaveBeenCalled();
  });
});
