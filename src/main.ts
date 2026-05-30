import {
  MarkdownView,
  Plugin,
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
  shouldForcePreview,
} from "./read-action";
import { scanPendingFolder, type IntakeDeps } from "./intake";
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
          void markAsRead(this.app, file).then(() => this.refreshQueueView());
        }
        return true;
      },
    });

    this.registerObsidianProtocolHandler("readqueue-random", async () => {
      await this.readRandom();
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file) return;
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
          | ReadFrontmatter
          | undefined;
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
      void this.runIntakeOnce();
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
    const lister = async (): Promise<TFile[]> => {
      return this.app.vault
        .getMarkdownFiles()
        .filter((f) => f.path.startsWith(pendingPrefix));
    };
    const outcomes = await scanPendingFolder(deps, lister);
    const ok = outcomes.filter((o) => o.ok).length;
    if (ok > 0) await this.refreshQueueView();
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
