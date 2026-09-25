/*
 * A Lua 5.3 REPL core for the browser, built against the exact Lua source TIC-80 embeds
 * (lua/lua 75ea9cc, 5.3.6) with the same compile flag (LUA_COMPAT_5_2) and the standard
 * libraries TIC-80 opens, plus a small `io` with only io.read and io.write, on the terminal:
 * no files, no os, no utf8.
 *
 * The REPL rules are those of the standalone `lua` interpreter (lua.c): an entry is tried as
 * an expression first, then as a statement; a syntax error ending in <eof> means "not finished".
 */
#include <stdio.h>
#include <stdlib.h>
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

/* ---- keyboard input ------------------------------------------------------------------------ */

/* One line typed in the terminal (malloc'd, without its newline), or NULL at the end of input.
   When the page offers no input at all, *failed is set and the result is the message to raise. */
EM_JS(char *, js_read_line, (int *failed), {
  try {
    const line = Module.readLine();
    return line === null ? 0 : stringToNewUTF8(line);
  } catch (err) {
    HEAP32[failed >> 2] = 1;
    return stringToNewUTF8(String(err.message || err));
  }
});

/* What has been typed and not read yet. Emptied at each entry: the answers typed for one entry
   are not left over for the next. */
static char *in_buf = NULL;
static size_t in_len = 0, in_pos = 0;

/* Wait for one more line, kept with its newline. 0 at the end of input. */
static int fill(lua_State *L) {
  int failed = 0;
  char *line = js_read_line(&failed);
  if (failed) {
    luaL_where(L, 1);
    lua_pushstring(L, line);
    free(line);
    lua_concat(L, 2);
    lua_error(L);
  }
  if (line == NULL) return 0;
  size_t rest = in_len - in_pos, n = strlen(line);
  char *buf = malloc(rest + n + 1);
  memcpy(buf, in_buf + in_pos, rest);
  memcpy(buf + rest, line, n);
  buf[rest + n] = '\n';
  free(in_buf);
  free(line);
  in_buf = buf;
  in_len = rest + n + 1;
  in_pos = 0;
  return 1;
}

static int read_line(lua_State *L, int keep_newline) {
  if (in_pos == in_len && !fill(L)) return 0;
  const char *s = in_buf + in_pos, *nl = memchr(s, '\n', in_len - in_pos);
  size_t n = nl ? (size_t)(nl - s) : in_len - in_pos;
  lua_pushlstring(L, s, n + (keep_newline && nl));
  in_pos += n + (nl != NULL);
  return 1;
}

static int read_chars(lua_State *L, size_t k) {
  while (in_len - in_pos < (k ? k : 1) && fill(L)) {}
  if (in_pos == in_len) return 0;
  size_t n = in_len - in_pos < k ? in_len - in_pos : k;
  lua_pushlstring(L, in_buf + in_pos, n);
  in_pos += n;
  return 1;
}

static int read_all(lua_State *L) {
  while (fill(L)) {}
  lua_pushlstring(L, in_buf + in_pos, in_len - in_pos);
  in_pos = in_len;
  return 1;
}

/* Like liolib: skip spaces (and lines), take the characters a numeral can have, convert. */
static int read_number(lua_State *L) {
  for (;;) {
    while (in_pos < in_len && strchr(" \t\r\n\f\v", in_buf[in_pos])) in_pos++;
    if (in_pos < in_len) break;
    if (!fill(L)) return 0;
  }
  char numeral[201];
  size_t n = 0;
  while (in_pos < in_len && n < sizeof(numeral) - 1
         && strchr("0123456789abcdefABCDEFxXpP.+-", in_buf[in_pos])) {
    numeral[n++] = in_buf[in_pos++];
  }
  numeral[n] = '\0';
  if (lua_stringtonumber(L, numeral) == 0) return 0;
  return 1;
}

/* io.read(...): the formats of Lua 5.3 ("l", "L", "n", "a", a count), from the keyboard. */
static int io_read(lua_State *L) {
  int nargs = lua_gettop(L);
  if (nargs == 0) {
    lua_pushliteral(L, "l");
    nargs = 1;
  }
  luaL_checkstack(L, nargs + LUA_MINSTACK, "too many arguments");
  int n;
  for (n = 1; n <= nargs; n++) {
    int ok;
    if (lua_type(L, n) == LUA_TNUMBER) {
      ok = read_chars(L, (size_t)luaL_checkinteger(L, n));
    } else {
      const char *p = luaL_checkstring(L, n);
      if (*p == '*') p++;
      switch (*p) {
        case 'n': ok = read_number(L); break;
        case 'l': ok = read_line(L, 0); break;
        case 'L': ok = read_line(L, 1); break;
        case 'a': ok = read_all(L); break;
        default: return luaL_argerror(L, n, "invalid format");
      }
    }
    if (!ok) {
      lua_pushnil(L);
      return n;
    }
  }
  return nargs;
}

/* io.write(...): strings and numbers, written as liolib writes them, without a newline. It
   returns io, so io.write(a):write(b) works as with the real io.write, which returns a file. */
static int io_write(lua_State *L) {
  int top = lua_gettop(L);
  int first = lua_rawequal(L, 1, lua_upvalueindex(1)) ? 2 : 1;   /* called as a method */
  for (int i = first; i <= top; i++) {
    size_t len;
    const char *s;
    char num[64];
    if (lua_type(L, i) == LUA_TNUMBER) {
      len = lua_isinteger(L, i)
          ? (size_t)snprintf(num, sizeof(num), LUA_INTEGER_FMT, (LUAI_UACINT)lua_tointeger(L, i))
          : (size_t)snprintf(num, sizeof(num), LUA_NUMBER_FMT, (LUAI_UACNUMBER)lua_tonumber(L, i));
      s = num;
    } else {
      s = luaL_checklstring(L, i, &len);
    }
    write_str(s, len, OUT_STDOUT);
  }
  lua_pushvalue(L, lua_upvalueindex(1));
  return 1;
}

static int open_io(lua_State *L) {
  lua_newtable(L);
  lua_pushcfunction(L, io_read);
  lua_setfield(L, -2, "read");
  lua_pushvalue(L, -1);
  lua_pushcclosure(L, io_write, 1);
  lua_setfield(L, -2, "write");
  return 1;
}

/* ---- the REPL -------------------------------------------------------------------------------- */

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
    { LUA_IOLIBNAME, open_io },      /* not in TIC-80: io.read and io.write only */
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
  in_pos = in_len;
  if (load_entry(src) != LUA_OK || lua_pcall(L, 0, LUA_MULTRET, 0) != LUA_OK) {
    write_error(L);
  } else if (lua_gettop(L) > 0) {
    write_values(L, 1, OUT_RESULT);
  }
  lua_settop(L, 0);
}
