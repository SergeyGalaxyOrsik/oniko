import { arch, cpus, platform, release, totalmem, version } from 'node:os'
import { app, screen } from 'electron'
import { z } from 'zod'
import type { DeviceInfo } from './contract'
import { truncate } from './scrub'

const text = (value: string) => truncate(value, 256)

/** Only the fields we read; everything else in Chromium's GPU dump is ignored. */
const gpuInfo = z.object({
  gpuDevice: z
    .array(
      z.object({
        vendorId: z.number().int().optional(),
        deviceId: z.number().int().optional(),
        driverVendor: z.string().optional(),
        driverVersion: z.string().optional(),
        active: z.boolean().optional(),
      }),
    )
    .optional(),
  auxAttributes: z.object({ glRenderer: z.string().optional(), glVendor: z.string().optional() }).optional(),
})

async function gpus(): Promise<DeviceInfo['gpus']> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000).unref())
  const raw = await Promise.race([app.getGPUInfo('complete').catch(() => null), timeout])
  const parsed = gpuInfo.safeParse(raw)
  if (!parsed.success) return []
  const devices = parsed.data.gpuDevice ?? []
  const aux = parsed.data.auxAttributes
  // The GL strings describe whichever GPU is driving the app.
  const activeIndex = Math.max(0, devices.findIndex((d) => d.active))
  return devices.slice(0, 8).map((d, i) => ({
    ...(d.vendorId !== undefined ? { vendorId: d.vendorId } : {}),
    ...(d.deviceId !== undefined ? { deviceId: d.deviceId } : {}),
    ...(d.driverVersion ? { driverVersion: text(d.driverVersion) } : {}),
    ...(i === activeIndex && aux?.glVendor ? { vendor: text(aux.glVendor) } : d.driverVendor ? { vendor: text(d.driverVendor) } : {}),
    ...(i === activeIndex && aux?.glRenderer ? { renderer: text(aux.glRenderer) } : {}),
  }))
}

/** Hardware and runtime facts only: no hostname, username, paths, addresses or serials. Call after ready. */
export async function collectDeviceInfo(): Promise<DeviceInfo> {
  const cpu = cpus()
  return {
    os: { platform: platform(), release: text(release()), version: text(version()), arch: arch() },
    cpu: {
      model: text(cpu[0]?.model.trim() ?? 'unknown'),
      cores: cpu.length,
      ...(cpu[0]?.speed ? { speedMhz: Math.round(cpu[0].speed) } : {}),
    },
    memoryBytes: totalmem(),
    gpus: await gpus(),
    displays: screen
      .getAllDisplays()
      .slice(0, 8)
      .map((d) => ({
        width: Math.round(d.size.width * d.scaleFactor),
        height: Math.round(d.size.height * d.scaleFactor),
        scaleFactor: d.scaleFactor,
        ...(d.displayFrequency ? { refreshRate: d.displayFrequency } : {}),
      })),
    locale: text(app.getLocale()),
    app: {
      version: text(app.getVersion()),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node,
      packaged: app.isPackaged,
    },
  }
}
