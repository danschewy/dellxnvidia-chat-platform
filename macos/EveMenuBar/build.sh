#!/bin/zsh
set -euo pipefail

source_dir="${0:A:h}"
project_dir="${source_dir:h:h}"
app_dir="${project_dir}/dist/Eve.app"
contents_dir="${app_dir}/Contents"

mkdir -p "${contents_dir}/MacOS" "${contents_dir}/Resources"
cp "${source_dir}/Info.plist" "${contents_dir}/Info.plist"

mkdir -p "${project_dir}/dist/ModuleCache"
clang \
  -fobjc-arc \
  -fmodules-cache-path="${project_dir}/dist/ModuleCache" \
  -O2 \
  -framework Cocoa \
  -framework Carbon \
  -framework WebKit \
  "${source_dir}/Sources/main.m" \
  -o "${contents_dir}/MacOS/Eve"

codesign --force --deep --sign - "${app_dir}"
echo "Built ${app_dir}"
