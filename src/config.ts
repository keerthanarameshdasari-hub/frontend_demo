/**
 * Build-time environment config. The values come from the env file the native build
 * selected (Android product flavour, iOS build configuration) via react-native-config.
 * They are public: nothing secret is ever read from here.
 */
import { Platform } from 'react-native';
import Config, { type NativeConfig } from 'react-native-config';

export const ENV_NAMES = ['dev', 'test', 'uat', 'prod'] as const;
export type EnvName = (typeof ENV_NAMES)[number];

export type AppConfig = {
  envName: EnvName;
  /** Origin of backend_demo, with no trailing slash. */
  apiUrl: string;
};

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function isEnvName(value: string | undefined): value is EnvName {
  return (ENV_NAMES as readonly (string | undefined)[]).includes(value);
}

/**
 * Validates the raw config. Throws ConfigError rather than letting the app start
 * with no API URL, which would only show up later as confusing network errors.
 */
export function readConfig(
  raw: NativeConfig = Config,
  os: typeof Platform.OS = Platform.OS,
): AppConfig {
  const envName = raw.ENV_NAME;
  if (!isEnvName(envName)) {
    throw new ConfigError(
      `ENV_NAME is "${envName ?? ''}", expected one of ${ENV_NAMES.join(
        ', ',
      )}. Was the app built with an env file?`,
    );
  }
  const platformUrl =
    os === 'android'
      ? raw.API_URL_ANDROID
      : os === 'ios'
      ? raw.API_URL_IOS
      : undefined;
  const apiUrl = (platformUrl || raw.API_URL || '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/.test(apiUrl)) {
    throw new ConfigError(
      `API_URL is "${apiUrl}", expected an http(s) origin such as https://api.example.com`,
    );
  }
  return { envName, apiUrl };
}
