const fs = require('fs');
/** Load a source file as LF text, remembering whether it was CRLF so it can be written back the same way. */
exports.open = (p) => {
  const raw = fs.readFileSync(p, 'utf8');
  const crlf = raw.includes('\r\n');
  let text = raw.replace(/\r\n/g, '\n');
  return {
    rep(a, b, all = false) {
      if (!text.includes(a)) throw new Error('missing in ' + p + ': ' + a.slice(0, 100));
      text = all ? text.split(a).join(b) : text.replace(a, () => b);
    },
    has: (a) => text.includes(a),
    get text() { return text; },
    set text(v) { text = v; },
    save() { fs.writeFileSync(p, crlf ? text.replace(/\n/g, '\r\n') : text); },
  };
};
