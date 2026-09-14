/*
 * A Lua 5.3 REPL core for the browser, built against the exact Lua source TIC-80 embeds
 * (lua/lua 75ea9cc, 5.3.6) with the same compile flag (LUA_COMPAT_5_2) and the same standard
 * libraries: no io, no os, no utf8. What works here works in a TIC-80 cart, and the reverse.
 *
 * The REPL rules are those of the standalone `lua` interpreter (lua.c): an entry is tried as
 * an expression first, then as a statement; a syntax error ending in <eof> means "not finished".
 */
#include <string.h>
#include <emscripten.h>
#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"

enum { OUT_STDOUT = 0, OUT_RESULT = 1, OUT_ERROR = 2 };

EM_JS(void, js_write, (const char *s, size_t len, int stream), {
  Module.onWrite(HEAPU8.slice(s, s + len), stream);
});

static lua_State *L = NULL;

static void write_str(const char *s, size_t len, int stream) { js_write(s, len, stream); }

/* Every value of the stack from `first` to the top, tab-separated, then a newline. */
static void write_values(lua_State *L, int first, int stream) {
  int top = lua_gettop(L);
  for (int i = first; i <= top; i++) {
    size_t len;
    const char *s = luaL_tolstring(L, i, &len);
    if (i > first) write_str("\t", 1, stream);
    write_str(s, len, stream);
    lua_pop(L, 1);
  }
  write_str("\n", 1, stream);
}

static int l_print(lua_State *L) {
  write_values(L, 1, OUT_STDOUT);
  return 0;
}

/* Same message lua.c shows for an error object that is not a string. */
static void write_error(lua_State *L) {
  size_t len;
  const char *msg = lua_tolstring(L, -1, &len);
  if (msg == NULL) {
    if (luaL_callmeta(L, -1, "__tostring") && lua_type(L, -1) == LUA_TSTRING) {
      msg = lua_tolstring(L, -1, &len);
    } else {
      msg = lua_pushfstring(L, "(error object is a %s value)", luaL_typename(L, -1));
      len = strlen(msg);
    }
  }
  write_str(msg, len, OUT_ERROR);
  write_str("\n", 1, OUT_ERROR);
}

EMSCRIPTEN_KEEPALIVE
const char *repl_version(void) { return LUA_RELEASE; }

EMSCRIPTEN_KEEPALIVE
int repl_init(void) {
  static const luaL_Reg libs[] = {   /* the list TIC-80 opens, in src/api/luaapi.c */
    { "_G", luaopen_base },
    { LUA_LOADLIBNAME, luaopen_package },
    { LUA_COLIBNAME, luaopen_coroutine },
    { LUA_TABLIBNAME, luaopen_table },
    { LUA_STRLIBNAME, luaopen_string },
    { LUA_MATHLIBNAME, luaopen_math },
    { LUA_DBLIBNAME, luaopen_debug },
    { NULL, NULL },
  };
  L = luaL_newstate();
  if (L == NULL) return 0;
  for (const luaL_Reg *lib = libs; lib->func; lib++) {
    luaL_requiref(L, lib->name, lib->func, 1);
    lua_pop(L, 1);
  }
  lua_register(L, "print", l_print);
  return 1;
}

static int load_entry(const char *src) {
  lua_pushfstring(L, "return %s", src);
  size_t len;
  const char *ret = lua_tolstring(L, -1, &len);
  int status = luaL_loadbuffer(L, ret, len, "=stdin");
  lua_remove(L, -2);
  if (status == LUA_OK) return LUA_OK;
  lua_pop(L, 1);
  return luaL_loadbuffer(L, src, strlen(src), "=stdin");
}

/* 1: complete, 0: the entry needs more lines. */
EMSCRIPTEN_KEEPALIVE
int repl_check(const char *src) {
  int status = load_entry(src);
  int complete = 1;
  if (status == LUA_ERRSYNTAX) {
    size_t len;
    const char *msg = lua_tolstring(L, -1, &len);
    const size_t eof = sizeof("<eof>") - 1;
    complete = !(msg && len >= eof && strcmp(msg + len - eof, "<eof>") == 0);
  }
  lua_settop(L, 0);
  return complete;
}

EMSCRIPTEN_KEEPALIVE
void repl_run(const char *src) {
  lua_settop(L, 0);
  if (load_entry(src) != LUA_OK || lua_pcall(L, 0, LUA_MULTRET, 0) != LUA_OK) {
    write_error(L);
  } else if (lua_gettop(L) > 0) {
    write_values(L, 1, OUT_RESULT);
  }
  lua_settop(L, 0);
}
