import Desk from '@/components/Desk'
import { deskConfig } from '@/lib/config'

// The page is a thin server shell: it reads the (public) desk config from env
// and hands it to the client desk. No data fetching here — the desk polls
// /api/portfolio itself so the header clock, the log, and the embed all stay
// live without a reload.
export default function Page() {
  return <Desk config={deskConfig()} />
}
