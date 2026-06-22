import { ItemView, type WorkspaceLeaf } from "obsidian";

import {
  computeStats,
  estimateReadingMinutesFromSize,
  filterByQuery,
  filterByStatus,
  filterBySnoozedUntil,
  filterByTopic,
  groupArticles,
  nextArticleAfterPath,
  sortArticles,
  topicSlug,
  type ArticleGroup,
  type GroupKey,
  type QueueArticle,
  type SortKey,
} from "./queue-data";
import {
  openInReadingView,
  postponeArticle,
  snoozeArticle,
  snoozeDate,
} from "./read-action";

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
  groupBy: GroupKey = "none";
  sortBy: SortKey = "newest";
  private visibleArticles: QueueArticle[] = [];
  private selectedIndex = 0;
  private searchQuery = "";
  private activeTopicFilter: string | undefined = undefined;
  private unreadCount = 0;
  private searchInputEl: HTMLInputElement | undefined;
  private listEl: HTMLElement | undefined;
  private allArticles: QueueArticle[] = [];
  todayPicks = new Set<string>();

  constructor(leaf: WorkspaceLeaf, plugin: ReadQueuePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  private get collapsedGroups(): Set<string> {
    const stored = this.plugin.settings.collapsedGroupsByGroupBy[this.groupBy] ?? [];
    return new Set(stored);
  }

  private async setGroupCollapsed(label: string, collapsed: boolean): Promise<void> {
    const map = this.plugin.settings.collapsedGroupsByGroupBy;
    const current = new Set(map[this.groupBy] ?? []);
    if (collapsed) current.add(label);
    else current.delete(label);
    map[this.groupBy] = [...current];
    await this.plugin.saveSettings();
  }

  getViewType(): string {
    return QUEUE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.unreadCount > 0
      ? `Reading Queue (${this.unreadCount})`
      : "Reading Queue";
  }

  override getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    this.registerKeyboardShortcuts();
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

    this.allArticles = this.plugin.loadQueueArticles();
    const stats = computeStats(this.allArticles);
    const statsBar = root.createDiv({ cls: "readqueue-view__stats" });
    const statsBits: string[] = [`${stats.unread} unread`];
    if (stats.snoozed > 0) statsBits.push(`${stats.snoozed} 💤`);
    if (stats.readThisWeek > 0) {
      statsBits.push(`${stats.readThisWeek} leídos esta semana`);
    }
    if (stats.topTopicThisMonth) {
      statsBits.push(`top mes: ${stats.topTopicThisMonth}`);
    }
    statsBar.setText(statsBits.join(" · "));

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
      this.renderList();
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
      this.renderList();
    };

    const refresh = toolbar.createEl("button", { text: "Recargar" });
    refresh.onclick = () => {
      void this.render();
    };

    const searchEl = root.createEl("input", {
      cls: "readqueue-view__search",
      attr: {
        type: "search",
        placeholder: "Filtrar título / topic / fuente…",
        "aria-label": "Filtrar la cola",
      },
    });
    searchEl.value = this.searchQuery;
    // Re-render only the list on each keystroke — never the whole view.
    // Rebuilding the toolbar would destroy this <input>, dropping focus and
    // resetting scroll on every letter (unusable on mobile, the original bug).
    searchEl.oninput = () => {
      this.searchQuery = searchEl.value;
      this.renderList();
    };
    this.searchInputEl = searchEl;

    if (this.activeTopicFilter) {
      const pill = root.createDiv({ cls: "readqueue-view__filter-pill" });
      pill.createSpan({ text: `Filtrando topic: ${this.activeTopicFilter}` });
      const clearBtn = pill.createEl("button", { text: "× Limpiar" });
      clearBtn.onclick = () => {
        this.activeTopicFilter = undefined;
        void this.render();
      };
    }

    this.listEl = root.createDiv({ cls: "readqueue-view__list" });
    this.renderList();
  }

  /**
   * Rebuilds only the list container from the in-memory `allArticles`
   * snapshot. Safe to call on every search keystroke: the toolbar, search
   * input and filter pill stay in the DOM, so focus, caret and scroll
   * survive. A full `render()` is reserved for actions that change the
   * chrome (group/sort/topic/reload, card mutations).
   */
  private renderList(): void {
    const list = this.listEl;
    if (!list) return;

    const unread = filterByStatus(this.allArticles, "unread");
    const active = filterBySnoozedUntil(unread);
    this.unreadCount = active.length;
    const byQuery = filterByQuery(active, this.searchQuery);
    const byTopic = filterByTopic(byQuery, this.activeTopicFilter);
    const sorted = sortArticles(byTopic, this.sortBy);
    const groups = groupArticles(sorted, this.groupBy);
    const visibleGroups = groups.filter((g) => g.articles.length > 0);
    this.refreshTabTitle();
    this.visibleArticles = visibleGroups.flatMap((g) =>
      this.collapsedGroups.has(g.label) && this.groupBy !== "none"
        ? []
        : g.articles,
    );
    if (this.selectedIndex >= this.visibleArticles.length) {
      this.selectedIndex = Math.max(0, this.visibleArticles.length - 1);
    }

    list.empty();

    if (visibleGroups.length === 0) {
      const filtering = this.searchQuery.trim() !== "" || this.activeTopicFilter;
      list.createEl("p", {
        text: filtering
          ? "Sin resultados para ese filtro."
          : "No hay nada en la cola.",
      });
      return;
    }

    for (const group of visibleGroups) {
      if (this.groupBy === "none") {
        for (const article of group.articles) {
          this.renderCard(list, article);
        }
        continue;
      }
      const collapsed = this.collapsedGroups.has(group.label);
      this.renderGroupHeader(list, group, collapsed);
      if (!collapsed) {
        for (const article of group.articles) {
          this.renderCard(list, article);
        }
      }
    }
  }

  private renderGroupHeader(
    parent: HTMLElement,
    group: ArticleGroup,
    collapsed: boolean,
  ): void {
    const header = parent.createEl("h3", {
      cls: collapsed
        ? "readqueue-view__group-header readqueue-view__group-header--collapsed"
        : "readqueue-view__group-header",
    });
    header.createSpan({
      cls: "readqueue-view__group-toggle",
      text: collapsed ? "▶" : "▼",
    });
    header.createSpan({
      cls: "readqueue-view__group-label",
      text: ` ${group.label}`,
    });
    header.createSpan({
      cls: "readqueue-view__group-count",
      text: ` (${group.articles.length})`,
    });
    header.onclick = () => {
      const isCollapsed = this.collapsedGroups.has(group.label);
      void this.setGroupCollapsed(group.label, !isCollapsed).then(() =>
        this.renderList(),
      );
    };
  }

  private renderCard(parent: HTMLElement, article: QueueArticle): void {
    const isSelected = this.visibleArticles[this.selectedIndex] === article;
    const isToday = this.todayPicks.has(article.file.path);
    const classes = ["readqueue-view__card"];
    if (isSelected) classes.push("readqueue-view__card--selected");
    if (isToday) classes.push("readqueue-view__card--today");
    const card = parent.createDiv({ cls: classes.join(" ") });
    if (isToday) {
      card.createSpan({
        cls: "readqueue-view__today-badge",
        text: "★ Hoy",
      });
    }
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
    if (article.topic) {
      const slug = topicSlug(article.topic);
      const badge = meta.createEl("span", {
        cls: `readqueue-view__topic-badge readqueue-view__topic-badge--${slug}`,
        text: article.topic,
        attr: { title: `Filtrar por topic: ${article.topic}` },
      });
      badge.onclick = (ev) => {
        ev.stopPropagation();
        this.activeTopicFilter = article.topic;
        void this.render();
      };
    }
    const size = article.file.stat?.size ?? 0;
    if (size > 0) {
      const minutes = estimateReadingMinutesFromSize(size);
      meta.createEl("span", { text: `${minutes} min` });
    }

    card.onclick = (ev) => {
      ev.preventDefault();
      const idx = this.visibleArticles.indexOf(article);
      if (idx >= 0) this.selectedIndex = idx;
      void openInReadingView(this.plugin.app, article.file);
    };

    const actions = card.createDiv({ cls: "readqueue-view__card-actions" });

    const markBtn = actions.createEl("button", {
      cls: "readqueue-view__card-mark",
      text: "✓ Leído",
    });
    markBtn.onclick = async (ev) => {
      ev.stopPropagation();
      await this.plugin.markArticleAsRead(article.file);
      await this.render();
    };

    const snoozeBtn = actions.createEl("button", {
      cls: "readqueue-view__card-snooze",
      text: "💤 1 sem",
      attr: { title: "Snooze 1 semana" },
    });
    snoozeBtn.onclick = async (ev) => {
      ev.stopPropagation();
      await snoozeArticle(this.plugin.app, article.file, snoozeDate(7));
      await this.render();
    };

    const postponeBtn = actions.createEl("button", {
      cls: "readqueue-view__card-postpone",
      text: "↓ Después",
      attr: { title: "Postponer al final de la cola" },
    });
    postponeBtn.onclick = async (ev) => {
      ev.stopPropagation();
      await postponeArticle(this.plugin.app, article.file);
      await this.render();
    };
  }

  private moveSelection(delta: number): void {
    if (this.visibleArticles.length === 0) return;
    const max = this.visibleArticles.length;
    this.selectedIndex = (this.selectedIndex + delta + max) % max;
    void this.render();
    requestAnimationFrame(() => {
      const cards = this.containerEl.querySelectorAll<HTMLElement>(
        ".readqueue-view__card",
      );
      const target = cards.item(this.selectedIndex);
      if (target) target.scrollIntoView({ block: "nearest" });
    });
  }

  private getSelectedArticle(): QueueArticle | undefined {
    return this.visibleArticles[this.selectedIndex];
  }

  /** Next article after `path` in the currently displayed order (MX21). */
  nextUnreadAfter(path: string): QueueArticle | undefined {
    return nextArticleAfterPath(this.visibleArticles, path);
  }

  private async snoozeSelected(days: number): Promise<void> {
    const a = this.getSelectedArticle();
    if (!a) return;
    await snoozeArticle(this.plugin.app, a.file, snoozeDate(days));
    await this.render();
  }

  private async markSelected(): Promise<void> {
    const a = this.getSelectedArticle();
    if (!a) return;
    await this.plugin.markArticleAsRead(a.file);
    await this.render();
  }

  private async openSelected(): Promise<void> {
    const a = this.getSelectedArticle();
    if (!a) return;
    await openInReadingView(this.plugin.app, a.file);
  }

  private registerKeyboardShortcuts(): void {
    this.containerEl.tabIndex = 0;
    this.containerEl.addEventListener("keydown", (ev) => {
      if (ev.key === "f" && (ev.metaKey || ev.ctrlKey)) {
        this.searchInputEl?.focus();
        ev.preventDefault();
        return;
      }
      if (
        ev.target instanceof HTMLInputElement ||
        ev.target instanceof HTMLTextAreaElement ||
        ev.target instanceof HTMLSelectElement
      ) {
        return;
      }
      switch (ev.key) {
        case "j":
        case "J":
          this.moveSelection(1);
          ev.preventDefault();
          break;
        case "k":
        case "K":
          this.moveSelection(-1);
          ev.preventDefault();
          break;
        case "Enter":
          void this.openSelected();
          ev.preventDefault();
          break;
        case "r":
        case "R":
          void this.markSelected();
          ev.preventDefault();
          break;
        case "s":
        case "S":
          void this.snoozeSelected(1);
          ev.preventDefault();
          break;
      }
    });
  }

  private refreshTabTitle(): void {
    const leaf = this.leaf as unknown as { updateHeader?: () => void };
    leaf.updateHeader?.();
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
