import { useEffect, useRef } from 'react';
import { highlightCodeIn, renderMarkdown, renderMermaidIn } from '../../lib/markdown';
import type { CanvasPart } from '../types';

// Renders a typed part. Markdown, code, maths and diagrams go through the app's existing renderer
// so a Canvas reply reads exactly like a chat reply — but it renders *parts*, and never parses
// layout back out of saved markup the way the legacy chat stream does (ADR-038).

function Markdownish({ text, partId }: { text: string; partId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Mermaid and highlight.js both work on mounted DOM: external systems, so an effect is right.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    renderMermaidIn(el);
    void highlightCodeIn(el);
  }, [text]);
  return (
    <div
      ref={ref} data-part={partId} className="nl-md"
      // The same trusted path the chat stream uses: our own renderer's output, not model HTML.
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}

export function PartView({ part }: { part: CanvasPart }) {
  if (part.state === 'failed') {
    return (
      <div role="alert" data-part={part.id} className="rounded-lg border border-danger-border bg-danger-soft p-2.5 text-xs text-danger">
        {part.error || 'This part could not be produced.'}
      </div>
    );
  }
  if (part.state === 'pending') {
    return <div data-part={part.id} className="text-xs text-text-3">Working&hellip;</div>;
  }
  switch (part.kind) {
    case 'text':
    case 'report':
      return <Markdownish text={part.text} partId={part.id} />;
    case 'code':
      return <Markdownish text={`\`\`\`${part.language}\n${part.text}\n\`\`\``} partId={part.id} />;
    case 'tool_result':
      return (
        <details data-part={part.id} className="rounded-lg border border-cv-edge bg-cv-card-inset px-2.5 py-1.5 text-xs">
          <summary className="cursor-pointer text-text-3">{part.title}</summary>
          <Markdownish text={part.markdown} partId={`${part.id}-body`} />
        </details>
      );
    case 'html':
      // Untrusted: sandboxed with no app-origin access, scripts off. Same boundary as
      // ArtifactDetail. The declared network policy lands with the HTML surface in C5.
      return (
        <iframe
          data-part={part.id} title={part.title || 'Generated HTML'} sandbox="" srcDoc={part.html}
          className="h-[320px] w-full rounded-lg border border-cv-edge bg-cv-card"
        />
      );
    case 'attachment':
      return (
        <div data-part={part.id} className="flex items-center gap-2 rounded-lg border border-cv-edge bg-cv-card-inset px-2.5 py-1.5 text-xs text-text-2">
          <span className="truncate">{part.name}</span>
          <span className="font-mono text-text-3">{Math.round(part.bytes / 1024)}kB</span>
        </div>
      );
    case 'image':
    case 'video':
      // C5. Declared so a media part can be stored now and shown then, rather than rendering
      // something that pretends to be a generated image.
      return (
        <div data-part={part.id} className="rounded-lg border border-dashed border-cv-edge px-2.5 py-2 text-xs text-text-3">
          {part.kind === 'image' ? 'Image' : 'Video'} output is not available in this release.
        </div>
      );
    default:
      return null;
  }
}
