#!/usr/bin/env bash
#
# HOPE Card — one-command setup.
#
#   bash scripts/setup.sh
#
# Checks your machine, links the Supabase project, applies the database
# migrations, verifies the money invariants, and writes .env.local with
# freshly generated secrets.
#
# Safe to re-run. It stops at the first problem and tells you what to do
# rather than half-finishing.

# pipefail matters: 'supabase db push | tee' must report the push's failure,
# not tee's success.
set -uo pipefail

PUSH_LOG=""
cleanup() { [ -n "$PUSH_LOG" ] && rm -f "$PUSH_LOG"; }
trap cleanup EXIT

PROJECT_REF="avwtfnfmkxeksfvtkyei"
BRANCH="claude/hope-card-mvp-BDgun"

# ── output helpers ─────────────────────────────────────────────────────────
if [ -t 1 ]; then
  B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; X=$'\033[0m'
else
  B=""; R=""; G=""; Y=""; C=""; X=""
fi

step()  { printf "\n${B}${C}▸ %s${X}\n" "$1"; }
ok()    { printf "  ${G}✓${X} %s\n" "$1"; }
warn()  { printf "  ${Y}!${X} %s\n" "$1"; }
die()   { printf "\n  ${R}✗ %s${X}\n\n" "$1"; [ $# -gt 1 ] && printf "%s\n\n" "$2"; exit 1; }

printf "\n${B}HOPE Card setup${X}\n"
printf "Project: %s\n" "$PROJECT_REF"

# ── 1. right place ─────────────────────────────────────────────────────────
step "Checking you're in the right folder"

if [ ! -f "package.json" ] || [ ! -d "supabase/migrations" ]; then
  die "This isn't the HOPE Card project folder." \
"  You need to be in the folder that contains 'package.json'.
  Try:  cd ~/Projects/Strat-Arch
  Then run this again."
fi
ok "Found the project"

# ── 2. tools ───────────────────────────────────────────────────────────────
step "Checking the tools you need are installed"

command -v git >/dev/null 2>&1 || die "git is not installed." \
"  Install Apple's developer tools:  xcode-select --install"

command -v node >/dev/null 2>&1 || die "Node.js is not installed." \
"  Install it from https://nodejs.org (pick the LTS version), then run this again."
ok "node $(node --version)"

# The Supabase CLI can be a real binary (brew) or run on demand through npx.
# Both work. npx matters because it avoids sending someone who doesn't have
# Homebrew off on a 15-minute install detour just to run one command.
SUPABASE=""
if command -v supabase >/dev/null 2>&1; then
  SUPABASE="supabase"
  ok "supabase $($SUPABASE --version 2>/dev/null | head -1)"
else
  warn "The Supabase tool isn't installed as a program."
  printf "\n  Two ways forward:\n\n"
  printf "    ${B}A${X}  Install it properly (faster every time after this):\n"
  printf "         ${C}brew install supabase/tap/supabase${X}\n"
  printf "         Needs Homebrew. If 'brew' isn't found, that's option B.\n\n"
  printf "    ${B}B${X}  Run it on demand through npx — nothing to install.\n"
  printf "         Slower to start each time, otherwise identical.\n\n"
  printf "  Use option B now? [Y/n] "
  read -r reply
  case "$reply" in
    [nN]*) die "Stopped. Run the brew line above, then start this script again." ;;
  esac

  printf "\n  Fetching the Supabase tool (first run takes a minute)...\n\n"
  if npx --yes supabase@latest --version >/dev/null 2>&1; then
    SUPABASE="npx --yes supabase@latest"
    ok "Using supabase via npx"
  else
    die "Couldn't fetch the Supabase tool through npx either." \
"  Install it with Homebrew instead:

      brew install supabase/tap/supabase

  If 'brew' is also missing, get Homebrew from https://brew.sh first."
  fi
fi

# ── 3. right code ──────────────────────────────────────────────────────────
step "Checking you have the latest code"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  warn "You're on branch '$CURRENT_BRANCH', but the code you need is on '$BRANCH'."
  printf "\n  Switch to it now? This won't lose any work. [y/N] "
  read -r reply
  case "$reply" in
    [yY]*)
      git fetch origin "$BRANCH" || die "Couldn't reach GitHub. Check your internet connection."
      git checkout "$BRANCH"     || die "Couldn't switch branch. You may have uncommitted changes — run 'git status' to see."
      ;;
    *) die "Stopped. Run:  git checkout $BRANCH" ;;
  esac
fi

git fetch origin "$BRANCH" -q 2>/dev/null
if ! git merge-base --is-ancestor "origin/$BRANCH" HEAD 2>/dev/null; then
  warn "Your copy is behind GitHub. Pulling the latest..."
  git pull --ff-only origin "$BRANCH" || die "Couldn't pull. Run 'git status' and check for uncommitted changes."
fi
ok "On $BRANCH at $(git rev-parse --short HEAD)"

# The whole ledger lives in 005-008. Without them you'd deploy a version with
# no double-entry accounting and sequential card codes.
MISSING=""
for f in 001_schema 002_rls 003_seed 004_org_types 005_ledger 006_grants \
         007_invariants_and_views 008_rotate_enumerable_codes; do
  [ -f "supabase/migrations/$f.sql" ] || MISSING="$MISSING $f"
done
[ -n "$MISSING" ] && die "Missing migration files:$MISSING" \
"  Your copy of the code is out of date. Try:  git pull origin $BRANCH"
ok "All 8 migrations present"

# ── 4. dependencies ────────────────────────────────────────────────────────
step "Installing project dependencies (this can take a minute)"
if [ -d "node_modules" ]; then
  ok "Already installed"
else
  printf "  Lots of text will scroll past. That is normal. It can take a few\n"
  printf "  minutes and may look frozen — leave it alone until it finishes.\n\n"
  npm install --no-fund --no-audit || die "npm install failed. The reason is in the text above."
  ok "Installed"
fi

# ── 5. supabase login ──────────────────────────────────────────────────────
step "Connecting to Supabase"

if ! $SUPABASE projects list >/dev/null 2>&1; then
  warn "You're not logged in to Supabase yet."
  printf "  A browser window will open. Log in, then come back here.\n\n"
  $SUPABASE login || die "Login failed or was cancelled."
fi
ok "Logged in"

printf "\n  Your Supabase projects:\n"
$SUPABASE projects list 2>/dev/null | sed 's/^/    /'
printf "\n  ${B}Check that %s shows a Canadian region above.${X}\n" "$PROJECT_REF"
printf "  Continue? [y/N] "
read -r reply
case "$reply" in [yY]*) ;; *) die "Stopped at your request." ;; esac

# ── 6. link ────────────────────────────────────────────────────────────────
step "Linking this folder to the project"

if [ -f "supabase/config.toml" ] && grep -q "$PROJECT_REF" supabase/.temp/project-ref 2>/dev/null; then
  ok "Already linked"
else
  printf "  Supabase will ask for your ${B}database password${X}.\n"
  printf "  That is NOT your login password. Find it at:\n"
  printf "  ${C}https://supabase.com/dashboard/project/%s/settings/database${X}\n" "$PROJECT_REF"
  printf "  (If you never set one, click 'Reset database password' there first.)\n\n"
  $SUPABASE link --project-ref "$PROJECT_REF" || die "Linking failed. Usually a wrong database password — see the link above."
  ok "Linked"
fi

# ── 7. migrations ──────────────────────────────────────────────────────────
step "Setting up the database"
printf "  This creates the tables, the money ledger, and 50 cards.\n\n"

PUSH_LOG=$(mktemp)
if $SUPABASE db push 2>&1 | tee "$PUSH_LOG"; then
  ok "Database is set up"
else
  if grep -qi "already exists" "$PUSH_LOG"; then
    die "The database already has tables in it." \
"  This project was supposed to be empty. Two possibilities:

    1. You're pointed at the wrong project. Check the ref above.
    2. Someone already ran these by pasting into the SQL Editor.

  Don't try to fix this by pasting more SQL — ask before continuing.
  See docs/DEPLOY.md section 2."
  fi
  die "Database setup failed. The error is above." \
"  If it mentions a password, reset it at:
  https://supabase.com/dashboard/project/$PROJECT_REF/settings/database"
fi

# 'rotated: 0' here is the CORRECT result on a fresh project — 003 seeds
# non-enumerable codes directly, so 008 finds nothing to fix.
grep -qi "Skipping dev advocate users" "$PUSH_LOG" \
  && ok "Test accounts with known passwords were correctly skipped"

# ── 8. verify ──────────────────────────────────────────────────────────────
step "Checking the money ledger is sound"

# Deliberately NOT run through the CLI. The Supabase CLI has no reliable
# subcommand for running ad-hoc SQL against a linked project, so this uses
# the SQL Editor — which for someone new is easier anyway: one paste, one
# click, a readable table of results.
CHECK_SQL="select * from check_ledger_invariants();"

printf "  Five rules must hold before any real money touches this.\n\n"

if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$CHECK_SQL" | pbcopy
  ok "Copied the check to your clipboard"
  COPIED=1
else
  COPIED=0
fi

printf "\n  1. Open this page:\n"
printf "     ${C}https://supabase.com/dashboard/project/%s/sql/new${X}\n" "$PROJECT_REF"
if [ "$COPIED" = "1" ]; then
  printf "  2. Paste (Cmd-V) and click ${B}Run${X}\n"
else
  printf "  2. Paste this and click ${B}Run${X}:\n\n       %s\n" "$CHECK_SQL"
fi
printf "  3. You should see five rows, all saying ${B}true${X}\n\n"

command -v open >/dev/null 2>&1 && \
  open "https://supabase.com/dashboard/project/$PROJECT_REF/sql/new" 2>/dev/null

printf "  Did all five say true? [y/N] "
read -r reply
case "$reply" in
  [yY]*) ok "Ledger verified" ;;
  *) die "Stop here — do not load any real money." \
"  Copy what you saw and send it to whoever is helping with the code.
  A failing invariant means the accounting is wrong, and that is worth
  fixing before a single dollar moves." ;;
esac

# ── 9. env file ────────────────────────────────────────────────────────────
step "Creating your .env.local file"

if [ -f ".env.local" ]; then
  ok ".env.local already exists — leaving it alone"
elif [ -f ".env" ]; then
  # Next.js reads both and .env.local WINS. Writing a blank .env.local next
  # to a filled-in .env would silently override real keys with empty ones,
  # and the resulting failure looks nothing like its cause.
  warn "You have a .env file with settings in it."
  printf "\n  This project expects ${B}.env.local${X}. Next.js reads both, and\n"
  printf "  .env.local takes priority — so creating a blank one now would\n"
  printf "  override the keys you already put in .env.\n\n"
  printf "  Rename .env to .env.local and keep what's in it? [Y/n] "
  read -r reply
  case "$reply" in
    [nN]*) warn "Left alone. Make sure only ONE of them holds your keys." ;;
    *)
      mv .env .env.local && ok "Renamed .env to .env.local — your keys are intact"
      printf "  Check it still has HOPE_QR_SIGNING_SECRET and CRON_SECRET:\n"
      printf "    ${C}grep -c SECRET .env.local${X}   (should print 2 or more)\n"
      ;;
  esac
else
  # Generated here so nobody has to invent them, and so they're actually random.
  QR_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  CRON_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

  cat > .env.local <<EOF
# HOPE Card — local environment
# Generated by scripts/setup.sh. Never commit this file.

NEXT_PUBLIC_SUPABASE_URL=https://$PROJECT_REF.supabase.co

# ── PASTE THESE TWO from:
# https://supabase.com/dashboard/project/$PROJECT_REF/settings/api
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ── PASTE THESE from your Stripe dashboard (use TEST keys to start)
# https://dashboard.stripe.com/test/apikeys
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# ── Generated for you. Random, and already correct.
HOPE_QR_SIGNING_SECRET=$QR_SECRET
CRON_SECRET=$CRON_SECRET

NEXT_PUBLIC_APP_URL=http://localhost:3000

# ── The real lost-card phone line. Leave blank until you have one —
# blank makes the app say "ask your outreach worker" instead of
# sending someone to a wrong number.
NEXT_PUBLIC_HOPE_INVALIDATION_PHONE=
EOF
  ok "Created .env.local with two secrets generated for you"
fi

# ── done ───────────────────────────────────────────────────────────────────
printf "\n${B}${G}Database is ready.${X}\n"
printf "\n${B}Three things left, all needing your logins:${X}\n\n"

printf "  ${B}1. Fill in the blanks in .env.local${X}\n"
printf "     Open it:  ${C}open -e .env.local${X}\n"
printf "     Supabase keys:  ${C}https://supabase.com/dashboard/project/%s/settings/api${X}\n" "$PROJECT_REF"
printf "     Stripe keys:    ${C}https://dashboard.stripe.com/test/apikeys${X}\n\n"

printf "  ${B}2. Make yourself an admin${X}\n"
printf "     There are no accounts yet — the test ones were removed on purpose.\n"
printf "     Create yours:   ${C}https://supabase.com/dashboard/project/%s/auth/users${X}\n" "$PROJECT_REF"
printf "     ('Add user' → your email → a strong password → tick Auto Confirm)\n"
printf "     Then run:       ${C}bash scripts/make-me-admin.sh${X}\n\n"

printf "  ${B}3. Start the app${X}\n"
printf "     ${C}npm run dev${X}   then open http://localhost:3000\n\n"

printf "  Stuck on any of these? Say which number and what you see.\n\n"
