import { App, PluginSettingTab, Setting } from "obsidian";

import type ReadQueuePlugin from "./main";

export interface ReadQueueSettings {
  webFolder: string;
  pendingFolder: string;
  intakeIntervalMin: number;
  topics: string[];
}

export const DEFAULT_SETTINGS: ReadQueueSettings = {
  webFolder: "Inbox/Web/",
  pendingFolder: "Inbox/Pending/",
  intakeIntervalMin: 5,
  topics: ["tech", "producto", "startups", "filosofía", "personal"],
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
      .setName("Tópicos sugeridos")
      .setDesc("Lista separada por comas. Se usa para autocompletar el campo topic.")
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
  }
}

function ensureTrailingSlash(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}
