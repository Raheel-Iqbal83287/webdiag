import { crawlLocalFolder } from './server/src/crawler/local-folder.js';
import { runAudit } from './server/src/engine/orchestrator.js';
import { canAutoFix, autoFix } from './server/src/engine/auto-fix/index.js';

const folder = 'D:\\philoweb';
const files = await crawlLocalFolder(folder);
console.log('Files:', files.length);

const results = await runAudit(files, 'fix-all');
let total = 0, fixable = 0, fixableIssues: any[] = [];

for (const m of results.moduleResults) {
  const f = m.issues.filter(i => canAutoFix(i, files));
  fixableIssues.push(...f);
  total += m.issues.length;
  fixable += f.length;
  if (f.length > 0) console.log(m.moduleId, 'fixable:', f.length, '/', m.issues.length);
}

console.log('\nTotal:', total, 'Remaining fixable:', fixable);

if (fixable > 0) {
  // Dry run first
  console.log('\n=== DRY RUN ===');
  const dry = autoFix(fixableIssues, files, { dryRun: true });
  dry.forEach(r => {
    if (r.diff) console.log(r.filePath + ' (' + r.issueId + '): ' + r.description);
  });
  console.log('Dry-run results:', dry.filter(r => r.success).length, 'would be fixed');

  // Apply for real
  console.log('\n=== APPLYING FIXES ===');
  const live = autoFix(fixableIssues, files, { dryRun: false });
  const succeeded = live.filter(r => r.success).length;
  const failed = live.filter(r => !r.success).length;
  live.forEach(r => console.log(r.filePath + ' (' + r.issueId + '): ' + (r.success ? 'OK' : 'FAIL') + ' - ' + r.description));
  console.log('\nResults:', succeeded, 'succeeded,', failed, 'failed');
} else {
  console.log('No fixable issues remaining.');
}
