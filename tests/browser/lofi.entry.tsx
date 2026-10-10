import { createRoot } from 'react-dom/client'
import ManualEditor from '@/app/editor/manual/page'
import AudioPage from '@/app/audio/page'
import { FlowImport } from '@/app/components/flow-import'

/** One bundle, routed by path, so the end-to-end test can walk through real pages with real full-page navigations. */
const path = window.location.pathname
const View = path.startsWith('/editor/manual') ? ManualEditor : path.startsWith('/audio') ? AudioPage : () => <FlowImport projectId="p1" />
createRoot(document.getElementById('root')!).render(<View />)
