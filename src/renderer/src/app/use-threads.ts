import { useEffect, useState } from 'react'
import type { SequencedEvent } from '@shared/api'
import type { ThreadMap } from '@shared/thread'
import { reduceThreads } from '@shared/thread-reducer'

/**
 * Mirrors main's thread state with the same reducer. Events are buffered until the snapshot lands,
 * then only those newer than the snapshot are applied, since IPC replies and pushes are not ordered.
 */
export function useThreads(): { threads: ThreadMap; loaded: boolean } {
  const [state, setState] = useState<{ threads: ThreadMap; loaded: boolean }>({ threads: {}, loaded: false })

  useEffect(() => {
    let snapshotSeq: number | null = null
    let buffered: SequencedEvent[] = []
    const apply = (events: SequencedEvent[]) =>
      setState((s) => ({ ...s, threads: events.reduce((threads, e) => (e.event.type === 'subscriptions' ? threads : reduceThreads(threads, e.event)), s.threads) }))
    const unsubscribe = window.oniko.onEvent((sequenced) => {
      if (snapshotSeq === null) buffered.push(sequenced)
      else if (sequenced.seq > snapshotSeq) apply([sequenced])
    })
    void window.oniko.threads.list().then((snapshot) => {
      snapshotSeq = snapshot.seq
      setState({ threads: Object.fromEntries(snapshot.threads.map((t) => [t.id, t])) as ThreadMap, loaded: true })
      apply(buffered.filter((e) => e.seq > snapshot.seq))
      buffered = []
    })
    return unsubscribe
  }, [])

  return state
}
