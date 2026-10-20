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
  const scripts = [read('api.js'), read('app.js')];
  scripts.forEach((s, i) => {
    if (/<\/script/i.test(s)) throw new Error('A client script contains a closing script tag: ' + ['api.js', 'app.js'][i]);
  });
  const css = read('styles.css');
  if (/<\/style/i.test(css)) throw new Error('styles.css contains a closing style tag');
  // String replacers are functions on purpose: the files contain $ characters.
  return read('index.html')
    .replace('<!--STYLES-->', () => '<style>\n' + css + '\n</style>')
    .replace('<!--VIEWS-->', () => views)
    .replace('<!--SCRIPTS-->', () => '<script>window.TLMI_TRANSPORT = ' + JSON.stringify(transport) + ';</script>\n<script>\n' + scripts[0] + '\n</script>\n<script>\n' + scripts[1] + '\n</script>');
}

module.exports = { assemblePage };
