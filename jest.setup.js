/* global jest */
// Native modules have no JS implementation in Jest; these stand in for them.

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// Overridden per test where the env matters; src/config.ts is also tested with explicit input.
jest.mock('react-native-config', () => ({
  __esModule: true,
  default: { ENV_NAME: 'dev', API_URL: 'http://localhost:3000' },
}));

jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: { getVersion: () => '1.0.0' },
}));

// An in-memory keychain. Tests usually inject their own TokenStore; this keeps the
// default one importable.
jest.mock('react-native-keychain', () => {
  let entry = null;
  return {
    ACCESSIBLE: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
    },
    setGenericPassword: jest.fn(async (username, password, options) => {
      entry = { username, password, service: options?.service };
      return { service: options?.service, storage: 'mock' };
    }),
    getGenericPassword: jest.fn(async () => entry ?? false),
    resetGenericPassword: jest.fn(async () => {
      entry = null;
      return true;
    }),
  };
});

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: { images: 'image/*', pdf: 'application/pdf' },
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: error => Boolean(error && typeof error.code === 'string'),
}));
