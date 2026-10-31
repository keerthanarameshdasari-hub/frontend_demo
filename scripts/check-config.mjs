#!/usr/bin/env node
/**
 * `npm run config:check`: checks that the four environments are wired up the same
 * way everywhere, and that the env files hold only public values.
 *
 * The environment table below is the single description of what each environment
 * must look like. This script fails if the env files, android/app/build.gradle,
 * the Xcode project, the Podfile or the shared schemes disagree with it, or if
 * the app version differs between package.json, Android and iOS (the version is
 * compared with GET /meta/min-app-version on launch, so a mismatch would gate the
 * two platforms differently).
 *
 * No network, no native toolchain: it reads the files as text, so it runs in CI
 * on ubuntu-latest.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const ENVIRONMENTS = [
  {
    env: 'dev',
    file: '.env.dev',
    flavor: 'dev',
    ios: 'Dev',
    id: 'com.demo.wallet.dev',
    name: 'Demo Wallet Dev',
  },
  {
    env: 'test',
    file: '.env.test',
    flavor: 'tst',
    ios: 'Test',
    id: 'com.demo.wallet.test',
    name: 'Demo Wallet Test',
  },
  {
    env: 'uat',
    file: '.env.uat',
    flavor: 'uat',
    ios: 'Uat',
    id: 'com.demo.wallet.uat',
    name: 'Demo Wallet UAT',
  },
  {
    env: 'prod',
    file: '.env.prod',
    flavor: 'prod',
    ios: 'Prod',
    id: 'com.demo.wallet',
    name: 'Demo Wallet',
  },
];

/** The only keys an env file may set. Everything in them ships inside the app. */
const ALLOWED_KEYS = new Set([
  'ENV_NAME',
  'API_URL',
  'API_URL_ANDROID',
  'API_URL_IOS',
]);
const URL_KEYS = ['API_URL', 'API_URL_ANDROID', 'API_URL_IOS'];
const SECRET_LOOKING =
  /SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY|CLIENT_?SECRET/i;
/** Plain http is acceptable only for a backend on the developer's own machine. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2']);

const errors = [];
const warnings = [];
const error = message => errors.push(message);
const warn = message => warnings.push(message);
const read = path => readFileSync(join(ROOT, path), 'utf8');

function parseEnvFile(path) {
  const values = new Map();
  read(path)
    .split('\n')
    .forEach((raw, index) => {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) return;
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (!match) {
        error(`${path}:${index + 1}: expected KEY=value, got "${line}"`);
        return;
      }
      const [, key, value] = match;
      if (values.has(key)) error(`${path}: ${key} is set twice`);
      values.set(key, value);
    });
  return values;
}

function checkEnvFiles() {
  for (const { env, file } of ENVIRONMENTS) {
    if (!existsSync(join(ROOT, file))) {
      error(`${file} is missing`);
      continue;
    }
    const values = parseEnvFile(file);
    for (const key of values.keys()) {
      if (SECRET_LOOKING.test(key)) {
        error(
          `${file}: ${key} looks like a secret. Env files are compiled into the app; secrets never go here.`,
        );
      } else if (!ALLOWED_KEYS.has(key)) {
        error(
          `${file}: ${key} is not an allowed key (${[...ALLOWED_KEYS].join(
            ', ',
          )})`,
        );
      }
    }
    if (values.get('ENV_NAME') !== env)
      error(
        `${file}: ENV_NAME must be "${env}", is "${values.get('ENV_NAME')}"`,
      );
    if (!values.get('API_URL')) error(`${file}: API_URL is required`);

    for (const key of URL_KEYS) {
      const value = values.get(key);
      if (value === undefined) continue;
      let url;
      try {
        url = new URL(value);
      } catch {
        error(`${file}: ${key} is not a valid URL: "${value}"`);
        continue;
      }
      if (
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        value.endsWith('/')
      ) {
        error(
          `${file}: ${key} must be an origin with no path or trailing slash, e.g. https://api.example.com`,
        );
      }
      if (
        url.protocol === 'http:' &&
        !(env === 'dev' && LOCAL_HOSTS.has(url.hostname))
      ) {
        error(
          `${file}: ${key} must use https (plain http is only allowed for a local backend in dev)`,
        );
      } else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        error(`${file}: ${key} must be http(s)`);
      }
      if (url.hostname.endsWith('.invalid')) {
        warn(
          `${file}: ${key} is still a placeholder (${url.hostname}). Set the real URL once that backend exists.`,
        );
      }
    }
  }
}

function checkAndroid(version) {
  const gradle = read('android/app/build.gradle');
  const block = /ext\.environments = \[([\s\S]*?)\n\]/.exec(gradle);
  if (!block) {
    error('android/app/build.gradle: could not find the ext.environments map');
    return;
  }
  const entries = new Map();
  for (const m of block[1].matchAll(
    /^\s*(\w+)\s*:\s*\[envFile:\s*"([^"]+)",\s*idSuffix:\s*(null|"[^"]*"),\s*appName:\s*"([^"]+)"\]/gm,
  )) {
    entries.set(m[1], {
      file: m[2],
      suffix: m[3] === 'null' ? null : m[3].slice(1, -1),
      name: m[4],
    });
  }
  if (entries.size !== ENVIRONMENTS.length) {
    error(
      `android/app/build.gradle: expected ${ENVIRONMENTS.length} flavours, found ${entries.size}`,
    );
  }
  const baseId = /applicationId "([^"]+)"/.exec(gradle)?.[1];
  for (const e of ENVIRONMENTS) {
    const flavor = entries.get(e.flavor);
    if (!flavor) {
      error(`android/app/build.gradle: no "${e.flavor}" flavour`);
      continue;
    }
    if (flavor.file !== e.file)
      error(
        `android flavour ${e.flavor}: envFile is ${flavor.file}, expected ${e.file}`,
      );
    if (`${baseId}${flavor.suffix ?? ''}` !== e.id) {
      error(
        `android flavour ${e.flavor}: application id is ${baseId}${
          flavor.suffix ?? ''
        }, expected ${e.id}`,
      );
    }
    if (flavor.name !== e.name)
      error(
        `android flavour ${e.flavor}: app name is "${flavor.name}", expected "${e.name}"`,
      );
  }
  const versionName = /versionName "([^"]+)"/.exec(gradle)?.[1];
  if (versionName !== version)
    error(
      `android versionName is ${versionName}, package.json version is ${version}`,
    );
}

function checkIos(version) {
  const pbx = read('ios/WalletDemo.xcodeproj/project.pbxproj');
  const configs = new Map();
  for (const m of pbx.matchAll(
    /\/\* ([\w-]+) \*\/ = \{\n\t\t\tisa = XCBuildConfiguration;\n([\s\S]*?)\n\t\t\tname = "?([\w-]+)"?;/g,
  )) {
    const settings = m[2];
    if (!settings.includes('PRODUCT_BUNDLE_IDENTIFIER')) continue; // project-level configuration
    configs.set(m[3], {
      id: /PRODUCT_BUNDLE_IDENTIFIER = "?([\w.-]+)"?;/.exec(settings)?.[1],
      name: /APP_DISPLAY_NAME = "([^"]+)";/.exec(settings)?.[1],
      version: /MARKETING_VERSION = "?([\w.-]+)"?;/.exec(settings)?.[1],
    });
  }
  const expected = ENVIRONMENTS.flatMap(e =>
    ['Debug', 'Release'].map(kind => ({ ...e, config: `${kind}-${e.ios}` })),
  );
  for (const extra of [...configs.keys()].filter(
    name => !expected.some(e => e.config === name),
  )) {
    error(
      `ios: build configuration ${extra} is not one of the environments (it would build with no env file)`,
    );
  }
  for (const e of expected) {
    const c = configs.get(e.config);
    if (!c) {
      error(`ios: no ${e.config} build configuration for the app target`);
      continue;
    }
    if (c.id !== e.id)
      error(`ios ${e.config}: bundle id is ${c.id}, expected ${e.id}`);
    if (c.name !== e.name)
      error(
        `ios ${e.config}: APP_DISPLAY_NAME is "${c.name}", expected "${e.name}"`,
      );
    if (c.version !== version)
      error(
        `ios ${e.config}: MARKETING_VERSION is ${c.version}, package.json version is ${version}`,
      );
  }

  const plist = read('ios/WalletDemo/Info.plist');
  if (
    !/<key>CFBundleDisplayName<\/key>\s*<string>\$\(APP_DISPLAY_NAME\)<\/string>/.test(
      plist,
    )
  ) {
    error(
      'ios/WalletDemo/Info.plist: CFBundleDisplayName must be $(APP_DISPLAY_NAME)',
    );
  }

  const podfile = read('ios/Podfile');
  for (const e of ENVIRONMENTS) {
    if (
      !new RegExp(`'${e.ios}'\\s*=>\\s*'${e.file.replace('.', '\\.')}'`).test(
        podfile,
      )
    ) {
      error(`ios/Podfile: ENVIRONMENTS must map '${e.ios}' => '${e.file}'`);
    }
    const schemePath = `ios/WalletDemo.xcodeproj/xcshareddata/xcschemes/${e.ios}.xcscheme`;
    if (!existsSync(join(ROOT, schemePath))) {
      error(`${schemePath} is missing`);
      continue;
    }
    const used = new Set(
      [...read(schemePath).matchAll(/buildConfiguration = "([^"]+)"/g)].map(
        m => m[1],
      ),
    );
    for (const config of used) {
      if (config !== `Debug-${e.ios}` && config !== `Release-${e.ios}`) {
        error(
          `${schemePath}: uses ${config}, which belongs to another environment`,
        );
      }
    }
  }
}

const version = JSON.parse(read('package.json')).version;
if (!/^\d+\.\d+\.\d+$/.test(version))
  error(`package.json version must be x.y.z, is ${version}`);
checkEnvFiles();
checkAndroid(version);
checkIos(version);

const gh = Boolean(process.env.GITHUB_ACTIONS);
for (const message of warnings)
  console.log(gh ? `::warning::${message}` : `warning: ${message}`);
for (const message of errors)
  console.error(gh ? `::error::${message}` : `error: ${message}`);
if (errors.length > 0) process.exit(1);
console.log(
  `Config ok: ${ENVIRONMENTS.length} environments, app version ${version}.`,
);
