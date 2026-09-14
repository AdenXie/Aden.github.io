'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createFont, woff2 } = require('fonteditor-core');
async function subsetIcons(out, files) {
  const used = new Set();
  for (const file of files.filter(f => /\.(?:html|js)$/.test(f) && !/[\\/]libs[\\/]/.test(f))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/\bfa-[a-z0-9-]+/g)) used.add(match[0]);
  }
  const points = new Set();
  for (const cssName of ['fontawesome.min.css', 'brands.min.css', 'solid.min.css', 'regular.min.css']) {
    const css = fs.readFileSync(path.join(out, 'fontawesome', cssName), 'utf8');
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
      const content = /content:\s*["']\\([0-9a-f]+)["']/i.exec(rule[2]);
      if (content && [...rule[1].matchAll(/\.(fa-[a-z0-9-]+)/g)].some(m => used.has(m[1]))) points.add(parseInt(content[1], 16));
    }
  }
  if (points.size < 10) throw new Error('Font Awesome mapping changed; review the subset builder');
  await woff2.init();
  const subset = [...points].sort((a, b) => a - b);
  for (const font of ['fa-solid-900', 'fa-regular-400', 'fa-brands-400']) {
    const data = createFont(fs.readFileSync(path.join(out, 'webfonts', `${font}.ttf`)), { type: 'ttf', subset, hinting: true });
    fs.writeFileSync(path.join(out, 'webfonts', `${font}-site.woff2`), data.write({ type: 'woff2', hinting: true }));
  }
  return subset.map(p => `U+${p.toString(16)}`).join(',');
}
module.exports = { subsetIcons };
