import Link from 'next/link';
import { getDemoRole, getDemoSession } from '@/lib/demoSession';
import { startFreshDemo } from '@/app/demoActions';
import { RoleSwitch } from './workspace/RoleSwitch';
import { ProductNav } from './ProductNav';

export async function AppHeader() {
  const role = await getDemoRole();
  const session = await getDemoSession();
  return <header className="app-header" data-role={role ?? 'none'}><div className="app-header__inner">
    <Link href="/" className="wordmark"><span className="wordmark__name">Rydr</span><span className="wordmark__tagline">Ride disputes, resolved.</span></Link>
    <div className="session-utility">
      {role ? <span className="badge badge--neutral">{role[0].toUpperCase()+role.slice(1)}</span> : null}
      {session ? <details className="session-menu"><summary>Session controls <span aria-hidden="true">⌄</span></summary><div className="session-menu__body"><strong>Sample session</strong><p>Role switching is available for this demo so you can explore each perspective. In the full product, users would sign in to access their own rides and authorized workspace.</p><p>Changing roles keeps your progress and the case you were viewing. Starting fresh opens a new sample session: a new set of cases, with every case open again.</p><RoleSwitch/><form action={startFreshDemo}><button className="btn btn--ghost btn--sm">Start fresh session</button></form></div></details> : null}
    </div>
    <ProductNav role={role}/>
    <div className="rail-note"><strong>A fairer way forward.</strong><span>Ride + Resolve</span></div>
  </div></header>;
}

