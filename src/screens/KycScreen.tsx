import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import {
  DOCUMENT_TYPES,
  latestKyc,
  submitKyc,
  type ApiClient,
  type DocumentType,
  type KycSubmission,
  type UploadFile,
} from '../api/client';
import { describeError } from '../errors';
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
import type { PickDocument } from './pickDocument';

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  PASSPORT: 'Passport',
  NATIONAL_ID: 'National ID',
  DRIVING_LICENCE: 'Driving licence',
};

/** Same rule as the backend: 4–32 letters, digits or dashes. */
const DOCUMENT_NUMBER = /^[A-Za-z0-9-]{4,32}$/;

function statusText(submission: KycSubmission | null): string {
  if (!submission) return 'Verify your identity to start using your wallet.';
  const doc = `${DOCUMENT_LABELS[submission.documentType]} ending ${
    submission.documentNumberLast4
  }`;
  switch (submission.status) {
    case 'APPROVED':
      return `Verified (${doc}).`;
    case 'PENDING':
      return `We're checking your ${doc}. Refresh in a moment.`;
    case 'REJECTED':
      return `Your ${doc} was not accepted${
        submission.decisionReason ? `: ${submission.decisionReason}` : ''
      }. Please submit again.`;
    case 'TIMED_OUT':
      return `We couldn't finish checking your ${doc}. Please submit again.`;
    case 'NOT_STARTED':
      return 'Verify your identity to start using your wallet.';
  }
}

export function KycScreen({
  api,
  envName,
  pickDocument,
  onApproved,
  onSignOut,
}: {
  api: ApiClient;
  envName: string;
  pickDocument: PickDocument;
  onApproved: () => void;
  onSignOut: () => void;
}) {
  const [submission, setSubmission] = useState<KycSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [documentType, setDocumentType] = useState<DocumentType>('PASSPORT');
  const [documentNumber, setDocumentNumber] = useState('');
  const [file, setFile] = useState<UploadFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSubmission(await latestKyc(api));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function choose() {
    setError(null);
    try {
      const picked = await pickDocument();
      if (picked.kind === 'picked') setFile(picked.file);
      else if (picked.kind === 'unsupported')
        setError('Choose a JPEG, PNG or PDF file.');
    } catch {
      setError("Couldn't open that file. Try another one.");
    }
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await submitKyc(api, {
        documentType,
        documentNumber: documentNumber.trim(),
        document: file,
      });
      setSubmission(result);
      if (result.status !== 'APPROVED') {
        setFile(null);
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const approved = submission?.status === 'APPROVED';
  const pending = submission?.status === 'PENDING';
  const canSubmitForm = !approved && !pending;
  const numberOk = DOCUMENT_NUMBER.test(documentNumber.trim());

  return (
    <Screen
      testID={TestIDs.kyc.screen}
      title="Verify your identity"
      envName={envName}
    >
      <Card>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text
            testID={TestIDs.kyc.status}
            style={[styles.body, approved && { color: colors.success }]}
          >
            {statusText(submission)}
          </Text>
        )}
      </Card>

      {approved ? (
        <Button
          testID={TestIDs.kyc.continueButton}
          title="Continue to wallet"
          onPress={onApproved}
        />
      ) : null}

      {pending ? (
        <Button
          testID={TestIDs.kyc.refreshButton}
          title="Refresh"
          onPress={refresh}
          busy={loading}
        />
      ) : null}

      {canSubmitForm && !loading ? (
        <>
          <Choice<DocumentType>
            label="Document type"
            value={documentType}
            onChange={setDocumentType}
            disabled={busy}
            options={DOCUMENT_TYPES.map(value => ({
              value,
              label: DOCUMENT_LABELS[value],
            }))}
            testIDFor={TestIDs.kyc.documentType}
          />
          <TextField
            testID={TestIDs.kyc.documentNumberInput}
            label="Document number"
            value={documentNumber}
            onChangeText={setDocumentNumber}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
          />
          {documentNumber.length > 0 && !numberOk ? (
            <Text style={styles.muted}>4–32 letters, digits or dashes.</Text>
          ) : null}
          <Button
            testID={TestIDs.kyc.pickFileButton}
            title={file ? 'Choose a different file' : 'Choose photo or PDF'}
            variant="secondary"
            onPress={choose}
            disabled={busy}
          />
          {file ? (
            <Text testID={TestIDs.kyc.pickedFileName} style={styles.muted}>
              {file.name}
            </Text>
          ) : null}
          <ErrorText testID={TestIDs.kyc.error} message={error} />
          <Button
            testID={TestIDs.kyc.submitButton}
            title="Submit for verification"
            onPress={submit}
            disabled={!file || !numberOk}
            busy={busy}
          />
        </>
      ) : (
        <ErrorText testID={TestIDs.kyc.error} message={error} />
      )}

      <Button
        testID={TestIDs.kyc.signOutButton}
        title="Sign out"
        variant="secondary"
        onPress={onSignOut}
      />
    </Screen>
  );
}
