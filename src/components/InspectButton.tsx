'use client';
import type { ReactNode } from 'react';
export interface InspectorDetail { title: string; text: string; evidenceIds?: string[]; policyIds?: string[]; notes?: string[] }
/** Local presentation event only: opening a detail never invokes an agent. */
export function InspectButton({ detail, children, className = 'btn btn--ghost btn--sm' }: { detail: InspectorDetail; children: ReactNode; className?: string }) {
  return <button type="button" className={className} onClick={event => document.dispatchEvent(new CustomEvent('rydr:inspect', { detail: { ...detail, trigger: event.currentTarget } }))}>{children}</button>;
}
