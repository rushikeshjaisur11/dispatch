import type { Transition } from "framer-motion";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(reducedMotionQuery).matches;
}

/** For entrances: note cards mounting, AgentPanel sliding in, dialogs opening. */
export function springEnter(): Transition {
  return prefersReducedMotion() ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 30 };
}

/** For press/hover feedback: buttons, cards. */
export function springPress(): Transition {
  return prefersReducedMotion() ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 25 };
}

export const pressScale = { scale: 0.97 };
