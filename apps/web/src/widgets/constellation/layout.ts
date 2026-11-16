/** One body in the force layout. */
export interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radius in px. */
  r: number;
}

const DAMPING = 0.82;
const CENTERING = 0.002;
const GAP = 6;

/** Start positions on a circle in list order: deterministic, so a reload looks the same. */
export function placeBodies(
  ids: readonly string[],
  radii: readonly number[],
  width: number,
  height: number,
): Body[] {
  const radius = Math.min(width, height) * 0.3;
  return ids.map((id, index) => {
    const angle = (index / Math.max(1, ids.length)) * 2 * Math.PI - Math.PI / 2;
    return {
      id,
      x: width / 2 + radius * Math.cos(angle),
      y: height / 2 + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
      r: radii[index] ?? 10,
    };
  });
}

/**
 * One step of the layout. Every pair is joined by a spring whose rest length shrinks as the two
 * move together: correlation +1 → touching, 0 → mid-distance, −1 → far apart. Bodies never
 * overlap, a weak pull keeps the sky centred, and they stay inside the canvas. Returns the
 * kinetic energy left, so callers can stop animating once it settles.
 */
export function stepBodies(
  bodies: Body[],
  correlationOf: (i: number, j: number) => number | undefined,
  width: number,
  height: number,
): number {
  const span = Math.min(width, height);
  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i];
    if (!a) continue;
    for (let j = i + 1; j < bodies.length; j += 1) {
      const b = bodies[j];
      if (!b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const touching = a.r + b.r + GAP;
      const c = correlationOf(i, j);
      const rest = c === undefined ? span * 0.3 : touching + ((1 - c) / 2) * span * 0.45;
      const stiffness = c === undefined ? 0.002 : 0.004 + 0.012 * Math.abs(c);
      let force = stiffness * (distance - rest);
      if (distance < touching) force -= 0.25 * (touching - distance);
      const fx = (force * dx) / distance;
      const fy = (force * dy) / distance;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }
  let energy = 0;
  for (const body of bodies) {
    body.vx = (body.vx + (width / 2 - body.x) * CENTERING) * DAMPING;
    body.vy = (body.vy + (height / 2 - body.y) * CENTERING) * DAMPING;
    body.x = Math.min(width - body.r, Math.max(body.r, body.x + body.vx));
    body.y = Math.min(height - body.r, Math.max(body.r, body.y + body.vy));
    energy += body.vx ** 2 + body.vy ** 2;
  }
  return energy;
}
