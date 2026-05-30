import { ItemView, type WorkspaceLeaf } from "obsidian";

import {
  filterByStatus,
  groupArticles,
  sortArticles,
  type GroupKey,
  type QueueArticle,
  type SortKey,
} from "./queue-data";
import { markAsRead, openInReadingView } from "./read-action";

import type ReadQueuePlugin from "./main";

export const QUEUE_VIEW_TYPE = "readqueue-view";

const GROUP_OPTIONS: ReadonlyArray<readonly [GroupKey, string]> = [
  ["topic", "Por tópico"],
  ["source", "Por fuente"],
  ["date", "Por fecha"],
  ["none", "Sin agrupar"],
];

const SORT_OPTIONS: ReadonlyArray<readonly [SortKey, string]> = [
  ["newest", "Más nuevos"],
  ["oldest", "Más viejos"],
  ["shuffle", "Al azar"],
];

export class QueueView extends ItemView {
  plugin: ReadQueuePlugin;
  groupBy: GroupKey = "topic";
  sortBy: SortKey = "newest";

  constructor(leaf: WorkspaceLeaf, plugin: ReadQueuePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return QUEUE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Reading Queue";
  }

  override getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {
    // No persistent resources to release.
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    const root = this.containerEl.children.item(1) ?? this.containerEl;
    if (!(root instanceof HTMLElement)) return;
    root.empty();
    root.addClass("readqueue-view");

    const toolbar = root.createDiv({ cls: "readqueue-view__toolbar" });

    const groupSelect = toolbar.createEl("select", {
      attr: { "aria-label": "Agrupar por" },
    });
    for (const [value, label] of GROUP_OPTIONS) {
      const opt = groupSelect.createEl("option", { text: label });
      opt.value = value;
    }
    groupSelect.value = this.groupBy;
    groupSelect.onchange = () => {
      this.groupBy = groupSelect.value as GroupKey;
      void this.render();
    };

    const sortSelect = toolbar.createEl("select", {
      attr: { "aria-label": "Ordenar por" },
    });
    for (const [value, label] of SORT_OPTIONS) {
      const opt = sortSelect.createEl("option", { text: label });
      opt.value = value;
    }
    sortSelect.value = this.sortBy;
    sortSelect.onchange = () => {
      this.sortBy = sortSelect.value as SortKey;
      void this.render();
    };

    const refresh = toolbar.createEl("button", { text: "Recargar" });
    refresh.onclick = () => {
      void this.render();
    };

    const articles = this.plugin.loadQueueArticles();
    const unread = filterByStatus(articles, "unread");
    const sorted = sortArticles(unread, this.sortBy);
    const groups = groupArticles(sorted, this.groupBy);

    const list = root.createDiv({ cls: "readqueue-view__list" });

    if (groups.length === 0 || groups.every((g) => g.articles.length === 0)) {
      list.createEl("p", { text: "No hay nada en la cola." });
      return;
    }

    for (const group of groups) {
      if (group.articles.length === 0) continue;
      if (this.groupBy !== "none") {
        list.createEl("h3", {
          text: `${group.label} (${group.articles.length})`,
        });
      }
      for (const article of group.articles) {
        this.renderCard(list, article);
      }
    }
  }

  private renderCard(parent: HTMLElement, article: QueueArticle): void {
    const card = parent.createDiv({ cls: "readqueue-view__card" });
    card.createEl("div", {
      cls: "readqueue-view__card-title",
      text: article.title,
    });

    const meta = card.createDiv({ cls: "readqueue-view__card-meta" });
    const sourceText = computeSourceText(article);
    if (sourceText) meta.createEl("span", { text: sourceText });
    if (article.savedAt) {
      meta.createEl("span", { text: article.savedAt.toLocaleDateString() });
    }
    if (article.topic) meta.createEl("span", { text: article.topic });

    card.onclick = (ev) => {
      ev.preventDefault();
      void openInReadingView(this.plugin.app, article.file);
    };

    const markBtn = card.createEl("button", {
      cls: "readqueue-view__card-mark",
      text: "✓ Leído",
    });
    markBtn.onclick = async (ev) => {
      ev.stopPropagation();
      await markAsRead(this.plugin.app, article.file);
      await this.render();
    };
  }
}

function computeSourceText(article: QueueArticle): string | undefined {
  if (article.url) {
    try {
      return new URL(article.url).hostname.replace(/^www\./, "");
    } catch {
      // fall through
    }
  }
  return article.source ?? undefined;
}
