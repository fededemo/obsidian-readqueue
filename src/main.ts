import {
  debounce,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  TFolder,
  requestUrl,
  type WorkspaceLeaf,
} from "obsidian";

import {
  articleFromFile,
  estimateReadingMinutesFromSize,
  filterByStatus,
  filterBySnoozedUntil,
  isWebClipperOrphan,
  pickForToday,
  randomArticle,
  type QueueArticle,
  type ReadFrontmatter,
} from "./queue-data";
import {
  ensureReadingView,
  markAsRead,
  openInReadingView,
  postponeArticle,
  readArchiveMonth,
  shouldForcePreview,
  snoozeArticle,
  snoozeDate,
} from "./read-action";
import {
  processUrl,
  scanPendingFolder,
  type IntakeDeps,
  type ParsedArticle,
  type ProcessUrlDeps,
  type ProcessUrlOutcome,
} from "./intake";
import {
  addToUrlIndex,
  findDuplicate,
  type ExistingNote,
  type UrlIndex,
} from "./url-canon";
import { AddUrlModal } from "./add-url-modal";
import { ReadingFlowManager } from "./reading-flow";
import {
  classifyTopic,
  FALLBACK_TOPIC,
  type ClassifyDeps,
  type ClassifyInput,
  type ClassifyResult,
} from "./topics";
import {
  DEFAULT_SETTINGS,
  ReadQueueSettingsTab,
  type ReadQueueSettings,
} from "./settings";
import { QUEUE_VIEW_TYPE, QueueView } from "./queue-view";
import { HIGHLIGHTS_VIEW_TYPE, HighlightsView } from "./highlights-view";
import {
  buildDigestHighlightsSection,
  classifyArticleSource,
  digestHasHighlightsSection,
  extractHighlights,
  pickDailyHighlights,
  rngFromSeed,
  type ArticleSource,
  type ExtractedHighlight,
} from "./highlights-data";
import { HighlightUI } from "./highlight-ui";
import {
  buildBookCardMarkdown,
  parseBookCard,
  reconcileLibrary,
  reconcileWishlist,
  type BookCard,
  type DesiredBook,
  type ReconcileAction,
} from "./books-data";
import {
  collectWishlist,
  parseWishlistId,
  wishlistItemToDesired,
  type FetchResult,
} from "./wishlist";
import {
  generateRecommendations,
  rankWishlist,
  renderRecommendationNote,
  renderWishlistRankNote,
  type ContextPack,
  type HighlightItem,
  type OwnedBook,
  type ReadItem,
  type WishlistBook,
} from "./recommend";

export interface VaultFileHighlights {
  file: TFile;
  title: string;
  articleSource: ArticleSource;
  highlights: ExtractedHighlight[];
}

export default class ReadQueuePlugin extends Plugin {
  settings: ReadQueueSettings = DEFAULT_SETTINGS;
  private highlightUI: HighlightUI | null = null;
  private readingFlow: ReadingFlowManager | null = null;
  private layoutReady = false;
  // Clasifica artículos nuevos al llegar (Web Clipper escribe directo a webFolder
  // sin pasar por el intake). Debounced para coalescer ráfagas de sync de iCloud.
  private readonly classifyNewArticles = debounce(
    () => {
      if (this.settings.classifyOnLoad) {
        void this.classifyAllWithoutTopic({ silent: true });
      }
    },
    4000,
    false,
  );

  async onload(): Promise<void> {
    await this.loadSettings();

    this.readingFlow = new ReadingFlowManager(this);
    this.readingFlow.register();

    this.registerView(QUEUE_VIEW_TYPE, (leaf) => new QueueView(leaf, this));
    this.registerView(
      HIGHLIGHTS_VIEW_TYPE,
      (leaf) => new HighlightsView(leaf, this),
    );

    this.addRibbonIcon("book-open", "Reading Queue", () => {
      void this.activateView();
    });

    this.addRibbonIcon("highlighter", "Highlights", () => {
      void this.activateHighlightsView();
    });

    this.addCommand({
      id: "open-reading-queue",
      name: "Open Reading Queue",
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "read-random",
      name: "Read random article",
      callback: () => {
        void this.readRandom();
      },
    });

    this.addCommand({
      id: "mark-as-read",
      name: "Mark current note as read",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) {
          void this.markAsReadAndAdvance(file);
        }
        return true;
      },
    });

    this.addCommand({
      id: "add-url-to-queue",
      name: "Agregar URL a la cola",
      callback: () => {
        new AddUrlModal(this.app, this).open();
      },
    });

    this.addCommand({
      id: "reclassify-topic",
      name: "Re-classify topic for current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) {
          void this.reclassifyCurrentTopic(file);
        }
        return true;
      },
    });

    this.addCommand({
      id: "classify-all-without-topic",
      name: "Classify all articles without topic",
      callback: () => {
        void this.classifyAllWithoutTopic();
      },
    });

    this.addCommand({
      id: "reclassify-all",
      name: "Re-classify ALL articles in queue (force)",
      callback: () => {
        void this.classifyAllWithoutTopic({ force: true });
      },
    });

    this.addCommand({
      id: "test-claude-api",
      name: "Test Claude API connection",
      callback: () => {
        void this.testClaudeApi();
      },
    });

    this.addCommand({
      id: "move-webclipper-orphans",
      name: "Move Web Clipper orphans to Inbox/Web",
      callback: () => {
        void this.moveWebClipperOrphans();
      },
    });

    for (const days of [1, 7, 30]) {
      const label =
        days === 1 ? "1 day" : days === 7 ? "1 week" : "1 month";
      this.addCommand({
        id: `snooze-current-${days}d`,
        name: `Snooze current note ${label}`,
        checkCallback: (checking) => {
          const file = this.app.workspace.getActiveFile();
          if (!file) return false;
          if (!checking) {
            void snoozeArticle(this.app, file, snoozeDate(days)).then(() =>
              this.refreshQueueView(),
            );
          }
          return true;
        },
      });
    }

    this.addCommand({
      id: "postpone-current",
      name: "Postpone current note to end of queue",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) {
          void postponeArticle(this.app, file).then(() => this.refreshQueueView());
        }
        return true;
      },
    });

    this.registerObsidianProtocolHandler("readqueue-random", async () => {
      await this.readRandom();
    });

    this.highlightUI = new HighlightUI(
      this,
      () => this.settings.enableHighlightButton,
    );
    this.highlightUI.register();

    this.addCommand({
      id: "highlight-selection",
      name: "Subrayar selección",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "h" }],
      checkCallback: (checking) => {
        const ui = this.highlightUI;
        if (!ui || !ui.hasActionableSelection()) return false;
        if (!checking) ui.highlightCurrentSelection();
        return true;
      },
    });

    this.addCommand({
      id: "highlight-selection-note",
      name: "Subrayar selección + nota",
      checkCallback: (checking) => {
        const ui = this.highlightUI;
        if (!ui || !ui.hasActionableSelection()) return false;
        if (!checking) ui.highlightCurrentSelectionWithNote();
        return true;
      },
    });

    this.addCommand({
      id: "pick-today-reading",
      name: "Pick today's reading (5 articles)",
      callback: () => {
        void this.pickTodayReading();
      },
    });

    this.addCommand({
      id: "create-daily-digest",
      name: "Create today's reading digest note",
      callback: () => {
        void this.createDailyDigest();
      },
    });

    this.addCommand({
      id: "open-highlights-view",
      name: "Abrir Highlights",
      callback: () => {
        void this.activateHighlightsView();
      },
    });

    this.addCommand({
      id: "review-today-highlights",
      name: "Repasar highlights de hoy",
      callback: () => {
        void this.reviewTodayHighlights();
      },
    });

    this.addCommand({
      id: "sync-wishlist",
      name: "Sincronizar wishlist de Amazon",
      callback: () => {
        void this.syncWishlist();
      },
    });

    this.addCommand({
      id: "recommend-books",
      name: "¿Qué leo ahora? (recomendar libros)",
      callback: () => {
        void this.recommendBooks();
      },
    });

    this.addCommand({
      id: "rank-wishlist",
      name: "Rankear mi wishlist (¿cuál leer?)",
      callback: () => {
        void this.rankMyWishlist();
      },
    });

    this.addCommand({
      id: "reconcile-kindle-library",
      name: "Reconciliar biblioteca Kindle",
      callback: () => {
        void this.reconcileKindleLibrary();
      },
    });

    this.addCommand({
      id: "start-reading-book",
      name: "Empezar este libro (readingStatus: reading)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !file.path.startsWith(this.booksPrefix())) return false;
        if (!checking) void this.startReadingBook(file);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.readingFlow?.onFileOpen(file);
        if (!file) {
          this.applyReaderBodyClass(undefined);
          return;
        }
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
          | ReadFrontmatter
          | undefined;
        this.applyReaderBodyClass(fm);
        if (!shouldForcePreview(fm)) return;
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (!leaf) return;
        const view = leaf.view;
        if (view instanceof MarkdownView) {
          void ensureReadingView(leaf, view);
        }
      }),
    );

    const inWebFolder = (path: string): boolean =>
      path.startsWith(`${stripTrailingSlash(this.settings.webFolder)}/`);
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!this.layoutReady) return;
        if (
          file instanceof TFile &&
          file.extension === "md" &&
          inWebFolder(file.path)
        ) {
          this.classifyNewArticles();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!this.layoutReady) return;
        if (
          file instanceof TFile &&
          file.extension === "md" &&
          inWebFolder(file.path) &&
          !inWebFolder(oldPath)
        ) {
          this.classifyNewArticles();
        }
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
      void (async () => {
        if (this.settings.openOnStartup) {
          await this.activateView();
        }
        await this.runIntakeOnce();
        if (this.settings.autoMoveOrphans !== false) {
          await this.moveWebClipperOrphans({ silent: true });
        }
        if (this.settings.classifyOnLoad) {
          await this.classifyAllWithoutTopic({ silent: true });
        }
      })();
    });

    if (this.settings.intakeIntervalMin > 0) {
      const ms = this.settings.intakeIntervalMin * 60 * 1000;
      const intervalId = window.setInterval(() => {
        void this.runIntakeOnce();
      }, ms);
      this.registerInterval(intervalId);
    }

    this.addSettingTab(new ReadQueueSettingsTab(this.app, this));

    console.log("ReadQueue: loaded");
  }

  async onunload(): Promise<void> {
    this.readingFlow?.destroy();
    this.readingFlow = null;
    this.highlightUI?.destroy();
    this.highlightUI = null;
    console.log("ReadQueue: unloaded");
  }

  /**
   * Single mark-as-read entry point: mutates frontmatter, drops the saved
   * scroll position, and refreshes the queue view.
   */
  async markArticleAsRead(file: TFile): Promise<void> {
    const readAt = await markAsRead(this.app, file, this.settings.readTag);
    this.readingFlow?.clearFor(file.path);
    if (this.settings.archiveOnRead) {
      await this.archiveReadFile(file, readAt);
    }
    await this.refreshQueueView();
  }

  private openQueueView(): QueueView | undefined {
    for (const leaf of this.app.workspace.getLeavesOfType(QUEUE_VIEW_TYPE)) {
      if (leaf.view instanceof QueueView) return leaf.view;
    }
    return undefined;
  }

  /** Mark as read, then open the next queue article in reading view (MX21). */
  async markAsReadAndAdvance(file: TFile): Promise<void> {
    const view = this.openQueueView();
    const next = view?.nextUnreadAfter(file.path);
    await this.markArticleAsRead(file);
    if (this.settings.advanceOnRead === false || !view) return;
    if (next) await openInReadingView(this.app, next.file);
    else new Notice("ReadQueue: terminaste la cola 🎉");
  }

  /**
   * Moves a just-read note into `<readFolder>/<YYYY-MM>/` (month from readAt).
   * No-op if already there. Best-effort: a failed move logs but never blocks
   * the mark-as-read flow. Collisions get a ` (n)` suffix like orphan moves.
   */
  private async archiveReadFile(file: TFile, readAtIso: string): Promise<void> {
    const base = stripTrailingSlash(this.settings.readFolder);
    if (!base) return;
    const folder = `${base}/${readArchiveMonth(readAtIso)}`;
    let dest = `${folder}/${file.name}`;
    if (dest === file.path) return;
    await ensureFolder(this.app, base);
    await ensureFolder(this.app, folder);
    const existing = this.app.vault.getAbstractFileByPath(dest);
    if (existing && existing !== file) {
      const stem = file.basename;
      const ext = file.extension || "md";
      let n = 2;
      while (
        this.app.vault.getAbstractFileByPath(`${folder}/${stem} (${n}).${ext}`)
      ) {
        n++;
      }
      dest = `${folder}/${stem} (${n}).${ext}`;
    }
    try {
      await this.app.fileManager.renameFile(file, dest);
    } catch (err) {
      console.error("ReadQueue: failed to archive read file", file.path, err);
    }
  }

  /** Same pipeline as the pending-folder intake, fed directly with a URL. */
  async addUrlToQueue(url: string): Promise<ProcessUrlOutcome> {
    const deps: ProcessUrlDeps = {
      app: this.app,
      webFolder: this.settings.webFolder,
    };
    if (this.settings.classifyOnIntake) {
      deps.classify = (article: ParsedArticle) => this.classifyArticle(article);
    }
    if (this.settings.dedupeOnIntake !== false) {
      const index = this.buildUrlIndex();
      deps.lookupExisting = (u) => findDuplicate(u, index);
    }
    const outcome = await processUrl(url, deps);
    if (outcome.ok) await this.refreshQueueView();
    return outcome;
  }

  /**
   * Maps every article in the vault (except raw pending URLs) by its canonical
   * URL, so intake can skip something already queued or read. Built fresh per
   * intake run from `metadataCache` — cheap, no file reads.
   */
  buildUrlIndex(): UrlIndex {
    const pendingPrefix = `${stripTrailingSlash(this.settings.pendingFolder)}/`;
    const index: UrlIndex = new Map();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.path.startsWith(pendingPrefix)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
        | ReadFrontmatter
        | undefined;
      const article = articleFromFile(file, fm);
      if (!article.url) continue;
      addToUrlIndex(index, article.url, {
        path: file.path,
        title: article.title,
        status: article.status,
        readAt: article.readAt?.toISOString(),
      });
    }
    return index;
  }

  /**
   * Non-blocking "you already have this" notice with a link to the existing
   * note. Shared by the intake scan and the "Agregar URL" modal.
   */
  notifyDuplicate(existing: ExistingNote | undefined): void {
    if (!existing) return;
    const detail =
      existing.status === "read"
        ? existing.readAt
          ? `ya lo leíste (${isoToDateSlug(existing.readAt)})`
          : "ya lo leíste"
        : "ya está en tu cola";
    const notice = new Notice("", 10_000);
    notice.noticeEl.createSpan({
      text: `ReadQueue: «${existing.title}» ${detail}; no lo agregué de nuevo. `,
    });
    const open = notice.noticeEl.createEl("a", { text: "Abrir" });
    open.onclick = (ev) => {
      ev.preventDefault();
      const file = this.app.vault.getAbstractFileByPath(existing.path);
      if (file instanceof TFile) {
        void this.app.workspace
          .getLeaf(false)
          .openFile(file, { state: { mode: "preview" } });
      }
      notice.hide();
    };
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<ReadQueueSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(QUEUE_VIEW_TYPE);
    if (existing.length > 0) {
      const leaf = existing[0];
      if (leaf) this.app.workspace.revealLeaf(leaf);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: QUEUE_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  loadQueueArticles(): QueueArticle[] {
    const folder = stripTrailingSlash(this.settings.webFolder);
    const prefix = `${folder}/`;
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix));
    return files.map((file) => {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
        | ReadFrontmatter
        | undefined;
      return articleFromFile(file, fm);
    });
  }

  async readRandom(): Promise<void> {
    const articles = this.loadQueueArticles();
    const unread = filterByStatus(articles, "unread");
    const pick = randomArticle(unread);
    if (!pick) return;
    await openInReadingView(this.app, pick.file);
  }

  async pickTodayReading(): Promise<QueueArticle[]> {
    const all = this.loadQueueArticles();
    const unread = filterByStatus(all, "unread");
    const active = filterBySnoozedUntil(unread);
    const picks = pickForToday(active, {
      count: 5,
      estimateMinutes: (a) =>
        estimateReadingMinutesFromSize(a.file.stat?.size ?? 0),
    });
    const paths = new Set(picks.map((p) => p.file.path));
    for (const leaf of this.app.workspace.getLeavesOfType(QUEUE_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof QueueView) {
        view.todayPicks = paths;
        await view.refresh();
      }
    }
    new Notice(
      picks.length === 0
        ? "ReadQueue: no hay artículos en la cola."
        : `ReadQueue: ${picks.length} artículos sugeridos para hoy.`,
    );
    return picks;
  }

  async createDailyDigest(): Promise<void> {
    const picks = await this.pickTodayReading();
    if (picks.length === 0) return;
    const slug = localDateSlug();
    const dest = `Diario/${slug} lectura.md`;
    const existing = this.app.vault.getAbstractFileByPath(dest);
    if (existing) {
      new Notice(`ReadQueue: ya existe ${dest}, no se sobrescribe.`);
      return;
    }
    const lines: string[] = [
      `# Lectura del ${slug}`,
      "",
      `> ${picks.length} artículos sugeridos por ReadQueue.`,
      "",
    ];
    for (const a of picks) {
      const minutes = estimateReadingMinutesFromSize(a.file.stat?.size ?? 0);
      const topic = a.topic ? ` · ${a.topic}` : "";
      const min = minutes > 0 ? ` · ${minutes} min` : "";
      lines.push(`- [[${a.file.basename}]]${topic}${min}`);
    }
    if (this.settings.includeHighlightsInDigest) {
      const highlightPicks = await this.pickDailyHighlightPicks(slug);
      if (highlightPicks.length > 0) {
        lines.push("");
        lines.push(...buildDigestHighlightsSection(highlightPicks));
      }
    }
    await ensureFolder(this.app, "Diario");
    await this.app.vault.create(dest, lines.join("\n") + "\n");
    new Notice(`ReadQueue: creado ${dest}`);
    const file = this.app.vault.getAbstractFileByPath(dest);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
    }
  }

  async activateHighlightsView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(HIGHLIGHTS_VIEW_TYPE);
    if (existing.length > 0) {
      const leaf = existing[0];
      if (leaf) this.app.workspace.revealLeaf(leaf);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: HIGHLIGHTS_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private highlightFolderPrefixes(): string[] {
    return [
      this.settings.webFolder,
      this.settings.kindleFolder,
      this.settings.matterFolder,
    ]
      .map((f) => stripTrailingSlash(f))
      .filter((f) => f.length > 0)
      .map((f) => `${f}/`);
  }

  isHighlightSourcePath(path: string): boolean {
    return this.highlightFolderPrefixes().some((p) => path.startsWith(p));
  }

  /** Scans the configured folders and extracts highlights, newest file first. */
  async collectHighlights(): Promise<VaultFileHighlights[]> {
    const prefixes = this.highlightFolderPrefixes();
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => prefixes.some((p) => f.path.startsWith(p)));
    const out: VaultFileHighlights[] = [];
    for (const file of files) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
        | ReadFrontmatter
        | undefined;
      const content = await this.app.vault.cachedRead(file);
      const title =
        typeof fm?.title === "string" && fm.title ? fm.title : file.basename;
      const source = typeof fm?.source === "string" ? fm.source : undefined;
      const highlights = extractHighlights(content, {
        sourcePath: file.path,
        title,
        source,
      });
      if (highlights.length === 0) continue;
      out.push({
        file,
        title,
        articleSource: classifyArticleSource(source),
        highlights,
      });
    }
    out.sort((a, b) => (b.file.stat?.mtime ?? 0) - (a.file.stat?.mtime ?? 0));
    return out;
  }

  private async pickDailyHighlightPicks(
    dateSeed: string,
  ): Promise<ExtractedHighlight[]> {
    const groups = await this.collectHighlights();
    const flat = groups.flatMap((g) => g.highlights);
    return pickDailyHighlights(
      flat,
      this.settings.dailyHighlightsCount,
      rngFromSeed(dateSeed),
    );
  }

  async reviewTodayHighlights(): Promise<void> {
    const slug = localDateSlug();
    const picks = await this.pickDailyHighlightPicks(slug);
    if (picks.length === 0) {
      new Notice("ReadQueue: no hay highlights para repasar.");
      return;
    }
    const dest = `Diario/${slug} lectura.md`;
    const existing = this.app.vault.getAbstractFileByPath(dest);
    if (existing instanceof TFile) {
      const content = await this.app.vault.cachedRead(existing);
      if (digestHasHighlightsSection(content)) {
        new Notice(`ReadQueue: ${dest} ya tiene highlights para repasar.`);
      } else {
        await this.app.vault.process(existing, (c) =>
          `${c.trimEnd()}\n\n${buildDigestHighlightsSection(picks).join("\n")}\n`,
        );
        new Notice(
          `ReadQueue: ${picks.length} highlights agregados a ${dest}.`,
        );
      }
      await this.app.workspace.getLeaf(false).openFile(existing);
      return;
    }
    const lines = [
      `# Lectura del ${slug}`,
      "",
      ...buildDigestHighlightsSection(picks),
    ];
    await ensureFolder(this.app, "Diario");
    await this.app.vault.create(dest, lines.join("\n") + "\n");
    new Notice(`ReadQueue: creado ${dest} con ${picks.length} highlights.`);
    const file = this.app.vault.getAbstractFileByPath(dest);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
    }
  }

  async runIntakeOnce(): Promise<void> {
    const pendingPrefix = `${stripTrailingSlash(this.settings.pendingFolder)}/`;
    const deps: IntakeDeps = {
      app: this.app,
      pendingFolder: this.settings.pendingFolder,
      webFolder: this.settings.webFolder,
    };
    if (this.settings.classifyOnIntake) {
      deps.classify = (article: ParsedArticle) => this.classifyArticle(article);
    }
    if (this.settings.dedupeOnIntake !== false) {
      const index = this.buildUrlIndex();
      deps.lookupExisting = (u) => findDuplicate(u, index);
    }
    const lister = async (): Promise<TFile[]> => {
      return this.app.vault
        .getMarkdownFiles()
        .filter((f) => f.path.startsWith(pendingPrefix));
    };
    const outcomes = await scanPendingFolder(deps, lister);
    const ok = outcomes.filter((o) => o.ok).length;
    for (const outcome of outcomes) {
      if (outcome.skipped === "duplicate") this.notifyDuplicate(outcome.existing);
    }
    if (ok > 0) await this.refreshQueueView();
  }

  async classifyArticle(article: ParsedArticle): Promise<ClassifyResult> {
    await this.loadSettings();
    const input: ClassifyInput = {
      title: article.title,
      excerpt: article.bodyMarkdown ?? article.contentHtml,
      domain: article.domain,
      source: article.source,
      description: article.description,
      tags: article.tags,
    };
    return classifyTopic(input, this.settings, this.classifyDeps());
  }

  async testClaudeApi(): Promise<void> {
    const key = this.settings.anthropicApiKey?.trim();
    if (!key) {
      new Notice("❌ ReadQueue: no Anthropic API key configured in settings.");
      return;
    }
    new Notice("ReadQueue: probando Claude API…");
    const body = JSON.stringify({
      model: this.settings.classifyModel || "claude-haiku-4-5",
      max_tokens: 10,
      messages: [{ role: "user", content: "Reply with the word 'ok'." }],
    });
    try {
      const res = await requestUrl({
        url: "https://api.anthropic.com/v1/messages",
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "content-type": "application/json",
        },
        body,
        throw: false,
      });
      if (res.status === 200) {
        let reply = "";
        try {
          const data = JSON.parse(res.text) as {
            content?: Array<{ text?: string }>;
          };
          reply = data.content?.[0]?.text?.trim() ?? "";
        } catch {
          reply = res.text.slice(0, 60);
        }
        new Notice(`✅ Claude responded (${this.settings.classifyModel}): ${reply}`);
        return;
      }
      const errSnippet = res.text.slice(0, 240).replace(/\n/g, " ");
      new Notice(`❌ Claude API ${res.status}: ${errSnippet}`, 10000);
      console.error("ReadQueue test Claude API", res.status, res.text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`❌ Claude API request failed: ${msg}`, 10000);
      console.error("ReadQueue test Claude API threw", err);
    }
  }

  private applyReaderBodyClass(fm: ReadFrontmatter | undefined): void {
    const body = document.body;
    const shouldApply =
      this.settings.enableReaderStyles && shouldForcePreview(fm);
    body.classList.toggle("readqueue-reader-active", shouldApply);
  }

  /** requestUrl-backed fetchJson shared by classify + recommend (bypasses CORS). */
  private anthropicFetchJson = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ): Promise<{ status: number; json: unknown }> => {
    try {
      const res = await requestUrl({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body,
        throw: false,
      });
      let json: unknown;
      try {
        json = JSON.parse(res.text);
      } catch {
        json = undefined;
      }
      if (res.status >= 400) {
        console.warn(`ReadQueue Claude API ${res.status}:`, res.text.slice(0, 500));
      }
      return { status: res.status, json };
    } catch (err) {
      console.error("ReadQueue Claude API request failed", err);
      throw err;
    }
  };

  private classifyDeps(): ClassifyDeps {
    return { fetchJson: this.anthropicFetchJson };
  }

  private async reclassifyCurrentTopic(file: TFile): Promise<void> {
    await this.classifyOne(file);
    await this.refreshQueueView();
  }

  private async classifyOne(file: TFile): Promise<string> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
      | ReadFrontmatter
      | undefined;
    const content = await this.app.vault.cachedRead(file);
    const bodyStart = content.indexOf("\n---", 3);
    const body = bodyStart >= 0 ? content.slice(bodyStart + 4) : content;
    const author = fm?.author;
    const flatAuthor = Array.isArray(author)
      ? author.find((a) => typeof a === "string")?.replace(/^\[\[|\]\]$/g, "")
      : author;
    const rawTags = fm?.tags;
    const fmTags = Array.isArray(rawTags)
      ? rawTags
      : typeof rawTags === "string"
        ? [rawTags]
        : undefined;
    const article: ParsedArticle = {
      title: fm?.title ?? file.basename,
      url: fm?.url ?? "",
      author: flatAuthor,
      published: fm?.published,
      domain: hostnameFromFrontmatter(fm),
      contentHtml: "",
      bodyMarkdown: body.slice(0, 2000),
      source: fm?.source,
      description: fm?.description,
      tags: fmTags,
    };
    const result = await this.classifyArticle(article);
    await this.app.fileManager.processFrontMatter(file, (raw) => {
      const obj = raw as Record<string, unknown>;
      obj["topic"] = result.topic;
      obj["classified"] = true;
      if (result.tags.length > 0) {
        const existing = obj["tags"];
        const merged = mergeTagsForFrontmatter(existing, result.tags);
        obj["tags"] = merged;
      }
    });
    return result.topic;
  }

  async classifyAllWithoutTopic(
    opts: { silent?: boolean; force?: boolean } = {},
  ): Promise<void> {
    const folder = stripTrailingSlash(this.settings.webFolder);
    const prefix = `${folder}/`;
    const candidates = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix))
      .filter((f) => {
        if (opts.force) return true;
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as
          | ReadFrontmatter
          | undefined;
        if ((fm as { classified?: unknown })?.classified === true) return false;
        const topic = (fm as unknown as { topic?: unknown })?.topic;
        if (!topic || (typeof topic === "string" && !topic.trim())) return true;
        return (
          typeof topic === "string" &&
          topic.trim().toLowerCase() === FALLBACK_TOPIC
        );
      });

    if (candidates.length === 0) {
      if (!opts.silent) new Notice("ReadQueue: no articles without topic.");
      return;
    }

    if (!opts.silent) {
      new Notice(`ReadQueue: clasificando ${candidates.length} artículos…`);
    } else {
      console.log(`ReadQueue: auto-classifying ${candidates.length} articles without topic`);
    }
    let ok = 0;
    let failed = 0;
    for (const file of candidates) {
      try {
        await this.classifyOne(file);
        ok++;
      } catch (err) {
        failed++;
        console.error("ReadQueue classify failed", file.path, err);
      }
    }
    if (!opts.silent) {
      new Notice(
        `ReadQueue: ${ok} clasificados${failed > 0 ? `, ${failed} fallidos` : ""}.`,
      );
    } else {
      console.log(`ReadQueue: auto-classified ok=${ok} failed=${failed}`);
    }
    await this.refreshQueueView();
  }

  private async refreshQueueView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(QUEUE_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof QueueView) await view.refresh();
    }
  }

  async moveWebClipperOrphans(opts: { silent?: boolean } = {}): Promise<void> {
    const webFolder = stripTrailingSlash(this.settings.webFolder);
    const webPrefix = `${webFolder}/`;
    const pendingPrefix = `${stripTrailingSlash(this.settings.pendingFolder)}/`;
    const readPrefix = `${stripTrailingSlash(this.settings.readFolder)}/`;
    const booksPrefix = `${stripTrailingSlash(this.settings.booksFolder)}/`;
    const protectedPrefixes = [
      "Inbox/",
      webPrefix,
      pendingPrefix,
      readPrefix,
      "Inbox/Legacy/",
      "Diario/",
      booksPrefix,
    ];

    const candidates = this.app.vault.getMarkdownFiles().filter((f) => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      return isWebClipperOrphan(f.path, fm, protectedPrefixes);
    });

    if (candidates.length === 0) {
      if (!opts.silent) new Notice("ReadQueue: no orphans found.");
      return;
    }

    await ensureFolder(this.app, webFolder);

    let moved = 0;
    let collisions = 0;
    for (const file of candidates) {
      let dest = `${webFolder}/${file.name}`;
      if (this.app.vault.getAbstractFileByPath(dest)) {
        const stem = file.basename;
        const ext = file.extension || "md";
        let n = 2;
        while (
          this.app.vault.getAbstractFileByPath(
            `${webFolder}/${stem} (${n}).${ext}`,
          )
        ) {
          n++;
        }
        dest = `${webFolder}/${stem} (${n}).${ext}`;
        collisions++;
      }
      try {
        await this.app.fileManager.renameFile(file, dest);
        moved++;
      } catch (err) {
        console.error("ReadQueue: failed to move orphan", file.path, err);
      }
    }

    if (moved > 0) {
      await this.refreshQueueView();
    }
    if (!opts.silent) {
      const tail = collisions > 0 ? ` (${collisions} renombrados)` : "";
      new Notice(
        moved > 0
          ? `ReadQueue: ${moved} huérfano(s) movido(s) a ${webFolder}${tail}.`
          : "ReadQueue: no orphans moved.",
      );
    } else if (moved > 0) {
      console.log(`ReadQueue: auto-moved ${moved} orphan(s) to ${webFolder}`);
    }
  }

  // --- Books, wishlist & recommender (F5) ---

  booksPrefix(): string {
    return `${stripTrailingSlash(this.settings.booksFolder)}/`;
  }

  /** Reads every `Books/` note that is a book card (has asin + shelf). */
  loadBookCards(): BookCard[] {
    const prefix = this.booksPrefix();
    const out: BookCard[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      const card = parseBookCard(fm, file.path);
      if (card) out.push(card);
    }
    return out;
  }

  private wishlistFetchText = async (url: string): Promise<FetchResult> => {
    try {
      const res = await requestUrl({
        url,
        headers: { "Accept-Language": "en-US,en;q=0.9" },
        throw: false,
      });
      return { status: res.status, text: res.text };
    } catch {
      return { status: 0, text: "" };
    }
  };

  async syncWishlist(): Promise<void> {
    const listId = parseWishlistId(this.settings.wishlistUrl);
    if (!listId) {
      new Notice(
        "ReadQueue: pegá la URL de tu wishlist de Amazon en settings (Books y recomendaciones).",
      );
      return;
    }
    new Notice("ReadQueue: sincronizando wishlist…");
    const result = await collectWishlist(listId, this.wishlistFetchText);
    if (result.items.length === 0) {
      new Notice(
        result.error
          ? `ReadQueue: no pude leer la wishlist (${result.error}). ¿Está compartida por link?`
          : "ReadQueue: la wishlist se vio vacía. ¿Está compartida por link?",
      );
      return;
    }
    const desired = result.items.map(wishlistItemToDesired);
    const actions = reconcileWishlist(desired, this.loadBookCards());
    const applied = await this.applyBookActions(actions);
    const moved = await this.relocateWishlistCards();
    const movedTail = moved > 0 ? `, ${moved} reubicados` : "";
    new Notice(
      `ReadQueue: wishlist — ${applied.created} nuevos, ${applied.updated} actualizados${movedTail} (${result.items.length} ítems${result.truncated ? ", parcial" : ""}).`,
    );
    await this.refreshQueueView();
  }

  /** Moves any wishlist ficha still sitting in Books/ root into Books/Wishlist/. */
  private async relocateWishlistCards(): Promise<number> {
    const base = stripTrailingSlash(this.settings.booksFolder);
    const wishlistDir = `${base}/Wishlist`;
    const cards = this.loadBookCards().filter((c) => c.shelf === "wishlist");
    let moved = 0;
    for (const card of cards) {
      if (card.sourcePath.startsWith(`${wishlistDir}/`)) continue;
      const file = this.app.vault.getAbstractFileByPath(card.sourcePath);
      if (!(file instanceof TFile)) continue;
      await ensureFolder(this.app, base);
      await ensureFolder(this.app, wishlistDir);
      const dest = `${wishlistDir}/${file.name}`;
      if (this.app.vault.getAbstractFileByPath(dest)) continue;
      try {
        await this.app.fileManager.renameFile(file, dest);
        moved++;
      } catch (err) {
        console.error("ReadQueue: failed to relocate wishlist card", card.sourcePath, err);
      }
    }
    return moved;
  }

  /** Applies reconcile actions: create new fichas, patch machine fields on
   * existing ones via processFrontMatter (never touching user fields). */
  private async applyBookActions(
    actions: readonly ReconcileAction[],
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    const base = stripTrailingSlash(this.settings.booksFolder);
    const now = new Date().toISOString();
    for (const action of actions) {
      if (action.type === "create") {
        const folder = action.book.shelf === "wishlist" ? `${base}/Wishlist` : base;
        await ensureFolder(this.app, base);
        if (folder !== base) await ensureFolder(this.app, folder);
        const md = buildBookCardMarkdown(action.book, {
          source: action.source,
          firstSeenAt: now,
        });
        const dest = `${folder}/${md.slug}.md`;
        if (this.app.vault.getAbstractFileByPath(dest)) continue;
        try {
          await this.app.vault.create(dest, md.content);
          created++;
        } catch (err) {
          console.error("ReadQueue: failed to create book card", dest, err);
        }
      } else if (action.type === "update-machine") {
        const file = this.app.vault.getAbstractFileByPath(action.sourcePath);
        if (!(file instanceof TFile)) continue;
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          const obj = fm as Record<string, unknown>;
          if (action.changes.shelf) obj["shelf"] = action.changes.shelf;
          if (action.changes.acquiredAt) obj["acquiredAt"] = action.changes.acquiredAt;
          if (action.changes.wishlistRemoved === null) delete obj["wishlistRemoved"];
          else if (action.changes.wishlistRemoved === true) obj["wishlistRemoved"] = true;
        });
        updated++;
      }
    }
    return { created, updated };
  }

  /** Reconciles owned books from a `.kindle-library.json` manifest deposited by
   * the extension in Books/. The manifest producer is MX23 (Cloud Reader spike);
   * until it exists this reports that library sync isn't set up yet. */
  async reconcileKindleLibrary(): Promise<void> {
    const base = stripTrailingSlash(this.settings.booksFolder);
    const manifestPath = `${base}/.kindle-library.json`;
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(manifestPath))) {
      new Notice(
        "ReadQueue: no encontré Books/.kindle-library.json. El sync de biblioteca Kindle (MX23) todavía no corrió.",
      );
      return;
    }
    let desired: DesiredBook[];
    try {
      const raw = await adapter.read(manifestPath);
      const parsed = JSON.parse(raw) as {
        books?: Array<Partial<DesiredBook> & { asin?: string; title?: string }>;
      };
      desired = (parsed.books ?? [])
        .filter((b): b is DesiredBook & { asin: string; title: string } =>
          typeof b.asin === "string" && typeof b.title === "string",
        )
        .map((b) => ({
          asin: b.asin,
          title: b.title,
          author: b.author,
          cover: b.cover,
          url: b.url,
          shelf: b.shelf ?? "owned",
          acquiredAt: b.acquiredAt,
        }));
    } catch (err) {
      new Notice(`ReadQueue: manifiesto de biblioteca inválido (${err instanceof Error ? err.message : err}).`);
      return;
    }
    const actions = reconcileLibrary(desired, this.loadBookCards());
    const applied = await this.applyBookActions(actions);
    new Notice(
      `ReadQueue: biblioteca — ${applied.created} fichas nuevas, ${applied.updated} actualizadas.`,
    );
    await this.refreshQueueView();
  }

  async startReadingBook(file: TFile): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      (fm as Record<string, unknown>)["readingStatus"] = "reading";
    });
    new Notice(`ReadQueue: «${file.basename}» marcado como en lectura.`);
  }

  /** Ranks the whole wishlist by match with reading history/highlights (Opción A). */
  async rankMyWishlist(): Promise<void> {
    if (!this.settings.anthropicApiKey?.trim()) {
      new Notice("ReadQueue: configurá tu Anthropic API key para rankear.");
      return;
    }
    await this.syncWishlist();
    const pack = await this.buildContextPack();
    if (pack.wishlist.length === 0) {
      new Notice(
        "ReadQueue: no hay libros en tu wishlist (configurá la URL en settings y sincronizá).",
      );
      return;
    }
    new Notice(`ReadQueue: rankeando ${pack.wishlist.length} libros de tu wishlist…`);
    const res = await rankWishlist(
      pack,
      {
        anthropicApiKey: this.settings.anthropicApiKey,
        recommendModel: this.settings.recommendModel,
      },
      { fetchJson: this.anthropicFetchJson },
    );
    if (res.status !== 200) {
      new Notice(`ReadQueue: el ranking falló (HTTP ${res.status || "sin red"}). Revisá tu API key.`);
      return;
    }
    if (res.ranked.length === 0) {
      console.error(
        "ReadQueue rank: 200 OK but 0 parsed.",
        "wishlist:",
        pack.wishlist.length,
        "raw:",
        res.raw?.slice(0, 3000),
      );
      new Notice(
        "ReadQueue: el modelo respondió pero no pude parsear el ranking. Abrí la consola (Cmd+Opt+I) y pegame lo que dice, o reintentá.",
      );
      return;
    }
    const date = localDateSlug();
    const base = stripTrailingSlash(this.settings.booksFolder);
    const dest = `${base}/Rankings/${date}.md`;
    const content = renderWishlistRankNote(res.ranked, {
      date,
      model: this.settings.recommendModel,
      generatedAt: new Date().toISOString(),
      total: pack.wishlist.length,
    });
    await ensureFolder(this.app, base);
    await ensureFolder(this.app, `${base}/Rankings`);
    const existing = this.app.vault.getAbstractFileByPath(dest);
    if (existing instanceof TFile) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(dest, content);
    const file = this.app.vault.getAbstractFileByPath(dest);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    new Notice(`ReadQueue: wishlist rankeada (${res.ranked.length} libros) en ${dest}.`);
  }

  async recommendBooks(): Promise<void> {
    if (!this.settings.anthropicApiKey?.trim()) {
      new Notice("ReadQueue: configurá tu Anthropic API key para recomendar.");
      return;
    }
    new Notice("ReadQueue: pensando qué te conviene leer…");
    const pack = await this.buildContextPack();
    const res = await generateRecommendations(
      pack,
      {
        anthropicApiKey: this.settings.anthropicApiKey,
        recommendModel: this.settings.recommendModel,
      },
      { fetchJson: this.anthropicFetchJson },
    );
    if (res.status !== 200) {
      new Notice(
        `ReadQueue: el recomendador falló (${res.status || "sin red"}). Probá «Test Claude API».`,
      );
      return;
    }
    const date = localDateSlug();
    const base = stripTrailingSlash(this.settings.booksFolder);
    const dest = `${base}/Recomendaciones/${date}.md`;
    const existing = this.app.vault.getAbstractFileByPath(dest);
    if (existing instanceof TFile) {
      new Notice(`ReadQueue: ya existe ${dest} (una por día).`);
      await this.app.workspace.getLeaf(false).openFile(existing);
      return;
    }
    const content = renderRecommendationNote(res.recommendations, {
      date,
      model: this.settings.recommendModel,
      pack,
      generatedAt: new Date().toISOString(),
    });
    await ensureFolder(this.app, base);
    await ensureFolder(this.app, `${base}/Recomendaciones`);
    await this.app.vault.create(dest, content);
    const file = this.app.vault.getAbstractFileByPath(dest);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    new Notice(`ReadQueue: ${res.recommendations.length} recomendaciones en ${dest}.`);
  }

  /** Assembles the context pack from vault signals (read history, highlights,
   * queue, book cards, prior recommendations). No network. */
  private async buildContextPack(): Promise<ContextPack> {
    const webPrefix = `${stripTrailingSlash(this.settings.webFolder)}/`;
    const readPrefix = `${stripTrailingSlash(this.settings.readFolder)}/`;

    const read: ReadItem[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(webPrefix) && !file.path.startsWith(readPrefix)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
        | ReadFrontmatter
        | undefined;
      if (fm?.status !== "read") continue;
      const item: ReadItem = { title: fm?.title ?? file.basename, link: file.basename };
      if (typeof fm?.topic === "string" && fm.topic) item.topic = fm.topic;
      if (typeof fm?.readAt === "string") item.readAt = fm.readAt;
      read.push(item);
    }
    read.sort((a, b) => (b.readAt ?? "").localeCompare(a.readAt ?? ""));
    const recentRead = read.slice(0, 30);

    const topicCounts = new Map<string, number>();
    for (const a of recentRead) {
      if (a.topic) topicCounts.set(a.topic, (topicCounts.get(a.topic) ?? 0) + 1);
    }
    const topicDistribution = [...topicCounts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count);

    const groups = await this.collectHighlights();
    const highlights: HighlightItem[] = [];
    for (const g of groups) {
      for (const h of g.highlights) {
        const item: HighlightItem = {
          text: h.text,
          source: g.articleSource,
          title: g.title,
          link: g.file.basename,
        };
        if (h.note) item.note = h.note;
        highlights.push(item);
        if (highlights.length >= 40) break;
      }
      if (highlights.length >= 40) break;
    }

    const queue = filterByStatus(this.loadQueueArticles(), "unread").map((a) => {
      const item: { title: string; topic?: string } = { title: a.title };
      if (a.topic) item.topic = a.topic;
      return item;
    });

    const cards = this.loadBookCards();
    const owned: OwnedBook[] = cards
      .filter((c) => c.shelf !== "wishlist" && c.readingStatus !== "read")
      .map((c) => {
        const b: OwnedBook = { asin: c.asin, title: c.title, readingStatus: c.readingStatus };
        if (c.author) b.author = c.author;
        if (c.topic) b.topic = c.topic;
        return b;
      });
    const wishlist: WishlistBook[] = cards
      .filter((c) => c.shelf === "wishlist")
      .map((c) => {
        const b: WishlistBook = { asin: c.asin, title: c.title };
        if (c.author) b.author = c.author;
        if (c.wishlistRemoved) b.wishlistRemoved = true;
        return b;
      });

    const recPrefix = `${stripTrailingSlash(this.settings.booksFolder)}/Recomendaciones/`;
    const priorRecommendations = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(recPrefix))
      .sort((a, b) => b.basename.localeCompare(a.basename))
      .slice(0, 4)
      .map((f) => {
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as
          | Record<string, unknown>
          | undefined;
        const asins = Array.isArray(fm?.["recommendedAsins"])
          ? (fm!["recommendedAsins"] as unknown[]).filter(
              (x): x is string => typeof x === "string",
            )
          : [];
        return { date: f.basename, asins };
      })
      .filter((p) => p.asins.length > 0);

    return {
      read: recentRead,
      topicDistribution,
      highlights,
      queue,
      owned,
      wishlist,
      priorRecommendations,
    };
  }
}

function stripTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}

function localDateSlug(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isoToDateSlug(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : localDateSlug(d);
}

function mergeTagsForFrontmatter(
  existing: unknown,
  extra: readonly string[],
): string[] {
  const base = Array.isArray(existing)
    ? existing.filter((x): x is string => typeof x === "string")
    : typeof existing === "string" && existing
      ? [existing]
      : [];
  const seen = new Set(base);
  const out = [...base];
  for (const t of extra) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function hostnameFromFrontmatter(fm: ReadFrontmatter | undefined): string {
  const url = fm?.url;
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function ensureFolder(
  app: { vault: { getAbstractFileByPath: (p: string) => unknown; createFolder: (p: string) => Promise<unknown> } },
  folder: string,
): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(folder);
  if (existing instanceof TFolder) return;
  if (existing) return;
  try {
    await app.vault.createFolder(folder);
  } catch {
    // already exists or race — ignore
  }
}
