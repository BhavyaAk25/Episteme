import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ERD } from "@/types/erd";
import type { Ontology } from "@/types/ontology";
import type { Plan } from "@/types/gemini";
import { idbDel, idbGet, idbSet } from "@/lib/storage/idb";
import { useErdStore, type XY } from "./useErdStore";
import { useProjectStore } from "./useProjectStore";
import { useCanvasStore } from "./useCanvasStore";
import { useSimulationStore } from "./useSimulationStore";
import { useAiEditStore } from "./useAiEditStore";

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  tableCount: number;
}

interface ProjectData {
  erd: ERD | null;
  positions: Record<string, XY>;
  prompt: string;
  templateId: "inventory" | "saas" | "ecommerce" | null;
  plan: Plan | null;
  ontology: Ontology | null;
  generationMode: "gemini" | "fallback" | null;
  fallbackDomain: "inventory" | "saas" | "ecommerce" | "generic" | null;
  generationWarning: string | null;
}

export interface Version {
  id: string;
  createdAt: number;
  label: string;
  tableCount: number;
  erd: ERD;
  positions: Record<string, XY>;
}

const MAX_VERSIONS = 30;
const DEFAULT_NAME = "Untitled project";

const projectKey = (id: string) => `project:${id}`;
const versionsKey = (id: string) => `versions:${id}`;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function snapshot(): ProjectData {
  const project = useProjectStore.getState();
  const { erd, positions } = useErdStore.getState();
  return {
    erd,
    positions,
    prompt: project.prompt,
    templateId: project.templateId,
    plan: project.plan,
    ontology: project.ontology,
    generationMode: project.generationMode,
    fallbackDomain: project.fallbackDomain,
    generationWarning: project.generationWarning,
  };
}

function applyData(data: ProjectData | undefined) {
  useAiEditStore.getState().discard();
  useSimulationStore.getState().reset();
  useProjectStore.setState({
    prompt: data?.prompt ?? "",
    templateId: data?.templateId ?? null,
    plan: data?.plan ?? null,
    ontology: data?.ontology ?? null,
    generationMode: data?.generationMode ?? null,
    fallbackDomain: data?.fallbackDomain ?? null,
    generationWarning: data?.generationWarning ?? null,
    generationError: null,
    isPlaying: false,
    currentBuildStep: 0,
  });
  useErdStore.getState().loadErd(data?.erd ?? null, data?.positions ?? {}, { resetHistory: true });
  useCanvasStore.getState().selectNode(null);
  useCanvasStore.getState().requestFit();
}

const sameErd = (a: ERD | null | undefined, b: ERD | null | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

interface ProjectsState {
  currentProjectId: string | null;
  projects: ProjectMeta[];
  versions: Version[];
  ready: boolean;

  init: () => Promise<void>;
  saveCurrent: () => Promise<void>;
  createProject: () => Promise<void>;
  switchProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => Promise<void>;
  /** Record the current schema as a version. */
  addVersion: (label: string) => Promise<void>;
  /** Record a version only if the schema changed since the latest one. */
  checkpoint: (label: string) => Promise<void>;
  restoreVersion: (versionId: string) => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>()(
  persist(
    (set, get) => ({
      currentProjectId: null,
      projects: [],
      versions: [],
      ready: false,

      init: async () => {
        let { currentProjectId, projects } = get();
        if (!currentProjectId || !projects.some((p) => p.id === currentProjectId)) {
          // First run (or lost metadata): adopt the current working copy as a project.
          const data = snapshot();
          const id = newId("prj");
          const now = Date.now();
          const name = data.plan?.domain?.slice(0, 48) || DEFAULT_NAME;
          projects = [...projects, { id, name, createdAt: now, updatedAt: now, tableCount: data.erd?.tables.length ?? 0 }];
          currentProjectId = id;
          set({ projects, currentProjectId });
          try {
            await idbSet(projectKey(id), data);
          } catch {
            // IndexedDB unavailable (private mode): the working copy still persists via localStorage.
          }
        }
        let versions: Version[] = [];
        try {
          versions = (await idbGet<Version[]>(versionsKey(currentProjectId))) ?? [];
        } catch {
          versions = [];
        }
        set({ versions, ready: true });
      },

      saveCurrent: async () => {
        const { currentProjectId, projects } = get();
        if (!currentProjectId) return;
        const data = snapshot();
        try {
          await idbSet(projectKey(currentProjectId), data);
        } catch {
          return;
        }
        set({
          projects: projects.map((p) =>
            p.id === currentProjectId ? { ...p, updatedAt: Date.now(), tableCount: data.erd?.tables.length ?? 0 } : p
          ),
        });
      },

      createProject: async () => {
        await get().saveCurrent();
        const id = newId("prj");
        const now = Date.now();
        set({
          projects: [...get().projects, { id, name: DEFAULT_NAME, createdAt: now, updatedAt: now, tableCount: 0 }],
          currentProjectId: id,
          versions: [],
        });
        applyData(undefined);
        await get().saveCurrent();
      },

      switchProject: async (id) => {
        if (id === get().currentProjectId) return;
        await get().saveCurrent();
        let data: ProjectData | undefined;
        let versions: Version[] = [];
        try {
          data = await idbGet<ProjectData>(projectKey(id));
          versions = (await idbGet<Version[]>(versionsKey(id))) ?? [];
        } catch {
          data = undefined;
        }
        set({ currentProjectId: id, versions });
        applyData(data);
      },

      renameProject: (id, name) => {
        const trimmed = name.trim().slice(0, 60) || DEFAULT_NAME;
        set({ projects: get().projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) });
      },

      deleteProject: async (id) => {
        const remaining = get().projects.filter((p) => p.id !== id);
        try {
          await idbDel(projectKey(id));
          await idbDel(versionsKey(id));
        } catch {
          // ignore
        }
        if (id !== get().currentProjectId) {
          set({ projects: remaining });
          return;
        }
        set({ projects: remaining, currentProjectId: null });
        const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (next) {
          let data: ProjectData | undefined;
          let versions: Version[] = [];
          try {
            data = await idbGet<ProjectData>(projectKey(next.id));
            versions = (await idbGet<Version[]>(versionsKey(next.id))) ?? [];
          } catch {
            data = undefined;
          }
          set({ currentProjectId: next.id, versions });
          applyData(data);
        } else {
          await get().createProject();
        }
      },

      addVersion: async (label) => {
        const { currentProjectId } = get();
        const { erd, positions } = useErdStore.getState();
        if (!currentProjectId || !erd) return;
        const version: Version = {
          id: newId("ver"),
          createdAt: Date.now(),
          label: label.slice(0, 120),
          tableCount: erd.tables.length,
          erd,
          positions,
        };
        const versions = [version, ...get().versions].slice(0, MAX_VERSIONS);
        set({ versions });
        try {
          await idbSet(versionsKey(currentProjectId), versions);
        } catch {
          // History is best-effort.
        }
      },

      checkpoint: async (label) => {
        const erd = useErdStore.getState().erd;
        if (!erd || erd.tables.length === 0) return;
        if (sameErd(get().versions[0]?.erd, erd)) return;
        await get().addVersion(label);
      },

      restoreVersion: async (versionId) => {
        const version = get().versions.find((v) => v.id === versionId);
        if (!version) return;
        await get().checkpoint("Before restoring");
        useAiEditStore.getState().discard();
        useErdStore.getState().loadErd(version.erd, version.positions);
        useCanvasStore.getState().requestFit();
        await get().addVersion(`Restored “${version.label}”`);
      },
    }),
    {
      name: "episteme-projects",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({ currentProjectId: state.currentProjectId, projects: state.projects }),
    }
  )
);
