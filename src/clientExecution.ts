// ==========================================
// ▶️ Blueprint の実行と配信
// ==========================================
// /c による手動実行、チャンネルへの送信（権限確認つき）、
// リアクション Trigger の処理、スケジューラを担う。

import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Client,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from "discord.js";
import { buildAutoMemoryProposal } from "./autoMemory.js";
import { GRAPHITE, type Blueprint } from "./blueprint.js";
import {
  MAX_MESSAGE_LENGTH,
  SCHEDULER_INTERVAL_MS,
  pluginsOf,
  type ClientDeps,
} from "./clientShared.js";
import { executeBlueprint, type IntendedAction } from "./engine.js";
import { matchesReactionTrigger, reactionCountFor } from "./reactionTrigger.js";
import { isScheduleDue } from "./schedule.js";

// ==========================================
// ▶️ /c による手動実行
// ==========================================

export async function handleRun(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const name = interaction.options.getString("name", true);
  const blueprint = deps.store.getBlueprint(guildId, name);
  if (blueprint === null) {
    await interaction.reply({
      content: `見つかりませんでした: /${name}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const result = executeBlueprint(
    blueprint,
    { ...deps, plugins: pluginsOf(deps) },
    {
      guildId,
      userId: interaction.user.id,
      userName: interaction.user.username,
      serverName: interaction.guild?.name ?? "",
    },
  );
  if (result.status === "blocked") {
    const message =
      result.reason === "cooldown"
        ? `実行できませんでした。クールダウン中です: 残り ${Math.ceil(
            (result.remainingMs ?? 0) / 1000,
          )} 秒`
        : "実行できませんでした。FORGE は無効化されています";
    await interaction.reply({
      content: message,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (result.status === "skipped") {
    await interaction.reply({
      content: "実行されませんでした。条件を満たしていません",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // 📤 チャンネル送信アクションは /c では実行されない。
  // 黙って捨てず、注記として返信に含める。
  const channelNote = result.actions.some(
    (action) => action.type === "sendToChannel",
  )
    ? "※ チャンネルへの送信は /forge run では実行されません"
    : null;
  if (result.outputs.length === 0) {
    await interaction.reply({
      content: channelNote ?? "実行されませんでした。条件を満たしていません",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const text = result.outputs.join("\n");
  if (blueprint.presentation?.format === "embed") {
    const embed = new EmbedBuilder()
      .setDescription(text)
      .setColor(blueprint.presentation.color ?? GRAPHITE);
    await interaction.reply({
      ...(channelNote !== null ? { content: channelNote } : {}),
      embeds: [embed],
    });
    return;
  }
  await interaction.reply({
    content: channelNote !== null ? `${text}\n${channelNote}` : text,
  });
}

// ==========================================
// 📤 チャンネルへの送信
// ==========================================

type SendAction = Extract<IntendedAction, { type: "sendToChannel" }>;

// 📤 送信先が「同じギルドのテキストチャンネル」で、Bot に
// 閲覧・送信権限がある場合だけ送る。送れない場合は警告ログを出して false。
export async function deliverToChannel(
  client: Client,
  guildId: string,
  blueprint: Blueprint,
  action: SendAction,
): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(action.channelId);
    if (
      channel === null ||
      !channel.isTextBased() ||
      channel.isDMBased() ||
      !("send" in channel)
    ) {
      console.warn(
        `Skipped send: channel ${action.channelId} is not a guild text channel`,
      );
      return false;
    }
    if (channel.guildId !== guildId) {
      console.warn(
        `Skipped send: channel ${action.channelId} is not in guild ${guildId}`,
      );
      return false;
    }
    const me =
      channel.guild.members.me ?? (await channel.guild.members.fetchMe());
    const permissions = channel.permissionsFor(me);
    if (
      permissions === null ||
      !permissions.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
      ])
    ) {
      console.warn(
        `Skipped send: missing ViewChannel/SendMessages in channel ${action.channelId}`,
      );
      return false;
    }
    const text = action.text.slice(0, MAX_MESSAGE_LENGTH);
    if (blueprint.presentation?.format === "embed") {
      const embed = new EmbedBuilder()
        .setDescription(text)
        .setColor(blueprint.presentation.color ?? GRAPHITE);
      await channel.send({ embeds: [embed] });
    } else {
      await channel.send({ content: text });
    }
    return true;
  } catch (error) {
    console.warn(`Failed to send to channel ${action.channelId}:`, error);
    return false;
  }
}

// ==========================================
// 👍 リアクション Trigger
// ==========================================

// 💬 発火したメッセージを名言候補として自動提案する。
// キーはメッセージ ID から決定的に作られ、Store 側で既存キーを
// 上書きしないため、候補はメッセージごとに1件だけになる。
// ギルド単位の無効化（isAutoMemoryEnabled）もここで尊重する。
function proposeAutoMemoryForMessage(
  deps: ClientDeps,
  guildId: string,
  input: {
    messageId: string;
    authorId: string;
    authorBot: boolean;
    content: string;
  },
): void {
  if (!deps.store.isAutoMemoryEnabled(guildId)) return;
  const proposal = buildAutoMemoryProposal(input);
  if (proposal === null) return;
  deps.store.proposeMemoryIfAbsent(guildId, proposal);
}

// 👍 リアクションが付いたら、そのギルドの reaction Trigger を照合する
export async function handleReactionAdd(
  client: Client,
  deps: ClientDeps,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  try {
    const actor = user.partial ? await user.fetch() : user;
    if (actor.bot) return;
    if (deps.globalDisabled) return;
    if (reaction.partial) await reaction.fetch();
    const message = reaction.message.partial
      ? await reaction.message.fetch()
      : reaction.message;
    const guild = message.guild;
    if (guild === null) return;
    const guildId = guild.id;
    if (deps.store.isGuildDisabled(guildId)) return;
    const blueprints = deps.store.listBlueprintsByTriggerType(
      guildId,
      "reaction",
    );
    if (blueprints.length === 0) return;
    const author = message.author;
    if (author === null) return;
    // 🔢 件数は文字列表現・名前・ID の全表記で引けるように登録する。
    // Trigger 側の絵文字指定がどの表記でも一致するようにするため。
    const emojiCounts: Record<string, number> = {};
    let totalCount = 0;
    for (const entry of message.reactions.cache.values()) {
      const count = entry.count ?? 0;
      totalCount += count;
      const keys = new Set<string>();
      keys.add(entry.emoji.toString());
      if (entry.emoji.name !== null) keys.add(entry.emoji.name);
      if (entry.emoji.id !== null) keys.add(entry.emoji.id);
      for (const key of keys) {
        if (key !== "") emojiCounts[key] = count;
      }
    }
    for (const blueprint of blueprints) {
      if (blueprint.trigger.type !== "reaction") continue;
      const trigger = blueprint.trigger;
      const matchInput = {
        emojiCounts,
        totalCount,
        alreadyFired: deps.store.hasAutomationFired(
          guildId,
          blueprint.name,
          message.id,
        ),
      };
      if (!matchesReactionTrigger(trigger, matchInput)) continue;
      const result = executeBlueprint(
        blueprint,
        { ...deps, plugins: pluginsOf(deps) },
        {
          guildId,
          userId: author.id,
          userName: author.username,
          serverName: guild.name,
          messageUrl: message.url,
          reactionCount: reactionCountFor(trigger, matchInput),
        },
      );
      if (result.status !== "ok") continue;
      // 📝 送信より先に発火を記録する。同時に届いたリアクションで
      // 二重送信しないためで、記録できなかった場合はここで止める。
      // 照合から記録まで await を挟まないため、送信以外の副作用
      // （カウンター・変数）も二重に適用されることはない。
      if (
        !deps.store.markAutomationFired(guildId, blueprint.name, message.id)
      ) {
        continue;
      }
      for (const action of result.actions) {
        if (action.type === "sendToChannel") {
          await deliverToChannel(client, guildId, blueprint, action);
        }
      }
      proposeAutoMemoryForMessage(deps, guildId, {
        messageId: message.id,
        authorId: author.id,
        authorBot: author.bot,
        content: message.content,
      });
    }
  } catch (error) {
    console.error("Reaction handling failed:", error);
  }
}

// ==========================================
// ⏰ スケジューラ
// ==========================================

export interface SchedulerHandle {
  stop: () => void;
}

// ⏰ 30秒ごとに全ギルドのスケジュール Blueprint を確認し、
// 実行時刻に達したものを送信する。最終実行時刻は送信より先に
// 記録し、再起動や次回 tick での二重発火を防ぐ。
export function startScheduler(
  client: Client,
  deps: ClientDeps,
): SchedulerHandle {
  // 🛡️ tick の多重実行ガード（前回が終わるまで次を始めない）
  let tickInFlight = false;
  const tick = async (): Promise<void> => {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      if (deps.globalDisabled) return;
      const now = new Date();
      for (const {
        guildId,
        blueprint,
      } of deps.store.listScheduledBlueprints()) {
        if (blueprint.trigger.type !== "schedule") continue;
        if (deps.store.isGuildDisabled(guildId)) continue;
        const lastRun = deps.store.getAutomationLastRun(
          guildId,
          blueprint.name,
        );
        if (!isScheduleDue(blueprint.trigger, lastRun, now)) continue;
        const guild = client.guilds.cache.get(guildId);
        if (guild === undefined) continue;
        const result = executeBlueprint(
          blueprint,
          { ...deps, plugins: pluginsOf(deps) },
          {
            guildId,
            userId: "",
            userName: client.user?.username ?? "FORGE",
            serverName: guild.name,
          },
        );
        if (result.status !== "ok") continue;
        deps.store.setAutomationLastRun(guildId, blueprint.name, now);
        for (const action of result.actions) {
          if (action.type === "sendToChannel") {
            await deliverToChannel(client, guildId, blueprint, action);
          }
        }
      }
    } catch (error) {
      console.error("Scheduler tick failed:", error);
    } finally {
      tickInFlight = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, SCHEDULER_INTERVAL_MS);
  // 💓 タイマーだけでプロセスを生存させない
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
    },
  };
}
