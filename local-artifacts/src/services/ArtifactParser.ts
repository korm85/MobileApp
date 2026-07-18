import { Artifact } from '../types';

const OPEN_TAG = /<pm-artifact(?:\s+title=(?:"([^"]*)"|'([^']*)'))?\s*>/i;
const CLOSE_TAG = '</pm-artifact>';

function normalizeHtml(value: string) {
  const html = value.trim();
  if (/<html[\s>]/i.test(html)) return html;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
}

function isValidArtifactHtml(value: string) {
  return /<!doctype\s+html/i.test(value) || /<html[\s>]/i.test(value) || /<(?:main|body|section|canvas|div)[\s>]/i.test(value);
}

export type ParsedArtifact = { title: string; html: string };

/** The only artifact signal accepted by the app. Raw HTML and Markdown fences are deliberately ignored. */
export function parseArtifactProtocol(content: string): ParsedArtifact | null {
  const open = OPEN_TAG.exec(content);
  if (!open) return null;
  const closeIndex = content.indexOf(CLOSE_TAG, (open.index ?? 0) + open[0].length);
  if (closeIndex < 0) return null;
  const html = content.slice((open.index ?? 0) + open[0].length, closeIndex).trim();
  if (!html || !isValidArtifactHtml(html)) return null;
  return { title: (open[1] || open[2] || inferArtifactTitle(html)).trim().slice(0, 64) || 'Interactive artifact', html: normalizeHtml(html) };
}

export function stripArtifactProtocol(content: string) {
  return content.replace(/<pm-artifact(?:\s+title=(?:"[^"]*"|'[^']*'))?\s*>[\s\S]*?<\/pm-artifact>/gi, '').trim();
}

/** Accumulates output and emits exactly once after a complete protocol envelope arrives. */
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
