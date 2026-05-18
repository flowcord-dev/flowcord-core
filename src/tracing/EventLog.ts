/**
 * EventLog — lightweight in-memory event recorder for session lifecycle events.
 *
 * MenuSession emits events when eventLog is provided (zero overhead if absent).
 * Primarily used by SimulatedAdapter and createTestSession for test assertions.
 */
import type {
  NormalizedRenderPayload,
  NormalizedTerminalPayload,
} from '../adapter/types';

export type SessionEvent =
  | {
      kind: 'render';
      menuId: string;
      payload: NormalizedRenderPayload;
      timestamp: number;
    }
  | {
      kind: 'navigation';
      from: string | null;
      to: string;
      timestamp: number;
    }
  | {
      kind: 'hook';
      menuId: string;
      hookName: string;
      timestamp: number;
    }
  | {
      kind: 'action';
      menuId: string;
      componentId: string;
      timestamp: number;
    }
  | { kind: 'modal:shown'; menuId: string; timestamp: number }
  | { kind: 'modal:submit'; menuId: string; timestamp: number }
  | {
      kind: 'session:end';
      reason: 'closed' | 'cancelled' | 'timeout';
      payload: NormalizedTerminalPayload;
      timestamp: number;
    };

export class EventLog {
  private readonly _events: SessionEvent[] = [];

  get events(): readonly SessionEvent[] {
    return this._events;
  }

  record(event: SessionEvent): void {
    this._events.push(event);
  }

  filter<T extends SessionEvent['kind']>(
    kind: T,
  ): Extract<SessionEvent, { kind: T }>[] {
    return this._events.filter(
      (e): e is Extract<SessionEvent, { kind: T }> => e.kind === kind,
    );
  }

  clear(): void {
    this._events.length = 0;
  }
}
