import { create } from "zustand";

type PlaybackSpeed = 0.5 | 1 | 2 | 5;
export type NodeDetail = "full" | "keys" | "names";

function readDetail(): NodeDetail {
  try {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("episteme-node-detail") : null;
    return saved === "keys" || saved === "names" ? saved : "full";
  } catch {
    return "full";
  }
}

interface UIState {
  // Sidebar
  sidebarOpen: boolean;
  sidebarWidth: number;

  // Inspector panel
  inspectorOpen: boolean;
  inspectorWidth: number;

  // Bottom drawer
  drawerOpen: boolean;
  notice: string | null;
  importOpen: boolean;
  shortcutsOpen: boolean;
  paletteOpen: boolean;
  tourOpen: boolean;
  nodeDetail: NodeDetail;
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
  notice: null as string | null,
  importOpen: false,
  shortcutsOpen: false,
  paletteOpen: false,
  tourOpen: false,
  nodeDetail: "full" as NodeDetail,
  drawerHeight: 250,
  playbackSpeed: 1 as PlaybackSpeed,
  exportModalOpen: false,
  errorModalOpen: false,
  errorModalContent: null,
};

export const useUIStore = create<UIState>((set) => ({
  ...initialState,

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  openInspector: () => set({ inspectorOpen: true }),
  closeInspector: () => set({ inspectorOpen: false }),
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
