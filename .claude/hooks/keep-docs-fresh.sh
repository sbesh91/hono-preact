#!/bin/bash
# Fires after Edit/Write tool use. If the file is in packages/, remind about keep-docs-fresh.
file=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('file_path',''))" 2>/dev/null <<< "$(cat)")
if [[ "$file" == */packages/* ]]; then
  echo "keep-docs-fresh: '$file' is in a framework package. Before committing, grep docs/ for the changed symbol and update any affected pages. See the keep-docs-fresh skill for the process."
fi
