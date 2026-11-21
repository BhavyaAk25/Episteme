/** "Panel on the left" glyph used by the sidebar show/hide buttons. */
export function SidebarIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" strokeWidth={1.6} />
      <path d="M9.5 4.5v15" strokeWidth={1.6} />
    </svg>
  );
}
