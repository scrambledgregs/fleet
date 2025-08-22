import type { Pack } from './types'
import Roofing from './roofing'
export const PACKS: Record<string, Pack> = {
  roofing: Roofing,
  general: { id: 'general', label: 'General', defaultPrompt: 'Trade estimate. JSON items only.' }
}