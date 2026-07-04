/**
 * Strips sensitive/internal columns (password_hash) before a user row is
 * ever allowed to leave the auth module.
 */
export function toPublicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    company_name: user.company_name,
    avatar_url: user.avatar_url,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}
