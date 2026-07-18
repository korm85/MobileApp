import { Artifact } from '../types';

const CODE_BLOCK_REGEX = /```(?:html|HTML|xml|javascript|js)?\s*([\s\S]*?)```/g;

function looksLikeHtml(value: string) {
  return /<!doctype\s+html/i.test(value) || /<html[\s>]/i.test(value) || /<body[\s>]/i.test(value) || /<(?:style|script|main|button|table)[\s>]/i.test(value);
}

function normalizeHtml(value: string) {
  const html = value.trim();
  if (/<html[\s>]/i.test(html)) return html;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
}

export function parseArtifact(content: string): string | null {
  for (const match of content.matchAll(CODE_BLOCK_REGEX)) {
    const candidate = match[1]?.trim();
    if (candidate && looksLikeHtml(candidate)) return normalizeHtml(candidate);
  }

  const documentMatch = /<!doctype\s+html[\s\S]*?<\/html\s*>/i.exec(content);
  if (documentMatch?.[0]) return normalizeHtml(documentMatch[0]);

  const htmlMatch = /<html[\s\S]*?<\/html\s*>/i.exec(content);
  if (htmlMatch?.[0]) return normalizeHtml(htmlMatch[0]);

  return null;
}

export function inferArtifactTitle(html: string, fallback = 'Interactive artifact') {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  if (title) return title.replace(/\s+/g, ' ').slice(0, 64);
  return fallback;
}

export function createArtifact(html: string, sourceMessageId?: string): Artifact {
  return {
    id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: inferArtifactTitle(html),
    html,
    sourceMessageId,
    createdAt: Date.now(),
  };
}
