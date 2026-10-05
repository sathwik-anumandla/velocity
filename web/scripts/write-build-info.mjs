import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

let revision = process.env.APP_REVISION;
if (!revision) {
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { revision = 'unknown'; }
}
writeFileSync('dist/build-info.json', JSON.stringify({ revision, built_at: new Date().toISOString() }));
