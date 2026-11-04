import React from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { TestIDs } from '../testIDs';
import { Button, Card, ErrorText, Screen, styles } from '../ui/components';
import { colors } from '../ui/theme';

/** Checking the version, restoring the session, or a failure doing so (with Retry). */
export function StartupScreen({
  envName,
  error,
  onRetry,
}: {
  envName?: string;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <Screen
      testID={error ? TestIDs.startup.error : TestIDs.startup.loading}
      title="Demo Wallet"
      envName={envName}
    >
      {error ? (
        <>
          <ErrorText testID={TestIDs.startup.errorMessage} message={error} />
          <Button
            testID={TestIDs.startup.retryButton}
            title="Try again"
            onPress={onRetry}
          />
        </>
      ) : (
        <ActivityIndicator size="large" color={colors.primary} />
      )}
    </Screen>
  );
}

/**
 * Blocking: this build is older than GET /meta/min-app-version. There is no way past it
 * except installing a newer build; "Check again" only re-asks the server (the minimum may
 * have been lowered).
 */
export function UpdateRequiredScreen({
  envName,
  installedVersion,
  minimumVersion,
  checking,
  onCheckAgain,
}: {
  envName: string;
  installedVersion: string;
  minimumVersion: string;
  checking: boolean;
  onCheckAgain: () => void;
}) {
  return (
    <Screen
      testID={TestIDs.updateRequired.screen}
      title="Update required"
      envName={envName}
    >
      <Card>
        <Text style={styles.body}>
          This version of Demo Wallet is no longer supported. Install the latest
          version to keep using your wallet.
        </Text>
        <Text
          testID={TestIDs.updateRequired.installedVersion}
          style={styles.muted}
        >
          Installed version: {installedVersion}
        </Text>
        <Text
          testID={TestIDs.updateRequired.minimumVersion}
          style={styles.muted}
        >
          Minimum supported version: {minimumVersion}
        </Text>
      </Card>
      <Button
        testID={TestIDs.updateRequired.retryButton}
        title="Check again"
        variant="secondary"
        onPress={onCheckAgain}
        busy={checking}
      />
    </Screen>
  );
}

/** The build has no usable env config. A packaging bug, never a user error. */
export function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <Screen testID={TestIDs.configError.screen} title="Demo Wallet">
      <Text style={styles.body}>
        This build is misconfigured and can't start.
      </Text>
      <Text style={styles.muted}>{message}</Text>
    </Screen>
  );
}
