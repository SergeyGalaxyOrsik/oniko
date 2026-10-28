import { z } from 'zod'

// Mirrors oniko-web/packages/api/src/telemetry/contract.ts; the server rejects anything else.

export const LIMITS = { events: 500, errors: 100, message: 2000, stack: 16_000, name: 128, text: 256, props: 32, key: 64, eventName: 64 } as const

const shortText = z.string().max(LIMITS.text)
const propValue = z.union([shortText, z.number(), z.boolean(), z.null()])
const props = z
  .record(z.string().max(LIMITS.key), propValue)
  .refine((value) => Object.keys(value).length <= LIMITS.props, 'At most 32 properties')

export const deviceInfo = z.object({
  os: z.object({ platform: shortText, release: shortText, version: shortText, arch: shortText }),
  cpu: z.object({ model: shortText, cores: z.number().int().min(0), speedMhz: z.number().int().min(0).optional() }),
  memoryBytes: z.number().int().min(0),
  gpus: z
    .array(
      z.object({
        vendor: shortText.optional(),
        renderer: shortText.optional(),
        vendorId: z.number().int().optional(),
        deviceId: z.number().int().optional(),
        driverVersion: shortText.optional(),
      }),
    )
    .max(8),
  displays: z
    .array(z.object({ width: z.number().int(), height: z.number().int(), scaleFactor: z.number(), refreshRate: z.number().optional() }))
    .max(8),
  locale: shortText,
  app: z.object({ version: shortText, electron: shortText, chrome: shortText, node: shortText, packaged: z.boolean() }),
})

export const ERROR_SOURCES = ['main', 'renderer', 'ipc', 'process'] as const

export const telemetryEvent = z.object({
  name: z
    .string()
    .min(1)
    .max(LIMITS.eventName)
    .regex(/^[a-z0-9_.:-]+$/i),
  props: props.optional(),
  at: z.iso.datetime(),
})

export const telemetryError = z.object({
  source: z.enum(ERROR_SOURCES),
  name: z.string().max(LIMITS.name),
  message: z.string().max(LIMITS.message),
  stack: z.string().max(LIMITS.stack).optional(),
  context: props.optional(),
  at: z.iso.datetime(),
})

export const registerOutput = z.object({ token: z.string() })

export type DeviceInfo = z.infer<typeof deviceInfo>
export type TelemetryEvent = z.infer<typeof telemetryEvent>
export type TelemetryError = z.infer<typeof telemetryError>
export type ErrorSource = (typeof ERROR_SOURCES)[number]
export type Props = Record<string, string | number | boolean | null>
