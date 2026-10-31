/**
 * The app's few building blocks. Each interactive one takes a required `testID`,
 * so an element can't be added without one (see src/testIDs.ts).
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TestIDs } from '../testIDs';
import { colors, spacing } from './theme';

export function Screen({
  testID,
  title,
  envName,
  children,
}: {
  testID: string;
  title: string;
  envName?: string;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView style={styles.safe} testID={testID}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {envName && envName !== 'prod' ? (
            <Text style={styles.envBadge} testID={TestIDs.envBadge}>
              {envName.toUpperCase()}
            </Text>
          ) : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Button({
  testID,
  title,
  onPress,
  disabled = false,
  busy = false,
  variant = 'primary',
}: {
  testID: string;
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        inactive && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.onPrimary : colors.primary}
        />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant === 'secondary' && styles.buttonTextSecondary,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function TextField({
  testID,
  label,
  ...input
}: { testID: string; label: string } & Omit<
  TextInputProps,
  'testID' | 'style'
>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={styles.input}
        {...input}
      />
    </View>
  );
}

/** A row of mutually exclusive options; each option gets its own testID. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  testIDFor,
  disabled = false,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  testIDFor: (value: T) => string;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.choiceRow} accessibilityRole="radiogroup">
        {options.map(option => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              testID={testIDFor(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              style={[styles.choice, selected && styles.choiceSelected]}
            >
              <Text
                style={[
                  styles.choiceText,
                  selected && styles.choiceTextSelected,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ErrorText({
  testID,
  message,
}: {
  testID: string;
  message: string | null;
}) {
  if (!message) return null;
  return (
    <Text testID={testID} style={styles.error} accessibilityRole="alert">
      {message}
    </Text>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.l, gap: spacing.m },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  envBadge: {
    backgroundColor: colors.warning,
    color: colors.text,
    fontWeight: '700',
    fontSize: 12,
    paddingHorizontal: spacing.s,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  body: { fontSize: 16, color: colors.text, lineHeight: 22 },
  muted: { fontSize: 14, color: colors.muted },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minHeight: 48,
    paddingHorizontal: spacing.m,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  buttonTextSecondary: { color: colors.primary },
  field: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.m,
    minHeight: 48,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    backgroundColor: colors.surface,
  },
  choiceSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  choiceText: { color: colors.text },
  choiceTextSelected: { color: colors.primary, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 15 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.m,
    gap: spacing.s,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
