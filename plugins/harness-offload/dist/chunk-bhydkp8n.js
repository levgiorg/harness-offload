import {
  __toESM,
  __commonJS
} from "./chunk-svvq99r5.js";

// node_modules/sisteransi/src/index.js
var require_src = __commonJS(function(exports, module) {
  var ESC = "\x1B";
  var CSI = `${ESC}[`;
  var beep = "\x07";
  var cursor = {
    to(x, y) {
      if (!y)
        return `${CSI}${x + 1}G`;
      return `${CSI}${y + 1};${x + 1}H`;
    },
    move(x, y) {
      let ret = "";
      if (x < 0)
        ret += `${CSI}${-x}D`;
      else if (x > 0)
        ret += `${CSI}${x}C`;
      if (y < 0)
        ret += `${CSI}${-y}A`;
      else if (y > 0)
        ret += `${CSI}${y}B`;
      return ret;
    },
    up: (count = 1) => `${CSI}${count}A`,
    down: (count = 1) => `${CSI}${count}B`,
    forward: (count = 1) => `${CSI}${count}C`,
    backward: (count = 1) => `${CSI}${count}D`,
    nextLine: (count = 1) => `${CSI}E`.repeat(count),
    prevLine: (count = 1) => `${CSI}F`.repeat(count),
    left: `${CSI}G`,
    hide: `${CSI}?25l`,
    show: `${CSI}?25h`,
    save: `${ESC}7`,
    restore: `${ESC}8`
  };
  var scroll = {
    up: (count = 1) => `${CSI}S`.repeat(count),
    down: (count = 1) => `${CSI}T`.repeat(count)
  };
  var erase = {
    screen: `${CSI}2J`,
    up: (count = 1) => `${CSI}1J`.repeat(count),
    down: (count = 1) => `${CSI}J`.repeat(count),
    line: `${CSI}2K`,
    lineEnd: `${CSI}K`,
    lineStart: `${CSI}1K`,
    lines(count) {
      let clear = "";
      for (let i = 0;i < count; i++)
        clear += this.line + (i < count - 1 ? cursor.up() : "");
      if (count)
        clear += cursor.left;
      return clear;
    }
  };
  module.exports = { cursor, scroll, erase, beep };
});

// node_modules/@clack/core/dist/index.mjs
import { styleText } from "node:util";
import { stdout, stdin } from "node:process";
import * as l from "node:readline";
import l__default from "node:readline";

// node_modules/fast-string-truncated-width/dist/utils.js
var getCodePointsLength = (() => {
  const SURROGATE_PAIR_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
  return (input) => {
    let surrogatePairsNr = 0;
    SURROGATE_PAIR_RE.lastIndex = 0;
    while (SURROGATE_PAIR_RE.test(input)) {
      surrogatePairsNr += 1;
    }
    return input.length - surrogatePairsNr;
  };
})();
var isFullWidth = (x) => {
  return x === 12288 || x >= 65281 && x <= 65376 || x >= 65504 && x <= 65510;
};
var isWideNotCJKTNotEmoji = (x) => {
  return x === 8987 || x === 9001 || x >= 12272 && x <= 12287 || x >= 12289 && x <= 12350 || x >= 12441 && x <= 12543 || x >= 12549 && x <= 12591 || x >= 12593 && x <= 12686 || x >= 12688 && x <= 12771 || x >= 12783 && x <= 12830 || x >= 12832 && x <= 12871 || x >= 12880 && x <= 19903 || x >= 65040 && x <= 65049 || x >= 65072 && x <= 65106 || x >= 65108 && x <= 65126 || x >= 65128 && x <= 65131 || x >= 127488 && x <= 127490 || x >= 127504 && x <= 127547 || x >= 127552 && x <= 127560 || x >= 131072 && x <= 196605 || x >= 196608 && x <= 262141;
};

// node_modules/fast-string-truncated-width/dist/index.js
var ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\u001b\]8;[^;]*;.*?(?:\u0007|\u001b\u005c)/y;
var CONTROL_RE = /[\x00-\x08\x0A-\x1F\x7F-\x9F]{1,1000}/y;
var CJKT_WIDE_RE = /(?:(?![\uFF61-\uFF9F\uFF00-\uFFEF])[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Tangut}]){1,1000}/yu;
var TAB_RE = /\t{1,1000}/y;
var EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F3F4}[\u{E0061}-\u{E007A}]{2}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,3}\u{E007F}|(?:\p{Emoji}\uFE0F\u20E3?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation})(?:\u200D(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation}|\p{Emoji}\uFE0F\u20E3?))*/yu;
var LATIN_RE = /(?:[\x20-\x7E\xA0-\xFF](?!\uFE0F)){1,1000}/y;
var MODIFIER_RE = /\p{M}+/gu;
var NO_TRUNCATION = { limit: Infinity, ellipsis: "" };
var getStringTruncatedWidth = (input, truncationOptions = {}, widthOptions = {}) => {
  const LIMIT = truncationOptions.limit ?? Infinity;
  const ELLIPSIS = truncationOptions.ellipsis ?? "";
  const ELLIPSIS_WIDTH = truncationOptions?.ellipsisWidth ?? (ELLIPSIS ? getStringTruncatedWidth(ELLIPSIS, NO_TRUNCATION, widthOptions).width : 0);
  const ANSI_WIDTH = 0;
  const CONTROL_WIDTH = widthOptions.controlWidth ?? 0;
  const TAB_WIDTH = widthOptions.tabWidth ?? 8;
  const EMOJI_WIDTH = widthOptions.emojiWidth ?? 2;
  const FULL_WIDTH_WIDTH = 2;
  const REGULAR_WIDTH = widthOptions.regularWidth ?? 1;
  const WIDE_WIDTH = widthOptions.wideWidth ?? FULL_WIDTH_WIDTH;
  const PARSE_BLOCKS = [
    [LATIN_RE, REGULAR_WIDTH],
    [ANSI_RE, ANSI_WIDTH],
    [CONTROL_RE, CONTROL_WIDTH],
    [TAB_RE, TAB_WIDTH],
    [EMOJI_RE, EMOJI_WIDTH],
    [CJKT_WIDE_RE, WIDE_WIDTH]
  ];
  let indexPrev = 0;
  let index = 0;
  let length = input.length;
  let lengthExtra = 0;
  let truncationEnabled = false;
  let truncationIndex = length;
  let truncationLimit = Math.max(0, LIMIT - ELLIPSIS_WIDTH);
  let unmatchedStart = 0;
  let unmatchedEnd = 0;
  let width = 0;
  let widthExtra = 0;
  outer:
    while (true) {
      if (unmatchedEnd > unmatchedStart || index >= length && index > indexPrev) {
        const unmatched = input.slice(unmatchedStart, unmatchedEnd) || input.slice(indexPrev, index);
        lengthExtra = 0;
        for (const char of unmatched.replaceAll(MODIFIER_RE, "")) {
          const codePoint = char.codePointAt(0) || 0;
          if (isFullWidth(codePoint)) {
            widthExtra = FULL_WIDTH_WIDTH;
          } else if (isWideNotCJKTNotEmoji(codePoint)) {
            widthExtra = WIDE_WIDTH;
          } else {
            widthExtra = REGULAR_WIDTH;
          }
          if (width + widthExtra > truncationLimit) {
            truncationIndex = Math.min(truncationIndex, Math.max(unmatchedStart, indexPrev) + lengthExtra);
          }
          if (width + widthExtra > LIMIT) {
            truncationEnabled = true;
            break outer;
          }
          lengthExtra += char.length;
          width += widthExtra;
        }
        unmatchedStart = unmatchedEnd = 0;
      }
      if (index >= length) {
        break outer;
      }
      for (let i = 0, l = PARSE_BLOCKS.length;i < l; i++) {
        const [BLOCK_RE, BLOCK_WIDTH] = PARSE_BLOCKS[i];
        BLOCK_RE.lastIndex = index;
        if (BLOCK_RE.test(input)) {
          lengthExtra = BLOCK_RE === CJKT_WIDE_RE ? getCodePointsLength(input.slice(index, BLOCK_RE.lastIndex)) : BLOCK_RE === EMOJI_RE ? 1 : BLOCK_RE.lastIndex - index;
          widthExtra = lengthExtra * BLOCK_WIDTH;
          if (width + widthExtra > truncationLimit) {
            truncationIndex = Math.min(truncationIndex, index + Math.floor((truncationLimit - width) / BLOCK_WIDTH));
          }
          if (width + widthExtra > LIMIT) {
            truncationEnabled = true;
            break outer;
          }
          width += widthExtra;
          unmatchedStart = indexPrev;
          unmatchedEnd = index;
          index = indexPrev = BLOCK_RE.lastIndex;
          continue outer;
        }
      }
      index += 1;
    }
  return {
    width: truncationEnabled ? truncationLimit : width,
    index: truncationEnabled ? truncationIndex : length,
    truncated: truncationEnabled,
    ellipsed: truncationEnabled && LIMIT >= ELLIPSIS_WIDTH
  };
};
var dist_default = getStringTruncatedWidth;

// node_modules/fast-string-width/dist/index.js
var NO_TRUNCATION2 = {
  limit: Infinity,
  ellipsis: "",
  ellipsisWidth: 0
};
var fastStringWidth = (input, options = {}) => {
  return dist_default(input, NO_TRUNCATION2, options).width;
};
var dist_default2 = fastStringWidth;

// node_modules/fast-wrap-ansi/lib/main.js
var ESC = "\x1B";
var CSI = "";
var END_CODE = 39;
var ANSI_ESCAPE_BELL = "\x07";
var ANSI_CSI = "[";
var ANSI_OSC = "]";
var ANSI_SGR_TERMINATOR = "m";
var ANSI_ESCAPE_LINK = `${ANSI_OSC}8;;`;
var GROUP_REGEX = new RegExp(`(?:\\${ANSI_CSI}(?<code>\\d+)m|\\${ANSI_ESCAPE_LINK}(?<uri>.*)${ANSI_ESCAPE_BELL})`, "y");
var getClosingCode = (openingCode) => {
  if (openingCode >= 30 && openingCode <= 37)
    return 39;
  if (openingCode >= 90 && openingCode <= 97)
    return 39;
  if (openingCode >= 40 && openingCode <= 47)
    return 49;
  if (openingCode >= 100 && openingCode <= 107)
    return 49;
  if (openingCode === 1 || openingCode === 2)
    return 22;
  if (openingCode === 3)
    return 23;
  if (openingCode === 4)
    return 24;
  if (openingCode === 7)
    return 27;
  if (openingCode === 8)
    return 28;
  if (openingCode === 9)
    return 29;
  if (openingCode === 0)
    return 0;
  return;
};
var wrapAnsiCode = (code) => `${ESC}${ANSI_CSI}${code}${ANSI_SGR_TERMINATOR}`;
var wrapAnsiHyperlink = (url) => `${ESC}${ANSI_ESCAPE_LINK}${url}${ANSI_ESCAPE_BELL}`;
var wrapWord = (rows, word, columns) => {
  const characters = word[Symbol.iterator]();
  let isInsideEscape = false;
  let isInsideLinkEscape = false;
  let lastRow = rows.at(-1);
  let visible = lastRow === undefined ? 0 : dist_default2(lastRow);
  let currentCharacter = characters.next();
  let nextCharacter = characters.next();
  let rawCharacterIndex = 0;
  while (!currentCharacter.done) {
    const character = currentCharacter.value;
    const characterLength = dist_default2(character);
    if (visible + characterLength <= columns) {
      rows[rows.length - 1] += character;
    } else {
      rows.push(character);
      visible = 0;
    }
    if (character === ESC || character === CSI) {
      isInsideEscape = true;
      isInsideLinkEscape = word.startsWith(ANSI_ESCAPE_LINK, rawCharacterIndex + 1);
    }
    if (isInsideEscape) {
      if (isInsideLinkEscape) {
        if (character === ANSI_ESCAPE_BELL) {
          isInsideEscape = false;
          isInsideLinkEscape = false;
        }
      } else if (character === ANSI_SGR_TERMINATOR) {
        isInsideEscape = false;
      }
    } else {
      visible += characterLength;
      if (visible === columns && !nextCharacter.done) {
        rows.push("");
        visible = 0;
      }
    }
    currentCharacter = nextCharacter;
    nextCharacter = characters.next();
    rawCharacterIndex += character.length;
  }
  lastRow = rows.at(-1);
  if (!visible && lastRow !== undefined && lastRow.length && rows.length > 1) {
    rows[rows.length - 2] += rows.pop();
  }
};
var stringVisibleTrimSpacesRight = (string) => {
  const words = string.split(" ");
  let last = words.length;
  while (last) {
    if (dist_default2(words[last - 1])) {
      break;
    }
    last--;
  }
  if (last === words.length) {
    return string;
  }
  return words.slice(0, last).join(" ") + words.slice(last).join("");
};
var exec = (string, columns, options = {}) => {
  if (options.trim !== false && string.trim() === "") {
    return "";
  }
  let returnValue = "";
  let escapeCode;
  let escapeUrl;
  const words = string.split(" ");
  let rows = [""];
  let rowLength = 0;
  for (let index = 0;index < words.length; index++) {
    const word = words[index];
    if (options.trim !== false) {
      const row = rows.at(-1) ?? "";
      const trimmed = row.trimStart();
      if (row.length !== trimmed.length) {
        rows[rows.length - 1] = trimmed;
        rowLength = dist_default2(trimmed);
      }
    }
    if (index !== 0) {
      if (rowLength >= columns && (options.wordWrap === false || options.trim === false)) {
        rows.push("");
        rowLength = 0;
      }
      if (rowLength || options.trim === false) {
        rows[rows.length - 1] += " ";
        rowLength++;
      }
    }
    const wordLength = dist_default2(word);
    if (options.hard && wordLength > columns) {
      const remainingColumns = columns - rowLength;
      const breaksStartingThisLine = 1 + Math.floor((wordLength - remainingColumns - 1) / columns);
      const breaksStartingNextLine = Math.floor((wordLength - 1) / columns);
      if (breaksStartingNextLine < breaksStartingThisLine) {
        rows.push("");
      }
      wrapWord(rows, word, columns);
      rowLength = dist_default2(rows.at(-1) ?? "");
      continue;
    }
    if (rowLength + wordLength > columns && rowLength && wordLength) {
      if (options.wordWrap === false && rowLength < columns) {
        wrapWord(rows, word, columns);
        rowLength = dist_default2(rows.at(-1) ?? "");
        continue;
      }
      rows.push("");
      rowLength = 0;
    }
    if (rowLength + wordLength > columns && options.wordWrap === false) {
      wrapWord(rows, word, columns);
      rowLength = dist_default2(rows.at(-1) ?? "");
      continue;
    }
    rows[rows.length - 1] += word;
    rowLength += wordLength;
  }
  if (options.trim !== false) {
    rows = rows.map((row) => stringVisibleTrimSpacesRight(row));
  }
  const preString = rows.join(`
`);
  let inSurrogate = false;
  for (let i = 0;i < preString.length; i++) {
    const character = preString[i];
    returnValue += character;
    if (!inSurrogate) {
      inSurrogate = character >= "\uD800" && character <= "\uDBFF";
      if (inSurrogate) {
        continue;
      }
    } else {
      inSurrogate = false;
    }
    if (character === ESC || character === CSI) {
      GROUP_REGEX.lastIndex = i + 1;
      const groupsResult = GROUP_REGEX.exec(preString);
      const groups = groupsResult?.groups;
      if (groups?.code !== undefined) {
        const code = Number.parseFloat(groups.code);
        escapeCode = code === END_CODE ? undefined : code;
      } else if (groups?.uri !== undefined) {
        escapeUrl = groups.uri.length === 0 ? undefined : groups.uri;
      }
    }
    if (preString[i + 1] === `
`) {
      if (escapeUrl) {
        returnValue += wrapAnsiHyperlink("");
      }
      const closingCode = escapeCode ? getClosingCode(escapeCode) : undefined;
      if (escapeCode && closingCode) {
        returnValue += wrapAnsiCode(closingCode);
      }
    } else if (character === `
`) {
      if (escapeCode && getClosingCode(escapeCode)) {
        returnValue += wrapAnsiCode(escapeCode);
      }
      if (escapeUrl) {
        returnValue += wrapAnsiHyperlink(escapeUrl);
      }
    }
  }
  return returnValue;
};
var CRLF_OR_LF = /\r?\n/;
function wrapAnsi(string, columns, options) {
  return String(string).normalize().split(CRLF_OR_LF).map((line) => exec(line, columns, options)).join(`
`);
}

// node_modules/@clack/core/dist/index.mjs
var import_sisteransi = __toESM(require_src(), 1);
import { ReadStream } from "node:tty";
function findCursor(s, o, l) {
  if (!l.some((r) => !r.disabled))
    return s;
  const t = s + o, n = Math.max(l.length - 1, 0), e = t < 0 ? n : t > n ? 0 : t;
  return l[e]?.disabled ? findCursor(e, o < 0 ? -1 : 1, l) : e;
}
function findTextCursor(s, o, l, i) {
  const t = i.split(`
`);
  let n = 0, e = s;
  for (const r of t) {
    if (e <= r.length)
      break;
    e -= r.length + 1, n++;
  }
  for (n = Math.max(0, Math.min(t.length - 1, n + l)), e = Math.min(e, t[n].length) + o;e < 0 && n > 0; )
    n--, e += t[n].length + 1;
  for (;e > t[n].length && n < t.length - 1; )
    e -= t[n].length + 1, n++;
  e = Math.max(0, Math.min(t[n].length, e));
  let h = 0;
  for (let r = 0;r < n; r++)
    h += t[r].length + 1;
  return h + e;
}
var a$1 = ["up", "down", "left", "right", "space", "enter", "cancel"];
var t = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
var settings2 = {
  actions: new Set(a$1),
  aliases: /* @__PURE__ */ new Map([
    ["k", "up"],
    ["j", "down"],
    ["h", "left"],
    ["l", "right"],
    ["\x03", "cancel"],
    ["escape", "cancel"]
  ]),
  messages: {
    cancel: "Canceled",
    error: "Something went wrong"
  },
  withGuide: true,
  accessible: undefined,
  date: {
    monthNames: [...t],
    messages: {
      required: "Please enter a valid date",
      invalidMonth: "There are only 12 months in a year",
      invalidDay: (n, e) => `There are only ${n} days in ${e}`,
      afterMin: (n) => `Date must be on or after ${n.toISOString().slice(0, 10)}`,
      beforeMax: (n) => `Date must be on or before ${n.toISOString().slice(0, 10)}`
    }
  }
};
function updateSettings2(n) {
  if (n.aliases !== undefined) {
    const e = n.aliases;
    for (const s in e) {
      if (!Object.hasOwn(e, s))
        continue;
      const i = e[s];
      i === undefined || !settings2.actions.has(i) || settings2.aliases.has(s) || settings2.aliases.set(s, i);
    }
  }
  if (n.messages !== undefined) {
    const e = n.messages;
    e.cancel !== undefined && (settings2.messages.cancel = e.cancel), e.error !== undefined && (settings2.messages.error = e.error);
  }
  if (n.withGuide !== undefined && (settings2.withGuide = n.withGuide !== false), n.accessible !== undefined && (settings2.accessible = n.accessible === true), n.date !== undefined) {
    const e = n.date;
    e.monthNames !== undefined && (settings2.date.monthNames = [...e.monthNames]), e.messages !== undefined && (e.messages.required !== undefined && (settings2.date.messages.required = e.messages.required), e.messages.invalidMonth !== undefined && (settings2.date.messages.invalidMonth = e.messages.invalidMonth), e.messages.invalidDay !== undefined && (settings2.date.messages.invalidDay = e.messages.invalidDay), e.messages.afterMin !== undefined && (settings2.date.messages.afterMin = e.messages.afterMin), e.messages.beforeMax !== undefined && (settings2.date.messages.beforeMax = e.messages.beforeMax));
  }
}
function isAccessible(n) {
  if (n !== undefined)
    return n;
  if (settings2.accessible !== undefined)
    return settings2.accessible;
  const e = process.env.ACCESSIBLE;
  return e !== undefined && e !== "" && e !== "0" && e !== "false";
}
function isActionKey(n, e) {
  if (typeof n == "string")
    return settings2.aliases.get(n) === e;
  for (const s of n)
    if (s !== undefined && isActionKey(s, e))
      return true;
  return false;
}
function diffLines(i, s) {
  if (i === s)
    return;
  const e = i.split(`
`), t = s.split(`
`), r = Math.max(e.length, t.length), f = [];
  for (let n = 0;n < r; n++)
    e[n] !== t[n] && f.push(n);
  return {
    lines: f,
    numLinesBefore: e.length,
    numLinesAfter: t.length,
    numLines: r
  };
}
var R = globalThis.process.platform.startsWith("win");
var CANCEL_SYMBOL2 = Symbol("clack:cancel");
function isCancel2(e) {
  return e === CANCEL_SYMBOL2;
}
function setRawMode(e, r) {
  const o = e;
  o.isTTY && o.setRawMode(r);
}
function block({
  input: e = stdin,
  output: r = stdout,
  overwrite: o = true,
  hideCursor: n = true
} = {}) {
  const s = l.createInterface({
    input: e,
    output: r,
    prompt: "",
    tabSize: 1
  });
  l.emitKeypressEvents(e, s), e instanceof ReadStream && e.isTTY && e.setRawMode(true);
  const t = (f, { name: a, sequence: w }) => {
    const c = String(f);
    if (isActionKey([c, a, w], "cancel")) {
      n && r.write(import_sisteransi.cursor.show), process.exit(0);
      return;
    }
    if (!o)
      return;
    const i = a === "return" ? 0 : -1, m = a === "return" ? -1 : 0;
    l.moveCursor(r, i, m, () => {
      l.clearLine(r, 1, () => {
        e.once("keypress", t);
      });
    });
  };
  return n && r.write(import_sisteransi.cursor.hide), e.once("keypress", t), () => {
    e.off("keypress", t), n && r.write(import_sisteransi.cursor.show), e instanceof ReadStream && e.isTTY && !R && e.setRawMode(false), s.terminal = false, s.close();
  };
}
var getColumns = (e) => ("columns" in e) && typeof e.columns == "number" ? e.columns : 80;
var getRows = (e) => ("rows" in e) && typeof e.rows == "number" ? e.rows : 20;
function wrapTextWithPrefix(e, r, o, n = o, s = o, t) {
  const f = getColumns(e ?? stdout);
  return wrapAnsi(r, f - o.length, {
    hard: true,
    trim: false
  }).split(`
`).map((c, i, m) => {
    const d = t ? t(c, i) : c;
    return i === 0 ? `${n}${d}` : i === m.length - 1 ? `${s}${d}` : `${o}${d}`;
  }).join(`
`);
}
function runValidation(e, a) {
  if ("~standard" in e) {
    const n = e["~standard"].validate(a);
    return n instanceof Promise ? n.then((r) => r.issues?.at(0)?.message) : n.issues?.at(0)?.message;
  }
  return e(a);
}

class y {
  input;
  output;
  _abortSignal;
  rl;
  opts;
  _render;
  _track = false;
  _prevFrame = "";
  _subscribers = /* @__PURE__ */ new Map;
  _cursor = 0;
  state = "initial";
  error = "";
  value;
  userInput = "";
  get accessible() {
    return isAccessible(this.opts.accessible);
  }
  constructor(t, e = true) {
    const { input: i = stdin, output: s = stdout, render: r, signal: n, ...o } = t;
    this.opts = o, this.onKeypress = this.onKeypress.bind(this), this.close = this.close.bind(this), this.render = this.render.bind(this), this._render = r.bind(this), this._track = e, this._abortSignal = n, this.input = i, this.output = s;
  }
  unsubscribe() {
    this._subscribers.clear();
  }
  setSubscriber(t, e) {
    const i = this._subscribers.get(t) ?? [];
    i.push(e), this._subscribers.set(t, i);
  }
  on(t, e) {
    this.setSubscriber(t, { cb: e });
  }
  once(t, e) {
    this.setSubscriber(t, { cb: e, once: true });
  }
  emit(t, ...e) {
    const i = this._subscribers.get(t) ?? [], s = [];
    for (const r of i)
      r.cb(...e), r.once && s.push(() => i.splice(i.indexOf(r), 1));
    for (const r of s)
      r();
  }
  prompt() {
    return new Promise((t) => {
      if (this._abortSignal) {
        if (this._abortSignal.aborted)
          return this.state = "cancel", this.close(), t(CANCEL_SYMBOL2);
        this._abortSignal.addEventListener("abort", () => {
          this.state = "cancel", this.close();
        }, { once: true });
      }
      this.rl = l__default.createInterface({
        input: this.input,
        tabSize: 2,
        prompt: "",
        escapeCodeTimeout: 50,
        terminal: true
      }), this.rl.prompt(), this.opts.initialUserInput !== undefined && this._setUserInput(this.opts.initialUserInput, true), this.input.on("keypress", this.onKeypress), setRawMode(this.input, true), this.output.on("resize", this.render), this.render(), this.once("submit", () => {
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), setRawMode(this.input, false), t(this.value);
      }), this.once("cancel", () => {
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), setRawMode(this.input, false), t(CANCEL_SYMBOL2);
      });
    });
  }
  _isActionKey(t, e) {
    return t === "\t";
  }
  _shouldSubmit(t, e) {
    return true;
  }
  _setValue(t) {
    this.value = t, this.emit("value", this.value);
  }
  _setUserInput(t, e) {
    this.userInput = t ?? "", this.emit("userInput", this.userInput), e && this._track && this.rl && (this.rl.write(this.userInput), this._cursor = this.rl.cursor);
  }
  _clearUserInput() {
    this.rl?.write(null, { ctrl: true, name: "u" }), this._setUserInput("");
  }
  async onKeypress(t, e) {
    if (this.state !== "validating") {
      if (this._track && e.name !== "return" && (e.name && this._isActionKey(t, e) && this.rl?.write(null, { ctrl: true, name: "h" }), this._cursor = this.rl?.cursor ?? 0, this._setUserInput(this.rl?.line)), this.state === "error" && (this.state = "active"), e?.name && (!this._track && settings2.aliases.has(e.name) && this.emit("cursor", settings2.aliases.get(e.name)), settings2.actions.has(e.name) && this.emit("cursor", e.name)), t && (t.toLowerCase() === "y" || t.toLowerCase() === "n") && this.emit("confirm", t.toLowerCase() === "y"), this.emit("key", t, e), e?.name === "return" && this._shouldSubmit(t, e)) {
        if (this.opts.validate) {
          const i = runValidation(this.opts.validate, this.value);
          let s;
          i instanceof Promise ? (this.state = "validating", this.render(), s = await i) : s = i, s && (this.error = s instanceof Error ? s.message : s, this.state = "error", this.rl?.write(this.userInput));
        }
        this.state !== "error" && (this.state = "submit");
      }
      isActionKey([t, e?.name, e?.sequence], "cancel") && (this.state = "cancel"), (this.state === "submit" || this.state === "cancel") && this.emit("finalize"), this.render(), (this.state === "submit" || this.state === "cancel") && this.close();
    }
  }
  close() {
    this.input.unpipe(), this.input.removeListener("keypress", this.onKeypress), this.output.write(`
`), setRawMode(this.input, false), this.rl?.close(), this.rl = undefined, this.emit(`${this.state}`, this.value), this.unsubscribe();
  }
  restoreCursor() {
    const t = wrapAnsi(this._prevFrame, process.stdout.columns, { hard: true, trim: false }).split(`
`).length - 1;
    this.output.write(import_sisteransi.cursor.move(-999, t * -1));
  }
  render() {
    const t = wrapAnsi(this._render(this) ?? "", process.stdout.columns, {
      hard: true,
      trim: false
    });
    if (t !== this._prevFrame) {
      if (this.state === "initial")
        this.output.write(import_sisteransi.cursor.hide);
      else {
        const e = diffLines(this._prevFrame, t), i = getRows(this.output);
        if (this.restoreCursor(), e) {
          const s = Math.max(0, e.numLinesAfter - i), r = Math.max(0, e.numLinesBefore - i);
          let n = e.lines.find((o) => o >= s);
          if (n === undefined) {
            this._prevFrame = t;
            return;
          }
          if (e.lines.length === 1) {
            this.output.write(import_sisteransi.cursor.move(0, n - r)), this.output.write(import_sisteransi.erase.lines(1));
            const o = t.split(`
`);
            this.output.write(o[n]), this._prevFrame = t, this.output.write(import_sisteransi.cursor.move(0, o.length - n - 1));
            return;
          } else if (e.lines.length > 1) {
            if (s < r)
              n = s;
            else {
              const h = n - r;
              h > 0 && this.output.write(import_sisteransi.cursor.move(0, h));
            }
            this.output.write(import_sisteransi.erase.down());
            const f = t.split(`
`).slice(n);
            this.output.write(f.join(`
`)), this._prevFrame = t;
            return;
          }
        }
        this.output.write(import_sisteransi.erase.down());
      }
      this.output.write(t), this.state === "initial" && (this.state = "active"), this._prevFrame = t;
    }
  }
}
function p$1(l, e) {
  if (l === undefined || e.length === 0)
    return 0;
  const i = e.findIndex((s) => s.value === l);
  return i !== -1 ? i : 0;
}
function m(l, e) {
  return (e.label ?? String(e.value)).toLowerCase().includes(l.toLowerCase());
}
function g(l, e) {
  if (e)
    return l ? e : e[0];
}
var T$1 = class T extends y {
  filteredOptions;
  multiple;
  isNavigating = false;
  selectedValues = [];
  focusedValue;
  #e = 0;
  #s = "";
  #t;
  #i;
  #n;
  #l;
  get cursor() {
    return this.#e;
  }
  get userInputWithCursor() {
    if (!this.userInput)
      return styleText(["inverse", "hidden"], "_");
    if (this._cursor >= this.userInput.length)
      return `${this.userInput}█`;
    const e = this.userInput.slice(0, this.cursor), t = this.userInput.slice(this.cursor, this.cursor + 1), i = this.userInput.slice(this.cursor + 1);
    return `${e}${styleText("inverse", t)}${i}`;
  }
  get options() {
    return typeof this.#i == "function" ? this.#i() : this.#i;
  }
  constructor(e) {
    super(e), this.#i = e.options, this.#n = e.placeholder, this.#l = e.completeOnTab === true;
    const t = this.options;
    this.filteredOptions = [...t], this.multiple = e.multiple === true, this.#t = typeof e.options == "function" ? e.filter : e.filter ?? m;
    let i;
    if (e.initialValue && Array.isArray(e.initialValue) ? this.multiple ? i = e.initialValue : i = e.initialValue.slice(0, 1) : !this.multiple && this.options.length > 0 && (i = [this.options[0]?.value]), i)
      for (const s of i) {
        const n = t.findIndex((r) => r.value === s);
        n !== -1 && (this.toggleSelected(s), this.#e = n);
      }
    this.focusedValue = this.options[this.#e]?.value, this.on("key", (s, n) => this.#u(s, n)), this.on("userInput", (s) => this.#o(s));
  }
  _isActionKey(e, t) {
    return e === "\t" || this.multiple && this.isNavigating && t.name === "space" && e !== undefined && e !== "";
  }
  #u(e, t) {
    const i = t.name === "up", s = t.name === "down", n = t.name === "return", r = this.userInput === "" || this.userInput === "\t", u = this.#n, d = this.options, c = u !== undefined && u !== "" && d.some((o) => !o.disabled && (this.#t ? this.#t(u, o) : true));
    if (t.name === "tab" && r && c) {
      this.userInput === "\t" && this._clearUserInput(), this._setUserInput(u, true), this.isNavigating = false;
      return;
    }
    if (t.name === "tab" && this.#l && !this.multiple && this.focusedValue !== undefined) {
      const o = String(this.focusedValue);
      this._clearUserInput(), this._setUserInput(o, true), this.isNavigating = false;
      return;
    }
    i || s ? (this.#e = findCursor(this.#e, i ? -1 : 1, this.filteredOptions), this.focusedValue = this.filteredOptions[this.#e]?.value, this.multiple || (this.selectedValues = [this.focusedValue]), this.isNavigating = true) : n ? this.value = g(this.multiple, this.selectedValues) : this.multiple ? this.focusedValue !== undefined && (t.name === "tab" || this.isNavigating && t.name === "space") ? this.toggleSelected(this.focusedValue) : this.isNavigating = false : (this.focusedValue && (this.selectedValues = [this.focusedValue]), this.isNavigating = false);
  }
  deselectAll() {
    this.selectedValues = [];
  }
  toggleSelected(e) {
    this.filteredOptions.length !== 0 && (this.multiple ? this.selectedValues.includes(e) ? this.selectedValues = this.selectedValues.filter((t) => t !== e) : this.selectedValues = [...this.selectedValues, e] : this.selectedValues = [e]);
  }
  #o(e) {
    if (e !== this.#s) {
      this.#s = e;
      const t = this.options;
      e && this.#t ? this.filteredOptions = t.filter((n) => this.#t?.(e, n)) : this.filteredOptions = [...t];
      const i = p$1(this.focusedValue, this.filteredOptions);
      this.#e = findCursor(i, 0, this.filteredOptions);
      const s = this.filteredOptions[this.#e];
      s && !s.disabled ? this.focusedValue = s.value : this.focusedValue = undefined, this.multiple || (this.focusedValue !== undefined ? this.toggleSelected(this.focusedValue) : this.deselectAll());
    }
  }
};

class r extends y {
  get cursor() {
    return this.value ? 0 : 1;
  }
  get _value() {
    return this.cursor === 0;
  }
  constructor(t) {
    super(t, false), this.value = !!t.initialValue, this.on("userInput", () => {
      this.value = this._value;
    }), this.on("confirm", (i) => {
      this.output.write(import_sisteransi.cursor.move(0, -1)), this.value = i, this.state = "submit", this.close();
    }), this.on("cursor", () => {
      this.value = !this.value;
    });
  }
}
var _ = {
  Y: { type: "year", len: 4 },
  M: { type: "month", len: 2 },
  D: { type: "day", len: 2 }
};
function M(r) {
  return [...r].map((t) => _[t]);
}
function P(r) {
  const i = new Intl.DateTimeFormat(r, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(2000, 0, 15)), s = [];
  let n = "/";
  for (const e of i)
    e.type === "literal" ? n = e.value.trim() || e.value : (e.type === "year" || e.type === "month" || e.type === "day") && s.push({ type: e.type, len: e.type === "year" ? 4 : 2 });
  return { segments: s, separator: n };
}
function p(r) {
  return Number.parseInt((r || "0").replace(/_/g, "0"), 10) || 0;
}
function f(r) {
  return {
    year: p(r.year),
    month: p(r.month),
    day: p(r.day)
  };
}
function c(r, t) {
  return new Date(r || 2001, t || 1, 0).getDate();
}
function b(r) {
  const { year: t, month: i, day: s } = f(r);
  if (!t || t < 0 || t > 9999 || !i || i < 1 || i > 12 || !s || s < 1)
    return;
  const n = new Date(Date.UTC(t, i - 1, s));
  if (!(n.getUTCFullYear() !== t || n.getUTCMonth() !== i - 1 || n.getUTCDate() !== s))
    return { year: t, month: i, day: s };
}
function C(r) {
  const t = b(r);
  return t ? new Date(Date.UTC(t.year, t.month - 1, t.day)) : undefined;
}
function T(r, t, i, s) {
  const n = i ? {
    year: i.getUTCFullYear(),
    month: i.getUTCMonth() + 1,
    day: i.getUTCDate()
  } : null, e = s ? {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate()
  } : null;
  return r === "year" ? { min: n?.year ?? 1, max: e?.year ?? 9999 } : r === "month" ? {
    min: n && t.year === n.year ? n.month : 1,
    max: e && t.year === e.year ? e.month : 12
  } : {
    min: n && t.year === n.year && t.month === n.month ? n.day : 1,
    max: e && t.year === e.year && t.month === e.month ? e.day : c(t.year, t.month)
  };
}

class U extends y {
  #i;
  #o;
  #t;
  #h;
  #u;
  #e = { segmentIndex: 0, positionInSegment: 0 };
  #n = true;
  #s = null;
  inlineError = "";
  get segmentCursor() {
    return { ...this.#e };
  }
  get segmentValues() {
    return { ...this.#t };
  }
  get segments() {
    return this.#i;
  }
  get separator() {
    return this.#o;
  }
  get formattedValue() {
    return this.#l(this.#t);
  }
  #l(t) {
    return this.#i.map((i) => t[i.type]).join(this.#o);
  }
  #r() {
    this._setUserInput(this.#l(this.#t)), this._setValue(C(this.#t) ?? undefined);
  }
  constructor(t) {
    const i = t.format ? { segments: M(t.format), separator: t.separator ?? "/" } : P(t.locale), s = t.separator ?? i.separator, n = t.format ? M(t.format) : i.segments, e = t.initialValue ?? t.defaultValue, m = e ? {
      year: String(e.getUTCFullYear()).padStart(4, "0"),
      month: String(e.getUTCMonth() + 1).padStart(2, "0"),
      day: String(e.getUTCDate()).padStart(2, "0")
    } : { year: "____", month: "__", day: "__" }, o = n.map((a) => m[a.type]).join(s);
    super({ ...t, initialUserInput: o }, false), this.#i = n, this.#o = s, this.#t = m, this.#h = t.minDate, this.#u = t.maxDate, this.#r(), this.on("cursor", (a) => this.#f(a)), this.on("key", (a, u) => this.#y(a, u)), this.on("finalize", () => this.#p(t));
  }
  #a() {
    const t = Math.max(0, Math.min(this.#e.segmentIndex, this.#i.length - 1)), i = this.#i[t];
    if (i)
      return this.#e.positionInSegment = Math.max(0, Math.min(this.#e.positionInSegment, i.len - 1)), { segment: i, index: t };
  }
  #m(t) {
    this.inlineError = "", this.#s = null;
    const i = this.#a();
    i && (this.#e.segmentIndex = Math.max(0, Math.min(this.#i.length - 1, i.index + t)), this.#e.positionInSegment = 0, this.#n = true);
  }
  #d(t) {
    const i = this.#a();
    if (!i)
      return;
    const { segment: s } = i, n = this.#t[s.type], e = !n || n.replace(/_/g, "") === "", m = Number.parseInt((n || "0").replace(/_/g, "0"), 10) || 0, o = T(s.type, f(this.#t), this.#h, this.#u);
    let a;
    e ? a = t === 1 ? o.min : o.max : a = Math.max(Math.min(o.max, m + t), o.min), this.#t = {
      ...this.#t,
      [s.type]: a.toString().padStart(s.len, "0")
    }, this.#n = true, this.#s = null, this.#r();
  }
  #f(t) {
    if (t)
      switch (t) {
        case "right":
          return this.#m(1);
        case "left":
          return this.#m(-1);
        case "up":
          return this.#d(1);
        case "down":
          return this.#d(-1);
      }
  }
  #y(t, i) {
    if (i?.name === "backspace" || i?.sequence === "" || i?.sequence === "\b" || t === "" || t === "\b") {
      this.inlineError = "";
      const n = this.#a();
      if (!n)
        return;
      if (!this.#t[n.segment.type].replace(/_/g, "")) {
        this.#m(-1);
        return;
      }
      this.#t[n.segment.type] = "_".repeat(n.segment.len), this.#n = true, this.#e.positionInSegment = 0, this.#r();
      return;
    }
    if (i?.name === "tab") {
      this.inlineError = "";
      const n = this.#a();
      if (!n)
        return;
      const e = i.shift ? -1 : 1, m = n.index + e;
      m >= 0 && m < this.#i.length && (this.#e.segmentIndex = m, this.#e.positionInSegment = 0, this.#n = true);
      return;
    }
    if (t && /^[0-9]$/.test(t)) {
      const n = this.#a();
      if (!n)
        return;
      const { segment: e } = n, m = !this.#t[e.type].replace(/_/g, "");
      if (this.#n && this.#s !== null && !m) {
        const h = this.#s + t, d = { ...this.#t, [e.type]: h }, g = this.#g(d, e);
        if (g) {
          this.inlineError = g, this.#s = null, this.#n = false;
          return;
        }
        this.inlineError = "", this.#t[e.type] = h, this.#s = null, this.#n = false, this.#r(), n.index < this.#i.length - 1 && (this.#e.segmentIndex = n.index + 1, this.#e.positionInSegment = 0, this.#n = true);
        return;
      }
      this.#n && !m && (this.#t[e.type] = "_".repeat(e.len), this.#e.positionInSegment = 0), this.#n = false, this.#s = null;
      const o = this.#t[e.type], a = o.indexOf("_"), u = a >= 0 ? a : Math.min(this.#e.positionInSegment, e.len - 1);
      if (u < 0 || u >= e.len)
        return;
      let l = o.slice(0, u) + t + o.slice(u + 1), D = false;
      if (u === 0 && o === "__" && (e.type === "month" || e.type === "day")) {
        const h = Number.parseInt(t, 10);
        l = `0${t}`, D = h <= (e.type === "month" ? 1 : 2);
      }
      if (e.type === "year" && (l = (o.replace(/_/g, "") + t).padStart(e.len, "_")), !l.includes("_")) {
        const h = { ...this.#t, [e.type]: l }, d = this.#g(h, e);
        if (d) {
          this.inlineError = d;
          return;
        }
      }
      this.inlineError = "", this.#t[e.type] = l;
      const y = l.includes("_") ? undefined : b(this.#t);
      if (y) {
        const { year: h, month: d } = y, g = c(h, d);
        this.#t = {
          year: String(Math.max(0, Math.min(9999, h))).padStart(4, "0"),
          month: String(Math.max(1, Math.min(12, d))).padStart(2, "0"),
          day: String(Math.max(1, Math.min(g, y.day))).padStart(2, "0")
        };
      }
      this.#r();
      const S = l.indexOf("_");
      D ? (this.#n = true, this.#s = t) : S >= 0 ? this.#e.positionInSegment = S : a >= 0 && n.index < this.#i.length - 1 ? (this.#e.segmentIndex = n.index + 1, this.#e.positionInSegment = 0, this.#n = true) : this.#e.positionInSegment = Math.min(u + 1, e.len - 1);
    }
  }
  #g(t, i) {
    const { month: s, day: n } = f(t);
    if (i.type === "month" && (s < 0 || s > 12))
      return settings2.date.messages.invalidMonth;
    if (i.type === "day" && (n < 0 || n > 31))
      return settings2.date.messages.invalidDay(31, "any month");
  }
  #p(t) {
    const { year: i, month: s, day: n } = f(this.#t);
    if (i && s && n) {
      const e = c(i, s);
      this.#t = {
        ...this.#t,
        day: String(Math.min(n, e)).padStart(2, "0")
      };
    }
    this.value = C(this.#t) ?? t.defaultValue ?? undefined;
  }
}
var u$2 = class u extends y {
  options;
  cursor = 0;
  #t;
  getGroupItems(t) {
    return this.options.filter((r) => r.group === t);
  }
  isGroupSelected(t) {
    const r = this.getGroupItems(t), e = this.value;
    return e === undefined ? false : r.every((s) => e.includes(s.value));
  }
  toggleValue() {
    const t = this.options[this.cursor];
    if (t !== undefined)
      if (this.value === undefined && (this.value = []), t.group === true) {
        const r = t.value, e = this.getGroupItems(r);
        this.isGroupSelected(r) ? this.value = this.value.filter((s) => e.findIndex((i) => i.value === s) === -1) : this.value = [...this.value, ...e.map((s) => s.value)], this.value = Array.from(new Set(this.value));
      } else {
        const r = this.value.includes(t.value);
        this.value = r ? this.value.filter((e) => e !== t.value) : [...this.value, t.value];
      }
  }
  constructor(t) {
    super(t, false);
    const { options: r } = t;
    this.#t = t.selectableGroups !== false, this.options = Object.entries(r).flatMap(([e, s]) => [
      { value: e, group: true, label: e },
      ...s.map((i) => ({ ...i, group: e }))
    ]), this.value = [...t.initialValues ?? []], this.cursor = Math.max(this.options.findIndex(({ value: e }) => e === t.cursorAt), this.#t ? 0 : 1), this.on("cursor", (e) => {
      switch (e) {
        case "left":
        case "up": {
          this.cursor = this.cursor === 0 ? this.options.length - 1 : this.cursor - 1;
          const s = this.options[this.cursor]?.group === true;
          !this.#t && s && (this.cursor = this.cursor === 0 ? this.options.length - 1 : this.cursor - 1);
          break;
        }
        case "down":
        case "right": {
          this.cursor = this.cursor === this.options.length - 1 ? 0 : this.cursor + 1;
          const s = this.options[this.cursor]?.group === true;
          !this.#t && s && (this.cursor = this.cursor === this.options.length - 1 ? 0 : this.cursor + 1);
          break;
        }
        case "space":
          this.toggleValue();
          break;
      }
    });
  }
};
var o = /* @__PURE__ */ new Set(["up", "down", "left", "right"]);

class h extends y {
  #t = false;
  #s;
  focused = "editor";
  get userInputWithCursor() {
    if (this.state === "submit")
      return this.userInput;
    const t = this.userInput;
    if (this.cursor >= t.length)
      return `${t}█`;
    const s = t.slice(0, this.cursor), r = t.slice(this.cursor, this.cursor + 1), i = t.slice(this.cursor + 1);
    return r === `
` ? `${s}█
${i}` : `${s}${styleText("inverse", r)}${i}`;
  }
  get cursor() {
    return this._cursor;
  }
  #r(t) {
    if (this.userInput.length === 0) {
      this._setUserInput(t);
      return;
    }
    this._setUserInput(this.userInput.slice(0, this.cursor) + t + this.userInput.slice(this.cursor));
  }
  #i(t) {
    const s = this.value ?? "";
    switch (t) {
      case "up":
        this._cursor = findTextCursor(this._cursor, 0, -1, s);
        return;
      case "down":
        this._cursor = findTextCursor(this._cursor, 0, 1, s);
        return;
      case "left":
        this._cursor = findTextCursor(this._cursor, -1, 0, s);
        return;
      case "right":
        this._cursor = findTextCursor(this._cursor, 1, 0, s);
        return;
    }
  }
  _shouldSubmit(t, s) {
    if (this.#s)
      return this.focused === "submit" ? true : (this.#r(`
`), this._cursor++, false);
    const r = this.#t;
    return this.#t = true, r && this.cursor === this.userInput.length ? (this.userInput[this.cursor - 1] === `
` && (this._setUserInput(this.userInput.slice(0, this.cursor - 1) + this.userInput.slice(this.cursor)), this._cursor--), true) : (this.#r(`
`), this._cursor++, false);
  }
  constructor(t) {
    const s = t.initialUserInput ?? t.initialValue;
    super({
      ...t,
      initialUserInput: s
    }, false), s !== undefined && (this._cursor = s.length), this.#s = t.showSubmit ?? false, this.on("key", (r, i) => {
      if (i?.name && o.has(i.name)) {
        this.#t = false, this.#i(i.name);
        return;
      }
      if (r === "\t" && this.#s) {
        this.focused = this.focused === "editor" ? "submit" : "editor";
        return;
      }
      if (i?.name !== "return") {
        if (this.#t = false, i?.name === "backspace" && this.cursor > 0) {
          this._setUserInput(this.userInput.slice(0, this.cursor - 1) + this.userInput.slice(this.cursor)), this._cursor--;
          return;
        }
        if (i?.name === "delete" && this.cursor < this.userInput.length) {
          this._setUserInput(this.userInput.slice(0, this.cursor) + this.userInput.slice(this.cursor + 1));
          return;
        }
        r && (this.#s && this.focused === "submit" && (this.focused = "editor"), this.#r(r ?? ""), this._cursor++);
      }
    }), this.on("userInput", (r) => {
      this._setValue(r);
    }), this.on("finalize", () => {
      this.value || (this.value = t.defaultValue), this.value === undefined && (this.value = "");
    });
  }
}

class a extends y {
  options;
  cursor = 0;
  get _value() {
    return this.options[this.cursor]?.value;
  }
  get _enabledOptions() {
    return this.options.filter((e) => e.disabled !== true);
  }
  toggleAll() {
    const e = this._enabledOptions, i = this.value !== undefined && this.value.length === e.length;
    this.value = i ? [] : e.map((t) => t.value);
  }
  toggleInvert() {
    const e = this.value;
    if (!e)
      return;
    const i = this._enabledOptions.filter((t) => !e.includes(t.value));
    this.value = i.map((t) => t.value);
  }
  toggleValue() {
    this.value === undefined && (this.value = []);
    const e = this.value.includes(this._value);
    this.value = e ? this.value.filter((i) => i !== this._value) : [...this.value, this._value];
  }
  constructor(e) {
    super(e, false), this.options = e.options, this.value = [...e.initialValues ?? []];
    const i = Math.max(this.options.findIndex(({ value: t }) => t === e.cursorAt), 0);
    this.cursor = this.options[i]?.disabled ? findCursor(i, 1, this.options) : i, this.on("key", (t, l) => {
      l.name === "a" && this.toggleAll(), l.name === "i" && this.toggleInvert();
    }), this.on("cursor", (t) => {
      switch (t) {
        case "left":
        case "up":
          this.cursor = findCursor(this.cursor, -1, this.options);
          break;
        case "down":
        case "right":
          this.cursor = findCursor(this.cursor, 1, this.options);
          break;
        case "space":
          this.toggleValue();
          break;
      }
    });
  }
}
var u$1 = class u extends y {
  _mask = "•";
  get cursor() {
    return this._cursor;
  }
  get masked() {
    return this.userInput.replaceAll(/./g, this._mask);
  }
  get userInputWithCursor() {
    if (this.state === "submit" || this.state === "cancel")
      return this.masked;
    const t = this.userInput;
    if (this.cursor >= t.length)
      return `${this.masked}${styleText(["inverse", "hidden"], "_")}`;
    const s = this.masked, r = s.slice(0, this.cursor), i = s.slice(this.cursor, this.cursor + 1), o = s.slice(this.cursor + 1);
    return `${r}${styleText("inverse", i)}${o}`;
  }
  clear() {
    this._clearUserInput();
  }
  constructor({ mask: t, ...s }) {
    super(s), this._mask = t ?? "•", this.on("userInput", (r) => {
      this._setValue(r);
    }), this.on("finalize", () => {
      this.value === undefined && (this.value = "");
    });
  }
};
var n$1 = class n extends y {
  options;
  cursor = 0;
  get _selectedValue() {
    return this.options[this.cursor];
  }
  changeValue() {
    const e = this._selectedValue;
    this.value = e === undefined ? undefined : e.value;
  }
  constructor(e) {
    super(e, false), this.options = e.options;
    const o = this.options.findIndex(({ value: s }) => s === e.initialValue), t = o === -1 ? 0 : o;
    this.cursor = this.options[t]?.disabled ? findCursor(t, 1, this.options) : t, this.changeValue(), this.on("cursor", (s) => {
      switch (s) {
        case "left":
        case "up":
          this.cursor = findCursor(this.cursor, -1, this.options);
          break;
        case "down":
        case "right":
          this.cursor = findCursor(this.cursor, 1, this.options);
          break;
      }
      this.changeValue();
    });
  }
};

class u extends y {
  options;
  cursor = 0;
  constructor(t) {
    super(t, false), this.options = t.options;
    const s = t.caseSensitive === true, i = this.options.map(({ value: [e] }) => s ? e : e?.toLowerCase());
    this.cursor = Math.max(i.indexOf(t.initialValue), 0), this.on("key", (e) => {
      if (!e)
        return;
      const o = s ? e : e.toLowerCase();
      if (!i.includes(o))
        return;
      const n = this.options.find(({ value: [r] }) => s ? r === o : r?.toLowerCase() === o);
      n && (this.value = n.value, this.state = "submit", this.emit("submit"));
    });
  }
}

class n extends y {
  get userInputWithCursor() {
    if (this.state === "submit")
      return this.userInput;
    const t = this.userInput;
    if (this.cursor >= t.length)
      return `${this.userInput}█`;
    const r = t.slice(0, this.cursor), s = t.slice(this.cursor, this.cursor + 1), e = t.slice(this.cursor + 1);
    return `${r}${styleText("inverse", s)}${e}`;
  }
  get cursor() {
    return this._cursor;
  }
  constructor(t) {
    super({
      ...t,
      initialUserInput: t.initialUserInput ?? t.initialValue
    }), this.on("userInput", (r) => {
      this._setValue(r);
    }), this.on("finalize", () => {
      this.value || (this.value = t.defaultValue), this.value === undefined && (this.value = "");
    });
  }
}

// node_modules/@clack/prompts/dist/index.mjs
import { styleText as styleText2, stripVTControlCharacters } from "node:util";
import process$1 from "node:process";
var import_sisteransi2 = __toESM(require_src(), 1);
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
function isUnicodeSupported() {
  if (process$1.platform !== "win32") {
    return process$1.env.TERM !== "linux";
  }
  return Boolean(process$1.env.CI) || Boolean(process$1.env.WT_SESSION) || Boolean(process$1.env.TERMINUS_SUBLIME) || process$1.env.ConEmuTask === "{cmd::Cmder}" || process$1.env.TERM_PROGRAM === "Terminus-Sublime" || process$1.env.TERM_PROGRAM === "vscode" || process$1.env.TERM === "xterm-256color" || process$1.env.TERM === "alacritty" || process$1.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}
var unicode2 = isUnicodeSupported();
var isCI2 = () => process.env.CI === "true";
var isTTY2 = (o) => o.isTTY === true;
var unicodeOr2 = (o, e) => unicode2 ? o : e;
var S_STEP_ACTIVE2 = unicodeOr2("◆", "*");
var S_STEP_CANCEL2 = unicodeOr2("■", "x");
var S_STEP_ERROR2 = unicodeOr2("▲", "x");
var S_STEP_SUBMIT2 = unicodeOr2("◇", "o");
var S_BAR_START2 = unicodeOr2("┌", "T");
var S_BAR2 = unicodeOr2("│", "|");
var S_BAR_END2 = unicodeOr2("└", "—");
var S_BAR_START_RIGHT2 = unicodeOr2("┐", "T");
var S_BAR_END_RIGHT2 = unicodeOr2("┘", "—");
var S_RADIO_ACTIVE2 = unicodeOr2("●", ">");
var S_RADIO_INACTIVE2 = unicodeOr2("○", " ");
var S_CHECKBOX_ACTIVE2 = unicodeOr2("◻", "[•]");
var S_CHECKBOX_SELECTED2 = unicodeOr2("◼", "[+]");
var S_CHECKBOX_INACTIVE2 = unicodeOr2("◻", "[ ]");
var S_PASSWORD_MASK2 = unicodeOr2("▪", "•");
var S_BAR_H2 = unicodeOr2("─", "-");
var S_CORNER_TOP_RIGHT2 = unicodeOr2("╮", "+");
var S_CONNECT_LEFT2 = unicodeOr2("├", "+");
var S_CORNER_BOTTOM_RIGHT2 = unicodeOr2("╯", "+");
var S_CORNER_BOTTOM_LEFT2 = unicodeOr2("╰", "+");
var S_CORNER_TOP_LEFT2 = unicodeOr2("╭", "+");
var S_INFO2 = unicodeOr2("●", "•");
var S_SUCCESS2 = unicodeOr2("◆", "*");
var S_WARN2 = unicodeOr2("▲", "!");
var S_ERROR2 = unicodeOr2("■", "x");
var symbol2 = (o) => {
  switch (o) {
    case "initial":
    case "active":
      return styleText2("cyan", S_STEP_ACTIVE2);
    case "cancel":
      return styleText2("red", S_STEP_CANCEL2);
    case "error":
      return styleText2("yellow", S_STEP_ERROR2);
    case "submit":
      return styleText2("green", S_STEP_SUBMIT2);
    case "validating":
      return styleText2("dim", S_STEP_ACTIVE2);
  }
};
var symbolBar2 = (o) => {
  switch (o) {
    case "initial":
    case "active":
      return styleText2("cyan", S_BAR2);
    case "cancel":
      return styleText2("red", S_BAR2);
    case "error":
      return styleText2("yellow", S_BAR2);
    case "submit":
      return styleText2("green", S_BAR2);
  }
};
function formatInstructionFooter2(o, e) {
  const r = [`${e ? `${styleText2("cyan", S_BAR2)}  ` : ""}${o.join(" • ")}`];
  return e && r.push(styleText2("cyan", S_BAR_END2)), r;
}
var I = (l, e, w, p, b, C = false) => {
  let r = e, O = 0;
  if (C)
    for (let i = p - 1;i >= w; i--) {
      const m = l[i];
      if (m && (r -= m.length), O++, r <= b)
        break;
    }
  else
    for (let i = w;i < p; i++) {
      const m = l[i];
      if (m && (r -= m.length), O++, r <= b)
        break;
    }
  return { lineCount: r, removals: O };
};
var limitOptions2 = ({
  cursor: l,
  options: e,
  style: w,
  output: p = process.stdout,
  maxItems: b = Number.POSITIVE_INFINITY,
  columnPadding: C = 0,
  rowPadding: r = 4
}) => {
  const i = getColumns(p) - C, m = getRows(p), M = styleText2("dim", "..."), v = Math.max(m - r, 0), a = Math.max(Math.min(b, v), 5);
  let f = 0;
  l >= a - 3 && (f = Math.max(Math.min(l - a + 3, e.length - a), 0));
  let d = a < e.length && f > 0, c = a < e.length && f + a < e.length;
  const W = Math.min(f + a, e.length), s = [];
  let g = 0;
  d && g++, c && g++;
  const T = f + (d ? 1 : 0), y = W - (c ? 1 : 0);
  for (let t = T;t < y; t++) {
    const n = e[t], o = n ? w(n, t === l) : "", h = wrapAnsi(o, i, {
      hard: true,
      trim: false
    }).split(`
`);
    s.push(h), g += h.length;
  }
  if (g > v) {
    let t = 0, n = 0, o = g;
    const h = l - T;
    let u = v;
    const L = () => I(s, o, 0, h, u), E = () => I(s, o, h + 1, s.length, u, true);
    d ? ({ lineCount: o, removals: t } = L(), o > u && (c || (u -= 1), { lineCount: o, removals: n } = E())) : (c || (u -= 1), { lineCount: o, removals: n } = E(), o > u && (u -= 1, { lineCount: o, removals: t } = L())), t > 0 && (d = true, s.splice(0, t)), n > 0 && (c = true, s.splice(s.length - n, n));
  }
  const x = [];
  d && x.push(M);
  for (const t of s)
    for (const n of t)
      x.push(n);
  return c && x.push(M), x;
};
function E(t) {
  return t.label ?? String(t.value ?? "");
}
function P2(t, c) {
  if (!t)
    return true;
  const n = (c.label ?? String(c.value ?? "")).toLowerCase(), i = (c.hint ?? "").toLowerCase(), r = String(c.value).toLowerCase(), o = t.toLowerCase();
  return n.includes(o) || i.includes(o) || r.includes(o);
}
function j(t, c) {
  const n = [];
  for (const i of c)
    t.includes(i.value) && n.push(i);
  return n;
}
var autocomplete2 = (t) => new T$1({
  options: t.options,
  initialValue: t.initialValue ? [t.initialValue] : undefined,
  initialUserInput: t.initialUserInput,
  placeholder: t.placeholder,
  completeOnTab: t.completeOnTab,
  filter: t.filter ?? ((n, i) => P2(n, i)),
  signal: t.signal,
  input: t.input,
  output: t.output,
  validate: t.validate,
  render() {
    const n = t.withGuide ?? settings2.withGuide, i = n ? [`${styleText2("gray", S_BAR2)}`, `${symbol2(this.state)}  ${t.message}`] : [`${symbol2(this.state)}  ${t.message}`], r = this.userInput, o = this.options, m = t.placeholder, p = r === "" && m !== undefined, $ = (l, s) => {
      const a = E(l), u = l.hint && l.value === this.focusedValue ? styleText2("dim", ` (${l.hint})`) : "";
      switch (s) {
        case "active":
          return `${styleText2("green", S_RADIO_ACTIVE2)} ${a}${u}`;
        case "inactive":
          return `${styleText2("dim", S_RADIO_INACTIVE2)} ${styleText2("dim", a)}`;
        case "disabled":
          return `${styleText2("gray", S_RADIO_INACTIVE2)} ${styleText2(["strikethrough", "gray"], a)}`;
      }
    };
    switch (this.state) {
      case "submit": {
        const l = j(this.selectedValues, o), s = l.length > 0 ? `  ${styleText2("dim", l.map(E).join(", "))}` : "", a = n ? styleText2("gray", S_BAR2) : "";
        return `${i.join(`
`)}
${a}${s}`;
      }
      case "cancel": {
        const l = r ? `  ${styleText2(["strikethrough", "dim"], r)}` : "", s = n ? styleText2("gray", S_BAR2) : "";
        return `${i.join(`
`)}
${s}${l}`;
      }
      default: {
        const l = this.state === "error" ? "yellow" : "cyan", s = n ? `${styleText2(l, S_BAR2)}  ` : "", a = n ? styleText2(l, S_BAR_END2) : "";
        let u = "";
        if (this.isNavigating || p) {
          const d = p ? m : r;
          u = d !== "" ? ` ${styleText2("dim", d)}` : "";
        } else
          u = ` ${this.userInputWithCursor}`;
        const V = this.filteredOptions.length !== o.length ? styleText2("dim", ` (${this.filteredOptions.length} match${this.filteredOptions.length === 1 ? "" : "es"})`) : "", b = this.filteredOptions.length === 0 && r ? [`${s}${styleText2("yellow", "No matches found")}`] : [], y = this.state === "error" ? [`${s}${styleText2("yellow", this.error)}`] : [];
        n && i.push(`${s.trimEnd()}`), i.push(`${s}${styleText2("dim", "Search:")}${u}${V}`, ...b, ...y);
        const S = [
          `${styleText2("dim", "↑/↓")} to select`,
          ...t.completeOnTab ? [`${styleText2("dim", "Tab:")} complete`] : [],
          `${styleText2("dim", "Enter:")} confirm`,
          `${styleText2("dim", "Type:")} to search`
        ], g = [`${s}${S.join(" • ")}`, a], O = this.filteredOptions.length === 0 ? [] : limitOptions2({
          cursor: this.cursor,
          options: this.filteredOptions,
          columnPadding: n ? 3 : 0,
          rowPadding: i.length + g.length,
          style: (d, f) => $(d, d.disabled ? "disabled" : f ? "active" : "inactive"),
          maxItems: t.maxItems,
          output: t.output
        });
        return [
          ...i,
          ...O.map((d) => `${s}${d}`),
          ...g
        ].join(`
`);
      }
    }
  }
}).prompt();
var autocompleteMultiselect2 = (t) => {
  const c = (i, r, o, m) => {
    const p = o.includes(i.value), $ = i.label ?? String(i.value ?? ""), l = i.hint && m !== undefined && i.value === m ? styleText2("dim", ` (${i.hint})`) : "", s = p ? styleText2("green", S_CHECKBOX_SELECTED2) : styleText2("dim", S_CHECKBOX_INACTIVE2);
    return i.disabled ? `${styleText2("gray", S_CHECKBOX_INACTIVE2)} ${styleText2(["strikethrough", "gray"], $)}` : r ? `${s} ${$}${l}` : `${s} ${styleText2("dim", $)}`;
  }, n = new T$1({
    options: t.options,
    multiple: true,
    placeholder: t.placeholder,
    filter: t.filter ?? ((i, r) => P2(i, r)),
    validate: () => {
      if (t.required && n.selectedValues.length === 0)
        return "Please select at least one item";
    },
    initialValue: t.initialValues,
    signal: t.signal,
    input: t.input,
    output: t.output,
    render() {
      const i = t.withGuide ?? settings2.withGuide, r = `${i ? `${styleText2("gray", S_BAR2)}
` : ""}${symbol2(this.state)}  ${t.message}
`, o = this.userInput, m = t.placeholder, p = o === "" && m !== undefined, $ = this.isNavigating || p ? styleText2("dim", p ? m : o) : this.userInputWithCursor, l = this.options, s = this.filteredOptions.length !== l.length ? styleText2("dim", ` (${this.filteredOptions.length} match${this.filteredOptions.length === 1 ? "" : "es"})`) : "";
      switch (this.state) {
        case "submit":
          return `${r}${i ? `${styleText2("gray", S_BAR2)}  ` : ""}${styleText2("dim", `${this.selectedValues.length} items selected`)}`;
        case "cancel":
          return `${r}${i ? `${styleText2("gray", S_BAR2)}  ` : ""}${styleText2(["strikethrough", "dim"], o)}`;
        default: {
          const a = this.state === "error" ? "yellow" : "cyan", u = i ? `${styleText2(a, S_BAR2)}  ` : "", V = i ? styleText2(a, S_BAR_END2) : "", b = [
            `${styleText2("dim", "↑/↓")} to navigate`,
            `${styleText2("dim", this.isNavigating ? "Space/Tab:" : "Tab:")} select`,
            `${styleText2("dim", "Enter:")} confirm`,
            `${styleText2("dim", "Type:")} to search`
          ], y = this.filteredOptions.length === 0 && o ? [`${u}${styleText2("yellow", "No matches found")}`] : [], S = this.state === "error" ? [`${u}${styleText2("yellow", this.error)}`] : [], g = [
            ...`${r}${i ? styleText2(a, S_BAR2) : ""}`.split(`
`),
            `${u}${styleText2("dim", "Search:")} ${$}${s}`,
            ...y,
            ...S
          ], O = [`${u}${b.join(" • ")}`, V], d = limitOptions2({
            cursor: this.cursor,
            options: this.filteredOptions,
            style: (f, L) => c(f, L, this.selectedValues, this.focusedValue),
            maxItems: t.maxItems,
            output: t.output,
            rowPadding: g.length + O.length
          });
          return [
            ...g,
            ...d.map((f) => `${u}${f}`),
            ...O
          ].join(`
`);
        }
      }
    }
  });
  return n.prompt();
};
var K = [
  S_CORNER_TOP_LEFT2,
  S_CORNER_TOP_RIGHT2,
  S_CORNER_BOTTOM_LEFT2,
  S_CORNER_BOTTOM_RIGHT2
];
var Q = [S_BAR_START2, S_BAR_START_RIGHT2, S_BAR_END2, S_BAR_END_RIGHT2];
function A$1(n, e, t, o) {
  let i = t, f = t;
  return o === "center" ? i = Math.floor((e - n) / 2) : o === "right" && (i = e - n - t), f = e - i - n, [i, f];
}
var U2 = (n) => n;
var box2 = (n = "", e = "", t) => {
  const o = t?.output ?? process.stdout, i = getColumns(o), R = 1 * 2, u = t?.titlePadding ?? 1, h = t?.contentPadding ?? 2, w = t?.width === undefined || t.width === "auto" ? 1 : Math.min(1, t.width), m = t?.withGuide ?? settings2.withGuide ? `${styleText2("gray", S_BAR2)} ` : "", b = t?.formatBorder ?? U2, a = ((t?.rounded) ? K : Q).map(b), _ = b(S_BAR_H2), p = b(S_BAR2), x = dist_default2(m), B = dist_default2(e), y = i - x;
  let r = Math.floor(i * w) - x;
  if (t?.width === "auto") {
    const c = n.split(`
`);
    let s = B + u * 2;
    for (const G of c) {
      const P = dist_default2(G) + h * 2;
      P > s && (s = P);
    }
    const g = s + R;
    g < r && (r = g);
  }
  r % 2 !== 0 && (r < y ? r++ : r--);
  const d = r - R, T = d - u * 2, S = B > T ? `${e.slice(0, T - 3)}...` : e, [O, W] = A$1(dist_default2(S), d, u, t?.titleAlign), L = wrapAnsi(n, d - h * 2, {
    hard: true,
    trim: false
  });
  o.write(`${m}${a[0]}${_.repeat(O)}${S}${_.repeat(W)}${a[1]}
`);
  const E = L.split(`
`);
  for (const c of E) {
    const [s, g] = A$1(dist_default2(c), d, h, t?.contentAlign);
    o.write(`${m}${p}${" ".repeat(s)}${c}${" ".repeat(g)}${p}
`);
  }
  o.write(`${m}${a[2]}${_.repeat(d)}${a[3]}
`);
};
var confirm2 = (e) => {
  const a = e.active ?? "Yes", o = e.inactive ?? "No";
  return new r({
    active: a,
    inactive: o,
    signal: e.signal,
    input: e.input,
    output: e.output,
    initialValue: e.initialValue ?? true,
    render() {
      const i = e.withGuide ?? settings2.withGuide, u = `${symbol2(this.state)}  `, l = i ? `${styleText2("gray", S_BAR2)}  ` : "", f = wrapTextWithPrefix(e.output, e.message, l, u), s = `${i ? `${styleText2("gray", S_BAR2)}
` : ""}${f}
`, c = this.value ? a : o;
      switch (this.state) {
        case "submit": {
          const r = i ? `${styleText2("gray", S_BAR2)}  ` : "";
          return `${s}${r}${styleText2("dim", c)}`;
        }
        case "cancel": {
          const r = i ? `${styleText2("gray", S_BAR2)}  ` : "";
          return `${s}${r}${styleText2(["strikethrough", "dim"], c)}${i ? `
${styleText2("gray", S_BAR2)}` : ""}`;
        }
        default: {
          const r = i ? `${styleText2("cyan", S_BAR2)}  ` : "", g = i ? styleText2("cyan", S_BAR_END2) : "";
          return `${s}${r}${this.value ? `${styleText2("green", S_RADIO_ACTIVE2)} ${a}` : `${styleText2("dim", S_RADIO_INACTIVE2)} ${styleText2("dim", a)}`}${e.vertical ? i ? `
${styleText2("cyan", S_BAR2)}  ` : `
` : ` ${styleText2("dim", "/")} `}${this.value ? `${styleText2("dim", S_RADIO_INACTIVE2)} ${styleText2("dim", o)}` : `${styleText2("green", S_RADIO_ACTIVE2)} ${o}`}
${g}
`;
        }
      }
    }
  }).prompt();
};
var date2 = (e) => {
  const r = e.validate;
  return new U({
    ...e,
    validate(t) {
      if (t === undefined)
        return e.defaultValue !== undefined ? undefined : r ? runValidation(r, t) : settings2.date.messages.required;
      const o = (i) => i.toISOString().slice(0, 10);
      if (e.minDate && o(t) < o(e.minDate))
        return settings2.date.messages.afterMin(e.minDate);
      if (e.maxDate && o(t) > o(e.maxDate))
        return settings2.date.messages.beforeMax(e.maxDate);
      if (r)
        return runValidation(r, t);
    },
    render() {
      const t = (e?.withGuide ?? settings2.withGuide) !== false, i = `${`${t ? `${styleText2("gray", S_BAR2)}
` : ""}${symbol2(this.state)}  `}${e.message}
`, l = this.state !== "initial" ? this.state : "active", d = b2(this, l), c = this.value instanceof Date ? this.formattedValue : "";
      switch (this.state) {
        case "error": {
          const a = this.error ? `  ${styleText2("yellow", this.error)}` : "", s = t ? `${styleText2("yellow", S_BAR2)}  ` : "", f = t ? styleText2("yellow", S_BAR_END2) : "";
          return `${i.trim()}
${s}${d}
${f}${a}
`;
        }
        case "submit": {
          const a = c ? `  ${styleText2("dim", c)}` : "", s = t ? styleText2("gray", S_BAR2) : "";
          return `${i}${s}${a}`;
        }
        case "cancel": {
          const a = c ? `  ${styleText2(["strikethrough", "dim"], c)}` : "", s = t ? styleText2("gray", S_BAR2) : "";
          return `${i}${s}${a}${c.trim() ? `
${s}` : ""}`;
        }
        default: {
          const a = t ? `${styleText2("cyan", S_BAR2)}  ` : "", s = t ? styleText2("cyan", S_BAR_END2) : "", f = t ? `${styleText2("cyan", S_BAR2)}  ` : "", g = this.inlineError ? `
${f}${styleText2("yellow", this.inlineError)}` : "";
          return `${i}${a}${d}${g}
${s}
`;
        }
      }
    }
  }).prompt();
};
function b2(e, r) {
  const { segmentValues: t, segmentCursor: o } = e;
  if (r === "submit" || r === "cancel")
    return e.formattedValue;
  const i = styleText2("gray", e.separator);
  return e.segments.map((l, d) => {
    const c = d === o.segmentIndex && !["submit", "cancel"].includes(r), a = p2[l.type];
    return x(t[l.type], { isActive: c, label: a });
  }).join(i);
}
function x(e, r) {
  const t = !e || e.replace(/_/g, "") === "";
  return r.isActive ? styleText2("inverse", t ? r.label : e.replace(/_/g, " ")) : t ? styleText2("dim", r.label) : e.replace(/_/g, styleText2("dim", " "));
}
var p2 = {
  year: "yyyy",
  month: "mm",
  day: "dd"
};
var group2 = async (o, r) => {
  const t = {}, p = Object.keys(o);
  for (const e of p) {
    const i = o[e], n = await i({ results: t })?.catch((a) => {
      throw a;
    });
    if (typeof r?.onCancel == "function" && isCancel2(n)) {
      t[e] = "canceled", r.onCancel({ results: t });
      continue;
    }
    t[e] = n;
  }
  return t;
};
var MULTISELECT_INSTRUCTIONS2 = [
  `${styleText2("dim", "↑/↓")} to navigate`,
  `${styleText2("dim", "Space:")} select`,
  `${styleText2("dim", "Enter:")} confirm`
];
var m2 = (i, u) => i.split(`
`).map((d) => u(d)).join(`
`);
var multiselect2 = (i) => {
  const u = (t, a) => {
    const r = t.label ?? String(t.value);
    return a === "disabled" ? `${styleText2("gray", S_CHECKBOX_INACTIVE2)} ${m2(r, (o) => styleText2(["strikethrough", "gray"], o))}${t.hint ? ` ${styleText2("dim", `(${t.hint ?? "disabled"})`)}` : ""}` : a === "active" ? `${styleText2("cyan", S_CHECKBOX_ACTIVE2)} ${r}${t.hint ? ` ${styleText2("dim", `(${t.hint})`)}` : ""}` : a === "selected" ? `${styleText2("green", S_CHECKBOX_SELECTED2)} ${m2(r, (o) => styleText2("dim", o))}${t.hint ? ` ${styleText2("dim", `(${t.hint})`)}` : ""}` : a === "cancelled" ? `${m2(r, (o) => styleText2(["strikethrough", "dim"], o))}` : a === "active-selected" ? `${styleText2("green", S_CHECKBOX_SELECTED2)} ${r}${t.hint ? ` ${styleText2("dim", `(${t.hint})`)}` : ""}` : a === "submitted" ? `${m2(r, (o) => styleText2("dim", o))}` : `${styleText2("dim", S_CHECKBOX_INACTIVE2)} ${m2(r, (o) => styleText2("dim", o))}`;
  }, d = i.required ?? true, x = i.showInstructions ?? true;
  return new a({
    options: i.options,
    signal: i.signal,
    input: i.input,
    output: i.output,
    initialValues: i.initialValues,
    required: d,
    cursorAt: i.cursorAt,
    validate(t) {
      if (d && (t === undefined || t.length === 0))
        return `Please select at least one option.
${styleText2("reset", styleText2("dim", `Press ${styleText2(["gray", "bgWhite", "inverse"], " space ")} to select, ${styleText2("gray", styleText2("bgWhite", styleText2("inverse", " enter ")))} to submit`))}`;
    },
    render() {
      const t = i.withGuide ?? settings2.withGuide, a = wrapTextWithPrefix(i.output, i.message, t ? `${symbolBar2(this.state)}  ` : "", `${symbol2(this.state)}  `), r = `${t ? `${styleText2("gray", S_BAR2)}
` : ""}${a}
`, o = this.value ?? [], g = (n, l) => {
        if (n.disabled)
          return u(n, "disabled");
        const s = o.includes(n.value);
        return l && s ? u(n, "active-selected") : s ? u(n, "selected") : u(n, l ? "active" : "inactive");
      };
      switch (this.state) {
        case "submit": {
          const n = this.options.filter(({ value: s }) => o.includes(s)).map((s) => u(s, "submitted")).join(styleText2("dim", ", ")) || styleText2("dim", "none"), l = wrapTextWithPrefix(i.output, n, t ? `${styleText2("gray", S_BAR2)}  ` : "");
          return `${r}${l}`;
        }
        case "cancel": {
          const n = this.options.filter(({ value: s }) => o.includes(s)).map((s) => u(s, "cancelled")).join(styleText2("dim", ", "));
          if (n.trim() === "")
            return `${r}${styleText2("gray", S_BAR2)}`;
          const l = wrapTextWithPrefix(i.output, n, t ? `${styleText2("gray", S_BAR2)}  ` : "");
          return `${r}${l}${t ? `
${styleText2("gray", S_BAR2)}` : ""}`;
        }
        case "error": {
          const n = t ? `${styleText2("yellow", S_BAR2)}  ` : "", l = this.error.split(`
`).map(($, v) => v === 0 ? `${t ? `${styleText2("yellow", S_BAR_END2)}  ` : ""}${styleText2("yellow", $)}` : `   ${$}`).join(`
`), s = r.split(`
`).length, h = l.split(`
`).length + 1;
          return `${r}${n}${limitOptions2({
            output: i.output,
            options: this.options,
            cursor: this.cursor,
            maxItems: i.maxItems,
            columnPadding: n.length,
            rowPadding: s + h,
            style: g
          }).join(`
${n}`)}
${l}
`;
        }
        default: {
          const n = t ? `${styleText2("cyan", S_BAR2)}  ` : "", l = r.split(`
`).length, s = x ? formatInstructionFooter2(MULTISELECT_INSTRUCTIONS2, t) : t ? [styleText2("cyan", S_BAR_END2)] : [], h = s.join(`
`), $ = s.length + 1;
          return `${r}${n}${limitOptions2({
            output: i.output,
            options: this.options,
            cursor: this.cursor,
            maxItems: i.maxItems,
            columnPadding: n.length,
            rowPadding: l + $,
            style: g
          }).join(`
${n}`)}
${h}
`;
        }
      }
    }
  }).prompt();
};
var groupMultiselect2 = (o) => {
  const { selectableGroups: f = true, groupSpacing: x = 0 } = o, d = (n, l, p = []) => {
    const a = n.label ?? String(n.value), t = typeof n.group == "string", s = t && (p[p.indexOf(n) + 1] ?? { group: true }), u = t && s && s.group === true;
    let r = "", c = "";
    t && (f ? (r = u ? `${S_BAR_END2} ` : `${S_BAR2} `, c = u ? "  " : `${S_BAR2} `) : r = "  ");
    let i = "";
    if (x > 0 && !t && (i = `
`.repeat(x)), l === "active")
      return wrapTextWithPrefix(o.output, `${a}${n.hint ? ` ${styleText2("dim", `(${n.hint})`)}` : ""}`, `${i}${styleText2("dim", r)} `, `${i}${styleText2("dim", r)}${styleText2("cyan", S_CHECKBOX_ACTIVE2)} `, `${i}${styleText2("dim", c)} `);
    if (l === "group-active")
      return wrapTextWithPrefix(o.output, a, `${i}${r} `, `${i}${r}${styleText2("cyan", S_CHECKBOX_ACTIVE2)} `, `${i}${c} `, (m) => styleText2("dim", m));
    if (l === "group-active-selected")
      return wrapTextWithPrefix(o.output, a, `${i}${r} `, `${i}${r}${styleText2("green", S_CHECKBOX_SELECTED2)} `, `${i}${c} `, (m) => styleText2("dim", m));
    if (l === "selected") {
      const m = t || f ? styleText2("green", S_CHECKBOX_SELECTED2) : "";
      return wrapTextWithPrefix(o.output, `${a}${n.hint ? ` (${n.hint})` : ""}`, `${i}${styleText2("dim", r)} `, `${i}${styleText2("dim", r)}${m} `, `${i}${styleText2("dim", c)} `, (I) => styleText2("dim", I));
    }
    if (l === "cancelled")
      return `${styleText2(["strikethrough", "dim"], a)}`;
    if (l === "active-selected")
      return wrapTextWithPrefix(o.output, `${a}${n.hint ? ` ${styleText2("dim", `(${n.hint})`)}` : ""}`, `${i}${styleText2("dim", r)} `, `${i}${styleText2("dim", r)}${styleText2("green", S_CHECKBOX_SELECTED2)} `, `${i}${styleText2("dim", c)} `);
    if (l === "submitted")
      return `${styleText2("dim", a)}`;
    const h = t || f ? styleText2("dim", S_CHECKBOX_INACTIVE2) : "";
    return wrapTextWithPrefix(o.output, a, `${i}${styleText2("dim", r)} `, `${i}${styleText2("dim", r)}${h} `, `${i}${styleText2("dim", c)} `, (m) => styleText2("dim", m));
  }, y = o.required ?? true, S = o.showInstructions ?? true;
  return new u$2({
    options: o.options,
    signal: o.signal,
    input: o.input,
    output: o.output,
    initialValues: o.initialValues,
    required: y,
    cursorAt: o.cursorAt,
    selectableGroups: f,
    validate(n) {
      if (y && (n === undefined || n.length === 0))
        return `Please select at least one option.
${styleText2("reset", styleText2("dim", `Press ${styleText2(["gray", "bgWhite", "inverse"], " space ")} to select, ${styleText2("gray", styleText2(["bgWhite", "inverse"], " enter "))} to submit`))}`;
    },
    render() {
      const n = o.withGuide ?? settings2.withGuide, l = `${n ? `${styleText2("gray", S_BAR2)}
` : ""}${symbol2(this.state)}  ${o.message}
`, p = this.value ?? [], a = (t, s) => {
        const u = this.options, r = p.includes(t.value) || t.group === true && this.isGroupSelected(`${t.value}`);
        return !s && typeof t.group == "string" && this.options[this.cursor]?.value === t.group ? d(t, r ? "group-active-selected" : "group-active", u) : s && r ? d(t, "active-selected", u) : r ? d(t, "selected", u) : d(t, s ? "active" : "inactive", u);
      };
      switch (this.state) {
        case "submit": {
          const t = this.options.filter(({ value: u }) => p.includes(u)).map((u) => d(u, "submitted")), s = t.length === 0 ? "" : `  ${t.join(styleText2("dim", ", "))}`;
          return `${l}${n ? styleText2("gray", S_BAR2) : ""}${s}`;
        }
        case "cancel": {
          const t = this.options.filter(({ value: s }) => p.includes(s)).map((s) => d(s, "cancelled")).join(styleText2("dim", ", "));
          return `${l}${n ? `${styleText2("gray", S_BAR2)}  ` : ""}${t.trim() ? `${t}${n ? `
${styleText2("gray", S_BAR2)}` : ""}` : ""}`;
        }
        case "error": {
          const t = n ? `${styleText2("yellow", S_BAR2)}  ` : "", s = this.error.split(`
`).map((i, h) => h === 0 ? `${n ? `${styleText2("yellow", S_BAR_END2)}  ` : ""}${styleText2("yellow", i)}` : `   ${i}`).join(`
`), u = l.split(`
`).length, r = s.split(`
`).length + 1, c = limitOptions2({
            output: o.output,
            options: this.options,
            cursor: this.cursor,
            maxItems: o.maxItems,
            columnPadding: t.length,
            rowPadding: u + r,
            style: a
          }).join(`
${t}`);
          return `${l}${t}${c}
${s}
`;
        }
        default: {
          const t = n ? `${styleText2("cyan", S_BAR2)}  ` : "", s = l.split(`
`).length, u = S ? formatInstructionFooter2(MULTISELECT_INSTRUCTIONS2, n) : n ? [styleText2("cyan", S_BAR_END2)] : [], r = u.join(`
`), c = u.length + 1, i = limitOptions2({
            output: o.output,
            options: this.options,
            cursor: this.cursor,
            maxItems: o.maxItems,
            columnPadding: t.length,
            rowPadding: s + c,
            style: a
          }).join(`
${t}`);
          return `${l}${t}${i}
${r}
`;
        }
      }
    }
  }).prompt();
};
var log2 = {
  message: (s = [], {
    symbol: e = styleText2("gray", S_BAR2),
    secondarySymbol: r = styleText2("gray", S_BAR2),
    output: m = process.stdout,
    spacing: l = 1,
    withGuide: c
  } = {}) => {
    const t = [], o = c ?? settings2.withGuide, f = o ? r : "", O = o ? `${e}  ` : "", u = o ? `${r}  ` : "";
    for (let i = 0;i < l; i++)
      t.push(f);
    const g = Array.isArray(s) ? s : s.split(`
`);
    if (g.length > 0) {
      const [i, ...y] = g;
      i.length > 0 ? t.push(`${O}${i}`) : t.push(o ? e : "");
      for (const p of y)
        p.length > 0 ? t.push(`${u}${p}`) : t.push(o ? r : "");
    }
    m.write(`${t.join(`
`)}
`);
  },
  info: (s, e) => {
    log2.message(s, { ...e, symbol: styleText2("blue", S_INFO2) });
  },
  success: (s, e) => {
    log2.message(s, { ...e, symbol: styleText2("green", S_SUCCESS2) });
  },
  step: (s, e) => {
    log2.message(s, { ...e, symbol: styleText2("green", S_STEP_SUBMIT2) });
  },
  warn: (s, e) => {
    log2.message(s, { ...e, symbol: styleText2("yellow", S_WARN2) });
  },
  warning: (s, e) => {
    log2.warn(s, e);
  },
  error: (s, e) => {
    log2.message(s, { ...e, symbol: styleText2("red", S_ERROR2) });
  }
};
var cancel2 = (o = "", t) => {
  const i = t?.output ?? process.stdout, e = t?.withGuide ?? settings2.withGuide ? `${styleText2("gray", S_BAR_END2)}  ` : "";
  i.write(`${e}${styleText2("red", o)}

`);
};
var intro2 = (o = "", t) => {
  const i = t?.output ?? process.stdout, e = t?.withGuide ?? settings2.withGuide ? `${styleText2("gray", S_BAR_START2)}  ` : "";
  i.write(`${e}${o}
`);
};
var outro2 = (o = "", t) => {
  const i = t?.output ?? process.stdout, e = t?.withGuide ?? settings2.withGuide ? `${styleText2("gray", S_BAR2)}
${styleText2("gray", S_BAR_END2)}  ` : "";
  i.write(`${e}${o}

`);
};
var multiline2 = (e) => new h({
  validate: e.validate,
  placeholder: e.placeholder,
  defaultValue: e.defaultValue,
  initialValue: e.initialValue,
  showSubmit: e.showSubmit,
  output: e.output,
  signal: e.signal,
  input: e.input,
  render() {
    const i = e?.withGuide ?? settings2.withGuide, o = `${`${i ? `${styleText2("gray", S_BAR2)}
` : ""}${symbol2(this.state)}  `}${e.message}
`, h = e.placeholder && e.placeholder.length > 0 ? styleText2("inverse", e.placeholder[0]) + styleText2("dim", e.placeholder.slice(1)) : styleText2(["inverse", "hidden"], "_"), a = this.userInput ? this.userInputWithCursor : h, l = this.value ?? "", d = e.showSubmit ? `
  ${styleText2(this.focused === "submit" ? "cyan" : "dim", "[ submit ]")}` : "";
    switch (this.state) {
      case "error": {
        const n = `${styleText2("yellow", S_BAR2)}  `, r = i ? wrapTextWithPrefix(e.output, a, n, undefined) : a, u = styleText2("yellow", S_BAR_END2);
        return `${o}${r}
${u}  ${styleText2("yellow", this.error)}${d}
`;
      }
      case "submit": {
        const n = `${styleText2("gray", S_BAR2)}  `, r = i ? wrapTextWithPrefix(e.output, l, n, undefined, undefined, (u) => styleText2("dim", u)) : l ? styleText2("dim", l) : "";
        return `${o}${r}`;
      }
      case "cancel": {
        const n = `${styleText2("gray", S_BAR2)}  `, r = i ? wrapTextWithPrefix(e.output, l, n, undefined, undefined, (u) => styleText2(["strikethrough", "dim"], u)) : l ? styleText2(["strikethrough", "dim"], l) : "";
        return `${o}${r}`;
      }
      default: {
        const n = i ? `${styleText2("cyan", S_BAR2)}  ` : "", r = i ? styleText2("cyan", S_BAR_END2) : "", u = i ? wrapTextWithPrefix(e.output, a, n) : a;
        return `${o}${u}
${r}${d}
`;
      }
    }
  }
}).prompt();
var W$1 = (o) => o;
var C2 = (o, e, s) => {
  const a = {
    hard: true,
    trim: false
  }, i = wrapAnsi(o, e, a).split(`
`), c = i.reduce((n, t) => Math.max(dist_default2(t), n), 0), u = i.map(s).reduce((n, t) => Math.max(dist_default2(t), n), 0), g = e - (u - c);
  return wrapAnsi(o, g, a);
};
var note2 = (o = "", e = "", s) => {
  const a = s?.output ?? process$1.stdout, i = s?.withGuide ?? settings2.withGuide, c = s?.format ?? W$1, g = ["", ...C2(o, getColumns(a) - 6, c).split(`
`).map(c), ""], n = dist_default2(e), t = Math.max(g.reduce((m, F) => {
    const O = dist_default2(F);
    return O > m ? O : m;
  }, 0), n) + 2, h = g.map((m) => `${styleText2("gray", S_BAR2)}  ${m}${" ".repeat(t - dist_default2(m))}${styleText2("gray", S_BAR2)}`).join(`
`), T = i ? `${styleText2("gray", S_BAR2)}
` : "", l$1 = i ? S_CONNECT_LEFT2 : S_CORNER_BOTTOM_LEFT2;
  a.write(`${T}${styleText2("green", S_STEP_SUBMIT2)}  ${styleText2("reset", e)} ${styleText2("gray", S_BAR_H2.repeat(Math.max(t - n - 1, 1)) + S_CORNER_TOP_RIGHT2)}
${h}
${styleText2("gray", l$1 + S_BAR_H2.repeat(t + 2) + S_CORNER_BOTTOM_RIGHT2)}
`);
};
var password2 = (e) => new u$1({
  validate: e.validate,
  mask: e.mask ?? S_PASSWORD_MASK2,
  signal: e.signal,
  input: e.input,
  output: e.output,
  render() {
    const r = e.withGuide ?? settings2.withGuide, o = `${r ? `${styleText2("gray", S_BAR2)}
` : ""}${symbol2(this.state)}  ${e.message}
`, m = this.userInputWithCursor, i = this.masked;
    switch (this.state) {
      case "error": {
        const s = r ? `${styleText2("yellow", S_BAR2)}  ` : "", n = r ? `${styleText2("yellow", S_BAR_END2)}  ` : "", d = i ?? "";
        return e.clearOnError && this.clear(), `${o.trim()}
${s}${d}
${n}${styleText2("yellow", this.error)}
`;
      }
      case "submit": {
        const s = r ? `${styleText2("gray", S_BAR2)}  ` : "", n = i ? styleText2("dim", i) : "";
        return `${o}${s}${n}`;
      }
      case "cancel": {
        const s = r ? `${styleText2("gray", S_BAR2)}  ` : "", n = i ? styleText2(["strikethrough", "dim"], i) : "";
        return `${o}${s}${n}${i && r ? `
${styleText2("gray", S_BAR2)}` : ""}`;
      }
      default: {
        const s = r ? `${styleText2("cyan", S_BAR2)}  ` : "", n = r ? styleText2("cyan", S_BAR_END2) : "";
        return `${o}${s}${m}
${n}
`;
      }
    }
  }
}).prompt();
var path2 = (e) => {
  const a = e.validate;
  return autocomplete2({
    ...e,
    initialUserInput: e.initialValue ?? e.root ?? process.cwd(),
    maxItems: 5,
    completeOnTab: true,
    validate(t) {
      if (!Array.isArray(t)) {
        if (!t)
          return "Please select a path";
        if (a)
          return runValidation(a, t);
      }
    },
    options() {
      const t = this.userInput;
      if (t === "")
        return [];
      try {
        let i;
        existsSync(t) ? lstatSync(t).isDirectory() && (!e.directory || t.endsWith("/")) ? i = t : i = dirname(t) : i = dirname(t);
        const c = t.length > 1 && t.endsWith("/") ? t.slice(0, -1) : t;
        return readdirSync(i).map((r) => {
          const n = join(i, r), m = lstatSync(n);
          return {
            name: r,
            path: n,
            isDirectory: m.isDirectory()
          };
        }).filter(({ path: r, isDirectory: n }) => r.startsWith(c) && (n || !e.directory)).map((r) => ({
          value: r.path
        }));
      } catch {
        return [];
      }
    }
  });
};
var W = (l) => styleText2("magenta", l);
var spinner2 = ({
  indicator: l = "dots",
  onCancel: h,
  output: n = process.stdout,
  cancelMessage: G,
  errorMessage: O,
  frames: E = unicode2 ? ["◒", "◐", "◓", "◑"] : ["•", "o", "O", "0"],
  delay: F = unicode2 ? 80 : 120,
  signal: m,
  ...I
} = {}) => {
  const u = isCI2();
  let M, T, d = false, S = false, s = "", p, w = performance.now();
  const x = getColumns(n), k = I?.styleFrame ?? W, g = (e) => {
    const r = e > 1 ? O ?? settings2.messages.error : G ?? settings2.messages.cancel;
    S = e === 1, d && (a(r, e), S && typeof h == "function" && h());
  }, f = () => g(2), i = () => g(1), A = () => {
    process.on("uncaughtExceptionMonitor", f), process.on("unhandledRejection", f), process.on("SIGINT", i), process.on("SIGTERM", i), process.on("exit", g), m && m.addEventListener("abort", i);
  }, H = () => {
    process.removeListener("uncaughtExceptionMonitor", f), process.removeListener("unhandledRejection", f), process.removeListener("SIGINT", i), process.removeListener("SIGTERM", i), process.removeListener("exit", g), m && m.removeEventListener("abort", i);
  }, y = () => {
    if (p === undefined)
      return;
    u && n.write(`
`);
    const r = wrapAnsi(p, x, {
      hard: true,
      trim: false
    }).split(`
`);
    r.length > 1 && n.write(import_sisteransi2.cursor.up(r.length - 1)), n.write(import_sisteransi2.cursor.to(0)), n.write(import_sisteransi2.erase.down());
  }, C = (e) => e.replace(/\.+$/, ""), _ = (e) => {
    const r = (performance.now() - e) / 1000, t = Math.floor(r / 60), o = Math.floor(r % 60);
    return t > 0 ? `[${t}m ${o}s]` : `[${o}s]`;
  }, N = I.withGuide ?? settings2.withGuide, P = (e = "") => {
    d = true, M = block({ output: n }), s = C(e), w = performance.now(), N && n.write(`${styleText2("gray", S_BAR2)}
`);
    let r = 0, t = 0;
    A(), T = setInterval(() => {
      if (u && s === p)
        return;
      y(), p = s;
      const o = k(E[r]);
      let v;
      if (u)
        v = `${o}  ${s}...`;
      else if (l === "timer")
        v = `${o}  ${s} ${_(w)}`;
      else {
        const B = ".".repeat(Math.floor(t)).slice(0, 3);
        v = `${o}  ${s}${B}`;
      }
      const j = wrapAnsi(v, x, {
        hard: true,
        trim: false
      });
      n.write(j), r = r + 1 < E.length ? r + 1 : 0, t = t < 4 ? t + 0.125 : 0;
    }, F);
  }, a = (e = "", r = 0, t = false) => {
    if (!d)
      return;
    d = false, clearInterval(T), y();
    const o = r === 0 ? styleText2("green", S_STEP_SUBMIT2) : r === 1 ? styleText2("red", S_STEP_CANCEL2) : styleText2("red", S_STEP_ERROR2);
    s = e ?? s, t || (l === "timer" ? n.write(`${o}  ${s} ${_(w)}
`) : n.write(`${o}  ${s}
`)), H(), M();
  };
  return {
    start: P,
    stop: (e = "") => a(e, 0),
    message: (e = "") => {
      s = C(e ?? s);
    },
    cancel: (e = "") => a(e, 1),
    error: (e = "") => a(e, 2),
    clear: () => a("", 0, true),
    get isCancelled() {
      return S;
    }
  };
};
var u2 = {
  light: unicodeOr2("─", "-"),
  heavy: unicodeOr2("━", "="),
  block: unicodeOr2("█", "#")
};
function progress2({
  style: o = "heavy",
  max: d = 100,
  size: v = 40,
  ...x
} = {}) {
  const r = spinner2(x);
  let a = 0, n = "";
  const c = Math.max(1, d), l = Math.max(1, v), S = (t) => {
    switch (t) {
      case "initial":
      case "active":
        return (e) => styleText2("magenta", e);
      case "error":
      case "cancel":
        return (e) => styleText2("red", e);
      case "submit":
        return (e) => styleText2("green", e);
      default:
        return (e) => styleText2("magenta", e);
    }
  }, p = (t, e) => {
    const m = Math.floor(a / c * l);
    return `${S(t)(u2[o].repeat(m))}${styleText2("dim", u2[o].repeat(l - m))} ${e}`;
  }, h = (t = "") => {
    n = t, r.start(p("initial", t));
  }, g = (t = 1, e) => {
    a = Math.min(c, t + a), r.message(p("active", e ?? n)), n = e ?? n;
  };
  return {
    start: h,
    stop: r.stop,
    cancel: r.cancel,
    error: r.error,
    clear: r.clear,
    advance: g,
    isCancelled: r.isCancelled,
    message: (t) => g(0, t)
  };
}
var SELECT_INSTRUCTIONS2 = [
  `${styleText2("dim", "↑/↓")} to navigate`,
  `${styleText2("dim", "Enter:")} confirm`
];
var c2 = (t, o) => t.includes(`
`) ? t.split(`
`).map((d) => o(d)).join(`
`) : o(t);
var select2 = (t) => {
  const o = (n, m) => {
    if (n === undefined)
      return "";
    const s = n.label ?? String(n.value);
    switch (m) {
      case "disabled":
        return `${styleText2("gray", S_RADIO_INACTIVE2)} ${c2(s, (i) => styleText2("gray", i))}${n.hint ? ` ${styleText2("dim", `(${n.hint ?? "disabled"})`)}` : ""}`;
      case "selected":
        return `${c2(s, (i) => styleText2("dim", i))}`;
      case "active":
        return `${styleText2("green", S_RADIO_ACTIVE2)} ${s}${n.hint ? ` ${styleText2("dim", `(${n.hint})`)}` : ""}`;
      case "cancelled":
        return `${c2(s, (i) => styleText2(["strikethrough", "dim"], i))}`;
      default:
        return `${styleText2("dim", S_RADIO_INACTIVE2)} ${c2(s, (i) => styleText2("dim", i))}`;
    }
  }, d = t.showInstructions ?? true;
  return new n$1({
    options: t.options,
    signal: t.signal,
    input: t.input,
    output: t.output,
    initialValue: t.initialValue,
    render() {
      const n = t.withGuide ?? settings2.withGuide, m = `${symbol2(this.state)}  `, s = `${symbolBar2(this.state)}  `, i = wrapTextWithPrefix(t.output, t.message, s, m), u = `${n ? `${styleText2("gray", S_BAR2)}
` : ""}${i}
`;
      switch (this.state) {
        case "submit": {
          const r = n ? `${styleText2("gray", S_BAR2)}  ` : "", a = wrapTextWithPrefix(t.output, o(this.options[this.cursor], "selected"), r);
          return `${u}${a}`;
        }
        case "cancel": {
          const r = n ? `${styleText2("gray", S_BAR2)}  ` : "", a = wrapTextWithPrefix(t.output, o(this.options[this.cursor], "cancelled"), r);
          return `${u}${a}${n ? `
${styleText2("gray", S_BAR2)}` : ""}`;
        }
        default: {
          const r = n ? `${styleText2("cyan", S_BAR2)}  ` : "", a = u.split(`
`).length, p = d ? formatInstructionFooter2(SELECT_INSTRUCTIONS2, n) : n ? [styleText2("cyan", S_BAR_END2)] : [], f = p.join(`
`), b = p.length + 1;
          return `${u}${r}${limitOptions2({
            output: t.output,
            cursor: this.cursor,
            options: this.options,
            maxItems: t.maxItems,
            columnPadding: r.length,
            rowPadding: a + b,
            style: (g, x) => o(g, g.disabled ? "disabled" : x ? "active" : "inactive")
          }).join(`
${r}`)}
${f}
`;
        }
      }
    }
  }).prompt();
};
var selectKey2 = (t) => {
  const c = (e, a = "inactive") => {
    if (e === undefined)
      return "";
    const n = e.label ?? String(e.value);
    return a === "selected" ? `${styleText2("dim", n)}` : a === "cancelled" ? `${styleText2(["strikethrough", "dim"], n)}` : a === "active" ? `${styleText2(["bgCyan", "gray"], ` ${e.value} `)} ${n}${e.hint ? ` ${styleText2("dim", `(${e.hint})`)}` : ""}` : `${styleText2(["gray", "bgWhite", "inverse"], ` ${e.value} `)} ${n}${e.hint ? ` ${styleText2("dim", `(${e.hint})`)}` : ""}`;
  };
  return new u({
    options: t.options,
    signal: t.signal,
    input: t.input,
    output: t.output,
    initialValue: t.initialValue,
    caseSensitive: t.caseSensitive,
    render() {
      const e = t.withGuide ?? settings2.withGuide, a = `${e ? `${styleText2("gray", S_BAR2)}
` : ""}${symbol2(this.state)}  ${t.message}
`;
      switch (this.state) {
        case "submit": {
          const n = e ? `${styleText2("gray", S_BAR2)}  ` : "", r = this.options.find((u) => u.value === this.value) ?? t.options[0], l = wrapTextWithPrefix(t.output, c(r, "selected"), n);
          return `${a}${l}`;
        }
        case "cancel": {
          const n = e ? `${styleText2("gray", S_BAR2)}  ` : "", r = wrapTextWithPrefix(t.output, c(this.options[0], "cancelled"), n);
          return `${a}${r}${e ? `
${styleText2("gray", S_BAR2)}` : ""}`;
        }
        default: {
          const n = e ? `${styleText2("cyan", S_BAR2)}  ` : "", r = e ? styleText2("cyan", S_BAR_END2) : "", l = this.options.map((u, d) => wrapTextWithPrefix(t.output, c(u, d === this.cursor ? "active" : "inactive"), n)).join(`
`);
          return `${a}${l}
${r}
`;
        }
      }
    }
  }).prompt();
};
var i = `${styleText2("gray", S_BAR2)}  `;
var stream2 = {
  message: async (e, { symbol: l = styleText2("gray", S_BAR2) } = {}) => {
    process.stdout.write(`${styleText2("gray", S_BAR2)}
${l}  `);
    let s = 3;
    for await (let r of e) {
      r = r.replace(/\n/g, `
${i}`), r.includes(`
`) && (s = 3 + stripVTControlCharacters(r.slice(r.lastIndexOf(`
`))).length);
      const o = stripVTControlCharacters(r).length;
      s + o < process.stdout.columns ? (s += o, process.stdout.write(r)) : (process.stdout.write(`
${i}${r.trimStart()}`), s = 3 + stripVTControlCharacters(r.trimStart()).length);
    }
    process.stdout.write(`
`);
  },
  info: (e) => stream2.message(e, { symbol: styleText2("blue", S_INFO2) }),
  success: (e) => stream2.message(e, { symbol: styleText2("green", S_SUCCESS2) }),
  step: (e) => stream2.message(e, { symbol: styleText2("green", S_STEP_SUBMIT2) }),
  warn: (e) => stream2.message(e, { symbol: styleText2("yellow", S_WARN2) }),
  warning: (e) => stream2.warn(e),
  error: (e) => stream2.message(e, { symbol: styleText2("red", S_ERROR2) })
};
var tasks2 = async (o, e) => {
  for (const t of o) {
    if (t.enabled === false)
      continue;
    const s = spinner2(e);
    s.start(t.title);
    const n = await t.task(s.message);
    s.stop(n || t.title);
  }
};
var A = (l) => l.replace(/\x1b\[(?:\d+;)*\d*[ABCDEFGHfJKSTsu]|\x1b\[(s|u)/g, "");
var taskLog2 = (l) => {
  const r = l.output ?? process.stdout, O = getColumns(r), i = styleText2("gray", S_BAR2), p = l.spacing ?? 1, k = 3, m = l.retainLog === true, d = !isCI2() && isTTY2(r);
  r.write(`${i}
`), r.write(`${styleText2("green", S_STEP_SUBMIT2)}  ${l.title}
`);
  for (let e = 0;e < p; e++)
    r.write(`${i}
`);
  const n = [
    {
      value: "",
      full: ""
    }
  ];
  let v = false;
  const f = (e) => {
    if (n.length === 0)
      return;
    let s = 0;
    e && (s += p + 2);
    for (const t of n) {
      const { value: o, result: a } = t;
      let g = a?.message ?? o;
      if (g.length === 0)
        continue;
      a === undefined && t.header !== undefined && t.header !== "" && (g += `
${t.header}`);
      const E = g.split(`
`).reduce((b, w) => w === "" ? b + 1 : b + Math.ceil((w.length + k) / O), 0);
      s += E;
    }
    s > 0 && (s += 1, r.write(import_sisteransi2.erase.lines(s)));
  }, h = (e, s, t) => {
    const o = t ? `${e.full}
${e.value}` : e.value;
    e.header !== undefined && e.header !== "" && log2.message(e.header.split(`
`).map((a) => styleText2("bold", a)), {
      output: r,
      secondarySymbol: i,
      symbol: i,
      spacing: 0
    }), log2.message(o.split(`
`).map((a) => styleText2("dim", a)), {
      output: r,
      secondarySymbol: i,
      symbol: i,
      spacing: s ?? p
    });
  }, T = () => {
    for (const e of n) {
      const { header: s, value: t, full: o } = e;
      (s === undefined || s.length === 0) && t.length === 0 || h(e, undefined, m === true && o.length > 0);
    }
  }, L = (e, s, t) => {
    if (f(false), (t?.raw !== true || !v) && e.value !== "" && (e.value += `
`), e.value += A(s), v = t?.raw === true, l.limit !== undefined) {
      const o = e.value.split(`
`), a = o.length - l.limit;
      if (a > 0) {
        const g = o.splice(0, a);
        m && (e.full += (e.full === "" ? "" : `
`) + g.join(`
`));
      }
      e.value = o.join(`
`);
    }
    d && y();
  }, y = () => {
    for (const e of n)
      e.result ? e.result.status === "error" ? log2.error(e.result.message, { output: r, secondarySymbol: i, spacing: 0 }) : log2.success(e.result.message, { output: r, secondarySymbol: i, spacing: 0 }) : e.value !== "" && h(e, 0);
  }, B = (e, s) => {
    f(false), e.result = s, d && y();
  };
  return {
    message(e, s) {
      L(n[0], e, s);
    },
    group(e) {
      const s = {
        header: e,
        value: "",
        full: ""
      };
      return n.push(s), {
        message(t, o) {
          L(s, t, o);
        },
        error(t) {
          B(s, {
            status: "error",
            message: t
          });
        },
        success(t) {
          B(s, {
            status: "success",
            message: t
          });
        }
      };
    },
    error(e, s) {
      f(true), log2.error(e, { output: r, secondarySymbol: i, spacing: 1 }), s?.showLog !== false && T(), n.splice(1, n.length - 1), n[0].value = "", n[0].full = "";
    },
    success(e, s) {
      f(true), log2.success(e, { output: r, secondarySymbol: i, spacing: 1 }), s?.showLog === true && T(), n.splice(1, n.length - 1), n[0].value = "", n[0].full = "";
    }
  };
};
var text2 = (t) => new n({
  validate: t.validate,
  placeholder: t.placeholder,
  defaultValue: t.defaultValue,
  initialValue: t.initialValue,
  output: t.output,
  signal: t.signal,
  input: t.input,
  render() {
    const r = t?.withGuide ?? settings2.withGuide, l = `${`${r ? `${styleText2("gray", S_BAR2)}
` : ""}${symbol2(this.state)}  `}${t.message}
`, d = t.placeholder && t.placeholder.length > 0 ? styleText2("inverse", t.placeholder[0]) + styleText2("dim", t.placeholder.slice(1)) : styleText2(["inverse", "hidden"], "_"), o = this.userInput ? this.userInputWithCursor : d, s = this.value ?? "";
    switch (this.state) {
      case "validating": {
        const n = r ? `${styleText2("cyan", S_BAR2)}  ` : "", i = r ? styleText2("cyan", S_BAR_END2) : "", c = styleText2("dim", o), $ = styleText2("dim", "Validating...");
        return `${l}${n}${c}
${i}  ${$}
`;
      }
      case "error": {
        const n = this.error ? `  ${styleText2("yellow", this.error)}` : "", i = r ? `${styleText2("yellow", S_BAR2)}  ` : "", c = r ? styleText2("yellow", S_BAR_END2) : "";
        return `${l.trim()}
${i}${o}
${c}${n}
`;
      }
      case "submit": {
        const n = s ? `${r ? "  " : ""}${styleText2("dim", s)}` : "", i = r ? styleText2("gray", S_BAR2) : "";
        return `${l}${i}${n}`;
      }
      case "cancel": {
        const n = s ? `  ${styleText2(["strikethrough", "dim"], s)}` : "", i = r ? styleText2("gray", S_BAR2) : "";
        return `${l}${i}${n}${s.trim() ? `
${i}` : ""}`;
      }
      default: {
        const n = r ? `${styleText2("cyan", S_BAR2)}  ` : "", i = r ? styleText2("cyan", S_BAR_END2) : "";
        return `${l}${n}${o}
${i}
`;
      }
    }
  }
}).prompt();
export { settings2, updateSettings2, CANCEL_SYMBOL2, isCancel2, unicode2, isCI2, isTTY2, unicodeOr2, S_STEP_ACTIVE2, S_STEP_CANCEL2, S_STEP_ERROR2, S_STEP_SUBMIT2, S_BAR_START2, S_BAR2, S_BAR_END2, S_BAR_START_RIGHT2, S_BAR_END_RIGHT2, S_RADIO_ACTIVE2, S_RADIO_INACTIVE2, S_CHECKBOX_ACTIVE2, S_CHECKBOX_SELECTED2, S_CHECKBOX_INACTIVE2, S_PASSWORD_MASK2, S_BAR_H2, S_CORNER_TOP_RIGHT2, S_CONNECT_LEFT2, S_CORNER_BOTTOM_RIGHT2, S_CORNER_BOTTOM_LEFT2, S_CORNER_TOP_LEFT2, S_INFO2, S_SUCCESS2, S_WARN2, S_ERROR2, symbol2, symbolBar2, formatInstructionFooter2, limitOptions2, autocomplete2, autocompleteMultiselect2, box2, confirm2, date2, group2, MULTISELECT_INSTRUCTIONS2, multiselect2, groupMultiselect2, log2, cancel2, intro2, outro2, multiline2, note2, password2, path2, spinner2, progress2, SELECT_INSTRUCTIONS2, select2, selectKey2, stream2, tasks2, taskLog2, text2 };
