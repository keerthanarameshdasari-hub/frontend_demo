# CI and security checks

This page explains what runs automatically on this repository and why. You don't need to
run any of it yourself; it all happens on GitHub when you open a pull request.

## How code moves

```
feature/* ──PR──▶ dev ──PR──▶ test ──PR──▶ main
```

Every arrow is a pull request, and every pull request into `dev`, `test` or `main` runs two
workflows: **CI** (`.github/workflows/ci.yml`: build and test checks) and **Security**
(`.github/workflows/security.yml`). Security also runs:

- on every push to `dev` (i.e. after a PR merges), so `dev` itself is scanned and the Security
  tab reflects what is actually on the branch;
- every Monday morning, so new problems in code that hasn't changed still get noticed (a
  vulnerability can be discovered in a package years after we added it).

Neither workflow runs on `pull_request_target`, and neither needs secrets.

A pull request can only merge when all of its required checks are green, it is up to date with
the branch it targets, and the other maintainer has approved it (see "Who reviews what").

## The CI jobs

### Lint, format and type check

Runs, in order: `npm run config:check`, `npm run api:check`, `npm run format:check`,
`npm run lint` and `npm run typecheck`.

- **config:check** checks the four environments are wired up the same way everywhere: the env
  files (only public keys, no secret-looking names, `https` outside dev), the Android flavours, the
  iOS build configurations, Podfile and schemes, and that the app version is the same in
  `package.json`, Android and iOS.
- **api:check** checks `api/openapi.json` against `api/openapi.lock.json`, regenerates
  `src/api/schema.d.ts` and fails if the committed copy differs.

*Why:* the env wiring is spread over Gradle, Xcode and the Podfile, and a mismatch there ships the
wrong backend URL or app ID without any compiler noticing. The env files are compiled into the app,
so a secret in one is published to everyone who installs it.

*If it fails:* the log names the file and the setting. For `api:check`, never edit
`api/openapi.json` by hand: run `npm run api:fetch -- <tag>`. For formatting, run `npm run format`.

### Unit and component tests

`npm test`: the unit tests, the component tests that drive the whole app against an in-memory
backend, and the test that every interactive element has a unique `testID`.

### Contract test (pinned backend_demo)

Starts `backend_demo` with `docker compose` at exactly the commit in `api/openapi.lock.json`, then
runs `npm run test:contract`: sign-up, sign-in, KYC upload, top-ups and idempotent retries, through
the app's own API client.

It checks backend_demo out at the tag written on the `ref: ... # backend-pin` lines in the
workflows, not at a ref read from a file while the job runs, so a pull request can't make CI run
another backend commit without changing those lines (which the reviewer sees). After the checkout,
`scripts/verify-backend-pin.sh` checks it is exactly the commit `api/openapi.lock.json` pins, so a
moved tag fails the job. `npm run api:fetch -- <tag>` updates those lines for you, and
`npm run config:check` fails if they ever disagree with the lock. An untagged pin fails CI: tag the
commit in backend_demo first.

*Why:* the component tests use a fake backend, which can drift from the real one. This proves the
app's requests work against the backend version the client was generated from.

*If it fails:* the job prints the backend's logs. If you just moved the pin, the new backend
version changed behaviour the app relies on.

## The Devices workflow (emulator and simulator)

`.github/workflows/devices.yml` builds the **dev** app and runs it on GitHub's machines, so nobody
needs an emulator or simulator on their own laptop. It runs on pull requests that change the app
(`src/`, `android/`, `ios/`, packages, `.env.dev`, `api/`, `e2e/`), and you can start it by hand:
**Actions → Devices → Run workflow**.

| Job | Machine | What it does |
|---|---|---|
| `Android emulator (dev)` | Linux | Starts backend_demo with docker compose, builds the dev release APK, boots an API 35 emulator, and walks the whole journey through the UI: create account, KYC upload with the system file picker, top-up. |
| `iOS simulator (dev)` | macOS | Starts backend_demo without Docker (Postgres, an S3 stand-in and the API), builds the `Dev` scheme in `Release-Dev`, and in the simulator creates an account, approves KYC through the API (the simulator has no files for the picker), relaunches and tops up. |

Both use backend_demo at the pinned tag, checked the same way as for the contract test, with no
shared npm or Gradle caches so backend code can't tamper with caches other runs reuse. [Maestro](https://maestro.dev) drives the app through its testIDs (flows in `e2e/`, scripts in
`scripts/e2e/`). Maestro is pinned and checked against the sha256 GitHub records for its release.

**Reading the results:** open the run and scroll to **Artifacts**. `android-results` and
`ios-results` each hold numbered screenshots of every step, `journey.mp4` (a screen recording),
`final-screen.png`, a JUnit report, Maestro's debug output (with a screenshot of the failing step
when one fails) and logs (`logcat.txt` on Android, `backend-*.log` on iOS).

*If it fails:* look at the failing step's screenshot in Maestro's debug output first. A failure in
the build step is a native build problem; a failure in the journey is an app or test problem.

The jobs are slow (roughly 20–40 minutes each, longest on the first run) and macOS minutes are
expensive on private repositories, which is why they only run when app files change. **Don't add
them to the required checks**: they don't run on every PR, and a required check that never reports
blocks the PR forever.

## The security jobs

### Secret scan (gitleaks)

Looks through **every commit in the history** for things that look like passwords, API keys
and tokens.

*Why:* once a secret is pushed to GitHub, deleting it in a later commit doesn't help. It is
still in the history and anyone who clones the repo can find it. This job catches it in
the PR, before it reaches a shared branch.

*If it fails:* the log shows the file and commit (the secret itself is redacted). Revoke the
secret with whoever issued it first, then remove it from your branch's history.

### Dependency review

Compares the dependencies in your PR with those on the branch you're merging into. It fails if
your PR **adds** a package that has a **high or critical** known vulnerability, or a package
licensed under **GPL or AGPL**.

*Why:* most of the code we ship is other people's. A vulnerable package is an easy way in for
an attacker, and GPL/AGPL licences can oblige us to publish our own source code.

*If it fails:* upgrade to a fixed version, or pick a different package. It only runs on pull
requests, so it shows as "skipped" on pushes to `dev` and the weekly run, which is expected.

### CodeQL (actions) and CodeQL (javascript-typescript)

GitHub's code analyser. It runs once per language, which is why it shows up as two checks:

- **actions** reads our workflow files and looks for things like untrusted input reaching a
  shell script, or a job with more permissions than it uses.
- **javascript-typescript** reads the app (`src/`, `index.js`), `scripts/` and the tests, and
  looks for security bugs such as injection, cross-site scripting and unsafe use of user input.

*Why:* these are the bugs reviewers miss most often, because the dangerous path can run across
several files.

*If it fails:* open the **Security → Code scanning** tab for the explanation and a suggested fix.

**Native code is not analysed yet.** `android/` (Kotlin) and `ios/` (Swift) exist now, but
CodeQL's `java-kotlin` needs a full Gradle build in the job and `swift` needs a macOS runner, so they
are left for a separate change. Adding a language adds a check, so update the rulesets with it
(see "Required checks").

### Workflow audit (zizmor)

Checks our GitHub Actions workflow files for security mistakes: overly broad permissions,
unpinned third-party actions, untrusted input injected into shell scripts, and so on.

*Why:* CI has access to the code and often to deployment credentials. A badly written
workflow is one of the easiest ways to compromise a repository.

### Workflow lint (actionlint)

Checks workflow files for plain mistakes: YAML errors, typos in keys, wrong expression syntax,
and bugs in the shell scripts inside `run:` steps.

*Why:* without it, a typo in a workflow only shows up when the workflow runs, or quietly
makes a job do nothing.

## Rules we follow in workflows

- **Permissions start at nothing.** The workflow sets `permissions: {}` and each job asks only
  for what it needs (usually just read access to the code).
- **Third-party actions are pinned to a commit SHA**, with the version in a comment, e.g.
  `actions/checkout@3d3c42e…  # v7.0.1`. A tag like `v7` can be moved to point at different
  code; a SHA cannot.
- **Downloaded tools are checksum-verified** before they run.
- **No `pull_request_target`.** It runs PR code with write access, which is the classic way
  CI gets hijacked.
- **Never put `${{ github.event.* }}` inside a `run:` script.** Things like PR titles and branch
  names are typed by whoever opens the PR, and putting them straight into a script lets them
  run commands. Pass them through `env:` instead.
- **No secrets are needed** for these checks.

## Keeping things up to date

Dependabot (`.github/dependabot.yml`) opens a pull request into `dev` every Monday for
outdated npm packages, GitHub Actions, Gradle dependencies (`android/`) and Ruby gems (the
`Gemfile` that pins CocoaPods). Minor and patch updates are grouped into one PR per ecosystem, so
there's less noise. Those PRs go through the same checks as everyone else's.

React Native itself (`react-native`, `@react-native/*`, `@react-native-community/cli*`) is ignored:
a React Native upgrade also changes files in `android/` and `ios/`, so it is done by hand with the
[upgrade helper](https://react-native-community.github.io/upgrade-helper/), not by bumping a version.
So is everything React Native pins and that only moves with such an upgrade: new **major** versions
of ESLint, Babel and React, the Gradle wrapper, `xcodeproj` and new CocoaPods majors. `@types/node`
majors are ignored too, because the types follow the oldest Node the app supports (22). Minor and
patch updates of all of these still arrive.

Dependabot reads this file from the default branch (`dev`) and rescans whenever it changes, so
editing it can open a batch of PRs straight away. They are only proposals: each goes through the
same checks and approval as any other PR, and closing one is fine.

## Who reviews what

`.github/CODEOWNERS` makes @keerthanarameshdasari-hub and @Keerthana-212 the code owners of
every file, with explicit lines for CI config (`.github/`), infrastructure (`infra/`),
Dockerfiles and `package-lock.json`, plus the native projects (`android/`, `ios/`), the
environment files (`.env.*`) and the pinned API contract (`api/`).

Because every file has owners, GitHub automatically asks the other maintainer to review each
pull request; it shows up in their GitHub notifications (and email, if they have it on). What
that review means depends on where the PR is going:

The rulesets `protect-dev`, `protect-test` and `protect-main` (Settings → Rules → Rulesets)
apply the same rules to all three branches:

- **An approval from a code owner other than the PR's author.** You can't approve your own PR,
  so the other maintainer has to. `protect-test` and `protect-main` also ask for one approving
  review in general, which the code owner's approval satisfies.
- **Up to date with the target branch.** If the PR shows "This branch is out-of-date", click
  **Update branch** (the checks then run again).
- **All review conversations resolved.**
- **Squash merge only.**
- **New commits dismiss earlier approvals**, so approve after the last push.
- **No bypass:** nobody, admins included, can skip these.

To review, open the PR, go to **Files changed → Review changes**, pick **Approve** or
**Request changes**, and submit.

## Required checks

These are the check names to require in all three branch rulesets (`protect-dev`, `protect-test`,
`protect-main`):

| Check name | Job |
|---|---|
| `Secret scan (gitleaks)` | gitleaks |
| `Dependency review` | dependency-review |
| `CodeQL (actions)` | codeql |
| `CodeQL (javascript-typescript)` | codeql |
| `Workflow audit (zizmor)` | zizmor |
| `Workflow lint (actionlint)` | actionlint |
| `Lint, format and type check` | static (ci.yml) |
| `Unit and component tests` | unit (ci.yml) |
| `Contract test (pinned backend_demo)` | contract (ci.yml) |

The last three come from `ci.yml` and are new with the mobile app: **add them to all three
rulesets** so a PR can't merge with them failing.

The Devices jobs (`Android emulator (dev)`, `iOS simulator (dev)`) are deliberately **not** in this
list; see "The Devices workflow".

If you rename a job or add a CodeQL language, update the rulesets too. A required check whose
name no longer exists never reports, and PRs wait on it forever.
