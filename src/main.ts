import {
  MarkdownView,
  Notice,
  Plugin,
  requestUrl,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";

import {
  articleFromFile,
  filterByStatus,
  randomArticle,
  type QueueArticle,
  type ReadFrontmatter,
} from "./queue-data";
import {
  ensureReadingView,
  markAsRead,
  openInReadingView,
  postponeArticle,
  shouldForcePreview,
  snoozeArticle,
  snoozeDate,
} from "./read-action";
import {
  scanPendingFolder,
  type IntakeDeps,
  type ParsedArticle,
} from "./intake";
import { classifyTopic, type ClassifyDeps, type ClassifyInput } from "./topics";
import {
  DEFAULT_SETTINGS,
  ReadQueueSettingsTab,
  type ReadQueueSettings,
} from "./settings";
import { QUEUE_VIEW_TYPE, QueueView } from "./queue-view";

export default class ReadQueuePlugin extends Plugin {
  settings: ReadQueueSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(QUEUE_VIEW_TYPE, (leaf) => new QueueView(leaf, this));

    this.addRibbonIcon("book-open", "Reading Queue", () => {
      void this.activateView();
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
          void markAsRead(this.app, file, this.settings.readTag).then(() =>
            this.refreshQueueView(),
          );
        }
        return true;
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
      id: "test-claude-api",
      name: "Test Claude API connection",
      callback: () => {
        void this.testClaudeApi();
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

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
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

    this.app.workspace.onLayoutReady(() => {
      void (async () => {
        await this.runIntakeOnce();
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
    console.log("ReadQueue: unloaded");
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

  async classifyArticle(article: ParsedArticle): Promise<string> {
    await this.loadSettings();
    const input: ClassifyInput = {
      title: article.title,
      excerpt: article.bodyMarkdown ?? article.contentHtml,
      domain: article.domain,
      source: article.source,
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
    const article: ParsedArticle = {
      title: fm?.title ?? file.basename,
      url: fm?.url ?? "",
      author: fm?.author,
      published: fm?.published,
      domain: hostnameFromFrontmatter(fm),
      contentHtml: "",
      bodyMarkdown: body.slice(0, 2000),
      source: fm?.source,
    };
    const topic = await this.classifyArticle(article);
    await this.app.fileManager.processFrontMatter(file, (raw) => {
      (raw as Record<string, unknown>)["topic"] = topic;
    });
    return topic;
  }

  async classifyAllWithoutTopic(opts: { silent?: boolean } = {}): Promise<void> {
    const folder = stripTrailingSlash(this.settings.webFolder);
    const prefix = `${folder}/`;
    const candidates = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix))
      .filter((f) => {
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as
          | ReadFrontmatter
          | undefined;
        const topic = (fm as unknown as { topic?: unknown })?.topic;
        return !topic || (typeof topic === "string" && !topic.trim());
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
}

function stripTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
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
