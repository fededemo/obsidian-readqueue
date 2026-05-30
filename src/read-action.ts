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
}

export function markAsReadMutation(now: Date = new Date()): MarkAsReadMutation {
  return {
    status: "read",
    readAt: now.toISOString(),
  };
}

export function applyMarkAsRead(
  fm: Record<string, unknown>,
  mutation: MarkAsReadMutation,
): void {
  fm["status"] = mutation.status;
  fm["readAt"] = mutation.readAt;
}

export async function openInReadingView(
  app: App,
  file: TFile,
): Promise<void> {
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file, { state: { mode: "preview" } });
}

export async function markAsRead(app: App, file: TFile): Promise<void> {
  const mutation = markAsReadMutation();
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
