import { Artifact } from '../types';

const OPEN_TAG = /<pm-artifact\b([^>]*)>/i;
const CLOSE_TAG = /<\/pm-artifact\s*>/i;

function normalizeHtml(value: string) {
  const html = value.trim();
  if (/<html[\s>]/i.test(html)) return html;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
}

function isValidArtifactHtml(value: string) {
  return /<!doctype\s+html/i.test(value) || /<html[\s>]/i.test(value) || /<(?:main|body|section|canvas|div)[\s>]/i.test(value);
}

function titleFromAttributes(attributes: string) {
  const match = /\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
  return (match?.[1] || match?.[2] || '').trim();
}

export type ParsedArtifact = { title: string; html: string };

function parsed(title: string, html: string): ParsedArtifact | null {
  const candidate = html.trim();
  if (!candidate || !isValidArtifactHtml(candidate)) return null;
  return {
    title: title.trim().slice(0, 64) || inferArtifactTitle(candidate),
    html: normalizeHtml(candidate),
  };
}

/**
 * The preferred artifact signal. Attribute spacing and additional attributes are tolerated,
 * because local models do not always reproduce the envelope byte-for-byte.
 */
export function parseArtifactProtocol(content: string): ParsedArtifact | null {
  const open = OPEN_TAG.exec(content);
  if (!open) return null;
  const close = CLOSE_TAG.exec(content.slice((open.index || 0) + open[0].length));
  if (!close || close.index === undefined) return null;
  const html = content.slice(
    (open.index || 0) + open[0].length,
    (open.index || 0) + open[0].length + close.index,
  );
  return parsed(titleFromAttributes(open[1] || '') || inferArtifactTitle(html), html);
}

/**
 * Canvas mode is intentionally forgiving. If the model emits a complete HTML document
 * or wraps it in a Markdown fence instead of the protocol, it is still an artifact.
 */
export function parseArtifactResponse(content: string, allowRawHtml = false): ParsedArtifact | null {
  const protocol = parseArtifactProtocol(content);
  if (protocol) return protocol;
  if (!allowRawHtml) return null;

  let candidate = content.trim()
    .replace(/^\s*```(?:html|htm)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const doctypeIndex = candidate.search(/<!doctype\s+html/i);
  const htmlIndex = candidate.search(/<html\b/i);
  const start = doctypeIndex >= 0 ? doctypeIndex : htmlIndex;
  if (start >= 0) {
    candidate = candidate.slice(start);
    const end = candidate.search(/<\/html\s*>/i);
    if (end >= 0) candidate = candidate.slice(0, end + candidate.slice(end).match(/<\/html\s*>/i)![0].length);
  } else if (!/^<(?:main|body|section|canvas|div)\b/i.test(candidate)) {
    return null;
  }

  return parsed(inferArtifactTitle(candidate), candidate);
}

export function stripArtifactProtocol(content: string) {
  return content.replace(/<pm-artifact\b[^>]*>[\s\S]*?<\/pm-artifact\s*>/gi, '').trim();
}

export class ArtifactStreamDetector {
  private content = '';
  private emitted = false;

  reset() {
    this.content = '';
    this.emitted = false;
  }

  append(chunk: string): ParsedArtifact | null {
    if (this.emitted) return null;
    this.content += chunk;
    const artifact = parseArtifactProtocol(this.content);
    if (!artifact) return null;
    this.emitted = true;
    return artifact;
  }
}

export function inferArtifactTitle(html: string, fallback = 'Interactive artifact') {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  if (title) return title.replace(/\s+/g, ' ').slice(0, 64);
  return fallback;
}

export function createArtifact(parsed: ParsedArtifact, sessionId: string, sourceMessageId?: string): Artifact {
  return {
    id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    title: parsed.title || inferArtifactTitle(parsed.html),
    html: parsed.html,
    sourceMessageId,
    createdAt: Date.now(),
  };
}
