/**
 * Break-glass path: publish the personal files from this machine.
 *
 * The site writes through the GitHub API from the browser, which is how cards get added
 * in a shop. When that path is unavailable — token expired, a bad deploy, no phone — this
 * does the same work from a laptop: re-encrypt what is in .local/, rebuild the public
 * derived files, validate everything, and commit.
 *
 *   PERSONAL_PASSWORD_ADMIN=… node scripts/admin-commit.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });

const run = (command, args) => {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit' });
};

const capture = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();

run('node', ['scripts/encrypt-personal.mjs']);
run('node', ['scripts/build-watchlist.mjs']);
run('node', ['scripts/validate.mjs']);
run('node', ['scripts/test-crypto.mjs']); // against the real vault

const changed = capture('git', ['status', '--porcelain', 'public/data']);
if (!changed) {
  console.log('\nnothing changed');
  process.exit(0);
}

console.log(`\nchanged:\n${changed}`);

// The working copies hold purchase prices in the clear. If one has ever been staged the
// commit must not proceed, because git history cannot be un-published.
const staged = capture('git', ['status', '--porcelain', '--ignored', '.local']);
if (staged.split('\n').some((line) => line.startsWith('A ') || line.startsWith('M '))) {
  console.error('\n.local/ has tracked changes. Refusing to commit: that would publish plaintext.');
  process.exit(1);
}

if (options['dry-run']) {
  console.log('\ndry run, nothing committed');
  process.exit(0);
}

run('git', ['add', 'public/data']);
run('git', ['commit', '-m', `chore(personal): publish from laptop ${new Date().toISOString().slice(0, 10)}`]);
run('git', ['push']);
console.log('\npublished');
