#!/bin/sh
# Vercel's Ignored Build Step (vercel.json "ignoreCommand"): exit 0 skips the build, exit 1 builds.
#
# Previews always build. A pull request's preview is what DJ checks before he merges
# (docs/decisions.md D3), and a sprint branch often ends on a docs-only "Record" commit.
# On main, a commit that touches only the validation bot's log, docs/, plans/ or Markdown is
# skipped, so the bot no longer redeploys production. Any git error builds, the safe side.
if [ "$VERCEL_GIT_COMMIT_REF" != "main" ]; then
  exit 1
fi
if git diff --quiet HEAD^ HEAD -- . ':(exclude)validation-log.ndjson' ':(exclude)docs' ':(exclude)plans' ':(exclude)*.md'; then
  exit 0
fi
exit 1
