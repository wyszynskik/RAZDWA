const fs = require("fs");
const path = require("path");

function formatTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `razdwa-v${year}${month}${day}${hours}${minutes}`;
}

function injectVersion(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠ File not found: ${filePath}`);
      return;
    }

    let content = fs.readFileSync(filePath, "utf8");
    const newVersion = formatTimestamp();

    const versionRegex = /var\s+CACHE_VERSION\s*=\s*['`"]([^'"`]*)['`"]/;

    if (!versionRegex.test(content)) {
      console.warn(`⚠ CACHE_VERSION pattern not found in ${filePath}`);
      return;
    }

    const newContent = content.replace(versionRegex, `var CACHE_VERSION = '${newVersion}'`);

    if (newContent !== content) {
      fs.writeFileSync(filePath, newContent, "utf8");
      console.log(`✓ Updated ${filePath} → ${newVersion}`);
    }
  } catch (error) {
    console.error(`✗ Error processing ${filePath}:`, error.message);
    process.exit(1);
  }
}

function formatHtmlVersion() {
  return formatTimestamp().replace("razdwa-v", "");
}

function injectHtmlVersion(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠ File not found: ${filePath}`);
      return;
    }

    let content = fs.readFileSync(filePath, "utf8");
    const version = formatHtmlVersion();

    const commentRegex = /<!-- APP_VERSION: [\w-]+ -->/;
    if (commentRegex.test(content)) {
      content = content.replace(commentRegex, `<!-- APP_VERSION: ${version} -->`);
    }

    content = content.replace(/\?v=[\w-]+/g, `?v=${version}`);

    content = content.replace(/(<meta name="app-version" content=")[\w-]*(")/, `$1${version}$2`);

    fs.writeFileSync(filePath, content, "utf8");
    console.log(`✓ Updated HTML version in ${filePath} → ${version}`);
  } catch (error) {
    console.error(`✗ Error processing ${filePath}:`, error.message);
    process.exit(1);
  }
}

function injectCacheBusterVersion(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠ File not found: ${filePath}`);
      return;
    }

    const version = formatHtmlVersion();
    let content = fs.readFileSync(filePath, "utf8");
    const newContent = content.replace(
      /const\s+APP_VERSION\s*=\s*['"`]([\w-]*)['"`]/,
      `const APP_VERSION='${version}'`
    );

    if (newContent !== content) {
      fs.writeFileSync(filePath, newContent, "utf8");
      console.log(`✓ Updated cache-buster version → ${version}`);
    }
  } catch (error) {
    console.error(`✗ Error processing ${filePath}:`, error.message);
    process.exit(1);
  }
}

const rootDir = path.join(__dirname, "..");
const docsDir = process.env.RAZDWA_DOCS_DIR ?? path.join(rootDir, "docs");
const swFiles = [path.join(docsDir, "sw.js")];
const htmlFile = path.join(docsDir, "index.html");
const cacheBusterFile = path.join(docsDir, "cache-buster.js");

console.log("Injecting cache version...");
swFiles.forEach(injectVersion);
injectHtmlVersion(htmlFile);
injectCacheBusterVersion(cacheBusterFile);
console.log("Done!\n");
