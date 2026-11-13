import { create } from "zustand";

type PlaybackSpeed = 0.5 | 1 | 2 | 5;
export type NodeDetail = "full" | "keys" | "names";
export type VerifyTab = "issues" | "tests" | "data" | "query";
/** Which enum type or view the editor dialog is open for (no name/id = new). */
export type ObjectEditorTarget = { kind: "enum"; name?: string } | { kind: "view"; id?: string };

function readDetail(): NodeDetail {
  try {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("episteme-node-detail") : null;
    return saved === "keys" || saved === "names" ? saved : "full";
  } catch {
    return "full";
  }
}

function readDrawerHeight(): number {
  try {
    const saved = typeof window !== "undefined" ? Number(window.localStorage.getItem("episteme-drawer-height")) : NaN;
    return Number.isFinite(saved) && saved >= 120 && saved <= 1200 ? saved : 250;
  } catch {
    return 250;
  }
}

interface UIState {
  // Sidebar
  sidebarOpen: boolean;
  sidebarWidth: number;

  // Inspector panel
  inspectorOpen: boolean;
  /** The sidebar was hidden only to make room for the inspector. */
  sidebarAutoClosed: boolean;
  inspectorWidth: number;

  // Bottom drawer
  drawerOpen: boolean;
  notice: string | null;
  importOpen: boolean;
  shortcutsOpen: boolean;
  paletteOpen: boolean;
  tourOpen: boolean;
  nodeDetail: NodeDetail;
  verifyTab: VerifyTab;
  objectEditor: ObjectEditorTarget | null;
  explainOpen: boolean;
  /** Version id the migration dialog compares the current schema against. */
  migrationFrom: string | null;
  drawerHeight: number;

  // Animation
  playbackSpeed: PlaybackSpeed;

  // Modals
  exportModalOpen: boolean;
  errorModalOpen: boolean;
  errorModalContent: { title: string; message: string } | null;

  // Actions
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;

  toggleInspector: () => void;
  openInspector: () => void;
  closeInspector: () => void;
  setInspectorWidth: (width: number) => void;

  toggleDrawer: () => void;
  showNotice: (message: string | null) => void;
  setImportOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setTourOpen: (open: boolean) => void;
  setNodeDetail: (detail: NodeDetail) => void;
  /** Open the bottom panel on a tab. */
  showVerifyTab: (tab: VerifyTab) => void;
  setVerifyTab: (tab: VerifyTab) => void;
  setObjectEditor: (target: ObjectEditorTarget | null) => void;
  setExplainOpen: (open: boolean) => void;
  setMigrationFrom: (versionId: string | null) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  setDrawerHeight: (height: number) => void;

  setPlaybackSpeed: (speed: PlaybackSpeed) => void;

  openExportModal: () => void;
  closeExportModal: () => void;

  showError: (title: string, message: string) => void;
  closeError: () => void;

  // Reset
  reset: () => void;
}

const initialState = {
  sidebarOpen: true,
  sidebarWidth: 260,
  inspectorOpen: false,
  inspectorWidth: 380,
  drawerOpen: false,
  sidebarAutoClosed: false,
  verifyTab: "issues" as VerifyTab,
  objectEditor: null,
  explainOpen: false,
  migrationFrom: null,
  notice: null as string | null,
  importOpen: false,
  shortcutsOpen: false,
  paletteOpen: false,
  tourOpen: false,
  nodeDetail: "full" as NodeDetail,
  drawerHeight: readDrawerHeight(),
  playbackSpeed: 1 as PlaybackSpeed,
  exportModalOpen: false,
  errorModalOpen: false,
  errorModalContent: null,
};

export const useUIStore = create<UIState>((set, get) => ({
  ...initialState,

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen, sidebarAutoClosed: false })),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  toggleInspector: () => (get().inspectorOpen ? get().closeInspector() : get().openInspector()),
  // Below 1280px the canvas can't fit the sidebar and inspector side by side:
  // tuck the sidebar away while inspecting and bring it back afterwards.
  openInspector: () => {
    const { inspectorOpen, sidebarOpen } = get();
    if (inspectorOpen) return;
    const cramped = typeof window !== "undefined" && window.innerWidth >= 768 && window.innerWidth < 1280;
    set({ inspectorOpen: true, ...(cramped && sidebarOpen ? { sidebarOpen: false, sidebarAutoClosed: true } : {}) });
  },
  closeInspector: () =>
    set((state) => ({ inspectorOpen: false, ...(state.sidebarAutoClosed ? { sidebarOpen: true, sidebarAutoClosed: false } : {}) })),
  setInspectorWidth: (width) => set({ inspectorWidth: width }),

  toggleDrawer: () => set((state) => ({ drawerOpen: !state.drawerOpen })),
  showNotice: (notice) => set({ notice }),
  setImportOpen: (importOpen) => set({ importOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setTourOpen: (tourOpen) => set({ tourOpen }),
  setNodeDetail: (nodeDetail) => {
    try {
      window.localStorage.setItem("episteme-node-detail", nodeDetail);
    } catch {
      /* storage unavailable */
    }
    set({ nodeDetail });
  },
  openDrawer: () => set({ drawerOpen: true }),
  showVerifyTab: (verifyTab) => set({ verifyTab, drawerOpen: true }),
  setVerifyTab: (verifyTab) => set({ verifyTab }),
  setObjectEditor: (objectEditor) => set({ objectEditor }),
  setExplainOpen: (explainOpen) => set({ explainOpen }),
  setMigrationFrom: (migrationFrom) => set({ migrationFrom }),
  closeDrawer: () => set({ drawerOpen: false }),
  setDrawerHeight: (height) => set({ drawerHeight: height }),

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

  openExportModal: () => set({ exportModalOpen: true }),
  closeExportModal: () => set({ exportModalOpen: false }),

  showError: (title, message) => set({
    errorModalOpen: true,
    errorModalContent: { title, message },
  }),
  closeError: () => set({
    errorModalOpen: false,
    errorModalContent: null,
  }),

  reset: () => set(initialState),
}));

/** Restore browser-only preferences after mount (avoids hydration mismatches). */
export function hydrateUIPreferences(): void {
  const small = typeof window !== "undefined" && window.innerWidth < 768;
  useUIStore.setState({ nodeDetail: readDetail(), ...(small ? { sidebarOpen: false } : {}) });
}
