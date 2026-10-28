import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const parseIoreg = (out: string): string | null => /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out)?.[1] ?? null
export const parseRegQuery = (out: string): string | null => /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out)?.[1] ?? null
export const parseMachineId = (text: string): string | null => text.trim() || null

/** The raw hardware id never leaves the machine, only this salted digest. */
export const hashDeviceId = (raw: string) => createHash('sha256').update(`oniko-telemetry:${raw}`).digest('hex')

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(file, args, { timeout: 3000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout))),
  )

async function firstFile(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    const id = await readFile(path, 'utf8').then(parseMachineId, () => null)
    if (id) return id
  }
  return null
}

export async function readHardwareId(platform: NodeJS.Platform = process.platform): Promise<string | null> {
  try {
    if (platform === 'darwin') return parseIoreg(await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']))
    if (platform === 'win32') return parseRegQuery(await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']))
    return await firstFile(['/etc/machine-id', '/var/lib/dbus/machine-id'])
  } catch {
    return null
  }
}
