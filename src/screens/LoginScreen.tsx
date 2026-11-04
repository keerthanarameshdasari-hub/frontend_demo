import React, { useState } from 'react';
import { Text } from 'react-native';
import { ApiError, unwrap, type ApiClient, type Schemas } from '../api/client';
import { describeError } from '../errors';
import { TestIDs } from '../testIDs';
import {
  Button,
  Choice,
  ErrorText,
  Screen,
  TextField,
  styles,
} from '../ui/components';

type Mode = 'signIn' | 'register';

/** The backend's RegisterRequest minLength for passwords. */
const MIN_PASSWORD_LENGTH = 10;

export function LoginScreen({
  api,
  envName,
  notice,
  onSignedIn,
}: {
  api: ApiClient;
  envName: string;
  /** Shown above the form, e.g. "Your session has expired". */
  notice?: string | null;
  onSignedIn: (token: Schemas['TokenResponse']) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registering = mode === 'register';
  const trimmedEmail = email.trim();
  const canSubmit =
    trimmedEmail.length > 0 &&
    password.length > 0 &&
    (!registering ||
      (fullName.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (registering) {
        try {
          unwrap(
            await api.POST('/auth/register', {
              body: {
                email: trimmedEmail,
                password,
                fullName: fullName.trim(),
              },
            }),
          );
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            throw new ApiError(
              409,
              e.code,
              'An account with this email already exists. Sign in instead.',
            );
          }
          throw e;
        }
      }
      let token: Schemas['TokenResponse'];
      try {
        token = unwrap(
          await api.POST('/auth/login', {
            body: { email: trimmedEmail, password },
          }),
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          throw new ApiError(401, e.code, 'Email or password is incorrect.');
        }
        throw e;
      }
      await onSignedIn(token);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  return (
    <Screen testID={TestIDs.login.screen} title="Demo Wallet" envName={envName}>
      {notice ? <Text style={styles.body}>{notice}</Text> : null}
      <Choice<Mode>
        label="I want to"
        value={mode}
        onChange={next => {
          setMode(next);
          setError(null);
        }}
        disabled={busy}
        options={[
          { value: 'signIn', label: 'Sign in' },
          { value: 'register', label: 'Create an account' },
        ]}
        testIDFor={value =>
          value === 'signIn'
            ? TestIDs.login.modeSignIn
            : TestIDs.login.modeRegister
        }
      />
      {registering ? (
        <TextField
          testID={TestIDs.login.fullNameInput}
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          autoComplete="name"
          textContentType="name"
          editable={!busy}
        />
      ) : null}
      <TextField
        testID={TestIDs.login.emailInput}
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!busy}
      />
      <TextField
        testID={TestIDs.login.passwordInput}
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={registering ? 'new-password' : 'current-password'}
        textContentType={registering ? 'newPassword' : 'password'}
        editable={!busy}
        onSubmitEditing={() => canSubmit && !busy && submit()}
      />
      {registering ? (
        <Text style={styles.muted}>
          At least {MIN_PASSWORD_LENGTH} characters.
        </Text>
      ) : null}
      <ErrorText testID={TestIDs.login.error} message={error} />
      <Button
        testID={TestIDs.login.submitButton}
        title={registering ? 'Create account' : 'Sign in'}
        onPress={submit}
        disabled={!canSubmit}
        busy={busy}
      />
    </Screen>
  );
}
