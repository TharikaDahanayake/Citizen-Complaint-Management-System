import * as Crypto from 'expo-crypto';

const ANON_TRACKING_SALT = process.env.EXPO_PUBLIC_ANON_TRACKING_SALT || 'citizen-app-anon-v1';

export const normalizeIdentityForAnonTracking = (identity) =>
  (identity || '').toString().trim().toLowerCase();

export const generateAnonOwnerHash = async (identity) => {
  const normalizedIdentity = normalizeIdentityForAnonTracking(identity);

  if (!normalizedIdentity) {
    throw new Error('Identity is required to generate anonymous owner hash.');
  }

  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${ANON_TRACKING_SALT}:${normalizedIdentity}`
  );
};
