/**
 * Keys the env files may set (.env.dev, .env.test, .env.uat, .env.prod).
 * scripts/check-config.mjs rejects any other key, so this list is complete.
 */
declare module 'react-native-config' {
  export interface NativeConfig {
    ENV_NAME?: string;
    API_URL?: string;
    /** Overrides API_URL on Android only (the emulator reaches the host at 10.0.2.2). */
    API_URL_ANDROID?: string;
    /** Overrides API_URL on iOS only. */
    API_URL_IOS?: string;
  }

  export const Config: NativeConfig;
  export default Config;
}
