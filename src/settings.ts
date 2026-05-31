import { App, PluginSettingTab, Setting } from "obsidian";

import type ReadQueuePlugin from "./main";
import { DEFAULT_PUBLISHER_TOPIC_MAP, DEFAULT_TOPIC_LIST } from "./topics";

export interface ReadQueueSettings {
  webFolder: string;
  pendingFolder: string;
  intakeIntervalMin: number;
  topics: string[];
  publisherTopicMap: Record<string, string>;
  anthropicApiKey: string;
  classifyModel: string;
  useClaudeForClassification: boolean;
  classifyOnIntake: boolean;
  classifyOnLoad: boolean;
  autoMoveOrphans: boolean;
  readTag: string;
  collapsedGroupsByGroupBy: Record<string, string[]>;
  enableReaderStyles: boolean;
  openOnStartup: boolean;
}

export const DEFAULT_SETTINGS: ReadQueueSettings = {
  webFolder: "Inbox/Web/",
  pendingFolder: "Inbox/Pending/",
  intakeIntervalMin: 5,
  topics: [...DEFAULT_TOPIC_LIST],
  publisherTopicMap: { ...DEFAULT_PUBLISHER_TOPIC_MAP },
  anthropicApiKey: "",
  classifyModel: "claude-haiku-4-5",
  useClaudeForClassification: true,
  classifyOnIntake: true,
  classifyOnLoad: true,
  autoMoveOrphans: true,
  readTag: "leido",
  collapsedGroupsByGroupBy: {},
  enableReaderStyles: true,
  openOnStartup: true,
};

export class ReadQueueSettingsTab extends PluginSettingTab {
  plugin: ReadQueuePlugin;

  constructor(app: App, plugin: ReadQueuePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "ReadQueue" });

    new Setting(containerEl)
      .setName("Carpeta de artículos parseados")
      .setDesc(
        'Dónde caen los artículos del Web Clipper + los parseados por el intake. Ej: "Inbox/Web/".',
      )
      .addText((text) =>
        text
          .setPlaceholder("Inbox/Web/")
          .setValue(this.plugin.settings.webFolder)
          .onChange(async (value) => {
            this.plugin.settings.webFolder = ensureTrailingSlash(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Carpeta de URLs pendientes")
      .setDesc(
        'Buffer de URLs guardadas desde el share sheet de iOS (app de X, Reddit, etc). El intake las procesa. Ej: "Inbox/Pending/".',
      )
      .addText((text) =>
        text
          .setPlaceholder("Inbox/Pending/")
          .setValue(this.plugin.settings.pendingFolder)
          .onChange(async (value) => {
            this.plugin.settings.pendingFolder = ensureTrailingSlash(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Intervalo del intake (minutos)")
      .setDesc(
        "Cada cuántos minutos escanear la carpeta pendiente. 0 = solo al iniciar Obsidian.",
      )
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.intakeIntervalMin))
          .onChange(async (value) => {
            const n = Number.parseInt(value, 10);
            this.plugin.settings.intakeIntervalMin =
              Number.isFinite(n) && n >= 0 ? n : 0;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Tag "leído"')
      .setDesc(
        'Tag que se agrega al frontmatter cuando marcás un artículo como leído. Dejar vacío para no agregar tag (solo cambia el status).',
      )
      .addText((text) =>
        text
          .setPlaceholder("leido")
          .setValue(this.plugin.settings.readTag)
          .onChange(async (value) => {
            this.plugin.settings.readTag = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h3", { text: "Topic classification" });

    new Setting(containerEl)
      .setName("Lista de tópicos")
      .setDesc(
        "Topics válidos, separados por comas. Default derivado de tu histórico de Matter.",
      )
      .addTextArea((area) =>
        area
          .setValue(this.plugin.settings.topics.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.topics = value
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Mapeo publisher → topic")
      .setDesc(
        'JSON con dominios y su topic. Ej: {"paulgraham.com": "tech"}. Default derivado de Matter.',
      )
      .addTextArea((area) => {
        area
          .setValue(JSON.stringify(this.plugin.settings.publisherTopicMap, null, 2))
          .onChange(async (value) => {
            try {
              const parsed = JSON.parse(value) as Record<string, string>;
              if (parsed && typeof parsed === "object") {
                this.plugin.settings.publisherTopicMap = parsed;
                await this.plugin.saveSettings();
              }
            } catch {
              // ignore until valid JSON
            }
          });
        area.inputEl.rows = 8;
      });

    new Setting(containerEl)
      .setName("Clasificar automáticamente al ingestar")
      .setDesc("Si está activo, cada artículo nuevo recibe un topic durante el intake.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.classifyOnIntake)
          .onChange(async (value) => {
            this.plugin.settings.classifyOnIntake = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Clasificar al cargar el plugin")
      .setDesc(
        "Cuando se carga el plugin (toggle off/on o reinicio de Obsidian), busca artículos sin topic en la carpeta de la cola y los clasifica en background.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.classifyOnLoad)
          .onChange(async (value) => {
            this.plugin.settings.classifyOnLoad = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Mover huérfanos del Web Clipper al cargar")
      .setDesc(
        "El Web Clipper de iOS Safari a veces guarda tweets/clips fuera de Inbox/Web (raíz de la vault, Clippings/, etc). Si está activo, al cargar el plugin mueve esos archivos automáticamente a la carpeta de la cola.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoMoveOrphans)
          .onChange(async (value) => {
            this.plugin.settings.autoMoveOrphans = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Usar Claude para clasificar")
      .setDesc(
        "Si está activo y hay API key, usa Claude Haiku 4.5 (~$0.0007/artículo). Sin API key cae a heurística por publisher.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useClaudeForClassification)
          .onChange(async (value) => {
            this.plugin.settings.useClaudeForClassification = value;
            await this.plugin.saveSettings();
          }),
      );

    const apiKeySetting = new Setting(containerEl)
      .setName("Anthropic API key")
      .setDesc(
        "El contenido del artículo se envía a Anthropic para clasificar. Dejá vacío para usar solo heurística.",
      );
    const apiKeyWarn = apiKeySetting.descEl.createEl("div", {
      cls: "readqueue-settings__warn",
    });
    const refreshKeyWarn = (value: string): void => {
      const v = value.trim();
      if (v && !v.startsWith("sk-ant-")) {
        apiKeyWarn.setText(
          "⚠ Esta key parece no ser válida — una API key de Anthropic empieza con sk-ant-",
        );
      } else {
        apiKeyWarn.setText("");
      }
    };
    refreshKeyWarn(this.plugin.settings.anthropicApiKey);
    apiKeySetting.addText((text) => {
      text
        .setPlaceholder("sk-ant-...")
        .setValue(this.plugin.settings.anthropicApiKey)
        .onChange(async (value) => {
          this.plugin.settings.anthropicApiKey = value.trim();
          refreshKeyWarn(value);
          await this.plugin.saveSettings();
        });
      text.inputEl.type = "password";
    });

    new Setting(containerEl)
      .setName("Modelo de clasificación")
      .setDesc("ID del modelo Anthropic.")
      .addText((text) =>
        text
          .setPlaceholder("claude-haiku-4-5")
          .setValue(this.plugin.settings.classifyModel)
          .onChange(async (value) => {
            const v = value.trim();
            this.plugin.settings.classifyModel = v || "claude-haiku-4-5";
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h3", { text: "Reading view" });

    new Setting(containerEl)
      .setName("Estilos premium en notas clipeadas")
      .setDesc(
        "Tipografía serif + max-width 720px + line-height 1.7 en notas con source web-clipper / intake-* / matter-legacy. Desactivar si tenés tu propio CSS.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableReaderStyles)
          .onChange(async (value) => {
            this.plugin.settings.enableReaderStyles = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h3", { text: "Vista" });

    new Setting(containerEl)
      .setName("Abrir cola al iniciar")
      .setDesc(
        "Al cargar el plugin, abre la vista de cola automáticamente en el panel derecho. Desactivar si preferís tap en el ribbon icon.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.openOnStartup = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}

function ensureTrailingSlash(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}
