import {
  errorCodes,
  isErrorWithCode,
  pick,
  types,
} from '@react-native-documents/picker';
import type { UploadFile } from '../api/client';

/** What backend_demo accepts for a KYC document. */
export const ALLOWED_DOCUMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;

export type PickResult =
  | { kind: 'picked'; file: UploadFile }
  | { kind: 'cancelled' }
  | { kind: 'unsupported' };
export type PickDocument = () => Promise<PickResult>;

/** Opens the system file picker for one image or PDF. */
export const pickDocument: PickDocument = async () => {
  try {
    const [picked] = await pick({
      type: [types.images, types.pdf],
      allowMultiSelection: false,
    });
    const type = picked.type ?? '';
    if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(type))
      return { kind: 'unsupported' };
    // React Native's fetch uploads straight from the content:// (Android) or file:// (iOS) uri.
    return {
      kind: 'picked',
      file: { uri: picked.uri, name: picked.name ?? 'document', type },
    };
  } catch (error) {
    if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED)
      return { kind: 'cancelled' };
    throw error;
  }
};
