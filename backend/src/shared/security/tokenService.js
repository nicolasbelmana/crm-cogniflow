import jwt from 'jsonwebtoken';

/**
 * Wraps JWT signing/verification behind a small factory so services depend
 * on a `tokenService` contract, not directly on `jsonwebtoken` + raw config.
 */
export function createTokenService({ secret, expiresIn }) {
  if (!secret) {
    throw new Error('tokenService requires a secret');
  }

  return {
    sign(payload) {
      return jwt.sign(payload, secret, { expiresIn });
    },
    verify(token) {
      return jwt.verify(token, secret);
    },
  };
}
