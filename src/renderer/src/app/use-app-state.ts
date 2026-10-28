import { useEffect, useState } from 'react'
import { EMPTY_SUBSCRIPTIONS, reduceApp, type AppState } from '@shared/app-reducer'
import type { SequencedEvent } from '@shared/api'
import { EMPTY_TASKS } from '@shared/tasks'
import type { ThreadMap } from '@shared/thread'

/**
 * Mirrors main's state with the same reducer. Events are buffered until the snapshot lands,
 * then only those newer than the snapshot are applied, since IPC replies and pushes are not ordered.
 */
type MirroredState = AppState & { home: string; loaded: boolean }

export function useAppState(): MirroredState {
  const [state, setState] = useState<MirroredState>({ threads: {}, subscriptions: EMPTY_SUBSCRIPTIONS, tasks: EMPTY_TASKS, home: '', loaded: false })

  useEffect(() => {
    let snapshotSeq: number | null = null
    let buffered: SequencedEvent[] = []
    const apply = (events: SequencedEvent[]) =>
      setState((s) => ({ ...s, ...events.reduce<AppState>((app, e) => reduceApp(app, e.event), s) }))
    const unsubscribe = window.oniko.onEvent((sequenced) => {
      if (snapshotSeq === null) buffered.push(sequenced)
      else if (sequenced.seq > snapshotSeq) apply([sequenced])
    })
    void window.oniko.snapshot().then((snapshot) => {
      snapshotSeq = snapshot.seq
      setState({
        threads: Object.fromEntries(snapshot.threads.map((t) => [t.id, t])) as ThreadMap,
        subscriptions: snapshot.subscriptions,
        tasks: snapshot.tasks,
        home: snapshot.home,
        loaded: true,
      })
      apply(buffered.filter((e) => e.seq > snapshot.seq))
      buffered = []
    })
    return unsubscribe
  }, [])

  return state
}
