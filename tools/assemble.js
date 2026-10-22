'use strict';
// Puts the client files into the one HTML page that an Apps Script web app can serve:
// the CSS, the views (templates) and the scripts are inlined into src/client/index.html.
const fs = require('node:fs');
const path = require('node:path');

function assemblePage(srcDir, transport) {
  const read = (rel) => fs.readFileSync(path.join(srcDir, rel), 'utf8');
  const viewsDir = path.join(srcDir, 'views');
  const views = fs.existsSync(viewsDir)
    ? fs.readdirSync(viewsDir).filter((f) => f.endsWith('.html')).sort().map((f) => read(path.join('views', f))).join('\n')
    : '';
  // Every src/client/*.js file: api.js first, then app.js, then the others in name order.
  const first = ['api.js', 'app.js'];
  const others = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js') && first.indexOf(f) < 0).sort();
  const names = first.concat(others);
  const scripts = names.map((n) => read(n));
  scripts.forEach((s, i) => {
    if (/<\/script/i.test(s)) throw new Error('A client script contains a closing script tag: ' + names[i]);
  });
  const css = read('styles.css');
  if (/<\/style/i.test(css)) throw new Error('styles.css contains a closing style tag');
  // String replacers are functions on purpose: the files contain $ characters.
  return read('index.html')
    .replace('<!--STYLES-->', () => '<style>\n' + css + '\n</style>')
    .replace('<!--VIEWS-->', () => views)
    .replace('<!--SCRIPTS-->', () => '<script>window.TLMI_TRANSPORT = ' + JSON.stringify(transport) + ';</script>\n<script>\n' + scripts[0] + '\n</script>\n' + scripts.slice(1).map((c) => '<script>\n' + c + '\n</script>').join('\n'));
}

module.exports = { assemblePage };
