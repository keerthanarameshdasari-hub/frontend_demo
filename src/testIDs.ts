/**
 * Every testID in the app, in one place. UI tests (Detox, Maestro, Appium, the Jest
 * component tests) select elements by these strings, so they are part of the app's
 * test contract: rename one only together with the tests that use it.
 *
 * Every interactive element has one. A few read-only elements that tests assert on
 * (balance, statuses, errors) have one too.
 *
 * Naming: <screen>.<element>[.<variant>]. Never derived from translated text.
 */
export const TestIDs = {
  envBadge: 'app.envBadge',

  startup: {
    loading: 'startup.loading',
    error: 'startup.error',
    errorMessage: 'startup.errorMessage',
    retryButton: 'startup.retryButton',
  },

  updateRequired: {
    screen: 'updateRequired.screen',
    installedVersion: 'updateRequired.installedVersion',
    minimumVersion: 'updateRequired.minimumVersion',
    retryButton: 'updateRequired.retryButton',
  },

  configError: {
    screen: 'configError.screen',
  },

  login: {
    screen: 'login.screen',
    modeSignIn: 'login.mode.signIn',
    modeRegister: 'login.mode.register',
    fullNameInput: 'login.fullNameInput',
    emailInput: 'login.emailInput',
    passwordInput: 'login.passwordInput',
    submitButton: 'login.submitButton',
    error: 'login.error',
  },

  kyc: {
    screen: 'kyc.screen',
    status: 'kyc.status',
    documentType: (type: string) => `kyc.documentType.${type}`,
    documentNumberInput: 'kyc.documentNumberInput',
    pickFileButton: 'kyc.pickFileButton',
    pickedFileName: 'kyc.pickedFileName',
    submitButton: 'kyc.submitButton',
    refreshButton: 'kyc.refreshButton',
    continueButton: 'kyc.continueButton',
    signOutButton: 'kyc.signOutButton',
    error: 'kyc.error',
  },

  wallet: {
    screen: 'wallet.screen',
    balance: 'wallet.balance',
    refreshButton: 'wallet.refreshButton',
    amountInput: 'wallet.amountInput',
    testCard: (outcome: string) => `wallet.testCard.${outcome}`,
    topUpButton: 'wallet.topUpButton',
    topUpResult: 'wallet.topUpResult',
    topUpItem: (id: string) => `wallet.topUp.${id}`,
    signOutButton: 'wallet.signOutButton',
    error: 'wallet.error',
  },
} as const;
