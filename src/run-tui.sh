#!/bin/sh
set -eu

directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
config=${1:?loop-agent instance config path is required}
instance_directory=$(CDPATH= cd -- "$(dirname -- "$config")" && pwd)
thread_id=$(/opt/homebrew/bin/node -e 'const c=require(process.argv[1]); if(!c.threadId) process.exit(1); process.stdout.write(c.threadId)' "$config")
cwd=$(/opt/homebrew/bin/node -e 'const c=require(process.argv[1]); process.stdout.write(c.cwd)' "$config")
codex_path=$(/opt/homebrew/bin/node -e 'const c=require(process.argv[1]); process.stdout.write(c.codexPath)' "$config")
git_author_name=$(/opt/homebrew/bin/node -e 'const c=require(process.argv[1]); process.stdout.write(c.gitAuthorName)' "$config")
git_author_email=$(/opt/homebrew/bin/node -e 'const c=require(process.argv[1]); process.stdout.write(c.gitAuthorEmail)' "$config")

export PATH="$instance_directory/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export GIT_ASKPASS="$instance_directory/git-askpass.sh"
export GIT_TERMINAL_PROMPT=0
export GIT_AUTHOR_NAME="$git_author_name"
export GIT_AUTHOR_EMAIL="$git_author_email"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export WHOSE_AGENT_WORKER=1
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0='url.https://github.com/.insteadOf'
export GIT_CONFIG_VALUE_0='git@github.com:'

exec "$codex_path" resume "$thread_id" \
  --dangerously-bypass-approvals-and-sandbox \
  -C "$cwd"
