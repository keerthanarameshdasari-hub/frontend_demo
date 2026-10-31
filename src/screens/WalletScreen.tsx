import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  ApiError,
  NetworkError,
  unwrap,
  type ApiClient,
  type TopUp,
  type User,
  type Wallet,
} from '../api/client';
import type { EnvName } from '../config';
import { describeError } from '../errors';
import { formatMinor, parseMajorToMinor } from '../money';
import {
  TEST_CARDS,
  newIdempotencyKey,
  testCardToken,
  testCardsAvailable,
  type TestCardOutcome,
} from '../payments';
import { TestIDs } from '../testIDs';
import {
  Button,
  Card,
  Choice,
  ErrorText,
  Screen,
  TextField,
  styles,
} from '../ui/components';
import { colors } from '../ui/theme';

const RECENT_TOP_UPS = 10;

/** A top-up attempt that may have reached the server. Retrying it reuses the key, so it can't charge twice. */
type Attempt = { key: string; amountMinor: number; paymentToken: string };

function topUpLine(topUp: TopUp): string {
  const amount = formatMinor(topUp.amountMinor, topUp.currency);
  switch (topUp.status) {
    case 'SUCCEEDED':
      return `${amount} added`;
    case 'FAILED':
      return `${amount} declined${
        topUp.failureReason ? ` (${topUp.failureReason})` : ''
      }`;
    case 'TIMED_OUT':
      return `${amount} not completed: the payment provider didn't answer`;
    case 'PENDING':
      return `${amount} processing`;
  }
}

function resultMessage(topUp: TopUp): { text: string; ok: boolean } {
  const amount = formatMinor(topUp.amountMinor, topUp.currency);
  switch (topUp.status) {
    case 'SUCCEEDED':
      return { text: `${amount} added to your wallet.`, ok: true };
    case 'FAILED':
      return {
        text: `Payment declined${
          topUp.failureReason ? `: ${topUp.failureReason}` : ''
        }.`,
        ok: false,
      };
    case 'TIMED_OUT':
      return {
        text: "The payment provider didn't answer in time. You have not been charged.",
        ok: false,
      };
    case 'PENDING':
      return { text: 'Your payment is still processing.', ok: true };
  }
}

export function WalletScreen({
  api,
  envName,
  user,
  onSignOut,
}: {
  api: ApiClient;
  envName: EnvName;
  user: User;
  onSignOut: () => void;
}) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [topUps, setTopUps] = useState<TopUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [card, setCard] = useState<TestCardOutcome>('approve');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const attempt = useRef<Attempt | null>(null);

  const cardsAvailable = testCardsAvailable(envName);
  const amountMinor = parseMajorToMinor(amount);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, list] = await Promise.all([
        api.GET('/wallet').then(unwrap),
        api
          .GET('/wallet/top-ups', {
            params: { query: { limit: RECENT_TOP_UPS } },
          })
          .then(unwrap),
      ]);
      setWallet(w);
      setTopUps(list);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function topUp() {
    if (amountMinor === null || !cardsAvailable) return;
    const paymentToken = testCardToken(card);
    const previous = attempt.current;
    // Same amount and card as an attempt whose outcome we never learned: send the same key,
    // so the server returns that attempt's result instead of charging again.
    const current: Attempt =
      previous &&
      previous.amountMinor === amountMinor &&
      previous.paymentToken === paymentToken
        ? previous
        : { key: newIdempotencyKey(), amountMinor, paymentToken };
    attempt.current = current;

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = unwrap(
        await api.POST('/wallet/top-ups', {
          params: { header: { 'Idempotency-Key': current.key } },
          body: {
            amountMinor: current.amountMinor,
            paymentToken: current.paymentToken,
          },
        }),
      );
      attempt.current = null; // the server answered: this attempt is settled
      setWallet(response.wallet);
      setTopUps(list =>
        [response.topUp, ...list.filter(t => t.id !== response.topUp.id)].slice(
          0,
          RECENT_TOP_UPS,
        ),
      );
      setResult(resultMessage(response.topUp));
      if (response.topUp.status === 'SUCCEEDED') setAmount('');
    } catch (e) {
      if (!(e instanceof NetworkError)) attempt.current = null;
      if (e instanceof ApiError && e.status === 403) {
        setError('Your identity has to be verified before you can top up.');
      } else if (e instanceof NetworkError) {
        setError(`${e.message} Tapping Top up again won't charge you twice.`);
      } else {
        setError(describeError(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen testID={TestIDs.wallet.screen} title="Wallet" envName={envName}>
      <Card>
        <Text style={styles.muted}>Hi {user.fullName}, your balance</Text>
        {wallet ? (
          <Text testID={TestIDs.wallet.balance} style={local.balance}>
            {formatMinor(wallet.balanceMinor, wallet.currency)}
          </Text>
        ) : loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : null}
        <Button
          testID={TestIDs.wallet.refreshButton}
          title="Refresh"
          variant="secondary"
          onPress={refresh}
          busy={loading}
        />
      </Card>

      <Card>
        <Text style={[styles.body, local.heading]}>Top up</Text>
        {cardsAvailable ? (
          <>
            <TextField
              testID={TestIDs.wallet.amountInput}
              label={`Amount (${wallet?.currency ?? 'INR'})`}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="500"
              editable={!busy}
            />
            {amount.length > 0 && amountMinor === null ? (
              <Text style={styles.muted}>
                Enter an amount like 500 or 99.50.
              </Text>
            ) : null}
            <Choice<TestCardOutcome>
              label="Pay with"
              value={card}
              onChange={setCard}
              disabled={busy}
              options={TEST_CARDS.map(c => ({
                value: c.outcome,
                label: c.label,
              }))}
              testIDFor={TestIDs.wallet.testCard}
            />
            <Button
              testID={TestIDs.wallet.topUpButton}
              title="Top up"
              onPress={topUp}
              disabled={amountMinor === null}
              busy={busy}
            />
          </>
        ) : (
          <Text style={styles.muted}>
            Card payments aren't available in this build yet.
          </Text>
        )}
        {result ? (
          <Text
            testID={TestIDs.wallet.topUpResult}
            style={[
              styles.body,
              { color: result.ok ? colors.success : colors.danger },
            ]}
          >
            {result.text}
          </Text>
        ) : null}
        <ErrorText testID={TestIDs.wallet.error} message={error} />
      </Card>

      {topUps.length > 0 ? (
        <Card>
          <Text style={[styles.body, local.heading]}>Recent top-ups</Text>
          {topUps.map(t => (
            <View key={t.id} testID={TestIDs.wallet.topUpItem(t.id)}>
              <Text style={styles.body}>{topUpLine(t)}</Text>
              <Text style={styles.muted}>
                {new Date(t.createdAt).toLocaleString()}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Button
        testID={TestIDs.wallet.signOutButton}
        title="Sign out"
        variant="secondary"
        onPress={onSignOut}
      />
    </Screen>
  );
}

const local = StyleSheet.create({
  balance: { fontSize: 34, fontWeight: '700', color: colors.text },
  heading: { fontWeight: '600' },
});
