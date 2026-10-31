# frontend_demo

Mobile wallet app for the CI/CD demo (`backend_demo`, `admin_demo`, `frontend_demo`, `infra_demo`):
sign in, verify identity (KYC document upload), see the wallet balance and top it up, all against
the `backend_demo` API. React Native 0.88 (community CLI, no Expo), TypeScript.

Branch flow: `feature/*` → `dev` → `test` → `main`, each step by pull request. See
[docs/ci.md](docs/ci.md) for what runs on every pull request.

## Run it locally (dev flavour, local backend)

There is no deployed backend yet, so the dev build talks to `backend_demo` on your machine.

You need Node ≥ 22.11, JDK 17+, Android Studio with an emulator, and (for iOS, on macOS) Xcode and
Ruby with Bundler.

1. Start the backend (in your `backend_demo` checkout): `docker compose up --build`.
   Check it with `curl localhost:3000/meta/min-app-version`.
2. Here: `npm ci`, then start Metro with `npm start` and leave it running.
3. **Android emulator:** start an emulator, then `npm run android:dev`. The app calls
   `http://10.0.2.2:3000`, which is how the emulator reaches your machine's `localhost`.
4. **iOS simulator:** once, `bundle install && (cd ios && bundle exec pod install)`. Then
   `npm run ios:dev`. The app calls `http://localhost:3000`.

The app opens on "Demo Wallet" with a yellow **DEV** badge. Create an account, upload any JPEG, PNG
or PDF with a document number like `P1234567`, continue to the wallet and top up `500` with the
"approved" test card. The backend's mock providers decide outcomes from the input (backend README,
"Mock providers"): a document number starting `REJECT` or `TIMEOUT` fails KYC, and the "declined" and
"no answer" test cards fail the payment.

## Environments

| Env | Env file | Android flavour → variant | iOS scheme → configurations | App ID / bundle ID | App name |
|---|---|---|---|---|---|
| dev | `.env.dev` | `dev` → `devDebug` | `Dev` → `Debug-Dev`, `Release-Dev` | `com.demo.wallet.dev` | Demo Wallet Dev |
| test | `.env.test` | `tst` → `tstDebug` | `Test` → `Debug-Test`, `Release-Test` | `com.demo.wallet.test` | Demo Wallet Test |
| uat | `.env.uat` | `uat` → `uatDebug` | `Uat` → `Debug-Uat`, `Release-Uat` | `com.demo.wallet.uat` | Demo Wallet UAT |
| prod | `.env.prod` | `prod` → `prodDebug` | `Prod` → `Debug-Prod`, `Release-Prod` | `com.demo.wallet` | Demo Wallet |

Each environment has its own ID and name, so all four install side by side. `npm run android:<env>`
and `npm run ios:<env>` run the Debug build of each; release builds are
`cd android && ./gradlew assemble<Flavour>Release` and the matching `Release-<Env>` configuration.

- **The Android test flavour is `tst`**, not `test`: the Android Gradle Plugin rejects flavour
  names starting with "test" because they clash with unit-test source sets. It still loads
  `.env.test` and reports `ENV_NAME=test`.
- **iOS has a Debug and a Release configuration per environment.** React Native decides between
  Metro and the bundled JS from "Debug" in the configuration name, so a single `Dev` configuration
  can't do both. The Podfile marks each `Debug-*` as debug for CocoaPods and for Swift's `#if DEBUG`
  (React Native only does that for a configuration named exactly `Debug`).

### How each build gets its env file

Values reach JS through [react-native-config](https://github.com/lugg/react-native-config) as
`Config`, read and validated in `src/config.ts`. A build with a missing or broken env file shows
"This build is misconfigured" instead of starting.

- **Android:** each product flavour in `android/app/build.gradle` reads its own env file into its
  own `BuildConfig`. This avoids the library's default `dotenv.gradle`, which guesses one env file
  from the Gradle task name and applies it to every variant in the build.
- **iOS:** the `Podfile` maps each build configuration to its env file (`ENVFILE`), the approach the
  library recommends. Run `pod install` after changing it. If an iOS build ever shows the wrong
  environment, check for a stray `/tmp/envfile` on the Mac: the library lets it override everything.

### Rules for the env files

They hold **public values only** (`ENV_NAME`, `API_URL`, and optional per-platform
`API_URL_ANDROID`/`API_URL_IOS`). Everything in them is compiled into the app, where anyone can read
it. `npm run config:check` (run in CI) fails on any other key, on anything that looks like a secret,
on plain `http` outside dev's local backend, and on any mismatch between the env files, the Gradle
flavours, the Xcode configurations, the Podfile, the schemes and the app version.

The test, uat and prod URLs are placeholders (`*.wallet-demo.invalid`) until those backends exist;
`config:check` warns about them. Replace them with the real `https` URLs.

## Minimum app version

On launch the app calls `GET /meta/min-app-version` before anything else. If the installed build
is older (semver, so `1.9.0` < `1.10.0` and `1.0.0-beta` < `1.0.0`), it shows a blocking **Update
required** screen; "Check again" re-asks the server and nothing else gets past it. If the server
can't be reached, the app shows the error with "Try again" rather than continuing unchecked.

The installed version is the native one (`versionName` / `CFBundleShortVersionString`, read with
`react-native-device-info`). It must equal `version` in `package.json`; `config:check` enforces that.
To release a new version, change all three (`package.json`, `versionName` in
`android/app/build.gradle`, `MARKETING_VERSION` in the Xcode project) and raise `versionCode` /
`CURRENT_PROJECT_VERSION`.

## Sign-in tokens

The access token (with its expiry) is stored only with `react-native-keychain`: in the iOS Keychain
(readable only while the device is unlocked and never restored onto another device,
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), and on Android encrypted with a key held in the Android Keystore. AsyncStorage is not a dependency, and
a test fails if anything in `src/` imports it. An expired token is discarded on launch, and any 401
from the API signs the user out with "Your session has expired".

## API client

`src/api/schema.d.ts` is generated from `api/openapi.json`, a verbatim copy of `backend_demo`'s
`openapi.json` at a pinned version; `api/openapi.lock.json` records the tag, commit, API version and
sha256 (currently `api-v0.2.0`, the same pin as `admin_demo`). The build never contacts the backend
for its contract. Requests and responses are typed through
[openapi-fetch](https://openapi-ts.dev/openapi-fetch/), so a field or path the backend renames or
removes is a compile error.

```sh
npm run api:fetch -- api-v0.3.0   # pin a newer tag: copies its openapi.json, updates the lock, regenerates
npm run typecheck                 # see what the new contract breaks
```

Top-ups send an `Idempotency-Key`. When a top-up fails at the network level (no answer from the
server), retrying the same amount and card reuses the key, so the backend returns the original
result instead of charging twice.

Payments: `backend_demo` only has a mock payment provider, so non-production builds offer three test
cards that map to its outcomes. Production has no payment SDK yet and shows top-up as unavailable
rather than sending a fake token.

## Test IDs

Every interactive element has a stable `testID`, all defined in `src/testIDs.ts` and named
`<screen>.<element>` (for example `login.emailInput`, `wallet.topUpButton`,
`kyc.documentType.PASSPORT`). UI tests (Detox, Maestro, Appium) should select by these. The shared
`Button`, `TextField` and `Choice` components require one, and `__tests__/testIDs.test.tsx` renders
every screen and fails if anything pressable or editable lacks a testID or two elements share one.

## Tests

```sh
npm test               # unit + component tests (Jest, React Native Testing Library)
npm run typecheck      # app and tests
npm run lint
npm run config:check
npm run api:check      # pinned spec matches its lock, generated client is up to date
CONTRACT_API_URL=http://localhost:3000 npm run test:contract   # against a running backend_demo
```

The component tests drive the whole app (version gate, sign-in, KYC, top-up, session expiry)
against an in-memory fake of the backend typed from the pinned schema. The contract test walks the
same journey against a real `backend_demo` through the app's API client; CI runs it against the
pinned backend commit started with `docker compose`.

## Project layout

```text
src/
  App.tsx          Launch sequence (config → version gate → session) and screen routing.
  config.ts        Env config from react-native-config, validated.
  appVersion.ts    Semver comparison for the version gate.
  auth/            Keychain token store.
  api/             Generated schema.d.ts and the typed client.
  screens/         Login, KYC, Wallet, and the gate screens.
  ui/              Button, TextField, Choice, Screen.
  testIDs.ts       Every testID.
api/               Pinned openapi.json and its lock.
scripts/           fetch-openapi.mjs, check-config.mjs.
android/, ios/     Native projects (flavours, configurations, schemes).
```
