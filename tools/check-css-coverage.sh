#!/usr/bin/env bash
# Comprueba que toda clase usada en el HTML/JS tiene su regla en styles.css.
set -uo pipefail
cd "$(dirname "$0")/.."

# 1) Clases usadas (atributos class= y asignaciones className)
{
  grep -ohE 'class="[^"]*"' src/index.html src/main.js
  grep -ohE 'className = .[^;]*.' src/main.js
} | tr ' ' '\n' | tr -d '"' \
  | sed 's/`//g; s/^class=//; s/^className=//; s/{[^}]*}//g; s/;$//' \
  | grep -E '^[a-zA-Z0-9:/._-]+$|^[a-zA-Z0-9:/._-]*\[[a-zA-Z0-9]+\][a-zA-Z0-9:/._-]*$' \
  | sort -u > /tmp/sup-used.txt

# 2) Clases definidas en la hoja de estilos
awk '
  { line=$0; gsub(/\\/, "", line) }
  line ~ /^\./ {
    gsub(/>/, " ", line)
    n = split(line, parts, /[ ,{]+/)
    for (i = 1; i <= n; i++) {
      s = parts[i]
      if (s == "" || s !~ /^\./) continue
      sub(/^\./, "", s)
      if (s ~ /::?[a-z-]+$/) { tmp = s; sub(/::?[a-z-]+$/, "", tmp); if (tmp != "") s = tmp }
      print s
    }
  }' src/styles.css | sort -u > /tmp/sup-defined.txt

# 3) Clases que son gancho de JS o marcadores, no necesitan estilo propio
HOOKS="app-checkbox|className|group|ignore-btn|install-btn|repair-btn|unignore-btn|uninstall-btn|upgrade-btn|size-slot"

echo "usadas=$(wc -l < /tmp/sup-used.txt)  definidas=$(wc -l < /tmp/sup-defined.txt)"
echo
missing=0
while IFS= read -r c; do
  if ! grep -qxF -- "$c" /tmp/sup-defined.txt; then
    if ! printf '%s' "$c" | grep -qE "^($HOOKS)$"; then
      echo "SIN REGLA CSS: $c"
      missing=$((missing + 1))
    fi
  fi
done < /tmp/sup-used.txt

if [ "$missing" -eq 0 ]; then
  echo "OK: todas las clases usadas tienen regla en styles.css"
else
  echo "FALTAN $missing reglas"
  exit 1
fi
