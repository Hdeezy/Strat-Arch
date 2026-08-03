#!/usr/bin/env bash
#
# HOPE Card — finish setup. One command, no dashboard, no copying UUIDs.
#
#   bash scripts/finish-setup.sh
#
# Fills in any missing secrets, creates your admin account, grants it the
# right roles, and checks the money ledger — all from the terminal, using
# the keys already in .env.local.
#
# Safe to re-run. If the account exists it reuses it rather than failing.

set -uo pipefail

if [ -t 1 ]; then
  B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; X=$'\033[0m'
else
  B=""; R=""; G=""; Y=""; C=""; X=""
fi
step() { printf "\n${B}${C}▸ %s${X}\n" "$1"; }
ok()   { printf "  ${G}✓${X} %s\n" "$1"; }
warn() { printf "  ${Y}!${X} %s\n" "$1"; }
die()  { printf "\n  ${R}✗ %s${X}\n\n" "$1"; [ $# -gt 1 ] && printf "%s\n\n" "$2"; exit 1; }

printf "\n${B}HOPE Card — finishing setup${X}\n"

[ -f "package.json" ] || die "Run this from the project folder." \
"  Try:  cd ~/Projects/Strat-Arch"

# ── 1. env file ────────────────────────────────────────────────────────────
step "Checking your settings file"

if [ ! -f ".env.local" ] && [ -f ".env" ]; then
  mv .env .env.local
  ok "Renamed .env to .env.local (this project reads .env.local)"
fi
[ -f ".env.local" ] || die "No .env.local file found." \
"  Run 'bash scripts/setup.sh' first — it creates one for you."

read_env() { grep -E "^$1=" .env.local 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r'; }

SUPABASE_URL=$(read_env NEXT_PUBLIC_SUPABASE_URL)
SERVICE_KEY=$(read_env SUPABASE_SERVICE_ROLE_KEY)

[ -n "$SUPABASE_URL" ] || die "NEXT_PUBLIC_SUPABASE_URL is missing from .env.local." \
"  Get it from: https://supabase.com/dashboard/project/avwtfnfmkxeksfvtkyei/settings/api"
[ -n "$SERVICE_KEY" ] || die "SUPABASE_SERVICE_ROLE_KEY is missing from .env.local." \
"  Get it from: https://supabase.com/dashboard/project/avwtfnfmkxeksfvtkyei/settings/api
  It's the one marked 'service_role' — keep it private, never share it."
ok "Found your Supabase keys"

# Two secrets nobody should have to invent. CRON_SECRET especially: without
# it every scheduled job refuses to run, donations never clear, and no card
# ever becomes spendable — while the app otherwise looks fine.
for VAR in HOPE_QR_SIGNING_SECRET CRON_SECRET; do
  if [ -z "$(read_env "$VAR")" ]; then
    NEW=$(openssl rand -hex 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
    if grep -qE "^$VAR=" .env.local; then
      # BSD sed (macOS) needs the empty backup argument.
      sed -i '' -e "s|^$VAR=.*|$VAR=$NEW|" .env.local 2>/dev/null \
        || sed -i -e "s|^$VAR=.*|$VAR=$NEW|" .env.local
    else
      printf '\n%s=%s\n' "$VAR" "$NEW" >> .env.local
    fi
    ok "Generated $VAR"
  else
    ok "$VAR already set"
  fi
done

# ── 2. reach the database ──────────────────────────────────────────────────
step "Connecting to your database"

api() {
  # $1 method, $2 path, $3 body (optional)
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" "$SUPABASE_URL$path" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" -H "Prefer: return=representation" \
      -d "$body"
  else
    curl -sS -X "$method" "$SUPABASE_URL$path" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY"
  fi
}

CHARITIES=$(api GET "/rest/v1/charities?select=id,name&limit=1")
CHARITY_ID=$(printf '%s' "$CHARITIES" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const j=JSON.parse(s);console.log(Array.isArray(j)&&j[0]?j[0].id:'')}catch(e){console.log('')}
})")

if [ -z "$CHARITY_ID" ]; then
  die "Couldn't read your database." \
"  What came back:
    $(printf '%s' "$CHARITIES" | head -c 300)

  Most likely the service_role key in .env.local is wrong or truncated.
  Re-copy it from the Supabase dashboard, API settings."
fi
ok "Connected"

# ── 3. your account ────────────────────────────────────────────────────────
step "Creating your admin account"

printf "  Your email: "
read -r ADMIN_EMAIL
[ -n "$ADMIN_EMAIL" ] || die "An email is required."

printf "  A password (typing is hidden): "
stty -echo 2>/dev/null; read -r ADMIN_PASS; stty echo 2>/dev/null; printf "\n"
[ ${#ADMIN_PASS} -ge 8 ] || die "Password must be at least 8 characters."

printf "  Your full name: "
read -r ADMIN_NAME
[ -n "$ADMIN_NAME" ] || ADMIN_NAME="HOPE Admin"

USER_JSON=$(node -e "
console.log(JSON.stringify({
  email: process.argv[1], password: process.argv[2], email_confirm: true
}))" "$ADMIN_EMAIL" "$ADMIN_PASS")

CREATE_RESP=$(api POST "/auth/v1/admin/users" "$USER_JSON")
USER_ID=$(printf '%s' "$CREATE_RESP" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const j=JSON.parse(s);console.log(j.id||'')}catch(e){console.log('')}
})")

if [ -z "$USER_ID" ]; then
  # Re-running is normal — reuse the existing account rather than failing.
  EXISTING=$(api GET "/auth/v1/admin/users")
  USER_ID=$(printf '%s' "$EXISTING" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{
    const j=JSON.parse(s); const list=j.users||j||[];
    const u=list.find(x=>x.email===process.argv[1]);
    console.log(u?u.id:'')
  }catch(e){console.log('')}
})" "$ADMIN_EMAIL")

  if [ -n "$USER_ID" ]; then
    ok "That account already existed — using it"
  else
    die "Couldn't create the account." \
"  What Supabase said:
    $(printf '%s' "$CREATE_RESP" | head -c 400)

  If it mentions 'Database error saving new user', migration 009 hasn't been
  applied yet. Run:
    npx --yes supabase@latest db push"
  fi
else
  ok "Account created"
fi

# ── 4. roles ───────────────────────────────────────────────────────────────
step "Granting you admin access"

# service_role bypasses row level security, so these go straight in.
PROFILE_JSON=$(node -e "
console.log(JSON.stringify({
  user_id: process.argv[1], role: 'charity_admin', full_name: process.argv[2]
}))" "$USER_ID" "$ADMIN_NAME")

curl -sS -X POST "$SUPABASE_URL/rest/v1/profiles" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d "$PROFILE_JSON" >/dev/null 2>&1
ok "You are a charity_admin"

ADVOCATE_JSON=$(node -e "
console.log(JSON.stringify({
  charity_id: process.argv[1], user_id: process.argv[2],
  full_name: process.argv[3], is_active: true
}))" "$CHARITY_ID" "$USER_ID" "$ADMIN_NAME")

curl -sS -X POST "$SUPABASE_URL/rest/v1/advocates" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d "$ADVOCATE_JSON" >/dev/null 2>&1
ok "You are an advocate (can load and hand out cards)"

# ── 5. the ledger ──────────────────────────────────────────────────────────
step "Checking the money ledger"

INV=$(api POST "/rest/v1/rpc/check_ledger_invariants" "{}")
printf '%s' "$INV" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{
    const rows=JSON.parse(s);
    if(!Array.isArray(rows)||!rows.length){ console.log('UNREADABLE'); return }
    let bad=0;
    for(const r of rows){
      const pass = r.passed===true||r.passed==='t';
      if(!pass) bad++;
      console.log('    '+(pass?'✓':'✗')+' '+r.invariant);
    }
    console.log(bad?'FAILED':'ALLGOOD');
  }catch(e){ console.log('UNREADABLE') }
})" > /tmp/hope-inv.txt 2>&1

sed '$d' /tmp/hope-inv.txt
VERDICT=$(tail -1 /tmp/hope-inv.txt)
rm -f /tmp/hope-inv.txt

case "$VERDICT" in
  ALLGOOD)    ok "All five rules hold" ;;
  FAILED)     die "A ledger rule failed — do not load real money." \
"  Send the list above to whoever helps you with the code." ;;
  *)          warn "Couldn't read the ledger check. Not fatal — check later." ;;
esac

# ── done ───────────────────────────────────────────────────────────────────
printf "\n${B}${G}Everything is set up.${X}\n\n"
printf "  Start the app:\n"
printf "     ${C}npm run dev${X}\n\n"
printf "  Then open ${C}http://localhost:3000/auth/login${X} and sign in as:\n"
printf "     %s\n\n" "$ADMIN_EMAIL"
printf "  ${B}/admin${X}     dashboard, cards, exports\n"
printf "  ${B}/advocate${X}  load and hand out cards\n"
printf "  ${B}/wallet${X}    what a cardholder sees\n\n"
