import { motion } from "motion/react";
import { useSettings } from "../lib/settings";

/**
 * The page's aurora: three large soft glows in the theme's colours that drift slowly behind
 * everything. Only transform is animated, so it stays on the GPU; off when "Living background"
 * is disabled or motion is reduced (MotionConfig skips transforms then).
 */
const BLOBS = [
  { color: "var(--aurora-1)", size: "70vmax", at: { left: "-18vmax", top: "-30vmax" }, path: { x: [0, 90, -40, 0], y: [0, 60, 110, 0], scale: [1, 1.12, 0.94, 1] }, dur: 38 },
  { color: "var(--aurora-2)", size: "60vmax", at: { right: "-20vmax", top: "-26vmax" }, path: { x: [0, -110, -30, 0], y: [0, 80, -20, 0], scale: [1, 0.9, 1.1, 1] }, dur: 44 },
  { color: "var(--aurora-1)", size: "55vmax", at: { left: "25vw", bottom: "-45vmax" }, path: { x: [0, -70, 60, 0], y: [0, -50, -10, 0], scale: [0.85, 1, 0.92, 0.85] }, dur: 52 },
];

export function Ambient() {
  const { settings } = useSettings();
  const live = settings.ambient;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {BLOBS.map((b, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{ ...b.at, width: b.size, height: b.size, background: `radial-gradient(closest-side, ${b.color}, transparent)`, opacity: i === 2 ? 0.6 : 1 }}
          animate={live ? b.path : { x: 0, y: 0, scale: 1 }}
          transition={live ? { duration: b.dur, repeat: Infinity, ease: "easeInOut" } : { duration: 1.2 }}
        />
      ))}
    </div>
  );
}
