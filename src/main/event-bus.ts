import type { SequencedEvent } from '@shared/api'
import type { AppEvent } from '@shared/events'

/** One sequence across thread and subscription events, so a snapshot's seq covers both. */
export class EventBus {
  seq = 0

  constructor(private readonly send: (event: SequencedEvent) => void) {}

  publish(event: AppEvent): void {
    this.seq += 1
    this.send({ seq: this.seq, event })
  }
}
