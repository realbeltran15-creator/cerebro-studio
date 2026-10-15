import { StudioShell } from '../components/studio-shell'
import { CampaignsApp } from './campaigns-app'

export const metadata = { title: 'Campañas · Cerebro Studio' }

export default function CampaignsPage() {
  return <StudioShell title="Campañas" eyebrow="PROMOCIÓN"><CampaignsApp /></StudioShell>
}
