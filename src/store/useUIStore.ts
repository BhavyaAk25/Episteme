import { create } from "zustand";

type PlaybackSpeed = 0.5 | 1 | 2 | 5;

interface UIState {
  // Sidebar
  sidebarOpen: boolean;
  sidebarWidth: number;

  // Inspector panel
  inspectorOpen: boolean;
  inspectorWidth: number;

  // Bottom drawer
  drawerOpen: boolean;
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
  sidebarWidth: 292,
  inspectorOpen: false,
  inspectorWidth: 320,
  drawerOpen: false,
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
