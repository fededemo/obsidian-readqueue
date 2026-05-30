import type { App, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";

import type { ReadFrontmatter } from "./queue-data";

const FORCE_PREVIEW_SOURCES = new Set([
  "web-clipper",
  "intake-defuddle",
  "intake-fxtwitter",
]);

export function shouldForcePreview(
  frontmatter: ReadFrontmatter | undefined,
): boolean {
  const source = frontmatter?.source;
  if (typeof source !== "string") return false;
  return FORCE_PREVIEW_SOURCES.has(source);
}

export interface MarkAsReadMutation {
  status: string;
  readAt: string;
  readTag?: string;
}

export function markAsReadMutation(
  now: Date = new Date(),
  readTag?: string,
): MarkAsReadMutation {
  const mutation: MarkAsReadMutation = {
    status: "read",
    readAt: now.toISOString(),
  };
  if (readTag && readTag.trim()) mutation.readTag = readTag.trim();
  return mutation;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string" && value) return [value];
  return [];
}

export function applyMarkAsRead(
  fm: Record<string, unknown>,
  mutation: MarkAsReadMutation,
): void {
  fm["status"] = mutation.status;
  fm["readAt"] = mutation.readAt;
  if (mutation.readTag) {
    const tags = asStringArray(fm["tags"]);
    if (!tags.includes(mutation.readTag)) {
      tags.push(mutation.readTag);
    }
    fm["tags"] = tags;
  }
}

export async function openInReadingView(
  app: App,
  file: TFile,
): Promise<void> {
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file, { state: { mode: "preview" } });
}

export async function markAsRead(
  app: App,
  file: TFile,
  readTag?: string,
): Promise<void> {
  const mutation = markAsReadMutation(undefined, readTag);
  await app.fileManager.processFrontMatter(file, (fm) => {
    applyMarkAsRead(fm as Record<string, unknown>, mutation);
  });
}

export interface ForceReadingViewDeps {
  app: App;
  getFrontmatter: (file: TFile) => ReadFrontmatter | undefined;
}

export async function ensureReadingView(
  leaf: WorkspaceLeaf,
  view: MarkdownView,
): Promise<void> {
  if (view.getMode() === "preview") return;
  const state = leaf.getViewState();
  await leaf.setViewState({
    ...state,
    state: { ...(state.state ?? {}), mode: "preview" },
  });
}

export async function snoozeArticle(
  app: App,
  file: TFile,
  until: Date,
): Promise<void> {
  const iso = until.toISOString();
  await app.fileManager.processFrontMatter(file, (fm) => {
    (fm as Record<string, unknown>)["snoozedUntil"] = iso;
  });
}

export async function unsnoozeArticle(app: App, file: TFile): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    delete (fm as Record<string, unknown>)["snoozedUntil"];
  });
}

export async function postponeArticle(app: App, file: TFile): Promise<void> {
  const now = new Date().toISOString();
  await app.fileManager.processFrontMatter(file, (fm) => {
    (fm as Record<string, unknown>)["savedAt"] = now;
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function snoozeDate(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + days * DAY_MS);
}
