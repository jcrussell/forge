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

# Types and their sections are documented in CONTRIBUTING.md#commit-messages.
# `type!:` marks a breaking change; it is listed here and under its own type.
emit "Breaking Changes" '[a-z][a-z0-9]*' '!'
emit "Features" 'feat'
emit "Bug Fixes" 'fix'
emit "Documentation & Translations" 'docs|i18n'

# Every other type (test, refactor, chore, ci, ...) is maintenance, so the list of
# types can't drift. Subjects with no type at all still surface under Other, or the
# notes would silently drop them. Both folded.
section "Maintenance" "$(subjects |
  grep -vE '^(feat|fix|docs|i18n)(\([^)]*\))?!?: ' |
  sed -nE 's/^[a-z][a-z0-9]*(\([^)]*\))?!?: (.*)$/- \2/p' || true)" collapse
section "Other" "$(subjects |
  grep -vE '^[a-z][a-z0-9]*(\([^)]*\))?!?: ' |
  sed 's/^/- /' || true)" collapse

REPO="${GITHUB_REPOSITORY:-jcrussell/forge}"

# Everyone credited on a commit: its author, then its Co-authored-by trailers (how
# a reimplemented PR credits the contributor), as `<login>\t<name>\t<email>` lines.
# Login is empty here; git_people only knows names.
git_people() { # git_people <rev-list args...>
  git log --no-merges --format='%aN <%aE>%n%(trailers:key=Co-authored-by,valueonly)' "$@" |
    sed -nE 's/^ *(.*[^ ]) *<([^>]*)>$/\t\1\t\2/p'
}

# Same lines with GitHub logins filled in. GraphQL's Commit.authors resolves the
# author and co-authors to accounts; REST only resolves the author. Fails if gh
# can't reach GitHub. A commit GitHub doesn't have (an unpushed local preview)
# falls back to git_people.
github_people() {
  local shas batch query sha
  shas="$(git rev-list --no-merges "$RANGE")" || return 1
  [ -n "$shas" ] || return 0
  while read -r batch; do
    query="{ repository(owner: \"${REPO%/*}\", name: \"${REPO#*/}\") {"
    for sha in $batch; do
      query+=" c$sha: object(oid: \"$sha\") { ... on Commit { authors(first: 100) { nodes { name email user { login } } } } }"
    done
    gh api graphql -f query="$query } }" --jq '.data.repository | to_entries[] |
      if .value == null then "MISSING\t\(.key[1:])"
      else .value.authors.nodes[] | "\(.user.login // "")\t\(.name)\t\(.email)" end' |
      while IFS= read -r line; do
        case "$line" in
          MISSING*) git_people -1 "${line#MISSING	}" ;;
          *) printf '%s\n' "$line" ;;
        esac
      done || return 1
  done < <(xargs -n 100 <<<"$shas")
}

# Contributors as `- @login`, or `- Name` when the email isn't linked to an account.
# Handles let GitHub show the release's contributor avatars. AI co-authors and bots
# are dropped. Names are untrusted text (anyone can commit as anyone), so every
# ASCII punctuation character is backslash-escaped: a name renders literally, never
# as a link, image, HTML, issue reference or @mention.
contributors() {
  local people kind who
  if command -v gh >/dev/null &&
    { [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ] || gh auth status >/dev/null 2>&1; }; then
    people="$(github_people)" || {
      echo "::warning::Contributor handle lookup failed; listing names instead" >&2
      people="$(git_people "$RANGE")"
    }
  else
    people="$(git_people "$RANGE")"
  fi
  awk -F'\t' '
    tolower($3) == "noreply@anthropic.com" || $1 ~ /\[bot\]$/ || $3 ~ /\[bot\]@/ { next }
    $1 != "" { key = "@" tolower($1); row = "L\t" $1 }
    $1 == "" && $2 != "" { key = tolower($2); row = "N\t" $2 }
    !(key in seen) { seen[key] = 1; print key "\t" row }' <<<"$people" |
    sort | cut -f2- |
    while IFS=$'\t' read -r kind who; do
      if [ "$kind" = L ]; then
        printf -- '- @%s\n' "$who"
      else
        printf -- '- %s\n' "$(sed 's/[][!"#$%&'\''()*+,./:;<=>?@\\^_`{|}~-]/\\&/g' <<<"$who")"
      fi
    done
}

section "Contributors" "$(contributors || true)"

REPO_URL="https://github.com/${REPO}"
if [ -n "$PREV" ]; then
  printf '**Full Changelog**: %s/compare/%s...%s\n' "$REPO_URL" "$PREV" "$TAG"
else
  printf '**Full Changelog**: %s/commits/%s\n' "$REPO_URL" "$TAG"
fi
