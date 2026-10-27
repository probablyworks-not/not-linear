/* global document, window */
/** Display-only policy: never rewrite the stored answer or its source offsets. */
export function installHtmlReading() {
  const style = document.createElement('style');
  style.dataset.nlReading = '';
  // The isolated document intentionally uses the user's fixed paper/ink palette,
  // independent of the surrounding app theme. Preserve chart/media paint data.
  style.textContent = `
    :root { color-scheme: light !important; --nl-paper: white; --nl-ink: black; --nl-selection: #b8d8ff; }
    html, body { background: var(--nl-paper) !important; color: var(--nl-ink) !important; }
    :where(body, body *):not(svg, svg *, canvas, img, video, picture, mark, [data-nl-page-gap]) {
      background-color: var(--nl-paper) !important;
      background-image: none !important;
      color: var(--nl-ink) !important;
      -webkit-text-fill-color: var(--nl-ink) !important;
      text-shadow: none !important;
    }
    mark[data-snapshot-id], mark[data-snapshot-id] * {
      color: var(--nl-ink) !important;
      -webkit-text-fill-color: var(--nl-ink) !important;
      background-color: inherit;
    }
    ::selection { background: var(--nl-selection) !important; color: var(--nl-ink) !important; -webkit-text-fill-color: var(--nl-ink) !important; text-shadow: none !important; }
    p { margin-block: .65em !important; }
  `;
  function apply() {
    // Stylesheets cannot override inline !important declarations. Clear only
    // competing presentation declarations, keeping geometry and media intact.
    document.querySelectorAll('body, body *').forEach(el => {
      if (el.closest('svg,canvas,img,video,picture') || !el.style) return;
      const properties = ['color', '-webkit-text-fill-color', 'text-shadow'];
      if (!el.closest('mark[data-snapshot-id]')) properties.push('background', 'background-color', 'background-image');
      properties.forEach(property => {
        if (el.style.getPropertyPriority(property) === 'important') el.style.removeProperty(property);
      });
    });
    document.head.append(style);
  }
  apply();
  // Streaming reconciles authored head/body nodes; reattach the same policy last.
  window.addEventListener('nl-stream-update', apply);
}
export const readingScript = `<script>(${installHtmlReading.toString()})();</` + 'script>';
