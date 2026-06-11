import { MarkdownView, Notice, type TFile } from "obsidian";

import type ReadQueuePlugin from "./main";
import type { ReadFrontmatter } from "./queue-data";
import { shouldForcePreview } from "./read-action";
import {
  forgetScroll,
  isEndOfArticle,
  rememberScroll,
  scrollRatio,
  shouldRestoreScroll,
  type ScrollEntry,
} from "./scroll-memory";

const CAPTURE_INTERVAL_MS = 3_000;
const FLUSH_INTERVAL_MS = 30_000;
// Preview render is async — applyScroll right after open often gets reset
// by a reflow, hence the retries. Later attempts back off if the user
// already scrolled away.
const RESTORE_DELAYS_MS = [150, 450, 1100];
const END_WATCH_RETRY_MS = 400;
const END_WATCH_MAX_RETRIES = 12;

/**
 * MX14 — reading flow polish for queue notes:
 * 1. remembers per-note scroll position (persisted in data.json, LRU-capped)
 *    and restores it on reopen;
 * 2. shows an inline "✓ Marcar como leído" button when the reader reaches
 *    the end of an unread article.
 */
export class ReadingFlowManager {
  private dirty = false;
  /** Grace period after open: don't capture while a restore may be in flight. */
  private suppressCaptureUntil = 0;
  private endWatcherCleanup: (() => void) | null = null;

  constructor(private plugin: ReadQueuePlugin) {}

  register(): void {
    this.plugin.registerInterval(
      window.setInterval(() => this.captureNow(), CAPTURE_INTERVAL_MS),
    );
    this.plugin.registerInterval(
      window.setInterval(() => this.flush(), FLUSH_INTERVAL_MS),
    );
  }

  onFileOpen(file: TFile | null): void {
    this.teardownEndWatcher();
    this.flush();
    if (!file || !this.isQueueNote(file)) return;
    const view = this.markdownViewFor(file);
    if (!view) return;
    this.restoreScroll(view, file.path);
    this.attachEndWatcher(view, file);
  }

  /** Drops the saved position for a note (e.g. when it gets marked as read). */
  clearFor(path: string): void {
    if (!this.plugin.settings.scrollPositions[path]) return;
    this.plugin.settings.scrollPositions = forgetScroll(
      this.plugin.settings.scrollPositions,
      path,
    );
    this.dirty = true;
    this.flush();
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    void this.plugin.saveSettings();
  }

  destroy(): void {
    this.captureNow();
    this.teardownEndWatcher();
    this.flush();
  }

  private captureNow(): void {
    if (Date.now() < this.suppressCaptureUntil) return;
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!view || !file || !this.isQueueNote(file)) return;
    const mode = view.currentMode;
    if (!mode) return;
    const scroll = mode.getScroll();
    if (!Number.isFinite(scroll)) return;
    const prev = this.plugin.settings.scrollPositions[file.path];
    if (prev && Math.abs(prev.scroll - scroll) < 0.5) return;
    if (!prev && scroll <= 0) return;
    const entry: ScrollEntry = { scroll, updatedAt: Date.now() };
    const scroller = this.findScroller(view);
    if (scroller) {
      entry.ratio = scrollRatio(
        scroller.scrollTop,
        scroller.clientHeight,
        scroller.scrollHeight,
      );
    }
    this.plugin.settings.scrollPositions = rememberScroll(
      this.plugin.settings.scrollPositions,
      file.path,
      entry,
    );
    this.dirty = true;
  }

  private restoreScroll(view: MarkdownView, path: string): void {
    const entry = this.plugin.settings.scrollPositions[path];
    if (!shouldRestoreScroll(entry)) return;
    const target = entry.scroll;
    this.suppressCaptureUntil =
      Date.now() + (RESTORE_DELAYS_MS[RESTORE_DELAYS_MS.length - 1] ?? 0) + 500;
    let applied = false;
    for (const delay of RESTORE_DELAYS_MS) {
      window.setTimeout(() => {
        if (view.file?.path !== path) return;
        const mode = view.currentMode;
        if (!mode) return;
        // Re-apply only while the view is still parked at the top — a late
        // render can reset it, but a deliberate user scroll must win.
        if (applied && mode.getScroll() > 1) return;
        mode.applyScroll(target);
        applied = true;
      }, delay);
    }
  }

  private attachEndWatcher(view: MarkdownView, file: TFile): void {
    if (!this.plugin.settings.showMarkReadAtEnd) return;
    const fm = this.frontmatterFor(file);
    if ((fm?.status ?? "unread") !== "unread") return;

    let scroller: HTMLElement | null = null;
    let retries = 0;
    let timer: number | undefined;

    const onScroll = (): void => {
      if (!scroller) return;
      if (
        !isEndOfArticle(
          scroller.scrollTop,
          scroller.clientHeight,
          scroller.scrollHeight,
        )
      ) {
        return;
      }
      this.injectEndButton(view, file);
    };

    const tryAttach = (): void => {
      timer = undefined;
      scroller = this.findScroller(view);
      if (scroller) {
        scroller.addEventListener("scroll", onScroll, { passive: true });
        return;
      }
      retries++;
      if (retries >= END_WATCH_MAX_RETRIES) return;
      timer = window.setTimeout(tryAttach, END_WATCH_RETRY_MS);
    };
    tryAttach();

    this.endWatcherCleanup = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      scroller?.removeEventListener("scroll", onScroll);
      view.contentEl.querySelector(".readqueue-endmark")?.remove();
    };
  }

  private injectEndButton(view: MarkdownView, file: TFile): void {
    const sizer = view.contentEl.querySelector<HTMLElement>(
      ".markdown-preview-sizer",
    );
    if (!sizer || sizer.querySelector(".readqueue-endmark")) return;
    const wrap = sizer.createDiv({ cls: "readqueue-endmark" });
    const btn = wrap.createEl("button", {
      cls: "readqueue-endmark__btn",
      text: "✓ Marcar como leído",
    });
    btn.onclick = (ev) => {
      ev.preventDefault();
      btn.disabled = true;
      void this.plugin.markArticleAsRead(file).then(() => {
        new Notice("ReadQueue: marcado como leído.");
        wrap.remove();
      });
    };
  }

  private teardownEndWatcher(): void {
    this.endWatcherCleanup?.();
    this.endWatcherCleanup = null;
  }

  private markdownViewFor(file: TFile): MarkdownView | null {
    const recent = this.plugin.app.workspace.getMostRecentLeaf()?.view;
    if (recent instanceof MarkdownView && recent.file?.path === file.path) {
      return recent;
    }
    const active = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.file?.path === file.path) return active;
    return null;
  }

  private isQueueNote(file: TFile): boolean {
    if (shouldForcePreview(this.frontmatterFor(file))) return true;
    const folder = this.plugin.settings.webFolder.replace(/\/+$/, "");
    return folder.length > 0 && file.path.startsWith(`${folder}/`);
  }

  private frontmatterFor(file: TFile): ReadFrontmatter | undefined {
    return this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as
      | ReadFrontmatter
      | undefined;
  }

  private findScroller(view: MarkdownView): HTMLElement | null {
    return (
      view.contentEl.querySelector<HTMLElement>(".markdown-preview-view") ??
      view.contentEl.querySelector<HTMLElement>(".cm-scroller")
    );
  }
}
