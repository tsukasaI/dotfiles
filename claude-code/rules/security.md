# Security

- Never hardcode secrets, API keys, tokens, or passwords. Use environment variables or secret managers.
- Parameterize all database queries. Never interpolate user input into SQL strings.
- Escape or sanitize user input before rendering in HTML to prevent XSS.
- Validate and sanitize file paths from user input to prevent path traversal.
- Use allowlists over denylists for input validation when possible.
- Never log secrets, credentials, full request bodies, or PII. Redact at the logging boundary.
- Verify external state at decision time, not from memory. Commit SHAs, dependency versions, API responses, and artifact digests must be fetched via the relevant tool (`gh api`, `curl`, `cargo search`) at the moment of use — not recalled.
- Security controls default to fail-closed; callers opt out explicitly. Verification toggles (`verify-attestation`, signature checks, digest comparison) must default to strict. Soft-fail or skip-on-absence treats a stripped signature the same as a valid one.
- Pin third-party actions and container images to content hashes, not tags. Pair each pin with a renewal mechanism (Dependabot, scheduled audit) so it doesn't silently rot.
- Enumerate edge inputs before shipping any validation or parsing logic: empty, missing, malformed, oversize, leading/trailing whitespace, multi-line. Shell-specific: empty string into `read -ra` produces a one-element array containing `""`, not an empty array.
