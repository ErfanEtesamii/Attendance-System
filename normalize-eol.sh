#!/usr/bin/env bash
# تبدیل فایل‌های متنی پروژه به LF و حذف BOM (مطابق .editorconfig). از ریشه‌ی پروژه اجرا شود.
# .bat و .ps1 عمداً دست نمی‌خورند (ویندوز CRLF می‌خواهد). فایل‌های باینری (تصویر، فونت) لمس نمی‌شوند.
set -euo pipefail
find . \( -path ./node_modules -o -path ./.git -o -path ./data -o -path ./attachments \) -prune -o -type f \
  \( -name '*.js' -o -name '*.json' -o -name '*.md' -o -name '*.css' -o -name '*.html' -o -name '*.svg' \
     -o -name '.editorconfig' -o -name '.gitignore' -o -name '.env.example' \) -print0 |
  xargs -0 sed -i '1s/^\xEF\xBB\xBF//; s/\r$//'
echo "done"
