import { describe, expect, it } from 'vitest'
import { newThreadConfig } from './config'
import type { SubscriptionId } from './subscriptions'
import { newThread, subscriptionId } from './test-fixtures'
import type { ConfigControl } from './thread'

const mode = (value: string): ConfigControl => ({
  id: 'mode',
  label: 'Mode',
  category: 'mode',
  source: 'mode',
  value,
  options: [
    { value: 'default', label: 'Manual' },
    { value: 'plan', label: 'Plan' },
  ],
})

describe('newThreadConfig', () => {
  const other = 'sub-2' as SubscriptionId

  it('takes the newest thread on the same subscription, with its last values', () => {
    const threads = [
      newThread({ createdAt: 1, config: [mode('default')] }),
      newThread({ createdAt: 2, config: [mode('plan')] }),
      newThread({ createdAt: 3, subscriptionId: other, config: [mode('default')] }),
    ]
    expect(newThreadConfig(threads, 'claude', subscriptionId)).toEqual([mode('plan')])
  })

  it('falls back to the same agent on another subscription, then to nothing', () => {
    const threads = [newThread({ createdAt: 1, subscriptionId: other, config: [mode('plan')] }), newThread({ createdAt: 2, config: [] })]
    expect(newThreadConfig(threads, 'claude', subscriptionId)).toEqual([mode('plan')])
    expect(newThreadConfig([newThread({ config: [] })], 'claude', subscriptionId)).toEqual([])
  })
})
