# Security Policy

## Supported Versions

Security fixes are applied to the current production release.

| Version | Supported          |
| ------- | ------------------ |
| 0.4.x   | :white_check_mark: |
| < 0.4   | :x:                |

## Reporting a Vulnerability

Please report vulnerabilities privately to
[info.studio.pinball@gmail.com](mailto:info.studio.pinball@gmail.com). Include
the affected page or component, reproduction steps, and the potential impact.
Do not include private replay data, Supabase credentials, access tokens, or
other users' information in the report.

You should receive an acknowledgement within seven days. Confirmed issues will
be prioritized according to impact, and public disclosure should wait until a
fix is available.

The product's core privacy boundary is security-sensitive: raw `.slp` files
must never leave the user's device. Only explicitly opted-in, derived stats may
sync, and public tournament archives contain derived statistics rather than raw
replays or private identifiers.
