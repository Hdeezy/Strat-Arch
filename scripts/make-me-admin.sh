#!/usr/bin/env bash
#
# HOPE Card — turn your Supabase account into an admin.
#
#   bash scripts/make-me-admin.sh
#
# A fresh database has NO admin and NO advocate accounts. That is deliberate:
# the old seed created two accounts whose passwords are published in this
# repo's git history, so they were removed rather than left as a trap.
#
# This grants your real account the two roles it needs:
#   charity_admin — see the dashboard, exports, settlement
#   advocate      — load and invalidate cards
#
# Run it AFTER creating your user in the Supabase dashboard.

set -uo pipefail

PROJECT_REF="avwtfnfmkxeksfvtkyei"

if [ -t 1 ]; then
  B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; C=$'\033[36m'; X=$'\033[0m'
else
  B=""; R=""; G=""; C=""; X=""
fi
ok()  { printf "  ${G}✓${X} %s\n" "$1"; }
die() { printf "\n  ${R}✗ %s${X}\n\n" "$1"; [ $# -gt 1 ] && printf "%s\n\n" "$2"; exit 1; }

printf "\n${B}Make me an admin${X}\n\n"

[ -d "supabase/migrations" ] || die "Run this from the project folder." \
"  Try:  cd ~/Projects/Strat-Arch"

command -v supabase >/dev/null 2>&1 || die "Supabase CLI not installed." \
"  Run scripts/setup.sh first."

printf "First, create your account if you haven't:\n"
printf "  ${C}https://supabase.com/dashboard/project/%s/auth/users${X}\n" "$PROJECT_REF"
printf "  Click ${B}Add user${X} → your email → a strong password → tick ${B}Auto Confirm User${X}\n\n"
printf "Then copy the ${B}User UID${X} from the list (a long string with dashes).\n\n"

printf "Paste your User UID: "
read -r USER_ID
USER_ID=$(printf '%s' "$USER_ID" | tr -d '[:space:]')

# Fail on a malformed id here rather than letting Postgres reject it with a
# message that means nothing to someone who hasn't seen a UUID before.
if ! printf '%s' "$USER_ID" | grep -Eqi '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
  die "That doesn't look like a User UID." \
"  It should look like:  3f8a1c2e-4b5d-6789-a012-3456789abcde
  Copy it from the ID column in the Supabase Authentication → Users list."
fi

printf "Your full name (shown to outreach staff): "
read -r FULL_NAME
[ -z "$FULL_NAME" ] && FULL_NAME="HOPE Admin"

printf "Your phone (optional, press Enter to skip): "
read -r PHONE

printf "\n  Granting charity_admin + advocate to %s...\n\n" "$USER_ID"

SQL=$(cat <<EOF
do \$\$
declare
  v_user uuid := '$USER_ID';
  v_charity uuid;
begin
  if not exists (select 1 from auth.users where id = v_user) then
    raise exception 'No Supabase user with that ID. Create the account in the dashboard first.';
  end if;

  select id into v_charity from charities order by created_at limit 1;
  if v_charity is null then
    raise exception 'No charity exists. Run scripts/setup.sh first.';
  end if;

  insert into profiles (user_id, role, full_name, phone)
  values (v_user, 'charity_admin', '$FULL_NAME', nullif('$PHONE',''))
  on conflict (user_id) do update
    set role = 'charity_admin', full_name = excluded.full_name, phone = excluded.phone;

  insert into advocates (charity_id, user_id, full_name, phone, is_active)
  values (v_charity, v_user, '$FULL_NAME', nullif('$PHONE',''), true)
  on conflict (charity_id, user_id) do update
    set is_active = true, full_name = excluded.full_name;

  raise notice 'Done. % is now charity_admin and an active advocate.', '$FULL_NAME';
end \$\$;
EOF
)

# Run through the SQL Editor rather than the CLI. The Supabase CLI has no
# dependable subcommand for ad-hoc SQL against a linked project, and for
# someone new a paste-and-click is clearer than a command anyway.
SQL_FILE="$(mktemp -t hope-admin).sql"
printf '%s\n' "$SQL" > "$SQL_FILE"

if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$SQL" | pbcopy
  ok "Copied the SQL to your clipboard"
else
  printf "  Saved to: %s\n" "$SQL_FILE"
fi

printf "\n  1. Open this page:\n"
printf "     ${C}https://supabase.com/dashboard/project/%s/sql/new${X}\n" "$PROJECT_REF"
printf "  2. Paste (Cmd-V) and click ${B}Run${X}\n"
printf "  3. Look for ${B}Success${X}, or a notice ending 'is now charity_admin'\n\n"

command -v open >/dev/null 2>&1 && \
  open "https://supabase.com/dashboard/project/$PROJECT_REF/sql/new" 2>/dev/null

printf "  Did it say Success? [y/N] "
read -r reply
case "$reply" in
  [yY]*) ok "You are now a charity_admin and an advocate" ;;
  *) die "It didn't work." \
"  The SQL is saved at:
    $SQL_FILE

  If the error mentions 'No Supabase user with that ID', the account wasn't
  created yet — make it in the dashboard first, then run this again.
  Any other error: send it along with the SQL above." ;;
esac

rm -f "$SQL_FILE"

printf "\n${B}You're set.${X}\n\n"
printf "  Start the app:  ${C}npm run dev${X}\n"
printf "  Then log in at  ${C}http://localhost:3000/auth/login${X}\n\n"
printf "  ${B}/admin${X}     dashboard, cards, exports\n"
printf "  ${B}/advocate${X}  load and hand out cards\n\n"
printf "  To use the merchant scanner you also need a merchant_staff row.\n"
printf "  Ask for that when you get there — it's one more insert.\n\n"
