#!/usr/bin/env bash
set -euo pipefail
umask 077
directory=/var/backups/lingua
stamp=$(TZ=Asia/Tehran date +%Y%m%d-%H%M%S)
target="$directory/lingua-$stamp.dump"
trap 'rm -f -- "$target.partial"' EXIT
pg_dump --format=custom --no-owner --no-acl --dbname=lingua --file="$target.partial"
pg_restore --list "$target.partial" >/dev/null
mv -- "$target.partial" "$target"
find "$directory" -maxdepth 1 -type f -name 'lingua-*.dump' -mtime +14 -delete
echo "Verified backup archive: $target"
