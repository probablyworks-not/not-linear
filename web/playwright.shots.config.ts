import base from './playwright.config';

// The screenshots in docs/DESIGN.md are captured, not drawn by hand, so they can never
// drift from the real UI. They are NOT tests, so they live outside tests/e2e and run
// only on demand:  pnpm shots   (see tests/design-shots/design-shots.spec.ts).
export default {
  ...base,
  testDir: './tests/design-shots',
  // A screenshot of a half-finished animation is worse than no screenshot; give them room.
  timeout: 60_000,
};
