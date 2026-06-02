const cache = new Map();

function setFileCache(path, content, projectId) {
  if (cache.has(path)) cache.delete(path);
  cache.set(path, { content, size: content.length, projectId: projectId ?? null });
}

function getFileCache(path) {
  const e = cache.get(path);
  if (e) { cache.delete(path); cache.set(path, e); }
  return e?.content;
}

function normalizePath(p) {
  p = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  while (p.startsWith('../')) p = p.slice(3);
  if (p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function invalidateProjectFiles(pid) {
  for (const [k, v] of cache.entries()) {
    if (v.projectId === pid) cache.delete(k);
  }
}

function clearAllFileCache() { cache.clear(); }

let pass = 0, fail = 0;
function check(desc, condition) {
  if (condition) { console.log('PASS: ' + desc); pass++; }
  else { console.log('FAIL: ' + desc); fail++; }
}

// Test 1: Cache with null projectId
console.log('=== Test 1: Global file caching (null projectId) ===');
setFileCache('style_templates/template.json', '{"dimensions":{"narrativeTone":"test"}}', null);
const hit1 = getFileCache('style_templates/template.json');
check('set/get with null projectId', hit1 !== undefined);

// Test 2: Path normalization
console.log('');
console.log('=== Test 2: Path normalization ===');
const p1 = '../../style_templates/template.json';
const p2 = normalizePath(p1);
console.log('  Input: ' + p1);
console.log('  Normalized: ' + p2);
setFileCache(p2, 'normalized-content', null);
const hit2 = getFileCache(p2);
check('normalized path lookup', hit2 !== undefined);

// Test 3: True LRU (get bumps to MRU)
console.log('');
console.log('=== Test 3: True LRU (cap=2) ===');
const lru = new Map();
function setL(p, c) {
  if (lru.has(p)) lru.delete(p);
  lru.set(p, { content: c });
  while (lru.size > 2) { const f = lru.keys().next().value; lru.delete(f); console.log('  Evicted: ' + f); }
}
function getL(p) {
  const e = lru.get(p);
  if (e) { lru.delete(p); lru.set(p, e); }
  return e?.content;
}
setL('a.txt', 'A');
setL('b.txt', 'B');
setL('c.txt', 'C'); // a evicted
check('a evicted after c inserted', getL('a.txt') === undefined);
getL('b.txt'); // access b → bump to MRU
setL('a.txt', 'A2'); // c evicted (b was bumped)
check('c evicted after a re-inserted (b had LRU bump)', getL('c.txt') === undefined && getL('b.txt') !== undefined);

// Test 4: Scoped invalidation preserves globals
console.log('');
console.log('=== Test 4: Scoped invalidation ===');
clearAllFileCache();  // clean slate
console.log('  Cleared: ' + cache.size + ' entries');
setFileCache('1/chapters/ch1.txt', 'chapter one', '1');
setFileCache('1/characters/x.json', 'x', '1');
setFileCache('style_templates/t.json', 'tpl', null);
setFileCache('1/outline/plot.md', 'plot', '1');
console.log('  Before: ' + cache.size + ' entries');
invalidateProjectFiles('1');
console.log('  After: ' + cache.size + ' entries');
const keys4 = [...cache.keys()];
console.log('  Keys: ' + keys4.join(', '));
check('globals survive (style_templates/ only)', keys4.length === 1 && keys4[0].includes('style_templates'));

// Test 5: Full clear
console.log('');
console.log('=== Test 5: Full clear ===');
clearAllFileCache();
check('clear empties cache', cache.size === 0);
check('get returns undefined after clear', getFileCache('style_templates/t.json') === undefined);

// Test 6: Backslash path normalization
console.log('');
console.log('=== Test 6: Backslash normalization ===');
setFileCache(normalizePath('chapters\\ch1.txt'), 'content', '1');
const hit6 = getFileCache(normalizePath('chapters/ch1.txt'));
check('backslash→slash lookup', hit6 !== undefined);

// Test 7: Duplicate slash
console.log('');
console.log('=== Test 7: Duplicate slash ===');
setFileCache(normalizePath('chapters//ch1.txt'), 'dup', '1');
const hit7 = getFileCache(normalizePath('chapters/ch1.txt'));
check('duplicate slash collapsed', hit7 !== undefined);

console.log('');
console.log('=== RESULT: ' + pass + '/' + (pass + fail) + ' passed ===');
process.exit(fail > 0 ? 1 : 0);
