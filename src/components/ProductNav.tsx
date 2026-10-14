'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect,useState } from 'react';
import { TEAM_TOOL_LINKS, primaryLinks, utilityLinks } from '@/domain/navigation';
import type { DemoRole } from '@/domain/demoAccess';

const ICONS: Record<string, React.ReactNode> = {
  rides: <><path d="M4 8h16v12H4zM8 8V4h8v4M8 12h8M8 16h5" /></>,
  worklist: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m8 12 3 3 5-6" /></>,
  policies: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM9 12l2 2 4-4" /></>,
};

function isActive(pathname: string, href: string): boolean {
  if (href === '/worklist') return pathname.startsWith('/worklist') || pathname.startsWith('/review-queue');
  if (href === '/rides') return pathname.startsWith('/rides');
  return pathname === href;
}

export function ProductNav({ role }: { role: DemoRole | null }) {
  const pathname = usePathname();
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>{const value=localStorage.getItem('rydr-rail:'+role)==='expanded';setExpanded(value);document.body.classList.toggle('rail-expanded',value);return()=>document.body.classList.remove('rail-expanded');},[role]);
  function toggle(){const next=!expanded;setExpanded(next);document.body.classList.toggle('rail-expanded',next);localStorage.setItem('rydr-rail:'+role,next?'expanded':'compact');}
  const primary = primaryLinks(role);
  const utilities = utilityLinks(role);

  return (
    <nav className="header-meta" aria-label="Primary">{role?<button className="rail-toggle" type="button" onClick={toggle} aria-expanded={expanded}>{expanded?'Compact menu':'Expand menu'}</button>:null}
      {primary.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className="nav-link"
            aria-current={active ? 'page' : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              {link.href === '/rides' ? ICONS.rides : ICONS.worklist}
            </svg>
            <span>{link.label}</span>
          </Link>
        );
      })}

      {utilities.map((link) => (
        <Link key={link.href} href={link.href} className="nav-link" aria-current={pathname === link.href ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            {ICONS.policies}
          </svg>
          <span>{link.label}</span>
        </Link>
      ))}

      {role === 'reviewer' ? (
        <details className="reviewer-tools">
          <summary>
            Team tools <span aria-hidden="true">＋</span>
          </summary>
          <div className="reviewer-tools__body">
            {TEAM_TOOL_LINKS.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
          </div>
        </details>
      ) : null}
    </nav>
  );
}
