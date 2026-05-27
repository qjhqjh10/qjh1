export { coreRulesProvider } from './coreRulesProvider'
export { characterProvider } from './characterProvider'
export { outlineProvider } from './outlineProvider'
export { detailedOutlineProvider } from './detailedOutlineProvider'
export { styleProvider } from './styleProvider'
export { sceneProvider } from './sceneProvider'
export { kbProvider } from './kbProvider'
export { notesProvider } from './notesProvider'
export { chapterWritingProvider } from './chapterWritingProvider'
export { promptLibraryProvider } from './promptLibraryProvider'

import { coreRulesProvider } from './coreRulesProvider'
import { characterProvider } from './characterProvider'
import { outlineProvider } from './outlineProvider'
import { detailedOutlineProvider } from './detailedOutlineProvider'
import { styleProvider } from './styleProvider'
import { sceneProvider } from './sceneProvider'
import { kbProvider } from './kbProvider'
import { notesProvider } from './notesProvider'
import { chapterWritingProvider } from './chapterWritingProvider'
import { promptLibraryProvider } from './promptLibraryProvider'
import type { ContextProvider } from '../ContextAssembler'

export const ALL_PROVIDERS: ContextProvider[] = [
  coreRulesProvider,         // priority 100 — always included
  characterProvider,         // priority 80
  outlineProvider,           // priority 85
  detailedOutlineProvider,   // priority 80
  styleProvider,             // priority 75
  sceneProvider,             // priority 75
  kbProvider,                // priority 70
  chapterWritingProvider,    // priority 70
  notesProvider,             // priority 65
  promptLibraryProvider,     // priority 60
]
