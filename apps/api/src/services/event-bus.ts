import { EventEmitter } from "node:events";
import { RunEvent } from "@aso/contracts";

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  public publish(runId: string, event: RunEvent): void {
    this.emitter.emit(`run:${runId}`, event);
  }

  public subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    const channel = `run:${runId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }
}

