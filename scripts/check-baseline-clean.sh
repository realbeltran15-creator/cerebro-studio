#!/usr/bin/env bash
# The structure snapshots must carry NO data and NO secrets. Fails on: top-level INSERT/COPY (other than the public=false storage bucket row),
# UUID literals, e-mail addresses, JWT/API-key shapes, URLs, the Production project ref, long literal string defaults.
set -u; cd "$(dirname "$0")/../supabase/schema"; bad=0
chk() { local what=$1 pat=$2; shift 2; local hits; hits=$(grep -nE "$pat" "$@" 2>/dev/null | grep -v "^\S*:[0-9]*:--" || true); [ -n "$hits" ] && { echo "FALLA: $what"; echo "$hits" | head -5; bad=1; }; return 0; }
FILES="baseline_live.sql live-columns.txt live-constraints.txt live-other.sql live-counts.txt"
top=$(grep -nE "^(insert into|copy |INSERT INTO|COPY )" baseline_live.sql live-other.sql | grep -v "insert into storage.buckets (id, name, public) values ('generated-assets', 'generated-assets', false)" || true)
[ -n "$top" ] && { echo "FALLA: sentencias de datos a nivel superior"; echo "$top" | head; bad=1; }
chk "UUID literal" "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" $FILES
chk "correo electrónico" "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}" $FILES
chk "forma de JWT o clave" "eyJ[A-Za-z0-9_-]{10,}|sk_(live|test)_|AKIA[0-9A-Z]{12}|-----BEGIN|sb_(secret|publishable)_|service_role_key\s*[:=]" $FILES
chk "URL o ref de Production" "https?://|supabase\.co|psbvqdaksrfrkxbewrll" $FILES
chk "literal de texto largo como valor por defecto" "default '[^']{24,}'" $FILES
[ $bad = 0 ] && echo "OK: las instantáneas de estructura no contienen datos ni secretos (solo la fila del bucket privado)."; exit $bad
