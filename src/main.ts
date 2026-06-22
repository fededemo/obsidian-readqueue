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
    const outcome = await processUrl(url, deps);
    if (outcome.ok) await this.refreshQueueView();
    return outcome;
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
    const lister = async (): Promise<TFile[]> => {
      return this.app.vault
        .getMarkdownFiles()
        .filter((f) => f.path.startsWith(pendingPrefix));
    };
    const outcomes = await scanPendingFolder(deps, lister);
    const ok = outcomes.filter((o) => o.ok).length;
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

  private classifyDeps(): ClassifyDeps {
    return {
      fetchJson: async (url, init) => {
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
            console.warn(
              `ReadQueue Claude API ${res.status}:`,
              res.text.slice(0, 500),
            );
          }
          return { status: res.status, json };
        } catch (err) {
          console.error("ReadQueue Claude API request failed", err);
          throw err;
        }
      },
    };
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
    const protectedPrefixes = [
      "Inbox/",
      webPrefix,
      pendingPrefix,
      readPrefix,
      "Inbox/Legacy/",
      "Diario/",
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
