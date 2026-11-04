import type { MalevoApi } from './index'

declare global {
  interface Window {
    malevo: MalevoApi
  }
}

export {}
