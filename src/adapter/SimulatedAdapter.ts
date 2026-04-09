/**
 * SimulatedAdapter — queue-based test double for FlowCordAdapter.
 *
 * Designed for deterministic testing of menu sessions without any Discord.js
 * connection. Interactions are enqueued before the session loop processes them.
 *
 * Key design:
 * - awaitComponent/awaitMessage/awaitModal are backed by InteractionQueue<T>
 *   which suspends until an item is available (or the safety timeout fires).
 * - waitForNextRender() resolves after the next sendPayload() call.
 * - endPromise resolves after sendTerminalPayload() is called.
 * - All normalized payloads are appended to renders[] / terminals[] for assertions.
 */
import type { FlowCordAdapter } from './FlowCordAdapter';
import type {
  AwaitOptions,
  NormalizedComponentInteraction,
  NormalizedMessage,
  NormalizedModal,
  NormalizedModalSubmission,
  NormalizedRenderPayload,
  NormalizedTerminalPayload,
  NormalizedTerminalReason,
} from './types';
import type { RenderMode } from '../types/common';

/** Thrown when an InteractionQueue times out waiting for an item. */
export class SimulatedTimeoutError extends Error {
  constructor(
    message = 'SimulatedAdapter queue timed out waiting for interaction',
  ) {
    super(message);
    this.name = 'SimulatedTimeoutError';
  }
}

/**
 * A simple FIFO queue that suspends `dequeue()` when empty.
 * Items enqueued before dequeue() is called resolve immediately.
 * If the queue is still empty after `safetyTimeout` ms, throws SimulatedTimeoutError.
 */
class InteractionQueue<T> {
  private readonly _queue: T[] = [];
  private _waiting: ((item: T) => void) | null = null;
  private _waitingReject: ((err: Error) => void) | null = null;
  private readonly _safetyTimeout: number;
  private _timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(safetyTimeout = 5000) {
    this._safetyTimeout = safetyTimeout;
  }

  enqueue(item: T): void {
    if (this._waiting) {
      const resolve = this._waiting;
      this._waiting = null;
      this._waitingReject = null;
      // Cancel the safety timeout so it does not keep the process alive.
      if (this._timeoutHandle !== null) {
        clearTimeout(this._timeoutHandle);
        this._timeoutHandle = null;
      }
      resolve(item);
    } else {
      this._queue.push(item);
    }
  }

  dequeue(_options: AwaitOptions): Promise<T> {
    if (this._queue.length > 0) {
      return Promise.resolve(this._queue.shift()!);
    }

    return new Promise<T>((resolve, reject) => {
      this._waiting = resolve;
      this._waitingReject = reject;

      this._timeoutHandle = setTimeout(() => {
        this._timeoutHandle = null;
        if (this._waiting === resolve) {
          this._waiting = null;
          this._waitingReject = null;
          reject(new SimulatedTimeoutError());
        }
      }, this._safetyTimeout);
      // Don't prevent Node/Jest from exiting if only this timer remains.
      // The timer is still cleared normally via clearTimeout() when an item
      // is enqueued — unref() only affects process exit, not timer firing.
      (this._timeoutHandle as unknown as NodeJS.Timeout).unref?.();
    });
  }

  clear(): void {
    this._queue.length = 0;
    if (this._timeoutHandle !== null) {
      clearTimeout(this._timeoutHandle);
      this._timeoutHandle = null;
    }
    if (this._waitingReject) {
      this._waitingReject(new SimulatedTimeoutError('Queue cleared'));
    }
    this._waiting = null;
    this._waitingReject = null;
  }
}

export class SimulatedAdapter implements FlowCordAdapter {
  /** All payloads sent via sendPayload(), in order. */
  readonly renders: NormalizedRenderPayload[] = [];
  /** All terminal payloads sent via sendTerminalPayload(), in order. */
  readonly terminals: NormalizedTerminalPayload[] = [];

  private _activeMessageMode: RenderMode | null = null;
  private _endResolve!: (reason: NormalizedTerminalReason) => void;

  /**
   * True after sendPayload() is called, cleared when render listeners are
   * notified in awaitComponent/awaitMessage. This guards against the
   * awaitComponent call inside awaitModalInteraction (the modal-dismiss racer)
   * triggering waitForNextRender() prematurely — only a call that follows an
   * actual render should notify.
   */
  private _hasPendingRender = false;

  /** Resolves when sendTerminalPayload() is called. */
  readonly endPromise: Promise<NormalizedTerminalReason>;

  private readonly _componentQueue: InteractionQueue<NormalizedComponentInteraction>;
  private readonly _messageQueue: InteractionQueue<NormalizedMessage>;
  private readonly _modalQueue: InteractionQueue<NormalizedModalSubmission>;
  private readonly _renderListeners: Array<() => void> = [];

  constructor(options: { safetyTimeout?: number } = {}) {
    const safetyTimeout = options.safetyTimeout ?? 5000;
    this._componentQueue = new InteractionQueue(safetyTimeout);
    this._messageQueue = new InteractionQueue(safetyTimeout);
    this._modalQueue = new InteractionQueue(safetyTimeout);
    this.endPromise = new Promise<NormalizedTerminalReason>(
      (resolve) => {
        this._endResolve = resolve;
      },
    );
  }

  // ---------------------------------------------------------------------------
  // FlowCordAdapter implementation
  // ---------------------------------------------------------------------------

  get activeMessageMode(): RenderMode | null {
    return this._activeMessageMode;
  }

  get renderCount(): number {
    return this.renders.length;
  }

  get lastRender(): NormalizedRenderPayload | null {
    return this.renders[this.renders.length - 1] ?? null;
  }

  async deferReply(_options: { ephemeral: boolean }): Promise<void> {
    // No-op for simulation — no Discord reply to defer.
  }

  async sendPayload(payload: NormalizedRenderPayload): Promise<void> {
    this.renders.push(payload);
    this._activeMessageMode = payload.mode;
    // Mark that a render occurred. Render listeners will be notified in the
    // next awaitComponent/awaitMessage call (the main-loop "ready for input"
    // call), NOT here. This prevents awaitComponent calls that are part of a
    // modal-dismiss race from triggering waitForNextRender() prematurely.
    this._hasPendingRender = true;
  }

  awaitComponent(
    options: AwaitOptions,
  ): Promise<NormalizedComponentInteraction> {
    if (this._hasPendingRender) {
      this._hasPendingRender = false;
      const listeners = this._renderListeners.splice(0);
      for (const listener of listeners) {
        listener();
      }
    }
    return this._componentQueue.dequeue(options);
  }

  awaitMessage(options: AwaitOptions): Promise<NormalizedMessage> {
    // Same pattern as awaitComponent.
    if (this._hasPendingRender) {
      this._hasPendingRender = false;
      const listeners = this._renderListeners.splice(0);
      for (const listener of listeners) {
        listener();
      }
    }
    return this._messageQueue.dequeue(options);
  }

  async showModal(
    _modal: NormalizedModal,
    _triggerInteraction: NormalizedComponentInteraction,
  ): Promise<void> {
    // No-op for simulation — modal is shown without a real Discord interaction.
    // The test enqueues a modal submission via enqueueModalSubmit().
  }

  awaitModal(
    options: AwaitOptions,
  ): Promise<NormalizedModalSubmission> {
    return this._modalQueue.dequeue(options);
  }

  async sendTerminalPayload(
    payload: NormalizedTerminalPayload,
  ): Promise<void> {
    this.terminals.push(payload);

    // Resolve all pending render listeners so any racing waitForNextRender() unblocks.
    const listeners = this._renderListeners.splice(0);
    for (const listener of listeners) {
      listener();
    }

    this._endResolve(payload.reason);
  }

  // ---------------------------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns a Promise that resolves after the next sendPayload() call.
   * If a terminal payload arrives first (session ended), also resolves.
   */
  waitForNextRender(): Promise<void> {
    return new Promise<void>((resolve) => {
      this._renderListeners.push(resolve);
    });
  }

  /**
   * Enqueue a component interaction to be returned by the next awaitComponent() call.
   */
  enqueueComponent(
    interaction: NormalizedComponentInteraction,
  ): void {
    this._componentQueue.enqueue(interaction);
  }

  /**
   * Enqueue a message to be returned by the next awaitMessage() call.
   */
  enqueueMessage(msg: NormalizedMessage): void {
    this._messageQueue.enqueue(msg);
  }

  /**
   * Enqueue a modal submission to be returned by the next awaitModal() call.
   */
  enqueueModalSubmit(submission: NormalizedModalSubmission): void {
    this._modalQueue.enqueue(submission);
  }
}
