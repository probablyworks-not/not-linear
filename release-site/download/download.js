// Public metadata only. No API keys, analytics, accounts or local storage.
const repository = 'probablyworks-not/not-linear';
const prefix = `https://github.com/${repository}/releases/download/`;
const button = document.querySelector('#download');
const status = document.querySelector('#release-status');
(async () => {
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: {Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(10000)
    });
    if (response.status === 404) {
      status.textContent = 'Apple Silicon · The first public release is being prepared.';
      return;
    }
    if (!response.ok) throw new Error('Release unavailable');
    const release = await response.json();
    const asset = release.assets?.find(item => /^Notlinear-\d+\.\d+\.\d+-arm64\.dmg$/.test(item.name));
    if (!asset || !asset.browser_download_url?.startsWith(prefix)) throw new Error('No Mac download');
    button.href = asset.browser_download_url;
    button.textContent = 'Download for Mac ↓';
    status.textContent = `Apple Silicon · ${release.tag_name} · ${Math.ceil(asset.size / 1024 / 1024)} MB · Not notarized by Apple`;
    document.querySelector('#checksums').href = `https://github.com/${repository}/releases/latest`;
  } catch (_) {
    status.textContent = 'Apple Silicon · View GitHub Releases for available downloads.';
  }
})();
