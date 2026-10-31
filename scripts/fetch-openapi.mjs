#!/usr/bin/env node
/**
 * Copies backend_demo's openapi.json into this repo at a pinned version, and
 * records exactly which version in api/openapi.lock.json.
 *
 *   npm run api:fetch -- api-v0.2.0            pin to a tag (the normal case)
 *   npm run api:fetch -- --commit <full-sha>   pin to a commit that has no tag yet
 *   npm run api:fetch -- --check               verify the committed copy against the lock (no network)
 *
 * After fetching it regenerates src/api/schema.d.ts. Commit api/ and the
 * schema together: the build never reaches out to the backend, so every
 * build of a given frontend_demo commit uses the same contract.
 *
 * Uses git (not the GitHub API), so it works anywhere `git fetch` does.
 * BACKEND_REPO_URL overrides the source repository, e.g. for a fork.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SPEC = join(ROOT, 'api', 'openapi.json');
const LOCK = join(ROOT, 'api', 'openapi.lock.json');
const DEFAULT_REPO =
  'https://github.com/keerthanarameshdasari-hub/backend_demo';
const TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SHA = /^[0-9a-f]{40}$/;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

function fail(message) {
  // ::error makes it a PR annotation in GitHub Actions; elsewhere it's just a prefix.
  console.error(
    `${process.env.GITHUB_ACTIONS ? '::error::' : 'error: '}${message}`,
  );
  process.exit(1);
}

function parseSpec(bytes, where) {
  let spec;
  try {
    spec = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(`${where} is not valid JSON`);
  }
  if (
    typeof spec?.openapi !== 'string' ||
    typeof spec?.info?.version !== 'string' ||
    typeof spec?.paths !== 'object'
  ) {
    fail(
      `${where} does not look like an OpenAPI document (needs openapi, info.version and paths)`,
    );
  }
  return spec;
}

function check() {
  let lock;
  try {
    lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  } catch {
    fail(
      'api/openapi.lock.json is missing or not JSON. Run `npm run api:fetch -- <tag>`.',
    );
  }
  const bytes = readFileSync(SPEC);
  const spec = parseSpec(bytes, 'api/openapi.json');
  if (sha256(bytes) !== lock.sha256) {
    fail(
      'api/openapi.json does not match api/openapi.lock.json. Never edit it by hand: run `npm run api:fetch -- <tag>`.',
    );
  }
  if (spec.info.version !== lock.apiVersion)
    fail('api/openapi.lock.json apiVersion does not match the spec');
  if (!SHA.test(lock.commit ?? ''))
    fail('api/openapi.lock.json has no full commit SHA');

  const pinned = lock.tag ? `tag ${lock.tag}` : 'an untagged commit';
  console.log(
    `api/openapi.json: backend API ${
      lock.apiVersion
    }, ${pinned} (${lock.commit.slice(0, 12)}), sha256 ok`,
  );
  if (!lock.tag) {
    const message = `The API spec is pinned to commit ${lock.commit.slice(
      0,
      12,
    )}, which has no tag. Tag it in backend_demo and run \`npm run api:fetch -- <tag>\`.`;
    console.log(
      process.env.GITHUB_ACTIONS
        ? `::warning file=api/openapi.lock.json::${message}`
        : `warning: ${message}`,
    );
  }
}

function fetchSpec(ref) {
  const repo = process.env.BACKEND_REPO_URL ?? DEFAULT_REPO;
  const dir = mkdtempSync(join(tmpdir(), 'backend-spec-'));
  try {
    git(dir, 'init', '--quiet', '--bare');
    // A tag is fetched by its full ref name, so a branch called the same can't be picked by mistake.
    const remoteRef = ref.kind === 'tag' ? `refs/tags/${ref.name}` : ref.name;
    try {
      git(
        dir,
        'fetch',
        '--quiet',
        '--depth',
        '1',
        '--no-tags',
        repo,
        remoteRef,
      );
    } catch (error) {
      fail(
        `could not fetch ${ref.kind} ${ref.name} from ${repo}: ${
          error.stderr?.toString().trim() || error.message
        }`,
      );
    }
    const commit = git(dir, 'rev-parse', 'FETCH_HEAD^{commit}')
      .toString()
      .trim();
    let bytes;
    try {
      bytes = git(dir, 'show', 'FETCH_HEAD:openapi.json');
    } catch {
      fail(
        `${ref.kind} ${ref.name} (${commit.slice(
          0,
          12,
        )}) has no openapi.json at the repository root`,
      );
    }
    return { repo, commit, bytes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function pin(ref) {
  const { repo, commit, bytes } = fetchSpec(ref);
  const spec = parseSpec(bytes, `openapi.json at ${ref.name}`);

  writeFileSync(SPEC, bytes);
  const lock = {
    $comment:
      'Written by `npm run api:fetch`. Records which backend_demo openapi.json is in api/openapi.json.',
    repository: repo,
    tag: ref.kind === 'tag' ? ref.name : null,
    commit,
    apiVersion: spec.info.version,
    sha256: sha256(bytes),
  };
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(
    `Pinned backend API ${lock.apiVersion} from ${ref.kind} ${
      ref.name
    } (${commit.slice(0, 12)})`,
  );

  execFileSync('npm', ['run', '--silent', 'api:generate'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  console.log(
    'Regenerated src/api/schema.d.ts. Run `npm run typecheck` to see what the new contract breaks.',
  );
}

const args = process.argv.slice(2);
if (args[0] === '--check' && args.length === 1) {
  check();
} else if (args[0] === '--commit' && args.length === 2) {
  if (!SHA.test(args[1])) fail('--commit needs a full 40-character commit SHA');
  pin({ kind: 'commit', name: args[1] });
} else if (args.length === 1 && TAG.test(args[0]) && !args[0].startsWith('-')) {
  pin({ kind: 'tag', name: args[0] });
} else {
  fail('usage: npm run api:fetch -- <tag> | --commit <sha> | --check');
}
