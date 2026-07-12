import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const devDomainPrefix = "https://kwyszynskidesign.github.io/RAZDWA/";

function parseArgs(argv) {
  const args = { clientId: "raz-dwa", includeHandover: false, allowIndexing: false };
  for (const raw of argv) {
    const [key, ...rest] = raw.replace(/^--/, "").split("=");
    const value = rest.join("=");
    if (key === "site-url") args.siteUrl = value;
    else if (key === "client-id") args.clientId = value;
    else if (key === "out") args.out = value;
    else if (key === "include-handover") args.includeHandover = true;
    else if (key === "allow-indexing") args.allowIndexing = true;
  }
  return args;
}

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of fsReaddirRecursive(dir)) {
    total += statSync(entry).size;
  }
  return total;
}

function* fsReaddirRecursive(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) yield* fsReaddirRecursive(full);
    else yield full;
  }
}

const args = parseArgs(process.argv.slice(2));

if (!args.siteUrl) {
  console.error("Brak wymaganego argumentu --site-url=https://domena-klientki.pl/sciezka/");
  console.error("Przykład: npm run package:client -- --site-url=https://klientka.pl/kalkulator/");
  process.exit(1);
}

const siteUrl = args.siteUrl.endsWith("/") ? args.siteUrl : `${args.siteUrl}/`;
const outDir = args.out
  ? resolve(rootDir, args.out)
  : resolve(rootDir, "dist-client", `${args.clientId}-${timestamp()}`);

console.log(`\n[1/4] Build klienta (RAZDWA_ENV=client, RAZDWA_CLIENT_ID=${args.clientId})`);
execSync("npm run build", {
  cwd: rootDir,
  stdio: "inherit",
  env: { ...process.env, RAZDWA_ENV: "client", RAZDWA_CLIENT_ID: args.clientId },
});

console.log(`\n[2/4] Kopiowanie docs/ → ${outDir}`);
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(join(rootDir, "docs"), outDir, {
  recursive: true,
  filter: (src) => {
    if (args.includeHandover) return true;
    return !src.endsWith("DOKUMENT_ODBIOROWY_KARTA.html");
  },
});

console.log(`\n[3/4] Podmiana adresu deweloperskiego na ${siteUrl}`);
const indexPath = join(outDir, "index.html");
const indexHtml = readFileSync(indexPath, "utf8");
const patchedHtml = indexHtml.split(devDomainPrefix).join(siteUrl);
if (patchedHtml === indexHtml) {
  console.warn(
    `⚠ Nie znaleziono "${devDomainPrefix}" w index.html — sprawdź ręcznie og:url/og:image/twitter:image`
  );
}
writeFileSync(indexPath, patchedHtml, "utf8");

if (args.allowIndexing) {
  writeFileSync(join(outDir, "robots.txt"), "User-agent: *\nAllow: /\n", "utf8");
  console.log("robots.txt: indeksowanie DOZWOLONE (--allow-indexing)");
} else {
  console.log("robots.txt: indeksowanie zablokowane (domyślnie, bez zmian)");
}

console.log(`\n[4/4] Gotowe`);
const sizeMb = (dirSizeBytes(outDir) / 1024 / 1024).toFixed(1);
console.log(`Paczka klienta: ${outDir} (${sizeMb} MB)`);
console.log(
  args.includeHandover
    ? "Zawiera DOKUMENT_ODBIOROWY_KARTA.html"
    : "Bez DOKUMENT_ODBIOROWY_KARTA.html (domyślnie)"
);
console.log(
  "\nNastępny krok: wgraj całą zawartość tego folderu na serwer klientki (FTP/panel hostingu),"
);
console.log(
  "potem przejdź smoke test: załaduj stronę, policz 2-3 kategorie, złóż testowe zamówienie i sprawdź arkusz Google.\n"
);
