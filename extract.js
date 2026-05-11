const fs = require('fs');
const s = fs.readFileSync('C:/Users/EnderMythex/Downloads/docker activitée/h256_page.js', 'utf8');

const start = s.indexOf('let S="');
console.log('start', start);

let i = start + 5;
let depthParen = 0, inStr = false, strCh = null, esc = false;
for (; i < s.length; i++) {
  const c = s[i];
  if (esc) { esc = false; continue; }
  if (c === '\\') { esc = true; continue; }
  if (inStr) {
    if (c === strCh) { inStr = false; }
    continue;
  } else {
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
    if (c === '(') { depthParen++; continue; }
    if (c === ')') { depthParen--; continue; }
    if (c === ';' && depthParen === 0) { break; }
  }
}
console.log('end at', i, 'len', i - start);
const stmt = s.slice(start, i + 1);
fs.writeFileSync('C:/Users/EnderMythex/Downloads/docker activitée/S_stmt.js', stmt + '\nrequire("fs").writeFileSync("C:/Users/EnderMythex/Downloads/docker activitée/shader.wgsl", S);');
console.log('wrote S_stmt.js');
