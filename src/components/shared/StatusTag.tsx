"use client";

import type { Status, Confidence } from "@/types/ontology";

interface StatusTagProps {
  status: Status;
}

const statusConfig: Record<Status, { label: string; className: string }> = {
  active: {
    label: "Active",
    className: "bg-[#E8F5E9] text-[#2E7D32]",
  },
  experimental: {
    label: "Experimental",
    className: "bg-[#FFF3E0] text-[#E65100]",
  },
  deprecated: {
    label: "Deprecated",
    className: "bg-error/15 text-error",
  },
};

export function StatusTag({ status }: StatusTagProps) {
  const config = statusConfig[status];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 text-[11px] font-semibold rounded-full ${config.className}`}
    >
      {config.label}
    </span>
  );
}

interface ConfidenceBadgeProps {
  confidence: Confidence;
}

const confidenceConfig: Record<Confidence, { label: string; className: string }> = {
  high: {
    label: "High",
    className: "bg-success/15 text-success",
  },
  medium: {
    label: "Medium",
    className: "bg-warning/15 text-warning",
  },
  low: {
    label: "Low",
    className: "bg-error/15 text-error",
  },
};

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const config = confidenceConfig[confidence];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-[3px] text-[11px] font-medium rounded-xl ${config.className}`}
    >
      {config.label}
    </span>
  );
}
