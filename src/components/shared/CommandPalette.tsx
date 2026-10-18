"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useUIStore } from "@/store/useUIStore";
import { useErdStore } from "@/store/useErdStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useProjectsStore } from "@/store/useProjectsStore";
import { useSimulationStore } from "@/store/useSimulationStore";
import { TEMPLATES, loadTemplate } from "@/lib/actions/templates";

interface Command {
  id: string;
  label: string;
  hint: string;
  group: "Tables" | "Actions" | "Projects";
  run: () => void;
}

/** Fuzzy-ish match: every query word appears in order-insensitive substrings. */
function matches(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => lower.includes(word));
}

function focusTable(id: string) {
  useCanvasStore.getState().selectNode(id);
  useCanvasStore.getState().requestFocus(id);
  useUIStore.getState().openInspector();
}

/** ⌘/Ctrl+K: jump to a table or run an action. */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useUIStore();
  const erd = useErdStore((state) => state.erd);
  const projects = useProjectsStore((state) => state.projects);
  const currentProjectId = useProjectsStore((state) => state.currentProjectId);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setActive(0);
        setPaletteOpen(!useUIStore.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setPaletteOpen]);

  useEffect(() => {
    if (paletteOpen) setTimeout(() => inputRef.current?.focus(), 0);
  }, [paletteOpen]);

  const commands = useMemo<Command[]>(() => {
    const ui = useUIStore.getState();
    const hasTables = (erd?.tables.length ?? 0) > 0;
    const list: Command[] = [
      ...(erd?.tables ?? []).map((table) => ({
        id: `table:${table.id}`,
        label: table.name,
        hint: `${table.columns.length} columns`,
        group: "Tables" as const,
        run: () => focusTable(table.id),
      })),
      {
        id: "ask-ai",
        label: "Ask AI to change the schema…",
        hint: "Describe a change",
        group: "Actions",
        run: () => setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="Ask AI to change the schema"]')?.focus(), 50),
      },
      {
        id: "generate",
        label: "Describe a new system…",
        hint: "Focus the description box",
        group: "Actions",
        run: () => setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="System description"]')?.focus(), 50),
      },
      ...(hasTables
        ? [
            {
              id: "run-tests",
              label: "Run Postgres tests",
              hint: "Check every rule in real Postgres",
              group: "Actions" as const,
              run: () => {
                ui.openDrawer();
                void useSimulationStore.getState().runTests();
              },
            },
            { id: "issues", label: "Show issues", hint: "Design checks and test results", group: "Actions" as const, run: () => ui.openDrawer() },
            { id: "export", label: "Export…", hint: "SQL, Prisma, Drizzle, PNG, share link", group: "Actions" as const, run: () => ui.openExportModal() },
            {
              id: "replay",
              label: "Replay build",
              hint: "Watch the schema assemble",
              group: "Actions" as const,
              run: () => {
                useProjectStore.getState().setCurrentBuildStep(0);
                useProjectStore.getState().setIsPlaying(true);
              },
            },
          ]
        : []),
      { id: "import", label: "Import SQL…", hint: "Paste CREATE TABLE statements", group: "Actions", run: () => ui.setImportOpen(true) },
      { id: "shortcuts", label: "Keyboard shortcuts", hint: "?", group: "Actions", run: () => ui.setShortcutsOpen(true) },
      { id: "tour", label: "Take the tour", hint: "A 4-step introduction", group: "Actions", run: () => ui.setTourOpen(true) },
      { id: "detail-full", label: "View: all columns", hint: "Column detail", group: "Actions", run: () => ui.setNodeDetail("full") },
      { id: "detail-keys", label: "View: keys only", hint: "Column detail", group: "Actions", run: () => ui.setNodeDetail("keys") },
      { id: "detail-names", label: "View: table names only", hint: "Column detail", group: "Actions", run: () => ui.setNodeDetail("names") },
      { id: "new-project", label: "New project", hint: "Start empty", group: "Projects", run: () => void useProjectsStore.getState().createProject() },
      ...TEMPLATES.map((t) => ({
        id: `template:${t.id}`,
        label: `New from template: ${t.title}`,
        hint: t.description,
        group: "Projects" as const,
        run: () => void loadTemplate(t.id, { newProject: true }),
      })),
      ...projects
        .filter((p) => p.id !== currentProjectId)
        .map((p) => ({
          id: `project:${p.id}`,
          label: `Open project: ${p.name}`,
          hint: `${p.tableCount} tables`,
          group: "Projects" as const,
          run: () => void useProjectsStore.getState().switchProject(p.id),
        })),
    ];
    return list;
  }, [erd, projects, currentProjectId]);

  const filtered = useMemo(() => (query.trim() ? commands.filter((c) => matches(`${c.label} ${c.hint}`, query)) : commands).slice(0, 50), [commands, query]);

  if (!paletteOpen) return null;

  const run = (command: Command | undefined) => {
    if (!command) return;
    setPaletteOpen(false);
    command.run();
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/45 pt-[12vh] px-4" onClick={() => setPaletteOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-[560px] max-w-full rounded-xl border border-border bg-surface shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(filtered[active]);
            } else if (e.key === "Escape") {
              setPaletteOpen(false);
            }
          }}
          placeholder="Jump to a table or run a command…"
          aria-label="Search tables and commands"
          className="w-full h-12 px-4 bg-transparent border-b border-border text-[14px] text-foreground placeholder:text-muted focus:outline-none"
        />
        <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-muted">No matches.</li>}
          {filtered.map((command, index) => {
            const header = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            return (
              <li key={command.id}>
                {header && <p className="px-4 pt-2 pb-1 ui-section-title">{header}</p>}
                <button
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(command)}
                  className={`w-full text-left px-4 py-2 flex items-center justify-between gap-3 ${index === active ? "bg-accent/12" : ""}`}
                >
                  <span className={`text-[13px] truncate ${command.group === "Tables" ? "font-mono" : ""} text-foreground`}>{command.label}</span>
                  <span className="text-[11px] text-muted truncate shrink-0 max-w-[45%]">{command.hint}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="px-4 py-2 border-t border-border text-[11px] text-muted flex gap-4">
          <span>↑↓ move</span>
          <span>Enter open</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
