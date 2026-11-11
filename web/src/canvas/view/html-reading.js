/* global document, window */
/** Display-only policy: never rewrite the stored answer or its source offsets. */
export function installHtmlReading() {
  const style = document.createElement('style');
  style.dataset.nlReading = '';
  // Keep authored chart fills, accents and matching foregrounds intact. Only
  // supply a light default canvas and a consistent, readable selection palette.
  style.textContent = `
    :root { color-scheme: light; --nl-paper: white; --nl-ink: black; --nl-selection: #b8d8ff; --nl-highlight-strength: 35%; }
    html, body { background: var(--nl-paper); color: var(--nl-ink); }
    mark[data-snapshot-id], mark[data-snapshot-id] * {
      color: var(--nl-ink) !important;
      -webkit-text-fill-color: var(--nl-ink) !important;
      background-color: inherit;
    }
    ::selection { background: var(--nl-selection) !important; color: var(--nl-ink) !important; -webkit-text-fill-color: var(--nl-ink) !important; text-shadow: none !important; }
    p { margin-block: .65em !important; }
  `;
  function apply() {
    document.head.append(style);
  }
  apply();
  // Streaming reconciles authored head/body nodes; reattach the same policy last.
  window.addEventListener('nl-stream-update', apply);
}
export const readingScript = `<script>(${installHtmlReading.toString()})();</` + 'script>';
