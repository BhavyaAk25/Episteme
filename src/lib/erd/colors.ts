import type { TableColor } from "@/types/erd";

/** Group colors: readable on both light and dark themes. No purple. */
export const TABLE_COLORS: Record<TableColor, string> = {
  slate: "#94a3b8",
  sky: "#38bdf8",
  teal: "#2dd4bf",
  green: "#4ade80",
  amber: "#fbbf24",
  rose: "#fb7185",
};

export const TABLE_COLOR_NAMES: TableColor[] = ["slate", "sky", "teal", "green", "amber", "rose"];
