const path = require('path');
const fs = require('fs');

// Simulate resolveAnyPath logic
const raw = '../../knowledge_base/files/雨夜氛围描写参考.md';
let cleaned = raw.replace(/\\/g, '/').replace(/\/+/g, '/');
while (cleaned.startsWith('../')) cleaned = cleaned.slice(3);
const appRoot = 'd:/3/novel-writing-app';
const resolved = path.resolve(appRoot, cleaned);
console.log('Path:', raw);
console.log('Cleaned:', cleaned);
console.log('Resolved:', resolved);
console.log('Exists:', fs.existsSync(resolved));

// Also test with fileToolHandler's resolvePath approach
const projectPath = 'd:/3/novel-writing-app/projects';
const parentDir = path.dirname(projectPath);
const fromParent = path.join(parentDir, 'knowledge_base', 'files', '雨夜氛围描写参考.md');
console.log('\nFrom parentDir:', fromParent);
console.log('Exists:', fs.existsSync(fromParent));
