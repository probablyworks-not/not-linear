import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code = readFileSync(new URL('../release-site/download/download.js', import.meta.url), 'utf8');
const base = 'https://github.com/probablyworks-not/not-linear/releases';
async function render(response) {
  const elements = Object.fromEntries(['#download', '#release-status', '#checksums'].map(id => [id, {href: base, textContent: ''}]));
  const context = vm.createContext({document: {querySelector: id => elements[id]},
    fetch: async () => {if (response instanceof Error) throw response; return response;},
    AbortSignal: {timeout: () => undefined}});
  await vm.runInContext(code, context);
  return elements;
}
let page = await render({status: 200, ok: true, json: async () => ({tag_name: 'v0.2.0', assets: [{
  name: 'Notlinear-0.2.0-arm64.dmg', size: 22000000,
  browser_download_url: `${base}/download/v0.2.0/Notlinear-0.2.0-arm64.dmg`
}]})});
assert.match(page['#download'].textContent, /Download for Mac/);
assert.match(page['#release-status'].textContent, /v0.2.0/);
page = await render({status: 404});
assert.equal(page['#download'].href, base);
assert.match(page['#release-status'].textContent, /being prepared/);
page = await render(new Error('offline'));
assert.equal(page['#download'].href, base);
assert.match(page['#release-status'].textContent, /View GitHub Releases/);
page = await render({status: 200, ok: true, json: async () => ({assets: [{
  name: 'Notlinear-0.2.0-arm64.dmg', browser_download_url: 'https://unrelated.example/app.dmg'
}]})});
assert.equal(page['#download'].href, base);
console.log('Download page: published release, unpublished release, offline and unsafe-link cases passed.');
