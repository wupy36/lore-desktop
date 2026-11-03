// Main-process event bus. Environment-agnostic (no Node/Electron imports) so
// renderer tests can drive it in-process.
import type { EventName, EventPayload } from "@shared/ipc";

type Listener<E extends EventName> = (payload: EventPayload<E>) => void;

export class Bus {
  private listeners = new Map<EventName, Set<Listener<never>>>();

  on<E extends EventName>(event: E, cb: Listener<E>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(cb as Listener<never>);
    return () => set.delete(cb as Listener<never>);
  }

  emit<E extends EventName>(event: E, payload: EventPayload<E>): void {
    for (const cb of this.listeners.get(event) ?? []) (cb as Listener<E>)(payload);
  }
}
