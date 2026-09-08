import path from 'node:path';
import { SecurityError } from './path-guard.js';

const BLOCKED_BASENAME_PATTERNS: RegExp[] = [
  /^\.env(?:\..+)?$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /\.(?:pem|key|p12|pfx)$/i,
  /^(?:credentials?|secrets?)(?:\.[^.]+)?$/i,
];

const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/\bgh[opusr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_API_KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_ACCESS_KEY]'],
];

export function assertNonSecretPath(requestedPath: string): void {
  const basename = path.basename(requestedPath);
  if (BLOCKED_BASENAME_PATTERNS.some((pattern) => pattern.test(basename))) {
    throw new SecurityError(`Access to sensitive file is blocked: ${basename}`);
  }
}

export function redactKnownSecrets(content: string): string {
  return REDACTION_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    content,
  );
}
