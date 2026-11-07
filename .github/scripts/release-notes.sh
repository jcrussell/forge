#!/usr/bin/env bash
# Generate release notes for a tag from conventional-commit subjects.
#
# GitHub's built-in generate_release_notes is PR-derived, and this repo lands
# commits directly on main with no PRs — so it produced empty bodies (v49-90-beta.1
# and beta.2 shipped with nothing but a compare link). Commit subjects here follow
# conventional commits, so bucket those instead.
#
# Usage: release-notes.sh <tag> [previous-tag]
# Writes markdown to stdout.
#
# If the tag is annotated, its message is used as a prelude — that is where
# upgrade notes belong (`git tag -a v2026.11.0 -m "..."`), so nothing release-specific
# is ever hardcoded here.
set -euo pipefail

TAG="${1:?usage: release-notes.sh <tag> [previous-tag]}"
PREV="${2:-}"

if [ -z "$PREV" ]; then
  # Nearest preceding v* tag. A stable tag skips pre-releases, so its notes cover
  # everything its betas shipped too. Empty on the very first tag, handled below.
  case "$TAG" in
    *-beta* | *-rc*) SKIP=() ;;
    *) SKIP=(--exclude '*-beta*' --exclude '*-rc*') ;;
  esac
  PREV="$(git describe --tags --abbrev=0 --match 'v*' ${SKIP[@]+"${SKIP[@]}"} "${TAG}^" 2>/dev/null || true)"
fi

if [ -n "$PREV" ]; then
  RANGE="${PREV}..${TAG}"
else
  RANGE="$TAG"
fi

# Annotated-tag message as prelude. Must check the object type first: a
# lightweight tag ref resolves straight to the commit, and %(contents) would then
# echo that commit's whole message into the notes. RELEASING.md allows lightweight
# tags, so this path is the common one.
if [ "$(git cat-file -t "refs/tags/${TAG}" 2>/dev/null || true)" = "tag" ]; then
  PRELUDE="$(git for-each-ref --format='%(contents)' "refs/tags/${TAG}" |
    sed '/^-----BEGIN PGP SIGNATURE-----/,$d')"
  if [ -n "${PRELUDE//[[:space:]]/}" ]; then
    printf '%s\n\n' "$PRELUDE"
  fi
fi

section() { # section <heading> <body> [collapse]
  local heading="$1" body="$2"
  [ -n "$body" ] || return 0
  if [ -n "${3:-}" ]; then
    # Folded so a long range's test and CI churn doesn't bury the user-facing
    # sections. The blank lines let GitHub render the list inside <details>.
    printf '<details>\n<summary><b>%s</b> (%d)</summary>\n\n%s\n\n</details>\n\n' \
      "$heading" "$(grep -c '^- ' <<<"$body")" "$body"
  else
    printf '### %s\n\n%s\n\n' "$heading" "$body"
  fi
}

# Commit subjects, with `<` escaped so GitHub neither strips a subject's
# `<range>` as a tag nor ends a <details> block early.
subjects() {
  git log --no-merges --format='%s' "$RANGE" | sed 's/</\&lt;/g'
}

emit() { # emit <heading> <type-regex> [bang-regex] [collapse]
  local heading="$1" types="$2" bang="${3:-!?}"
  section "$heading" "$(subjects |
    sed -nE "s/^(${types})(\([^)]*\))?${bang}: (.*)$/- \3/p" || true)" "${4:-}"
}

# `type!:` marks a breaking change; it is listed here and under its own type.
emit "Breaking Changes" '[a-z]+' '!'
emit "Features" 'feat'
emit "Bug Fixes" 'fix'
emit "Documentation & Translations" 'docs|i18n'
emit "Maintenance" 'refactor|tooling|chore|ci|build|style|perf|test' '!?' collapse

# Anything that does not parse as a conventional commit still has to surface, or
# the notes would silently drop it. Folded: it is mostly pre-convention history.
section "Other" "$(subjects |
  grep -vE '^(feat|fix|docs|i18n|refactor|tooling|chore|ci|build|style|perf|test)(\([^)]*\))?!?: ' |
  sed 's/^/- /' || true)" collapse

REPO_URL="https://github.com/${GITHUB_REPOSITORY:-jcrussell/forge}"
if [ -n "$PREV" ]; then
  printf '**Full Changelog**: %s/compare/%s...%s\n' "$REPO_URL" "$PREV" "$TAG"
else
  printf '**Full Changelog**: %s/commits/%s\n' "$REPO_URL" "$TAG"
fi
