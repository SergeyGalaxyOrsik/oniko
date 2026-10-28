import type { OnikoApi } from '@shared/api'

declare global {
  interface Window {
    oniko: OnikoApi
  }
}
