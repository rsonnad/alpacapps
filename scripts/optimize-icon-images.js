#!/usr/bin/env node
/**
 * Optimize alpaca head icon loading across all HTML files
 * Adds width, height, fetchpriority, decoding, and loading attributes
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Find all HTML files with icon images
const findCommand = `grep -rl 'alpaca-head-.*-transparent\\.png' --include='*.html' .`;
let files;
try {
  files = execSync(findCommand, { encoding: 'utf-8', cwd: __dirname + '/..' })
    .trim()
    .split('\n')
    .filter(f => f && !f.includes('node_modules'));
} catch (e) {
  console.error('Error finding files:', e.message);
  process.exit(1);
}

console.log(`Found ${files.length} HTML files with icon images`);

let totalChanges = 0;

files.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  let content = fs.readFileSync(filePath, 'utf-8');
  let changed = false;

  // Pattern 1: Header icons (high priority, async decoding, with dimensions)
  // Match: <img src="...alpaca-head-...-transparent.png" ... class="aap-header__icon" ...>
  const headerPattern = /(<img\s+[^>]*class="aap-header__icon"[^>]*>)/g;
  content = content.replace(headerPattern, (match) => {
    // Skip if already optimized
    if (match.includes('fetchpriority') && match.includes('width')) {
      return match;
    }

    let optimized = match;

    // Add width if not present (height is usually there)
    if (!match.includes('width=')) {
      optimized = optimized.replace(/class="aap-header__icon"/, 'width="30" class="aap-header__icon"');
    }

    // Add fetchpriority and decoding if not present
    if (!match.includes('fetchpriority=')) {
      optimized = optimized.replace(/class="aap-header__icon"/, 'fetchpriority="high" class="aap-header__icon"');
    }
    if (!match.includes('decoding=')) {
      optimized = optimized.replace(/class="aap-header__icon"/, 'decoding="async" class="aap-header__icon"');
    }

    if (optimized !== match) {
      changed = true;
      totalChanges++;
    }
    return optimized;
  });

  // Pattern 2: Footer icons (lazy load, async decoding, with dimensions)
  // Match: <img src="...alpaca-head-...-transparent.png" ... class="aap-footer__icon" ...>
  const footerPattern = /(<img\s+[^>]*class="aap-footer__icon"[^>]*>)/g;
  content = content.replace(footerPattern, (match) => {
    // Skip if already optimized
    if (match.includes('loading') && match.includes('width')) {
      return match;
    }

    let optimized = match;

    // Add width if not present
    if (!match.includes('width=')) {
      optimized = optimized.replace(/class="aap-footer__icon"/, 'width="52" class="aap-footer__icon"');
    }

    // Add loading and decoding if not present
    if (!match.includes('loading=')) {
      optimized = optimized.replace(/class="aap-footer__icon"/, 'loading="lazy" class="aap-footer__icon"');
    }
    if (!match.includes('decoding=')) {
      optimized = optimized.replace(/class="aap-footer__icon"/, 'decoding="async" class="aap-footer__icon"');
    }

    if (optimized !== match) {
      changed = true;
      totalChanges++;
    }
    return optimized;
  });

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`✓ Optimized: ${file}`);
  }
});

console.log(`\nComplete! Applied ${totalChanges} optimizations across ${files.length} files.`);
