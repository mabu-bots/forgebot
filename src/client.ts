// ==========================================
// 🤖 Discord クライアントの生成と配線
// ==========================================
// Intent は非 Privileged な3つだけ（Guilds / GuildMessages /
// GuildMessageReactions）。メッセージ本文は必要としない。
// このモジュールは公開 API の再エクスポートも担う:
// buildCommands / startScheduler / ClientDeps は従来どおり
// client.js から import できる。

import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} from "discord.js";
import { handleReactionAdd, startScheduler } from "./clientExecution.js";
import {
  handleAutocomplete,
  handleChannelSelect,
  handleChatInputCommand,
  handleDraftButton,
  handleModalSubmit,
  handleStringSelect,
} from "./clientInteractions.js";
import type { ClientDeps } from "./clientShared.js";
import { logExec } from "./execLog.js";

export { buildCommands } from "./commandDefinitions.js";
export { startScheduler, type SchedulerHandle } from "./clientExecution.js";
export type { ClientDeps } from "./clientShared.js";

// 🤖 クライアントを生成する（Privileged Intent は使わない）
export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User],
  });
}

// 🔌 イベントハンドラを登録し、スケジューラを開始する
export function attachHandlers(
  client: Client,
  deps: ClientDeps,
): { stop: () => void } {
  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready: ${readyClient.user.tag}`);
  });
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    void handleReactionAdd(client, deps, reaction, user);
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction, deps);
        return;
      }
      if (interaction.isModalSubmit()) {
        if (interaction.guildId === null) {
          await interaction.reply({
            content: "実行できませんでした。サーバー内で実行してください",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await handleModalSubmit(interaction, deps);
        return;
      }
      if (interaction.isButton()) {
        if (interaction.guildId === null) return;
        await handleDraftButton(interaction, deps);
        return;
      }
      if (interaction.isStringSelectMenu()) {
        if (interaction.guildId === null) return;
        await handleStringSelect(interaction);
        return;
      }
      if (interaction.isChannelSelectMenu()) {
        if (interaction.guildId === null) return;
        await handleChannelSelect(interaction, deps);
        return;
      }
      if (!interaction.isChatInputCommand()) return;
      // 📋 スラッシュコマンドだけ実行ログの対象にする
      try {
        await handleChatInputCommand(interaction, deps);
        logExec({
          command: interaction.commandName,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: interaction.user.id,
        });
      } catch (error) {
        logExec({
          command: interaction.commandName,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: interaction.user.id,
          error,
        });
        throw error;
      }
    } catch (error) {
      console.error("Interaction handling failed:", error);
      try {
        if (
          interaction.isRepliable() &&
          !interaction.replied &&
          !interaction.deferred
        ) {
          await interaction.reply({
            content: "実行できませんでした。内部でエラーが発生しました",
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch {
        // ⚠️ 応答自体が失敗した場合は何もできない
      }
    }
  });
  return startScheduler(client, deps);
}
