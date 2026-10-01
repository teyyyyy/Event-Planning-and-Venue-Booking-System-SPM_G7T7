#!/usr/bin/env bash
# Claude Code PostToolUse hook: after a source file is edited, run the suites so a new or changed
# function is never left untested. Exit 2 feeds the output back to Claude to fix.
file="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)"
case "$file" in
  */backend/*.py|*/frontend/src/*.js|*/frontend/src/*.jsx) ;;
  *) exit 0 ;;
esac
out="$("$(dirname "$0")/test-all.sh" 2>&1)" && exit 0
echo "$out" | tail -40 >&2
echo "Tests or coverage failed after editing $file. Add/repair tests (with @tc / tc() documentation) until scripts/test-all.sh passes." >&2
exit 2
