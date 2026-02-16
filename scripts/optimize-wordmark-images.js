#!/usr/bin/env node
/**
 * Optimize wordmark image loading across all HTML files
 * Adds width, height, fetchpriority, decoding, and loading attributes
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Find all HTML files with wordmark images
const findCommand = `grep -rl 'wordmark-.*-transparent\\.png' --include='*.html' .`;
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

console.log(`Found ${files.length} HTML files with wordmark images`);

let totalChanges = 0;

files.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  let content = fs.readFileSync(filePath, 'utf-8');
  let changed = false;

  // Pattern 1: Header wordmarks (high priority, async decoding, with dimensions)
  // Match: <img src="...wordmark-...-transparent.png" ... class="aap-header__wordmark" ...>
  const headerPattern = /(<img\s+[^>]*class="aap-header__wordmark"[^>]*>)/g;
  content = content.replace(headerPattern, (match) => {
    // Skip if already optimized
    if (match.includes('fetchpriority') && match.includes('width') && match.includes('height')) {
      return match;
    }

    let optimized = match;

    // Add width and height if not present
    if (!match.includes('width=')) {
      optimized = optimized.replace(/class="aap-header__wordmark"/, 'width="175" class="aap-header__wordmark"');
    }
    if (!match.includes('height=')) {
      optimized = optimized.replace(/class="aap-header__wordmark"/, 'height="22" class="aap-header__wordmark"');
    }

    // Add fetchpriority and decoding if not present
    if (!match.includes('fetchpriority=')) {
      optimized = optimized.replace(/class="aap-header__wordmark"/, 'fetchpriority="high" class="aap-header__wordmark"');
    }
    if (!match.includes('decoding=')) {
      optimized = optimized.replace(/class="aap-header__wordmark"/, 'decoding="async" class="aap-header__wordmark"');
    }

    if (optimized !== match) {
      changed = true;
      totalChanges++;
    }
    return optimized;
  });

  // Pattern 2: Footer wordmarks (lazy load, async decoding, with dimensions)
  // Match: <img src="...wordmark-...-transparent.png" ... class="aap-footer__wordmark" ...>
  const footerPattern = /(<img\s+[^>]*class="aap-footer__wordmark"[^>]*>)/g;
  content = content.replace(footerPattern, (match) => {
    // Skip if already optimized
    if (match.includes('loading') && match.includes('width') && match.includes('height')) {
      return match;
    }

    let optimized = match;

    // Add width and height if not present
    if (!match.includes('width=')) {
      optimized = optimized.replace(/class="aap-footer__wordmark"/, 'width="200" class="aap-footer__wordmark"');
    }
    if (!match.includes('height=')) {
      optimized = optimized.replace(/class="aap-footer__wordmark"/, 'height="24" class="aap-footer__wordmark"');
    }

    // Add loading and decoding if not present
    if (!match.includes('loading=')) {
      optimized = optimized.replace(/class="aap-footer__wordmark"/, 'loading="lazy" class="aap-footer__wordmark"');
    }
    if (!match.includes('decoding=')) {
      optimized = optimized.replace(/class="aap-footer__wordmark"/, 'decoding="async" class="aap-footer__wordmark"');
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
