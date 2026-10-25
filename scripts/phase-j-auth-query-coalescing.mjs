export function estimateIdentityResolutionCalls({ businessContextRequested, verifiedUserRequested }) {
  const before = Number(Boolean(businessContextRequested)) + Number(Boolean(verifiedUserRequested));
  const after = Number(Boolean(businessContextRequested || verifiedUserRequested));
  return Object.freeze({ before, after, eliminated: before - after });
}
