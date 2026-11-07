import { build } from "esbuild";
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  readFileSync(".env", "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    });
}

const url = process.env.GOOGLE_APPS_SCRIPT_URL ?? "";
const env = process.env.RAZDWA_ENV ?? "dev";
const clientId = process.env.RAZDWA_CLIENT_ID ?? "";
const outfile = process.env.RAZDWA_BUILD_OUTFILE ?? "docs/assets/app.js";

await build({
  entryPoints: ["src/ui/main.ts"],
  bundle: true,
  outfile,
  platform: "browser",
  target: "es2019",
  minify: true,
  charset: "ascii",
  define: {
    "process.env.GOOGLE_APPS_SCRIPT_URL": JSON.stringify(url),
    "process.env.RAZDWA_ENV": JSON.stringify(env),
    "process.env.RAZDWA_CLIENT_ID": JSON.stringify(clientId),
  },
});
