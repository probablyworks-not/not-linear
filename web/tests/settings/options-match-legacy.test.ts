import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODELS, PROVIDERS, RANKING_OPTIONS, THEMES, TONES, type Choice } from '../../src/settings/options';

// Oracle, in the same spirit as descriptions-match-app.test.ts: the lists in
// web/src/settings/options.ts are copies, and a copy can drift. These ids are
// persisted in prefs, so a typo would save a value legacy cannot resolve. The
// legacy files are read as text and parsed; nothing here re-states them.
//
// Delete the parts that read index.html at the P6 cutover, when it goes.
const root = resolve(__dirname, '../../..');
const html = readFileSync(resolve(root, 'frontend/index.html'), 'utf8');
const appJs = readFileSync(resolve(root, 'frontend/app.js'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');

/** Reads the `.seg` button group inside the prefs section whose id/label we know. */
function segChoices(selector: string): Choice[] {
  return [...doc.querySelectorAll(`${selector} button[data-v]`)].map(b => ({
    id: b.getAttribute('data-v')!,
    label: b.querySelector('.t')!.textContent!.trim(),
    // The blurb is the text node after <span class="t">, with entities decoded.
    blurb: (b.textContent ?? '').replace(b.querySelector('.t')!.textContent!, '').trim(),
  }));
}

describe('Settings options match the legacy app', () => {
  it('themes', () => {
    expect(THEMES).toEqual(segChoices('#seg-theme'));
  });

  it('tones (two rows in the markup, one list here)', () => {
    const tonePrefs = [...doc.querySelectorAll('#seg-tone, #seg-tone ~ .seg.row2')];
    const legacy = tonePrefs.flatMap(el => [...el.querySelectorAll('button[data-v]')]).map(b => b.getAttribute('data-v'));
    expect(TONES.map(t => t.id)).toEqual(legacy);
    const labels = tonePrefs.flatMap(el => [...el.querySelectorAll('button .t')]).map(t => t.textContent!.trim());
    expect(TONES.map(t => t.label)).toEqual(labels);
  });

  it('models: ids, labels and blurbs, in order, from the Settings markup', () => {
    // The model group is the .seg.row2 in the section headed "Default model".
    const section = [...doc.querySelectorAll('.prefs-section')]
      .find(s => s.querySelector('.prefs-label')?.textContent?.trim() === 'Default model')!;
    const legacy = [...section.querySelectorAll('button[data-v]')].map(b => ({
      id: b.getAttribute('data-v')!,
      label: b.querySelector('.t')!.textContent!.trim(),
      blurb: b.textContent!.replace(b.querySelector('.t')!.textContent!, '').trim(),
    }));
    expect(MODELS).toEqual(legacy);
  });

  it('models: ids and labels agree with MODEL_OPTIONS in app.js, the map prefs.model is validated against', () => {
    const block = appJs.match(/const MODEL_OPTIONS = \{([\s\S]*?)\n  \};/)![1]!;
    const entries = [...block.matchAll(/^\s*'?([\w.-]+)'?:\s*\{\s*label:'([^']+)'/gm)].map(m => ({ id: m[1]!, label: m[2]! }));
    expect(entries.length).toBeGreaterThan(10);
    expect(MODELS.map(m => ({ id: m.id, label: m.label }))).toEqual(entries);
  });

  it('providers (value and visible option text)', () => {
    const legacy = [...doc.querySelectorAll('#api-provider option')].map(o => ({ id: o.getAttribute('value')!, option: o.textContent!.trim() }));
    // `github` is a P7 provider that legacy has never heard of.
    expect(PROVIDERS.filter(p => p.id !== 'github').map(p => ({ id: p.id, option: p.option }))).toEqual(legacy);
  });

  it('provider display labels agree with PROVIDER_LABELS in app.js', () => {
    const line = appJs.match(/const PROVIDER_LABELS = \{([^}]*)\}/)![1]!;
    const legacy = Object.fromEntries([...line.matchAll(/(\w+):'([^']+)'/g)].map(m => [m[1]!, m[2]!]));
    expect(Object.fromEntries(PROVIDERS.filter(p => p.id !== 'github').map(p => [p.id, p.label]))).toEqual(legacy);
  });

  it('context ranking options', () => {
    const legacy = [...doc.querySelectorAll('#ranking-llm-select option')].map(o => ({ id: o.getAttribute('value')!, label: o.textContent!.trim() }));
    expect(RANKING_OPTIONS).toEqual(legacy);
  });

  it('the oracle can fail: a drifted copy is detected', () => {
    const drifted = MODELS.map(m => (m.id === 'sonnet' ? { ...m, id: 'sonet' } : m));
    expect(drifted).not.toEqual(segChoices('.prefs-section .seg.row2'));
  });
});
