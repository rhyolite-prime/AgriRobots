#!/usr/bin/env node
/**
 * Documentation link check.
 *
 * The design package is the entry point for engineers, suppliers and reviewers.
 * A broken relative link hides a requirement, a drawing or an evidence template,
 * so every relative Markdown link and image reference must resolve.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.nuxt', '.output', 'coverage']);

const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HTML_SRC = /<(?:img|a)\s[^>]*(?:src|href)="([^"]+)"/gi;

function isExternal(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

function markdownFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) markdownFiles(path.join(dir, entry.name), found);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

/** Removes fenced code blocks so example paths are not treated as links. */
function stripCodeFences(text) {
  return text.replace(/^```[\s\S]*?^```/gm, '');
}

const errors = [];
let checked = 0;

for (const file of markdownFiles(REPO_ROOT)) {
  const relativeFile = path.relative(REPO_ROOT, file);
  const text = stripCodeFences(readFileSync(file, 'utf8'));
  const targets = [];

  for (const match of text.matchAll(MARKDOWN_LINK)) targets.push(match[1]);
  for (const match of text.matchAll(HTML_SRC)) targets.push(match[1]);

  for (const raw of targets) {
    if (!raw || raw.startsWith('#') || isExternal(raw)) continue;

    const withoutFragment = raw.split('#')[0].split('?')[0];
    if (!withoutFragment) continue;

    const resolved = path.resolve(path.dirname(file), decodeURIComponent(withoutFragment));
    checked += 1;

    if (!existsSync(resolved)) {
      errors.push(`${relativeFile}: broken link -> ${raw}`);
      continue;
    }
    if (statSync(resolved).isDirectory() && !existsSync(path.join(resolved, 'README.md'))) {
      errors.push(`${relativeFile}: link -> ${raw} points at a directory without a README.md`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Documentation link check failed (${errors.length} problems):\n`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Documentation link check passed (${checked} relative links).`);
