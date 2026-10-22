#!/usr/bin/env node
/**
 * render-docs.js — Generates rich HTML companion fragments from .md files.
 *
 * Usage:
 *   node scripts/render-docs.js              # render all configured docs
 *   node scripts/render-docs.js SCHEMA.md    # render one specific doc
 *
 * Output goes to devdocs/rendered/<Name>.html (HTML fragments, no <html>/<body>)
 */

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const ROOT = path.resolve(__dirname, '..');
const DEVDOCS = path.join(ROOT, 'devcontrol', 'devdocs');
const RENDERED = path.join(DEVDOCS, 'rendered');

// ── Doc config: maps filename → visual theme + metadata ──
const DOC_CONFIG = {
  'SCHEMA.md':         { theme: 'schema',   accent: '#6366f1', icon: '🗄️',  title: 'Database Schema' },
  'API.md':            { theme: 'api',      accent: '#0ea5e9', icon: '🌐',  title: 'API Reference', root: true },
  'ARCHITECTURE.md':   { theme: 'arch',     accent: '#0ea5e9', icon: '🏗️',  title: 'System Architecture', root: true },
  'PATTERNS.md':       { theme: 'code',     accent: '#e879f9', icon: '🎨',  title: 'UI Patterns & Tokens' },
  'KEY-FILES.md':      { theme: 'filetree', accent: '#14b8a6', icon: '📁',  title: 'Project File Map' },
  'DEPLOY.md':         { theme: 'workflow', accent: '#22c55e', icon: '🚀',  title: 'Deployment Workflow' },
  'CHANGELOG.md':      { theme: 'timeline', accent: '#64748b', icon: '📋',  title: 'Changelog' },
  'INTEGRATIONS.md':   { theme: 'vendors',  accent: '#f97316', icon: '🔌',  title: 'Integrations & Vendors' },
  'HOMEAUTOMATION.md': { theme: 'dashboard',accent: '#f59e0b', icon: '🏠',  title: 'Home Automation' },
  'LIGHTINGAUTOMATION.md': { theme: 'dashboard', accent: '#f59e0b', icon: '💡', title: 'Lighting Control' },
  'PRODUCTDESIGN.md':  { theme: 'decisions',accent: '#a855f7', icon: '🧭',  title: 'Product Design Decisions', root: true },
  'CREDENTIALS.md':    { theme: 'secure',   accent: '#ef4444', icon: '🔑',  title: 'Credentials & Secrets' },
  'SECRETS-GUIDE.md':  { theme: 'secure',   accent: '#ef4444', icon: '🛡️',  title: 'Secrets Management Guide' },
  'TESTING-GUIDE.md':  { theme: 'workflow', accent: '#22c55e', icon: '✅',  title: 'Testing Guide' },
  'home-assistant-lighting-design.md': { theme: 'dashboard', accent: '#f59e0b', icon: '💡', title: 'HAOS Lighting Architecture' },
  'LOCAL-AI-SETUP.md': { theme: 'dashboard', accent: '#a855f7', icon: '🤖', title: 'Local AI Setup' },
  'CAD.md':            { theme: 'arch',     accent: '#0ea5e9', icon: '📐',  title: 'CAD Tool Reference' },
  'CAD-SITE-PLANS.md': { theme: 'workflow', accent: '#14b8a6', icon: '🗺️',  title: 'Site Plan Workflows' },
  'CAD-RENDER-PIPELINE.md': { theme: 'workflow', accent: '#14b8a6', icon: '🎬', title: '3D Render Pipeline' },
};

// ── Syntax highlighting (simple token-based) ──
function highlightCode(code, lang) {
  const l = (lang || '').toLowerCase();
  if (!l || l === 'text' || l === 'plaintext') return escHtml(code);

  let escaped = escHtml(code);

  if (l === 'bash' || l === 'sh' || l === 'shell') {
    escaped = escaped
      .replace(/(#[^\n]*)/g, '<span class="dv-cmt">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="dv-str">$1</span>')
      .replace(/('(?:[^'\\]|\\.)*')/g, '<span class="dv-str">$1</span>')
      .replace(/\b(sudo|curl|git|npm|node|ssh|sshpass|docker|brew|cat|echo|export|cd|ls|mkdir|cp|mv|rm|chmod|chown|kill|ps|grep|awk|sed|find|head|tail|wc)\b/g, '<span class="dv-kw">$1</span>')
      .replace(/(\$\w+|\$\{[^}]+\})/g, '<span class="dv-fn">$1</span>');
  } else if (l === 'json') {
    escaped = escaped
      .replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span class="dv-prop">$1</span>:')
      .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span class="dv-str">$1</span>')
      .replace(/:\s*(\d+(?:\.\d+)?)/g, ': <span class="dv-num">$1</span>')
      .replace(/:\s*(true|false|null)\b/g, ': <span class="dv-kw">$1</span>');
  } else if (l === 'javascript' || l === 'js') {
    escaped = escaped
      .replace(/(\/\/[^\n]*)/g, '<span class="dv-cmt">$1</span>')
      .replace(/\b(const|let|var|function|async|await|return|if|else|for|while|import|export|from|class|new|this|try|catch|throw)\b/g, '<span class="dv-kw">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="dv-str">$1</span>')
      .replace(/('(?:[^'\\]|\\.)*')/g, '<span class="dv-str">$1</span>')
      .replace(/(`(?:[^`\\]|\\.)*`)/g, '<span class="dv-str">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="dv-num">$1</span>');
  } else if (l === 'sql') {
    escaped = escaped
      .replace(/(--[^\n]*)/g, '<span class="dv-cmt">$1</span>')
      .replace(/\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|JOIN|LEFT|RIGHT|INNER|ON|AND|OR|NOT|IN|IS|NULL|AS|ORDER|BY|GROUP|HAVING|LIMIT|SET|INTO|VALUES|TABLE|INDEX|PRIMARY|KEY|FOREIGN|REFERENCES|DEFAULT|UNIQUE|CASCADE|CONSTRAINT|EXISTS|BOOLEAN|TEXT|INTEGER|UUID|JSONB|TIMESTAMPTZ|BIGINT|SERIAL)\b/gi, '<span class="dv-kw">$1</span>')
      .replace(/('(?:[^'\\]|\\.)*')/g, '<span class="dv-str">$1</span>');
  }
  return escaped;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Custom marked renderer ──
function createRenderer(config) {
  const renderer = new marked.Renderer();

  // Tables → wrapped in dv-table-wrap
  renderer.table = function({ header, rows }) {
    const headerCells = header.map(h => `<th>${h.text}</th>`).join('');
    const bodyRows = rows.map(row =>
      `<tr>${row.map(cell => `<td>${cell.text}</td>`).join('')}</tr>`
    ).join('\n');
    return `<div class="dv-table-wrap"><table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
  };

  // Code blocks → wrapped with header + copy button + syntax highlighting
  renderer.code = function({ text, lang }) {
    const language = (lang || 'text').toLowerCase();
    const highlighted = highlightCode(text, language);
    const id = 'cb-' + Math.random().toString(36).slice(2, 8);
    return `<div class="dv-code-wrap">
      <div class="dv-code-header">
        <span class="dv-code-lang">${escHtml(language)}</span>
        <button class="dv-copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('${id}').textContent).then(()=>{this.textContent='Copied!';this.classList.add('copied');setTimeout(()=>{this.textContent='Copy';this.classList.remove('copied')},1500)})">Copy</button>
      </div>
      <pre><code id="${id}">${highlighted}</code></pre>
    </div>`;
  };

  // Blockquotes → styled
  renderer.blockquote = function({ text }) {
    return `<blockquote>${text}</blockquote>`;
  };

  return renderer;
}

// ── Post-processing per theme ──
function postProcess(html, config) {
  const { theme, accent } = config;

  // Add type pills for schema docs
  if (theme === 'schema') {
    html = html
      .replace(/\b(uuid)\b(?![^<]*<\/)/gi, '<span class="dv-pill dv-pill-uuid">uuid</span>')
      .replace(/\b(text|varchar)\b(?![^<]*<\/)/gi, '<span class="dv-pill dv-pill-text">text</span>')
      .replace(/\b(boolean)\b(?![^<]*<\/)/gi, '<span class="dv-pill dv-pill-bool">boolean</span>')
      .replace(/\b(integer|int4|bigint|serial)\b(?![^<]*<\/)/gi, '<span class="dv-pill dv-pill-int">$1</span>')
      .replace(/\b(jsonb)\b(?![^<]*<\/)/gi, '<span class="dv-pill dv-pill-jsonb">jsonb</span>')
      .replace(/\b(timestamptz|timestamp)\b(?![^<]*<\/)/gi, '<span class="dv-pill dv-pill-ts">$1</span>');
  }

  // Add secure banner for credentials docs
  if (theme === 'secure') {
    html = `<div class="dv-secure-banner">🔒 This document contains sensitive access information. Do not share or commit credential values.</div>` + html;
  }

  return html;
}

// ── Make sections collapsible ──
function makeCollapsible(html) {
  // Convert h2 sections into <details> blocks
  // Split on h2 tags, wrap each section
  const parts = html.split(/(<h2[^>]*>.*?<\/h2>)/);
  if (parts.length <= 1) return html;

  let result = '';
  let firstSection = true;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.match(/^<h2/)) {
      // Close previous details if not first
      if (!firstSection) result += '</div></details>';
      const title = part.replace(/<\/?h2[^>]*>/g, '');
      const open = firstSection ? ' open' : '';
      result += `<details${open}><summary>${title}</summary><div class="dv-section-body">`;
      firstSection = false;
    } else {
      result += part;
    }
  }
  if (!firstSection) result += '</div></details>';
  return result;
}

// ── Generate TOC ──
function generateTOC(markdown) {
  const headings = [];
  const lines = markdown.split('\n');
  for (const line of lines) {
    const m = line.match(/^(#{2,3})\s+(.+)/);
    if (m) {
      const level = m[1].length;
      const text = m[2].trim();
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      headings.push({ level, text, id });
    }
  }
  if (headings.length < 3) return '';

  const items = headings.map(h => {
    const indent = h.level === 3 ? 'margin-left:1rem;' : '';
    return `<a href="#${h.id}" style="display:block;padding:0.2rem 0;color:var(--text-muted,#666);text-decoration:none;font-size:0.75rem;${indent}" onclick="event.preventDefault();document.getElementById('${h.id}')?.scrollIntoView({behavior:'smooth'})">${escHtml(h.text)}</a>`;
  }).join('');

  return `<details open style="margin-bottom:1rem;"><summary style="font-size:0.75rem;font-weight:600;color:var(--text-muted,#888);">Contents</summary><nav style="padding:0.25rem 0.75rem;">${items}</nav></details>`;
}

// ── Main render function ──
function renderDoc(filename) {
  const config = DOC_CONFIG[filename];
  if (!config) {
    console.log(`  ⏭ ${filename} — no config, skipping`);
    return false;
  }

  // Find the file
  const filePath = config.root
    ? path.join(ROOT, filename)
    : path.join(DEVDOCS, filename);

  if (!fs.existsSync(filePath)) {
    console.log(`  ❌ ${filename} — file not found at ${filePath}`);
    return false;
  }

  const markdown = fs.readFileSync(filePath, 'utf-8');

  // Configure marked
  marked.setOptions({
    gfm: true,
    breaks: false,
  });
  marked.use({ renderer: createRenderer(config) });

  // Add IDs to headings for TOC
  const mdWithIds = markdown.replace(/^(#{2,3})\s+(.+)/gm, (match, hashes, text) => {
    const id = text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${hashes} <span id="${id}"></span>${text}`;
  });

  // Render markdown → HTML
  let html = marked.parse(mdWithIds);

  // Post-process per theme
  html = postProcess(html, config);

  // Make h2 sections collapsible
  html = makeCollapsible(html);

  // Generate TOC
  const toc = generateTOC(markdown);

  // Build final fragment
  const fragment = `<!-- Generated by render-docs.js — do not edit manually -->
<!-- Source: ${filename} | Theme: ${config.theme} | Generated: ${new Date().toISOString().split('T')[0]} -->
<div class="dv-root" data-theme="${config.theme}" style="--doc-accent: ${config.accent};">
  <div class="dv-header">
    <div class="dv-header-icon" style="background: ${config.accent};">${config.icon}</div>
    <div>
      <h1>${escHtml(config.title)}</h1>
      <p class="dv-subtitle">${escHtml(filename)} · ${markdown.split('\n').length} lines</p>
    </div>
  </div>
  ${toc}
  ${html}
</div>`;

  // Write output
  const outPath = path.join(RENDERED, filename.replace('.md', '.html'));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, fragment, 'utf-8');
  console.log(`  ✓ ${filename} → ${path.relative(ROOT, outPath)}`);
  return true;
}

// ── CLI ──
const targetFile = process.argv[2];
if (targetFile) {
  console.log('Rendering single doc:');
  renderDoc(targetFile);
} else {
  console.log('Rendering all configured docs:');
  let count = 0;
  for (const filename of Object.keys(DOC_CONFIG)) {
    if (renderDoc(filename)) count++;
  }
  console.log(`\nDone: ${count} files rendered to devdocs/rendered/`);
}
