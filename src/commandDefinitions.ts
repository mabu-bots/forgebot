// ==========================================
// 📝 スラッシュコマンド定義（/forge と /c）
// ==========================================
// /forge は管理コマンド一式（サブコマンドとグループで構成）、
// /c はカスタムコマンドの実行口。定義はここで一元管理し、
// 登録（register.ts）とテストの両方から使う。

import {
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

// 📝 /forge の定義を組み立てる
function buildForgeCommand(): RESTPostAPIChatInputApplicationCommandsJSONBody {
  const forge = new SlashCommandBuilder()
    .setName("forge")
    .setDescription("FORGE の管理コマンド")
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Blueprint / Variable / Counter の件数を表示する"),
    )
    .addSubcommand((sub) =>
      sub.setName("create").setDescription("Blueprint を作成する"),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Blueprint の一覧を表示する"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Blueprint を削除する")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Blueprint の名前")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Blueprint を編集する")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Blueprint の名前")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("auto")
        .setDescription("自動化を管理する")
        .addSubcommand((sub) =>
          sub.setName("create").setDescription("自動化を作成する"),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("share")
        .setDescription("Blueprint の共有コードを表示する")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Blueprint の名前")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("import")
        .setDescription("共有コードから Blueprint を読み込む"),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("memory")
        .setDescription("サーバーの記憶を管理する")
        .addSubcommand((sub) =>
          sub
            .setName("propose")
            .setDescription("記憶の候補を登録する")
            .addStringOption((o) =>
              o.setName("key").setDescription("キー").setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName("kind")
                .setDescription("種別")
                .setRequired(true)
                .addChoices(
                  { name: "名言", value: "quote" },
                  { name: "記念日", value: "anniversary" },
                  { name: "メモ", value: "note" },
                ),
            )
            .addStringOption((o) =>
              o.setName("content").setDescription("内容").setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("list")
            .setDescription("記憶の一覧を表示する")
            .addStringOption((o) =>
              o
                .setName("status")
                .setDescription("承認状態")
                .setRequired(false)
                .addChoices(
                  { name: "pending", value: "pending" },
                  { name: "approved", value: "approved" },
                  { name: "rejected", value: "rejected" },
                ),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("approve")
            .setDescription("記憶の候補を承認する")
            .addStringOption((o) =>
              o
                .setName("key")
                .setDescription("キー")
                .setRequired(true)
                .setAutocomplete(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("reject")
            .setDescription("記憶の候補を却下する")
            .addStringOption((o) =>
              o
                .setName("key")
                .setDescription("キー")
                .setRequired(true)
                .setAutocomplete(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("delete")
            .setDescription("記憶を削除する")
            .addStringOption((o) =>
              o
                .setName("key")
                .setDescription("キー")
                .setRequired(true)
                .setAutocomplete(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("auto-enable")
            .setDescription(
              "リアクション閾値到達時の記憶の自動提案を有効化する",
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("auto-disable")
            .setDescription(
              "リアクション閾値到達時の記憶の自動提案を無効化する",
            ),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("plugin")
        .setDescription("プラグインを管理する")
        .addSubcommand((sub) =>
          sub.setName("list").setDescription("プラグインの一覧を表示する"),
        )
        .addSubcommand((sub) =>
          sub
            .setName("enable")
            .setDescription("プラグインを有効化する")
            .addStringOption((o) =>
              o
                .setName("name")
                .setDescription("プラグイン名")
                .setRequired(true)
                .setAutocomplete(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("disable")
            .setDescription("プラグインを無効化する")
            .addStringOption((o) =>
              o
                .setName("name")
                .setDescription("プラグイン名")
                .setRequired(true)
                .setAutocomplete(true),
            ),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("template")
        .setDescription("公式テンプレートを使う")
        .addSubcommand((sub) =>
          sub.setName("list").setDescription("テンプレートの一覧を表示する"),
        )
        .addSubcommand((sub) =>
          sub
            .setName("use")
            .setDescription("テンプレートを取り込む")
            .addStringOption((o) =>
              o
                .setName("id")
                .setDescription("テンプレート ID")
                .setRequired(true)
                .setAutocomplete(true),
            )
            .addStringOption((o) =>
              o
                .setName("name")
                .setDescription("新しい名前 (任意)")
                .setRequired(false),
            ),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("data")
        .setDescription("サーバーのデータを管理する")
        .addSubcommand((sub) =>
          sub
            .setName("export")
            .setDescription("サーバーのデータを JSON で書き出す"),
        )
        .addSubcommand((sub) =>
          sub
            .setName("delete")
            .setDescription("サーバーのデータを全件削除する"),
        ),
    );
  return forge.toJSON();
}

// 📝 /c の定義を組み立てる
function buildRunCommand(): RESTPostAPIChatInputApplicationCommandsJSONBody {
  const run = new SlashCommandBuilder()
    .setName("c")
    .setDescription("カスタムコマンドを実行する")
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Blueprint の名前")
        .setRequired(true),
    );
  return run.toJSON();
}

// 📝 登録用のコマンド定義一式（/forge と /c）
export function buildCommands(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [buildForgeCommand(), buildRunCommand()];
}
