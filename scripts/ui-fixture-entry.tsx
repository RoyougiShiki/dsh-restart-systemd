import { createRoot } from 'react-dom/client'
import { RestartButton } from '../src/client/RestartButton.tsx'
import { en, zh } from '../src/client/index.ts'

const params = new URLSearchParams(location.search)
const dict = params.get('lang') === 'en' ? en : zh
const wide = params.get('wide') !== '0'
const t = (key: keyof typeof dict) => dict[key]

const stage = document.getElementById('stage')!
stage.className = wide ? 'wide' : 'rail'
document.getElementById('caption')!.textContent = (wide ? 'wide' : 'rail') + ' / ' + (params.get('lang') === 'en' ? 'en' : 'zh')

createRoot(stage).render(<RestartButton wide={wide} t={t} />)
