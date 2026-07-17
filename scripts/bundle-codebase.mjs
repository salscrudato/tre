#!/usr/bin/env node
/**
 * bundle-codebase.mjs
 *
 * Concatenates all functional source code, configuration, and documentation
 * of this repository into a single Markdown file that an AI (or a human) can
 * read end to end to comprehensively review the application: its architecture,
 * design patterns, functionality, and correctness.
 *
 * What it includes:
 *   - Every file git tracks, plus untracked-but-not-ignored files
 *     (so node_modules, dist, emulator-data, .env, secrets, and other
 *      .gitignore entries are excluded automatically).
 *
 * What it deliberately drops (not "functional working code"):
 *   - Lockfiles (package-lock.json)
 *   - Binary images (*.png)
 *   - Empty placeholders (*.gitkeep)
 *   - Its own output file and this script
 *
 * Everything else (TypeScript, TSX, CSS, HTML, JSON config, Firestore rules,
 * SVG, and Markdown docs) is included and grouped into logical review sections.
 *
 * Usage:
 *   node scripts/bundle-codebase.mjs [outputFile]
 *   node scripts/bundle-codebase.mjs codebase-review.md   (default)
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";

// ---------------------------------------------------------------------------
// Resolve repo root and output target
// ---------------------------------------------------------------------------
const repoRoot = execSync("git rev-parse --show-toplevel").toString().trim();
process.chdir(repoRoot);

const OUTPUT = process.argv[2] || "codebase-review.md";
const SELF = "scripts/bundle-codebase.mjs";

// ---------------------------------------------------------------------------
// Enumerate candidate files (tracked + untracked-not-ignored), then filter
// ---------------------------------------------------------------------------
function gitList(cmd) {
  return execSync(cmd, { maxBuffer: 64 * 1024 * 1024 })
    .toString()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const all = new Set([
  ...gitList("git ls-files"),
  ...gitList("git ls-files --others --exclude-standard"),
]);

const EXCLUDE_EXACT = new Set([OUTPUT, SELF]);
const isExcluded = (p) =>
  EXCLUDE_EXACT.has(p) ||
  /(^|\/)package-lock\.json$/.test(p) || // dependency lockfiles
  /\.png$/i.test(p) || // binary raster images
  /\.gitkeep$/.test(p) || // empty directory placeholders
  /\.DS_Store$/.test(p);

const files = [...all].filter((p) => !isExcluded(p)).sort();

// ---------------------------------------------------------------------------
// Language + section classification
// ---------------------------------------------------------------------------
function language(path) {
  const base = basename(path);
  if (base === ".firebaserc") return "json";
  if (base === ".gitignore") return "gitignore";
  const ext = extname(path).toLowerCase();
  return (
    {
      ".ts": "typescript",
      ".tsx": "tsx",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".js": "javascript",
      ".jsx": "jsx",
      ".json": "json",
      ".css": "css",
      ".html": "html",
      ".md": "markdown",
      ".svg": "xml",
      ".rules": "", // Firestore security rules (CEL-like; no native highlighter)
    }[ext] ?? ""
  );
}

// Ordered so a reviewer reads the app in a sensible progression:
// context/docs -> config -> types -> logic -> UI -> backend.
const SECTIONS = [
  { title: "1. Documentation & Project Context", match: (p) => p === "README.md" || p === "CLAUDE.md" || p.startsWith("docs/") },
  { title: "2. Build, Tooling & Package Config", match: (p) => /^(package\.json|tsconfig\.json|vite\.config\.ts|eslint\.config\.js|index\.html|\.firebaserc|\.gitignore|firebase\.json)$/.test(p) || /^functions\/(package\.json|tsconfig\.json|\.gitignore)$/.test(p) },
  { title: "3. Firebase Rules & Indexes", match: (p) => p === "firestore.rules" || p === "firestore.indexes.json" },
  { title: "4. App Entry & Global Styles", match: (p) => /^src\/(main\.tsx|App\.tsx|index\.css|vite-env\.d\.ts)$/.test(p) },
  { title: "5. Domain Types", match: (p) => p === "src/types.ts" },
  { title: "6. App Config (src/config)", match: (p) => p.startsWith("src/config/") },
  { title: "7. Core Library & Financial Engine (src/lib)", match: (p) => p.startsWith("src/lib/") },
  { title: "8. React Hooks (src/hooks)", match: (p) => p.startsWith("src/hooks/") },
  { title: "9. Context Providers (src/context)", match: (p) => p.startsWith("src/context/") },
  { title: "10. Data Services / Firestore Layer (src/services)", match: (p) => p.startsWith("src/services/") },
  { title: "11. Components (src/components)", match: (p) => p.startsWith("src/components/") },
  { title: "12. Routes / Pages (src/routes)", match: (p) => p.startsWith("src/routes/") },
  { title: "13. Assets (src/assets)", match: (p) => p.startsWith("src/assets/") || p.startsWith("public/") },
  { title: "14. Cloud Functions (functions/src)", match: (p) => p.startsWith("functions/src/") },
  { title: "15. Admin & Maintenance Scripts (scripts)", match: (p) => p.startsWith("scripts/") },
  { title: "99. Other", match: () => true },
];

function sectionOf(path) {
  return SECTIONS.find((s) => s.match(path)).title;
}

// ---------------------------------------------------------------------------
// Helpers: safe fences, slugs, human sizes, directory tree
// ---------------------------------------------------------------------------
// Choose a fence longer than any backtick run inside the file so embedded
// Markdown code blocks (in docs) never break out of their container.
function fenceFor(content) {
  let longest = 0;
  const runs = content.match(/`+/g);
  if (runs) for (const r of runs) longest = Math.max(longest, r.length);
  return "`".repeat(Math.max(3, longest + 1));
}

const usedSlugs = new Set();
function slug(path) {
  let base = "file-" + path.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let s = base;
  let i = 2;
  while (usedSlugs.has(s)) s = `${base}-${i++}`;
  usedSlugs.add(s);
  return s;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function buildTree(paths) {
  const root = {};
  for (const p of paths) {
    let node = root;
    for (const part of p.split("/")) {
      node[part] ??= {};
      node = node[part];
    }
  }
  const lines = [];
  const walk = (node, prefix) => {
    const keys = Object.keys(node).sort((a, b) => {
      const ad = Object.keys(node[a]).length > 0;
      const bd = Object.keys(node[b]).length > 0;
      if (ad !== bd) return ad ? -1 : 1; // directories first
      return a.localeCompare(b);
    });
    keys.forEach((k, idx) => {
      const last = idx === keys.length - 1;
      const isDir = Object.keys(node[k]).length > 0;
      lines.push(`${prefix}${last ? "└── " : "├── "}${k}${isDir ? "/" : ""}`);
      if (isDir) walk(node[k], prefix + (last ? "    " : "│   "));
    });
  };
  walk(root, "");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Gather git metadata
// ---------------------------------------------------------------------------
function safeExec(cmd, fallback = "unknown") {
  try {
    return execSync(cmd).toString().trim();
  } catch {
    return fallback;
  }
}
const branch = safeExec("git rev-parse --abbrev-ref HEAD");
const commit = safeExec("git rev-parse --short HEAD");
const commitSubject = safeExec("git log -1 --pretty=%s");
const commitDate = safeExec("git log -1 --date=short --pretty=%cd");
const generatedAt = new Date().toISOString();

// ---------------------------------------------------------------------------
// Read every file, compute per-file + aggregate stats
// ---------------------------------------------------------------------------
const entries = files.map((path) => {
  const content = readFileSync(path, "utf8");
  const bytes = statSync(path).size;
  const lines = content.length === 0 ? 0 : content.split("\n").length;
  return { path, content, bytes, lines, lang: language(path), section: sectionOf(path), anchor: slug(path) };
});

const totalBytes = entries.reduce((n, e) => n + e.bytes, 0);
const totalLines = entries.reduce((n, e) => n + e.lines, 0);

// Group by section, preserving SECTIONS order
const bySection = new Map(SECTIONS.map((s) => [s.title, []]));
for (const e of entries) bySection.get(e.section).push(e);
for (const [, arr] of bySection) arr.sort((a, b) => a.path.localeCompare(b.path));

// Files-by-extension table
const extCounts = {};
for (const e of entries) {
  const ext = extname(e.path) || basename(e.path);
  extCounts[ext] = (extCounts[ext] || 0) + 1;
}

// ---------------------------------------------------------------------------
// Emit Markdown
// ---------------------------------------------------------------------------
const out = [];
const w = (s = "") => out.push(s);

w(`# Nest - Complete Codebase Review Bundle`);
w();
w(`> A private, two-person household finance PWA. This document is an auto-generated,`);
w(`> single-file snapshot of the entire functional codebase, assembled for comprehensive`);
w(`> AI review of the application, its architecture, design patterns, and functionality.`);
w();
w(`| | |`);
w(`|---|---|`);
w(`| Generated (UTC) | ${generatedAt} |`);
w(`| Git branch | \`${branch}\` |`);
w(`| Git commit | \`${commit}\` - ${commitSubject} (${commitDate}) |`);
w(`| Files included | ${entries.length} |`);
w(`| Total lines | ${totalLines.toLocaleString()} |`);
w(`| Total size | ${humanSize(totalBytes)} |`);
w();
w(`**Excluded:** \`node_modules\`, build output (\`dist\`), emulator state, \`.env*\` secrets,`);
w(`lockfiles, binary images (\`*.png\`), and other \`.gitignore\` entries. Everything an AI needs`);
w(`to understand and review the running application is present below.`);
w();

// Files by type
w(`## Files by type`);
w();
w(`| Type | Count |`);
w(`|---|---|`);
for (const [ext, count] of Object.entries(extCounts).sort((a, b) => b[1] - a[1])) {
  w(`| \`${ext}\` | ${count} |`);
}
w();

// Section summary
w(`## Sections`);
w();
w(`| Section | Files | Lines |`);
w(`|---|---|---|`);
for (const s of SECTIONS) {
  const arr = bySection.get(s.title);
  if (arr.length === 0) continue;
  const secLines = arr.reduce((n, e) => n + e.lines, 0);
  w(`| ${s.title} | ${arr.length} | ${secLines.toLocaleString()} |`);
}
w();

// Directory tree
w(`## Directory tree (included files)`);
w();
w("```");
w(buildTree(entries.map((e) => e.path)));
w("```");
w();

// Table of contents
w(`## Table of contents`);
w();
for (const s of SECTIONS) {
  const arr = bySection.get(s.title);
  if (arr.length === 0) continue;
  w(`- **${s.title}**`);
  for (const e of arr) {
    w(`  - [${e.path}](#${e.anchor}) _(${e.lines} lines)_`);
  }
}
w();
w(`---`);
w();

// File bodies, section by section
for (const s of SECTIONS) {
  const arr = bySection.get(s.title);
  if (arr.length === 0) continue;
  w(`# ${s.title}`);
  w();
  for (const e of arr) {
    const fence = fenceFor(e.content);
    w(`<a id="${e.anchor}"></a>`);
    w(`## \`${e.path}\``);
    w();
    w(`_${e.section.replace(/^\d+\.\s*/, "")} &middot; ${e.lines} lines &middot; ${humanSize(e.bytes)}_`);
    w();
    w(`${fence}${e.lang}`);
    // Trim a single trailing newline so the fence sits flush; preserve all else.
    w(e.content.replace(/\n$/, ""));
    w(fence);
    w();
  }
  w(`---`);
  w();
}

w(`_End of bundle. ${entries.length} files, ${totalLines.toLocaleString()} lines, ${humanSize(totalBytes)}._`);
w();

const markdown = out.join("\n");
writeFileSync(OUTPUT, markdown, "utf8");

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------
console.log(`Wrote ${OUTPUT}`);
console.log(`  files : ${entries.length}`);
console.log(`  lines : ${totalLines.toLocaleString()}`);
console.log(`  size  : ${humanSize(Buffer.byteLength(markdown))} of Markdown`);
console.log(`  branch: ${branch} @ ${commit}`);
