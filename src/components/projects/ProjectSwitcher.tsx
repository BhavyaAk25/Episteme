"use client";

import { useEffect, useRef, useState } from "react";
import { useProjectsStore } from "@/store/useProjectsStore";
import { useProjectStore } from "@/store/useProjectStore";

function timeAgo(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export { timeAgo };

/** Current project name with a menu to rename, switch, create and delete projects. */
export function ProjectSwitcher() {
  const { projects, currentProjectId, ready, switchProject, createProject, renameProject, deleteProject } = useProjectsStore();
  const isGenerating = useProjectStore((state) => state.isGenerating);
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = projects.find((p) => p.id === currentProjectId);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setConfirmDelete(false);
      }
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!ready || !current) {
    return <div className="w-[160px] h-9" />;
  }

  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        disabled={isGenerating}
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-9 max-w-[220px] px-3 rounded-lg border border-border bg-canvas hover:bg-white flex items-center gap-2 text-[13px] font-medium text-foreground disabled:opacity-50"
        title="Switch project"
      >
        <span className="truncate">{current.name}</span>
        <svg className="w-3.5 h-3.5 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div role="menu" className="absolute left-0 top-11 z-50 w-[300px] rounded-xl border border-border bg-surface shadow-xl overflow-hidden">
          <div className="p-3 border-b border-border">
            <label className="ui-section-title" htmlFor="project-name">Project name</label>
            <input
              id="project-name"
              defaultValue={current.name}
              key={current.id}
              onBlur={(e) => renameProject(current.id, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="mt-1.5 w-full h-8 px-2 rounded-md border border-border bg-white text-[13px] focus:outline-none focus:border-accent"
            />
          </div>

          <div className="max-h-[260px] overflow-y-auto py-1">
            {sorted.map((project) => (
              <button
                key={project.id}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  void switchProject(project.id);
                }}
                className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 hover:bg-[rgba(0,0,0,0.04)] ${
                  project.id === currentProjectId ? "bg-[rgba(47,110,184,0.06)]" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-foreground">{project.name}</span>
                  <span className="block text-[11px] text-muted">
                    {project.tableCount} table{project.tableCount === 1 ? "" : "s"} · {timeAgo(project.updatedAt)}
                  </span>
                </span>
                {project.id === currentProjectId && <span className="text-[11px] text-accent font-medium shrink-0">Open</span>}
              </button>
            ))}
          </div>

          <div className="p-2 border-t border-border flex items-center justify-between gap-2">
            <button
              onClick={() => {
                setOpen(false);
                void createProject();
              }}
              className="h-8 px-3 rounded-md text-[12px] font-medium text-accent hover:bg-accent/10"
            >
              + New project
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted">Delete for good?</span>
                <button
                  onClick={() => {
                    setConfirmDelete(false);
                    setOpen(false);
                    void deleteProject(current.id);
                  }}
                  className="h-7 px-2 rounded-md text-[12px] font-medium text-white bg-error"
                >
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(false)} className="h-7 px-2 rounded-md text-[12px] text-muted hover:text-foreground">
                  Cancel
                </button>
              </span>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="h-8 px-3 rounded-md text-[12px] text-error hover:bg-error/10">
                Delete project
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
