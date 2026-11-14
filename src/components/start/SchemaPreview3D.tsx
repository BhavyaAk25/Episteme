"use client";

import { useEffect, useRef, useState } from "react";
import type { ERD } from "@/types/erd";

/**
 * A real schema drawn in 3D: one node per table (sized by its columns),
 * one line per foreign key. It turns slowly (still when the system asks
 * for reduced motion), can be dragged, and highlights a table and its links
 * on hover. three.js is loaded only when this is on screen.
 */

interface Props {
  erd: ERD;
  onPick?: () => void;
  className?: string;
}

/** Deterministic 3D force layout: linked tables close, others apart. */
function layout3d(erd: ERD): Map<string, [number, number, number]> {
  const n = erd.tables.length;
  const pos = erd.tables.map((_, i) => {
    // Fibonacci sphere start, so runs are stable.
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const theta = i * 2.399963;
    return [Math.cos(theta) * r * 2, y * 2, Math.sin(theta) * r * 2];
  });
  const index = new Map(erd.tables.map((t, i) => [t.name, i]));
  const links = erd.relationships
    .map((r) => [index.get(r.fromTable), index.get(r.toTable)] as const)
    .filter((l): l is readonly [number, number] => l[0] !== undefined && l[1] !== undefined && l[0] !== l[1]);

  for (let step = 0; step < 300; step += 1) {
    const force = pos.map(() => [0, 0, 0]);
    for (let a = 0; a < n; a += 1) {
      for (let b = a + 1; b < n; b += 1) {
        const d = [0, 1, 2].map((k) => pos[a][k] - pos[b][k]);
        const dist2 = Math.max(0.05, d[0] ** 2 + d[1] ** 2 + d[2] ** 2);
        const push = 1.6 / dist2;
        for (let k = 0; k < 3; k += 1) {
          force[a][k] += (d[k] / Math.sqrt(dist2)) * push;
          force[b][k] -= (d[k] / Math.sqrt(dist2)) * push;
        }
      }
    }
    for (const [a, b] of links) {
      const d = [0, 1, 2].map((k) => pos[b][k] - pos[a][k]);
      const dist = Math.max(0.01, Math.hypot(...d));
      const pull = (dist - 1.6) * 0.35;
      for (let k = 0; k < 3; k += 1) {
        force[a][k] += (d[k] / dist) * pull;
        force[b][k] -= (d[k] / dist) * pull;
      }
    }
    const cooling = 0.08 * (1 - step / 300) + 0.01;
    for (let i = 0; i < n; i += 1) {
      for (let k = 0; k < 3; k += 1) pos[i][k] += Math.max(-0.5, Math.min(0.5, force[i][k] - pos[i][k] * 0.02)) * cooling * 4;
    }
  }
  // Centre, and scale by the typical (RMS) distance so one outlying table
  // doesn't squeeze the rest into the middle.
  const centre = [0, 1, 2].map((k) => pos.reduce((s, p) => s + p[k], 0) / Math.max(1, n));
  const rms = Math.sqrt(pos.reduce((s, p) => s + (p[0] - centre[0]) ** 2 + (p[1] - centre[1]) ** 2 + (p[2] - centre[2]) ** 2, 0) / Math.max(1, n));
  const scale = 1.9 / Math.max(0.001, rms);
  return new Map(
    erd.tables.map((t, i) => {
      const p = pos[i].map((v, k) => (v - centre[k]) * scale);
      const length = Math.hypot(p[0], p[1], p[2]);
      const clamp = length > 2.9 ? 2.9 / length : 1;
      return [t.name, p.map((v) => v * clamp) as [number, number, number]];
    })
  );
}

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function SchemaPreview3D({ erd, onPick, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const labelLayer = labelsRef.current;
    if (!container || !canvas || !labelLayer || erd.tables.length === 0) return;
    let disposed = false;
    let cleanup = () => {};

    void import("three")
      .then((THREE) => {
        if (disposed) return;
        let renderer: InstanceType<typeof THREE.WebGLRenderer>;
        try {
          renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        } catch {
          setFailed(true);
          return;
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        const scene = new THREE.Scene();
        // Soft light so nodes read as spheres, and fog toward the background
        // so far tables recede.
        scene.add(new THREE.AmbientLight(0xffffff, 1.1));
        const light = new THREE.DirectionalLight(0xffffff, 1.6);
        light.position.set(3, 4, 6);
        scene.add(light);
        scene.fog = new THREE.Fog(cssColor("--bg-canvas", "#05070b"), 7.5, 13);
        const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
        camera.position.set(0, 0, 9.5);
        const group = new THREE.Group();
        group.rotation.x = 0.32;
        scene.add(group);

        const positions = layout3d(erd);
        const colors = () => ({
          node: new THREE.Color(cssColor("--text-primary", "#e8edf5")),
          accent: new THREE.Color(cssColor("--accent-blue", "#7dd3fc")),
          link: new THREE.Color(cssColor("--text-secondary", "#8b95a7")),
        });
        let palette = colors();

        // Nodes
        const nodeMeshes = erd.tables.map((table) => {
          const radius = 0.09 + Math.sqrt(table.columns.length) * 0.045;
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(radius, 32, 20),
            new THREE.MeshStandardMaterial({ color: palette.node, roughness: 0.45, metalness: 0.05 })
          );
          mesh.position.set(...positions.get(table.name)!);
          mesh.userData.table = table.name;
          group.add(mesh);
          return mesh;
        });

        // Links: one LineSegments per relationship so each can be highlighted.
        const linkLines = erd.relationships.flatMap((rel) => {
          const a = positions.get(rel.fromTable);
          const b = positions.get(rel.toTable);
          if (!a || !b || rel.fromTable === rel.toTable) return [];
          const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
          const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: palette.link, transparent: true, opacity: 0.7 }));
          line.userData = { from: rel.fromTable, to: rel.toTable };
          group.add(line);
          return [line];
        });

        // Labels: real HTML text, positioned from the 3D points each frame.
        labelLayer.replaceChildren();
        const labels = erd.tables.map((table) => {
          const span = document.createElement("span");
          span.textContent = table.name;
          span.className = "absolute left-0 top-0 font-mono text-[11px] whitespace-nowrap text-foreground pointer-events-none select-none";
          labelLayer.appendChild(span);
          return span;
        });

        let hovered: string | null = null;
        const applyHighlight = () => {
          const related = new Set<string>();
          if (hovered) {
            related.add(hovered);
            erd.relationships.forEach((r) => {
              if (r.fromTable === hovered) related.add(r.toTable);
              if (r.toTable === hovered) related.add(r.fromTable);
            });
          }
          nodeMeshes.forEach((mesh) => {
            const name = mesh.userData.table as string;
            const material = mesh.material as InstanceType<typeof THREE.MeshStandardMaterial>;
            material.color.copy(name === hovered ? palette.accent : palette.node);
            mesh.scale.setScalar(name === hovered ? 1.35 : 1);
          });
          linkLines.forEach((line) => {
            const material = line.material as InstanceType<typeof THREE.LineBasicMaterial>;
            const active = hovered && (line.userData.from === hovered || line.userData.to === hovered);
            material.color.copy(active ? palette.accent : palette.link);
            material.opacity = hovered ? (active ? 1 : 0.15) : 0.7;
          });
          labels.forEach((label, i) => {
            const name = erd.tables[i].name;
            label.dataset.state = !hovered ? "" : name === hovered ? "hot" : related.has(name) ? "near" : "far";
          });
        };

        const resize = () => {
          const { width, height } = container.getBoundingClientRect();
          if (width === 0 || height === 0) return;
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(container);

        // Theme changes (toggle or system) recolour the scene.
        const recolour = () => {
          palette = colors();
          (scene.fog as InstanceType<typeof THREE.Fog>).color.set(cssColor("--bg-canvas", "#05070b"));
          applyHighlight();
        };
        const themeObserver = new MutationObserver(recolour);
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        media.addEventListener("change", recolour);

        // Interaction: drag to turn, hover to highlight, click to open.
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        let dragging = false;
        let moved = 0;
        let last = { x: 0, y: 0 };
        const toPointer = (event: PointerEvent) => {
          const rect = container.getBoundingClientRect();
          pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        };
        const onDown = (event: PointerEvent) => {
          dragging = true;
          moved = 0;
          last = { x: event.clientX, y: event.clientY };
          container.setPointerCapture(event.pointerId);
        };
        const onMove = (event: PointerEvent) => {
          toPointer(event);
          if (dragging) {
            const dx = event.clientX - last.x;
            const dy = event.clientY - last.y;
            moved += Math.abs(dx) + Math.abs(dy);
            group.rotation.y += dx * 0.008;
            group.rotation.x = Math.max(-1, Math.min(1, group.rotation.x + dy * 0.006));
            last = { x: event.clientX, y: event.clientY };
            return;
          }
          raycaster.setFromCamera(pointer, camera);
          const hit = raycaster.intersectObjects(nodeMeshes)[0];
          const next = (hit?.object.userData.table as string | undefined) ?? null;
          if (next !== hovered) {
            hovered = next;
            container.style.cursor = hovered ? "pointer" : "grab";
            applyHighlight();
          }
        };
        const onUp = (event: PointerEvent) => {
          dragging = false;
          container.releasePointerCapture(event.pointerId);
          if (moved < 4) pickRef.current?.();
        };
        const onLeave = () => {
          hovered = null;
          applyHighlight();
        };
        container.addEventListener("pointerdown", onDown);
        container.addEventListener("pointermove", onMove);
        container.addEventListener("pointerup", onUp);
        container.addEventListener("pointerleave", onLeave);
        container.style.cursor = "grab";

        // Render loop, paused when off screen or the tab is hidden.
        let frame = 0;
        let visible = true;
        let previous = performance.now();
        const projected = new THREE.Vector3();
        const paint = () => {
          renderer.render(scene, camera);
          const { width, height } = container.getBoundingClientRect();
          nodeMeshes.forEach((mesh, i) => {
            mesh.getWorldPosition(projected);
            const depth = projected.z;
            projected.project(camera);
            const x = (projected.x * 0.5 + 0.5) * width;
            const y = (-projected.y * 0.5 + 0.5) * height;
            const label = labels[i];
            const state = label.dataset.state;
            // Nearer tables read stronger; hover overrides.
            const base = Math.max(0.28, Math.min(1, 0.62 + depth * 0.14));
            const opacity = state === "hot" ? 1 : state === "near" ? 0.9 : state === "far" ? 0.15 : base;
            label.style.opacity = String(opacity);
            label.style.fontWeight = state === "hot" ? "600" : "400";
            label.style.transform = `translate(${x + 15}px, ${y - 8}px)`;
          });
        };
        const draw = (now: number) => {
          frame = requestAnimationFrame(draw);
          const dt = Math.min(0.05, (now - previous) / 1000);
          previous = now;
          if (!visible || document.hidden) return;
          if (!reducedMotion && !dragging && !hovered) group.rotation.y += dt * 0.12;
          paint();
        };
        // One frame right away, so the preview is complete even before (or
        // without) animation frames, e.g. in a background tab.
        paint();
        frame = requestAnimationFrame(draw);
        const io = new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
        });
        io.observe(container);

        cleanup = () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          io.disconnect();
          themeObserver.disconnect();
          media.removeEventListener("change", recolour);
          container.removeEventListener("pointerdown", onDown);
          container.removeEventListener("pointermove", onMove);
          container.removeEventListener("pointerup", onUp);
          container.removeEventListener("pointerleave", onLeave);
          nodeMeshes.forEach((m) => {
            m.geometry.dispose();
            (m.material as InstanceType<typeof THREE.Material>).dispose();
          });
          linkLines.forEach((l) => {
            l.geometry.dispose();
            (l.material as InstanceType<typeof THREE.Material>).dispose();
          });
          renderer.dispose();
          labelLayer.replaceChildren();
        };
      })
      .catch(() => setFailed(true));

    return () => {
      disposed = true;
      cleanup();
    };
  }, [erd]);

  if (failed) return null;
  return (
    <div
      ref={containerRef}
      className={`touch-none select-none ${className || "relative"}`}
      role="img"
      aria-label={`3D preview of ${erd.tables.length} tables and their links`}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      <div ref={labelsRef} className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true" />
    </div>
  );
}
