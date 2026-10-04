import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractFallbackChangelog, extractIcons, ICON_IDS } from '../../scripts/gen-changelog-assets.mjs';
import { FALLBACK_CHANGELOG_MD } from '../../src/changelog/fallback-changelog';
import { STORY_ICON_BODIES } from '../../src/changelog/story-icons';

// The two generated files must equal what the generator derives from the legacy
// sources right now. A hand edit, or a legacy change not regenerated, fails here.
const root = resolve(__dirname, '../../..');

describe('generated changelog assets are current', () => {
  it('fallback changelog equals FALLBACK_CHANGELOG_MD in app.js', () => {
    expect(FALLBACK_CHANGELOG_MD).toBe(extractFallbackChangelog(readFileSync(resolve(root, 'frontend/app.js'), 'utf8')));
    expect(FALLBACK_CHANGELOG_MD.length).toBeGreaterThan(1000);
  });

  it('icon bodies equal the Mind Garden sheet', () => {
    expect(STORY_ICON_BODIES).toEqual(extractIcons(readFileSync(resolve(root, 'frontend/mind-garden-icons.html'), 'utf8')));
    expect(Object.keys(STORY_ICON_BODIES).sort()).toEqual([...ICON_IDS].sort());
    for (const body of Object.values(STORY_ICON_BODIES)) expect(body.length).toBeGreaterThan(20);
  });

  it('icons contain no script or event handlers (they are rendered as raw markup)', () => {
    for (const body of Object.values(STORY_ICON_BODIES)) {
      expect(body).not.toMatch(/<script|\son\w+\s*=|javascript:/i);
    }
  });
});
