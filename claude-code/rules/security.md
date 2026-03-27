# Security

- Never hardcode secrets, API keys, tokens, or passwords. Use environment variables or secret managers.
- Parameterize all database queries. Never interpolate user input into SQL strings.
- Escape or sanitize user input before rendering in HTML to prevent XSS.
- Validate and sanitize file paths from user input to prevent path traversal.
- Use allowlists over denylists for input validation when possible.
