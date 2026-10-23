#!/usr/bin/env bash
# Repository-level checks for collaboration and AI guardrails.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
status=0

echo "== Required policy files"
for file in AGENTS.md SECURITY.md; do
  if [ ! -f "$ROOT/$file" ]; then
    echo "Missing required policy file: $file" >&2
    status=1
  fi
done

echo "== Tracked environment files"
if git -C "$ROOT" ls-files | grep -E '(^|/)(\.env|\.env\.[^example])$' >/dev/null; then
  echo "A non-example environment file is tracked." >&2
  status=1
fi

echo "== Legacy secret patterns"
if git -C "$ROOT" grep -nIE "BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|(api|secret|token|password)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{12,}" -- ':!package-lock.json' ':!frontend/package-lock.json' ':!docs/test-register/package-lock.json' ':!AGENTS.md' ':!SECURITY.md' ':!scripts/check-guardrails.sh' >/dev/null; then
  echo "A possible secret or private key pattern was found; review the matching file." >&2
  status=1
fi

if [ "$status" -ne 0 ]; then
  echo "Guardrail checks failed." >&2
  exit 1
fi

echo "Guardrail checks passed."
