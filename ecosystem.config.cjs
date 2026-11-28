// ==========================================
// 🛠️ pm2 用 ecosystem ファイル（forgebot）
// ==========================================
// 起動: pm2 start ecosystem.config.cjs
// 再起動後も残すには: pm2 startup（表示されたコマンドを実行）→ pm2 save
//
// .env をこのファイルで読む理由: pm2 は .env を自動では読み込まず、
// Bot 本体も dotenv に依存していないため、ここでリポジトリ直下の
// .env を解析して環境変数として渡す。秘密は .env（gitignore 済み）
// だけに置き、このファイルには書かない。
//
// node:sqlite は Node 22 では --experimental-sqlite が必要なので、
// Node 24 未満のときだけ自動で付ける。

// ===== .env の読み込み =====
const fs = require("node:fs");
const path = require("node:path");

function readEnvFile(filePath) {
  const values = {};
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return values;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = line.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (match === null) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const envFromFile = readEnvFile(path.join(__dirname, ".env"));
if (!envFromFile.DISCORD_TOKEN || !envFromFile.DISCORD_CLIENT_ID) {
  console.error(
    "[forgebot] .env に DISCORD_TOKEN / DISCORD_CLIENT_ID がありません。先に .env を用意してください。",
  );
}

const nodeMajor = Number(process.versions.node.split(".")[0]);

// ===== アプリ定義 =====
module.exports = {
  apps: [
    {
      name: "forgebot",
      script: "dist/src/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      kill_timeout: 5000,
      // Node 24 未満では node:sqlite にフラグが要る
      ...(nodeMajor < 24 ? { node_args: "--experimental-sqlite" } : {}),
      env: {
        NODE_ENV: "production",
        ...envFromFile,
      },
    },
  ],
};
