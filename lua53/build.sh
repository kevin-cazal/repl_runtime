#!/usr/bin/env bash
# Rebuild vendor/lua53/lua53.js from the exact Lua source TIC-80 embeds. The same module runs
# the code (in the worker) and checks whether an entry is finished (in the page).
#
#   lua53/build.sh
#
# The output is committed, so `npm run build` never needs Emscripten. Run this only to change
# the Lua version or lua53/repl.c. Needs Docker.
set -euo pipefail

# TIC-80 4aba09c (the build tic80-web-editor ships) -> vendor/lua submodule -> lua/lua 75ea9cc
LUA_COMMIT="75ea9ccbea7c4886f30da147fb67b693b2624c26"   # Lua 5.3.6
EMSDK_IMAGE="emscripten/emsdk:3.1.50"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL "https://codeload.github.com/lua/lua/tar.gz/$LUA_COMMIT" | tar -xz -C "$WORK"
mv "$WORK/lua-$LUA_COMMIT" "$WORK/lua"

# The core and the libraries TIC-80 opens. Not lua.c/luac.c (programs), not liolib, loslib,
# lutf8lib, lbitlib or linit (never opened by TIC-80).
SRC="lapi lcode lctype ldebug ldo ldump lfunc lgc llex lmem lobject lopcodes lparser lstate
     lstring ltable ltm lundump lvm lzio lauxlib lbaselib lcorolib ldblib lmathlib lstrlib
     ltablib loadlib"
FILES=""
for f in $SRC; do FILES="$FILES lua/$f.c"; done

docker run --rm -v "$WORK:/w" -v "$ROOT/lua53:/repl:ro" -w /w --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e EM_CACHE=/tmp/emcache "$EMSDK_IMAGE" \
  emcc -O2 -DLUA_COMPAT_5_2 -Ilua /repl/repl.c $FILES -o lua53.js \
    -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createLua53 -sENVIRONMENT=web,worker \
    -sSINGLE_FILE -sALLOW_MEMORY_GROWTH -sSTACK_SIZE=1048576 \
    -sEXPORTED_FUNCTIONS=_repl_init,_repl_check,_repl_run,_repl_version \
    -sEXPORTED_RUNTIME_METHODS=cwrap

mkdir -p "$ROOT/vendor/lua53"
cp "$WORK/lua53.js" "$ROOT/vendor/lua53/lua53.js"
echo "vendor/lua53/lua53.js: $(du -h "$ROOT/vendor/lua53/lua53.js" | cut -f1), Lua 5.3.6 @ ${LUA_COMMIT:0:7}"
