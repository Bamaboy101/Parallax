/** Two offset viewpoints resolve onto one shared market. */
export function ParallaxMark() {
  return (
    <svg className="parallax-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M5 24V8h10l12 8-12 8H5Z" stroke="currentColor" strokeWidth="2" />
      <path d="M5 8l12 8-12 8M17 8v16" stroke="var(--live)" strokeWidth="2" />
    </svg>
  );
}
