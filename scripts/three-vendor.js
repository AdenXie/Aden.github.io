'use strict';

// three.js for the 3D scenes (source/js/scenes/), served from node_modules at a
// versioned path so the scenes can import it by URL without an import map.
const fs = require('node:fs');
const path = require('node:path');

if (typeof hexo !== 'undefined') {
  const dir = path.join(hexo.base_dir, 'node_modules/three');
  const { version } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  hexo.extend.generator.register('three-vendor', () => ({
    path: `js/vendor/three-${version}.module.min.js`,
    data: () => fs.createReadStream(path.join(dir, 'build/three.module.min.js'))
  }));
}
