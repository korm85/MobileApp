import { Artifact } from '../types';

const HTML_BLOCK_REGEX = /```(?:html|HTML)\s*([\s\S]*?)```/;

export function parseArtifact(content: string): string | null {
  const match = HTML_BLOCK_REGEX.exec(content);
  if (match?.[1]?.trim()) return match[1].trim();
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
