import { STORY_ICON_BODIES } from './story-icons';

/**
 * One of the hand-drawn Mind Garden icons (core/mind-garden.js renderIconSvg).
 * The markup is generated from the repo's own icon sheet, never user input, so
 * rendering it as HTML is safe. `color` is a CSS value (a token); it is applied
 * via `style` because a presentation attribute cannot resolve var().
 */
export function StoryIcon({ id, size, color }: { id: string; size: number; color: string }) {
  const body = STORY_ICON_BODIES[id];
  if (!body) return null;
  return (
    <svg
      viewBox="0 0 64 64" width={size} height={size} fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={{ stroke: color, color }}
      dangerouslySetInnerHTML={{ __html: `<g>${body}</g>` }}
    />
  );
}
