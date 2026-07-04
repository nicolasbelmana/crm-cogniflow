/**
 * Auth use cases. Depends only on abstractions passed in by the composition
 * root (app.js): a user repository, a password hasher and a token service.
 * No direct knowledge of Postgres, bcrypt or jsonwebtoken (Dependency
 * Inversion Principle) — which also means this is trivially unit-testable
 * with fakes for all three collaborators.
 */
export function createAuthService({ userRepository, passwordHasher, tokenService }) {
  function issueToken(user) {
    return tokenService.sign({ sub: user.id, email: user.email });
  }

  return {
    async register({ email, password, name, companyName }) {
      const passwordHash = await passwordHasher.hash(password);
      const user = await userRepository.create({ email, passwordHash, name, companyName });
      const token = issueToken(user);

      return { user, token };
    },

    issueToken,
  };
}
