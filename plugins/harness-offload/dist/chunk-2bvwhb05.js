import {
  __commonJS,
  __toESM
} from "./chunk-d1gt213s.js";

// node_modules/sisteransi/src/index.js
var require_src = __commonJS((exports, module) => {
  var ESC2 = "\x1B";
  var CSI2 = `${ESC2}[`;
  var beep = "\x07";
  var cursor = {
    to(x, y) {
      if (!y)
        return `${CSI2}${x + 1}G`;
      return `${CSI2}${y + 1};${x + 1}H`;
    },
    move(x, y) {
      let ret = "";
      if (x < 0)
        ret += `${CSI2}${-x}D`;
      else if (x > 0)
        ret += `${CSI2}${x}C`;
      if (y < 0)
        ret += `${CSI2}${-y}A`;
      else if (y > 0)
        ret += `${CSI2}${y}B`;
      return ret;
    },
    up: (count = 1) => `${CSI2}${count}A`,
    down: (count = 1) => `${CSI2}${count}B`,
    forward: (count = 1) => `${CSI2}${count}C`,
    backward: (count = 1) => `${CSI2}${count}D`,
    nextLine: (count = 1) => `${CSI2}E`.repeat(count),
    prevLine: (count = 1) => `${CSI2}F`.repeat(count),
    left: `${CSI2}G`,
    hide: `${CSI2}?25l`,
    show: `${CSI2}?25h`,
    save: `${ESC2}7`,
    restore: `${ESC2}8`
  };
  var scroll = {
    up: (count = 1) => `${CSI2}S`.repeat(count),
    down: (count = 1) => `${CSI2}T`.repeat(count)
  };
  var erase = {
    screen: `${CSI2}2J`,
    up: (count = 1) => `${CSI2}1J`.repeat(count),
    down: (count = 1) => `${CSI2}J`.repeat(count),
    line: `${CSI2}2K`,
    lineEnd: `${CSI2}K`,
    lineStart: `${CSI2}1K`,
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
function findCursor(s, o, l2) {
  if (!l2.some((r) => !r.disabled))
    return s;
  const t = s + o, n = Math.max(l2.length - 1, 0), e = t < 0 ? n : t > n ? 0 : t;
  return l2[e]?.disabled ? findCursor(e, o < 0 ? -1 : 1, l2) : e;
}
function findTextCursor(s, o, l2, i) {
  const t = i.split(`
`);
  let n = 0, e = s;
  for (const r of t) {
    if (e <= r.length)
      break;
    e -= r.length + 1, n++;
  }
  for (n = Math.max(0, Math.min(t.length - 1, n + l2)), e = Math.min(e, t[n].length) + o;e < 0 && n > 0; )
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
var settings = {
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
function updateSettings(n) {
  if (n.aliases !== undefined) {
    const e = n.aliases;
    for (const s in e) {
      if (!Object.hasOwn(e, s))
        continue;
      const i = e[s];
      i === undefined || !settings.actions.has(i) || settings.aliases.has(s) || settings.aliases.set(s, i);
    }
  }
  if (n.messages !== undefined) {
    const e = n.messages;
    e.cancel !== undefined && (settings.messages.cancel = e.cancel), e.error !== undefined && (settings.messages.error = e.error);
  }
  if (n.withGuide !== undefined && (settings.withGuide = n.withGuide !== false), n.accessible !== undefined && (settings.accessible = n.accessible === true), n.date !== undefined) {
    const e = n.date;
    e.monthNames !== undefined && (settings.date.monthNames = [...e.monthNames]), e.messages !== undefined && (e.messages.required !== undefined && (settings.date.messages.required = e.messages.required), e.messages.invalidMonth !== undefined && (settings.date.messages.invalidMonth = e.messages.invalidMonth), e.messages.invalidDay !== undefined && (settings.date.messages.invalidDay = e.messages.invalidDay), e.messages.afterMin !== undefined && (settings.date.messages.afterMin = e.messages.afterMin), e.messages.beforeMax !== undefined && (settings.date.messages.beforeMax = e.messages.beforeMax));
  }
}
function isAccessible(n) {
  if (n !== undefined)
    return n;
  if (settings.accessible !== undefined)
    return settings.accessible;
  const e = process.env.ACCESSIBLE;
  return e !== undefined && e !== "" && e !== "0" && e !== "false";
}
function isActionKey(n, e) {
  if (typeof n == "string")
    return settings.aliases.get(n) === e;
  for (const s of n)
    if (s !== undefined && isActionKey(s, e))
      return true;
  return false;
}
function diffLines(i, s) {
  if (i === s)
    return;
  const e = i.split(`
`), t2 = s.split(`
`), r = Math.max(e.length, t2.length), f = [];
  for (let n = 0;n < r; n++)
    e[n] !== t2[n] && f.push(n);
  return {
    lines: f,
    numLinesBefore: e.length,
    numLinesAfter: t2.length,
    numLines: r
  };
}
var R = globalThis.process.platform.startsWith("win");
var CANCEL_SYMBOL = Symbol("clack:cancel");
function isCancel(e) {
  return e === CANCEL_SYMBOL;
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
  const t2 = (f, { name: a, sequence: w }) => {
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
        e.once("keypress", t2);
      });
    });
  };
  return n && r.write(import_sisteransi.cursor.hide), e.once("keypress", t2), () => {
    e.off("keypress", t2), n && r.write(import_sisteransi.cursor.show), e instanceof ReadStream && e.isTTY && !R && e.setRawMode(false), s.terminal = false, s.close();
  };
}
var getColumns = (e) => ("columns" in e) && typeof e.columns == "number" ? e.columns : 80;
var getRows = (e) => ("rows" in e) && typeof e.rows == "number" ? e.rows : 20;
function wrapTextWithPrefix(e, r, o, n = o, s = o, t2) {
  const f = getColumns(e ?? stdout);
  return wrapAnsi(r, f - o.length, {
    hard: true,
    trim: false
  }).split(`
`).map((c, i, m) => {
    const d = t2 ? t2(c, i) : c;
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
  constructor(t2, e = true) {
    const { input: i = stdin, output: s = stdout, render: r, signal: n, ...o } = t2;
    this.opts = o, this.onKeypress = this.onKeypress.bind(this), this.close = this.close.bind(this), this.render = this.render.bind(this), this._render = r.bind(this), this._track = e, this._abortSignal = n, this.input = i, this.output = s;
  }
  unsubscribe() {
    this._subscribers.clear();
  }
  setSubscriber(t2, e) {
    const i = this._subscribers.get(t2) ?? [];
    i.push(e), this._subscribers.set(t2, i);
  }
  on(t2, e) {
    this.setSubscriber(t2, { cb: e });
  }
  once(t2, e) {
    this.setSubscriber(t2, { cb: e, once: true });
  }
  emit(t2, ...e) {
    const i = this._subscribers.get(t2) ?? [], s = [];
    for (const r of i)
      r.cb(...e), r.once && s.push(() => i.splice(i.indexOf(r), 1));
    for (const r of s)
      r();
  }
  prompt() {
    return new Promise((t2) => {
      if (this._abortSignal) {
        if (this._abortSignal.aborted)
          return this.state = "cancel", this.close(), t2(CANCEL_SYMBOL);
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
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), setRawMode(this.input, false), t2(this.value);
      }), this.once("cancel", () => {
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), setRawMode(this.input, false), t2(CANCEL_SYMBOL);
      });
    });
  }
  _isActionKey(t2, e) {
    return t2 === "\t";
  }
  _shouldSubmit(t2, e) {
    return true;
  }
  _setValue(t2) {
    this.value = t2, this.emit("value", this.value);
  }
  _setUserInput(t2, e) {
    this.userInput = t2 ?? "", this.emit("userInput", this.userInput), e && this._track && this.rl && (this.rl.write(this.userInput), this._cursor = this.rl.cursor);
  }
  _clearUserInput() {
    this.rl?.write(null, { ctrl: true, name: "u" }), this._setUserInput("");
  }
  async onKeypress(t2, e) {
    if (this.state !== "validating") {
      if (this._track && e.name !== "return" && (e.name && this._isActionKey(t2, e) && this.rl?.write(null, { ctrl: true, name: "h" }), this._cursor = this.rl?.cursor ?? 0, this._setUserInput(this.rl?.line)), this.state === "error" && (this.state = "active"), e?.name && (!this._track && settings.aliases.has(e.name) && this.emit("cursor", settings.aliases.get(e.name)), settings.actions.has(e.name) && this.emit("cursor", e.name)), t2 && (t2.toLowerCase() === "y" || t2.toLowerCase() === "n") && this.emit("confirm", t2.toLowerCase() === "y"), this.emit("key", t2, e), e?.name === "return" && this._shouldSubmit(t2, e)) {
        if (this.opts.validate) {
          const i = runValidation(this.opts.validate, this.value);
          let s;
          i instanceof Promise ? (this.state = "validating", this.render(), s = await i) : s = i, s && (this.error = s instanceof Error ? s.message : s, this.state = "error", this.rl?.write(this.userInput));
        }
        this.state !== "error" && (this.state = "submit");
      }
      isActionKey([t2, e?.name, e?.sequence], "cancel") && (this.state = "cancel"), (this.state === "submit" || this.state === "cancel") && this.emit("finalize"), this.render(), (this.state === "submit" || this.state === "cancel") && this.close();
    }
  }
  close() {
    this.input.unpipe(), this.input.removeListener("keypress", this.onKeypress), this.output.write(`
`), setRawMode(this.input, false), this.rl?.close(), this.rl = undefined, this.emit(`${this.state}`, this.value), this.unsubscribe();
  }
  restoreCursor() {
    const t2 = wrapAnsi(this._prevFrame, process.stdout.columns, { hard: true, trim: false }).split(`
`).length - 1;
    this.output.write(import_sisteransi.cursor.move(-999, t2 * -1));
  }
  render() {
    const t2 = wrapAnsi(this._render(this) ?? "", process.stdout.columns, {
      hard: true,
      trim: false
    });
    if (t2 !== this._prevFrame) {
      if (this.state === "initial")
        this.output.write(import_sisteransi.cursor.hide);
      else {
        const e = diffLines(this._prevFrame, t2), i = getRows(this.output);
        if (this.restoreCursor(), e) {
          const s = Math.max(0, e.numLinesAfter - i), r = Math.max(0, e.numLinesBefore - i);
          let n = e.lines.find((o) => o >= s);
          if (n === undefined) {
            this._prevFrame = t2;
            return;
          }
          if (e.lines.length === 1) {
            this.output.write(import_sisteransi.cursor.move(0, n - r)), this.output.write(import_sisteransi.erase.lines(1));
            const o = t2.split(`
`);
            this.output.write(o[n]), this._prevFrame = t2, this.output.write(import_sisteransi.cursor.move(0, o.length - n - 1));
            return;
          } else if (e.lines.length > 1) {
            if (s < r)
              n = s;
            else {
              const h = n - r;
              h > 0 && this.output.write(import_sisteransi.cursor.move(0, h));
            }
            this.output.write(import_sisteransi.erase.down());
            const f = t2.split(`
`).slice(n);
            this.output.write(f.join(`
`)), this._prevFrame = t2;
            return;
          }
        }
        this.output.write(import_sisteransi.erase.down());
      }
      this.output.write(t2), this.state === "initial" && (this.state = "active"), this._prevFrame = t2;
    }
  }
}
function p$1(l2, e) {
  if (l2 === undefined || e.length === 0)
    return 0;
  const i = e.findIndex((s) => s.value === l2);
  return i !== -1 ? i : 0;
}
function m(l2, e) {
  return (e.label ?? String(e.value)).toLowerCase().includes(l2.toLowerCase());
}
function g(l2, e) {
  if (e)
    return l2 ? e : e[0];
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
    const e = this.userInput.slice(0, this.cursor), t2 = this.userInput.slice(this.cursor, this.cursor + 1), i = this.userInput.slice(this.cursor + 1);
    return `${e}${styleText("inverse", t2)}${i}`;
  }
  get options() {
    return typeof this.#i == "function" ? this.#i() : this.#i;
  }
  constructor(e) {
    super(e), this.#i = e.options, this.#n = e.placeholder, this.#l = e.completeOnTab === true;
    const t2 = this.options;
    this.filteredOptions = [...t2], this.multiple = e.multiple === true, this.#t = typeof e.options == "function" ? e.filter : e.filter ?? m;
    let i;
    if (e.initialValue && Array.isArray(e.initialValue) ? this.multiple ? i = e.initialValue : i = e.initialValue.slice(0, 1) : !this.multiple && this.options.length > 0 && (i = [this.options[0]?.value]), i)
      for (const s of i) {
        const n = t2.findIndex((r) => r.value === s);
        n !== -1 && (this.toggleSelected(s), this.#e = n);
      }
    this.focusedValue = this.options[this.#e]?.value, this.on("key", (s, n) => this.#u(s, n)), this.on("userInput", (s) => this.#o(s));
  }
  _isActionKey(e, t2) {
    return e === "\t" || this.multiple && this.isNavigating && t2.name === "space" && e !== undefined && e !== "";
  }
  #u(e, t2) {
    const i = t2.name === "up", s = t2.name === "down", n = t2.name === "return", r = this.userInput === "" || this.userInput === "\t", u = this.#n, d = this.options, c = u !== undefined && u !== "" && d.some((o) => !o.disabled && (this.#t ? this.#t(u, o) : true));
    if (t2.name === "tab" && r && c) {
      this.userInput === "\t" && this._clearUserInput(), this._setUserInput(u, true), this.isNavigating = false;
      return;
    }
    if (t2.name === "tab" && this.#l && !this.multiple && this.focusedValue !== undefined) {
      const o = String(this.focusedValue);
      this._clearUserInput(), this._setUserInput(o, true), this.isNavigating = false;
      return;
    }
    i || s ? (this.#e = findCursor(this.#e, i ? -1 : 1, this.filteredOptions), this.focusedValue = this.filteredOptions[this.#e]?.value, this.multiple || (this.selectedValues = [this.focusedValue]), this.isNavigating = true) : n ? this.value = g(this.multiple, this.selectedValues) : this.multiple ? this.focusedValue !== undefined && (t2.name === "tab" || this.isNavigating && t2.name === "space") ? this.toggleSelected(this.focusedValue) : this.isNavigating = false : (this.focusedValue && (this.selectedValues = [this.focusedValue]), this.isNavigating = false);
  }
  deselectAll() {
    this.selectedValues = [];
  }
  toggleSelected(e) {
    this.filteredOptions.length !== 0 && (this.multiple ? this.selectedValues.includes(e) ? this.selectedValues = this.selectedValues.filter((t2) => t2 !== e) : this.selectedValues = [...this.selectedValues, e] : this.selectedValues = [e]);
  }
  #o(e) {
    if (e !== this.#s) {
      this.#s = e;
      const t2 = this.options;
      e && this.#t ? this.filteredOptions = t2.filter((n) => this.#t?.(e, n)) : this.filteredOptions = [...t2];
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
  constructor(t2) {
    super(t2, false), this.value = !!t2.initialValue, this.on("userInput", () => {
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
function M(r2) {
  return [...r2].map((t2) => _[t2]);
}
function P(r2) {
  const i = new Intl.DateTimeFormat(r2, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(2000, 0, 15)), s = [];
  let n = "/";
  for (const e of i)
    e.type === "literal" ? n = e.value.trim() || e.value : (e.type === "year" || e.type === "month" || e.type === "day") && s.push({ type: e.type, len: e.type === "year" ? 4 : 2 });
  return { segments: s, separator: n };
}
function p(r2) {
  return Number.parseInt((r2 || "0").replace(/_/g, "0"), 10) || 0;
}
function f(r2) {
  return {
    year: p(r2.year),
    month: p(r2.month),
    day: p(r2.day)
  };
}
function c(r2, t2) {
  return new Date(r2 || 2001, t2 || 1, 0).getDate();
}
function b(r2) {
  const { year: t2, month: i, day: s } = f(r2);
  if (!t2 || t2 < 0 || t2 > 9999 || !i || i < 1 || i > 12 || !s || s < 1)
    return;
  const n = new Date(Date.UTC(t2, i - 1, s));
  if (!(n.getUTCFullYear() !== t2 || n.getUTCMonth() !== i - 1 || n.getUTCDate() !== s))
    return { year: t2, month: i, day: s };
}
function C(r2) {
  const t2 = b(r2);
  return t2 ? new Date(Date.UTC(t2.year, t2.month - 1, t2.day)) : undefined;
}
function T2(r2, t2, i, s) {
  const n = i ? {
    year: i.getUTCFullYear(),
    month: i.getUTCMonth() + 1,
    day: i.getUTCDate()
  } : null, e = s ? {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate()
  } : null;
  return r2 === "year" ? { min: n?.year ?? 1, max: e?.year ?? 9999 } : r2 === "month" ? {
    min: n && t2.year === n.year ? n.month : 1,
    max: e && t2.year === e.year ? e.month : 12
  } : {
    min: n && t2.year === n.year && t2.month === n.month ? n.day : 1,
    max: e && t2.year === e.year && t2.month === e.month ? e.day : c(t2.year, t2.month)
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
  #l(t2) {
    return this.#i.map((i) => t2[i.type]).join(this.#o);
  }
  #r() {
    this._setUserInput(this.#l(this.#t)), this._setValue(C(this.#t) ?? undefined);
  }
  constructor(t2) {
    const i = t2.format ? { segments: M(t2.format), separator: t2.separator ?? "/" } : P(t2.locale), s = t2.separator ?? i.separator, n = t2.format ? M(t2.format) : i.segments, e = t2.initialValue ?? t2.defaultValue, m2 = e ? {
      year: String(e.getUTCFullYear()).padStart(4, "0"),
      month: String(e.getUTCMonth() + 1).padStart(2, "0"),
      day: String(e.getUTCDate()).padStart(2, "0")
    } : { year: "____", month: "__", day: "__" }, o = n.map((a) => m2[a.type]).join(s);
    super({ ...t2, initialUserInput: o }, false), this.#i = n, this.#o = s, this.#t = m2, this.#h = t2.minDate, this.#u = t2.maxDate, this.#r(), this.on("cursor", (a) => this.#f(a)), this.on("key", (a, u) => this.#y(a, u)), this.on("finalize", () => this.#p(t2));
  }
  #a() {
    const t2 = Math.max(0, Math.min(this.#e.segmentIndex, this.#i.length - 1)), i = this.#i[t2];
    if (i)
      return this.#e.positionInSegment = Math.max(0, Math.min(this.#e.positionInSegment, i.len - 1)), { segment: i, index: t2 };
  }
  #m(t2) {
    this.inlineError = "", this.#s = null;
    const i = this.#a();
    i && (this.#e.segmentIndex = Math.max(0, Math.min(this.#i.length - 1, i.index + t2)), this.#e.positionInSegment = 0, this.#n = true);
  }
  #d(t2) {
    const i = this.#a();
    if (!i)
      return;
    const { segment: s } = i, n = this.#t[s.type], e = !n || n.replace(/_/g, "") === "", m2 = Number.parseInt((n || "0").replace(/_/g, "0"), 10) || 0, o = T2(s.type, f(this.#t), this.#h, this.#u);
    let a;
    e ? a = t2 === 1 ? o.min : o.max : a = Math.max(Math.min(o.max, m2 + t2), o.min), this.#t = {
      ...this.#t,
      [s.type]: a.toString().padStart(s.len, "0")
    }, this.#n = true, this.#s = null, this.#r();
  }
  #f(t2) {
    if (t2)
      switch (t2) {
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
  #y(t2, i) {
    if (i?.name === "backspace" || i?.sequence === "" || i?.sequence === "\b" || t2 === "" || t2 === "\b") {
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
      const e = i.shift ? -1 : 1, m2 = n.index + e;
      m2 >= 0 && m2 < this.#i.length && (this.#e.segmentIndex = m2, this.#e.positionInSegment = 0, this.#n = true);
      return;
    }
    if (t2 && /^[0-9]$/.test(t2)) {
      const n = this.#a();
      if (!n)
        return;
      const { segment: e } = n, m2 = !this.#t[e.type].replace(/_/g, "");
      if (this.#n && this.#s !== null && !m2) {
        const h = this.#s + t2, d = { ...this.#t, [e.type]: h }, g2 = this.#g(d, e);
        if (g2) {
          this.inlineError = g2, this.#s = null, this.#n = false;
          return;
        }
        this.inlineError = "", this.#t[e.type] = h, this.#s = null, this.#n = false, this.#r(), n.index < this.#i.length - 1 && (this.#e.segmentIndex = n.index + 1, this.#e.positionInSegment = 0, this.#n = true);
        return;
      }
      this.#n && !m2 && (this.#t[e.type] = "_".repeat(e.len), this.#e.positionInSegment = 0), this.#n = false, this.#s = null;
      const o = this.#t[e.type], a = o.indexOf("_"), u = a >= 0 ? a : Math.min(this.#e.positionInSegment, e.len - 1);
      if (u < 0 || u >= e.len)
        return;
      let l2 = o.slice(0, u) + t2 + o.slice(u + 1), D = false;
      if (u === 0 && o === "__" && (e.type === "month" || e.type === "day")) {
        const h = Number.parseInt(t2, 10);
        l2 = `0${t2}`, D = h <= (e.type === "month" ? 1 : 2);
      }
      if (e.type === "year" && (l2 = (o.replace(/_/g, "") + t2).padStart(e.len, "_")), !l2.includes("_")) {
        const h = { ...this.#t, [e.type]: l2 }, d = this.#g(h, e);
        if (d) {
          this.inlineError = d;
          return;
        }
      }
      this.inlineError = "", this.#t[e.type] = l2;
      const y2 = l2.includes("_") ? undefined : b(this.#t);
      if (y2) {
        const { year: h, month: d } = y2, g2 = c(h, d);
        this.#t = {
          year: String(Math.max(0, Math.min(9999, h))).padStart(4, "0"),
          month: String(Math.max(1, Math.min(12, d))).padStart(2, "0"),
          day: String(Math.max(1, Math.min(g2, y2.day))).padStart(2, "0")
        };
      }
      this.#r();
      const S = l2.indexOf("_");
      D ? (this.#n = true, this.#s = t2) : S >= 0 ? this.#e.positionInSegment = S : a >= 0 && n.index < this.#i.length - 1 ? (this.#e.segmentIndex = n.index + 1, this.#e.positionInSegment = 0, this.#n = true) : this.#e.positionInSegment = Math.min(u + 1, e.len - 1);
    }
  }
  #g(t2, i) {
    const { month: s, day: n } = f(t2);
    if (i.type === "month" && (s < 0 || s > 12))
      return settings.date.messages.invalidMonth;
    if (i.type === "day" && (n < 0 || n > 31))
      return settings.date.messages.invalidDay(31, "any month");
  }
  #p(t2) {
    const { year: i, month: s, day: n } = f(this.#t);
    if (i && s && n) {
      const e = c(i, s);
      this.#t = {
        ...this.#t,
        day: String(Math.min(n, e)).padStart(2, "0")
      };
    }
    this.value = C(this.#t) ?? t2.defaultValue ?? undefined;
  }
}
var u$2 = class u extends y {
  options;
  cursor = 0;
  #t;
  getGroupItems(t2) {
    return this.options.filter((r2) => r2.group === t2);
  }
  isGroupSelected(t2) {
    const r2 = this.getGroupItems(t2), e = this.value;
    return e === undefined ? false : r2.every((s) => e.includes(s.value));
  }
  toggleValue() {
    const t2 = this.options[this.cursor];
    if (t2 !== undefined)
      if (this.value === undefined && (this.value = []), t2.group === true) {
        const r2 = t2.value, e = this.getGroupItems(r2);
        this.isGroupSelected(r2) ? this.value = this.value.filter((s) => e.findIndex((i) => i.value === s) === -1) : this.value = [...this.value, ...e.map((s) => s.value)], this.value = Array.from(new Set(this.value));
      } else {
        const r2 = this.value.includes(t2.value);
        this.value = r2 ? this.value.filter((e) => e !== t2.value) : [...this.value, t2.value];
      }
  }
  constructor(t2) {
    super(t2, false);
    const { options: r2 } = t2;
    this.#t = t2.selectableGroups !== false, this.options = Object.entries(r2).flatMap(([e, s]) => [
      { value: e, group: true, label: e },
      ...s.map((i) => ({ ...i, group: e }))
    ]), this.value = [...t2.initialValues ?? []], this.cursor = Math.max(this.options.findIndex(({ value: e }) => e === t2.cursorAt), this.#t ? 0 : 1), this.on("cursor", (e) => {
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
    const t2 = this.userInput;
    if (this.cursor >= t2.length)
      return `${t2}█`;
    const s = t2.slice(0, this.cursor), r2 = t2.slice(this.cursor, this.cursor + 1), i = t2.slice(this.cursor + 1);
    return r2 === `
` ? `${s}█
${i}` : `${s}${styleText("inverse", r2)}${i}`;
  }
  get cursor() {
    return this._cursor;
  }
  #r(t2) {
    if (this.userInput.length === 0) {
      this._setUserInput(t2);
      return;
    }
    this._setUserInput(this.userInput.slice(0, this.cursor) + t2 + this.userInput.slice(this.cursor));
  }
  #i(t2) {
    const s = this.value ?? "";
    switch (t2) {
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
  _shouldSubmit(t2, s) {
    if (this.#s)
      return this.focused === "submit" ? true : (this.#r(`
`), this._cursor++, false);
    const r2 = this.#t;
    return this.#t = true, r2 && this.cursor === this.userInput.length ? (this.userInput[this.cursor - 1] === `
` && (this._setUserInput(this.userInput.slice(0, this.cursor - 1) + this.userInput.slice(this.cursor)), this._cursor--), true) : (this.#r(`
`), this._cursor++, false);
  }
  constructor(t2) {
    const s = t2.initialUserInput ?? t2.initialValue;
    super({
      ...t2,
      initialUserInput: s
    }, false), s !== undefined && (this._cursor = s.length), this.#s = t2.showSubmit ?? false, this.on("key", (r2, i) => {
      if (i?.name && o.has(i.name)) {
        this.#t = false, this.#i(i.name);
        return;
      }
      if (r2 === "\t" && this.#s) {
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
        r2 && (this.#s && this.focused === "submit" && (this.focused = "editor"), this.#r(r2 ?? ""), this._cursor++);
      }
    }), this.on("userInput", (r2) => {
      this._setValue(r2);
    }), this.on("finalize", () => {
      this.value || (this.value = t2.defaultValue), this.value === undefined && (this.value = "");
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
    this.value = i ? [] : e.map((t2) => t2.value);
  }
  toggleInvert() {
    const e = this.value;
    if (!e)
      return;
    const i = this._enabledOptions.filter((t2) => !e.includes(t2.value));
    this.value = i.map((t2) => t2.value);
  }
  toggleValue() {
    this.value === undefined && (this.value = []);
    const e = this.value.includes(this._value);
    this.value = e ? this.value.filter((i) => i !== this._value) : [...this.value, this._value];
  }
  constructor(e) {
    super(e, false), this.options = e.options, this.value = [...e.initialValues ?? []];
    const i = Math.max(this.options.findIndex(({ value: t2 }) => t2 === e.cursorAt), 0);
    this.cursor = this.options[i]?.disabled ? findCursor(i, 1, this.options) : i, this.on("key", (t2, l2) => {
      l2.name === "a" && this.toggleAll(), l2.name === "i" && this.toggleInvert();
    }), this.on("cursor", (t2) => {
      switch (t2) {
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
var u$1 = class u2 extends y {
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
    const t2 = this.userInput;
    if (this.cursor >= t2.length)
      return `${this.masked}${styleText(["inverse", "hidden"], "_")}`;
    const s = this.masked, r2 = s.slice(0, this.cursor), i = s.slice(this.cursor, this.cursor + 1), o2 = s.slice(this.cursor + 1);
    return `${r2}${styleText("inverse", i)}${o2}`;
  }
  clear() {
    this._clearUserInput();
  }
  constructor({ mask: t2, ...s }) {
    super(s), this._mask = t2 ?? "•", this.on("userInput", (r2) => {
      this._setValue(r2);
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
    const o2 = this.options.findIndex(({ value: s }) => s === e.initialValue), t2 = o2 === -1 ? 0 : o2;
    this.cursor = this.options[t2]?.disabled ? findCursor(t2, 1, this.options) : t2, this.changeValue(), this.on("cursor", (s) => {
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

class u3 extends y {
  options;
  cursor = 0;
  constructor(t2) {
    super(t2, false), this.options = t2.options;
    const s = t2.caseSensitive === true, i = this.options.map(({ value: [e] }) => s ? e : e?.toLowerCase());
    this.cursor = Math.max(i.indexOf(t2.initialValue), 0), this.on("key", (e) => {
      if (!e)
        return;
      const o2 = s ? e : e.toLowerCase();
      if (!i.includes(o2))
        return;
      const n2 = this.options.find(({ value: [r2] }) => s ? r2 === o2 : r2?.toLowerCase() === o2);
      n2 && (this.value = n2.value, this.state = "submit", this.emit("submit"));
    });
  }
}

class n2 extends y {
  get userInputWithCursor() {
    if (this.state === "submit")
      return this.userInput;
    const t2 = this.userInput;
    if (this.cursor >= t2.length)
      return `${this.userInput}█`;
    const r2 = t2.slice(0, this.cursor), s = t2.slice(this.cursor, this.cursor + 1), e = t2.slice(this.cursor + 1);
    return `${r2}${styleText("inverse", s)}${e}`;
  }
  get cursor() {
    return this._cursor;
  }
  constructor(t2) {
    super({
      ...t2,
      initialUserInput: t2.initialUserInput ?? t2.initialValue
    }), this.on("userInput", (r2) => {
      this._setValue(r2);
    }), this.on("finalize", () => {
      this.value || (this.value = t2.defaultValue), this.value === undefined && (this.value = "");
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
var unicode = isUnicodeSupported();
var isCI = () => process.env.CI === "true";
var isTTY = (o2) => o2.isTTY === true;
var unicodeOr = (o2, e) => unicode ? o2 : e;
var S_STEP_ACTIVE = unicodeOr("◆", "*");
var S_STEP_CANCEL = unicodeOr("■", "x");
var S_STEP_ERROR = unicodeOr("▲", "x");
var S_STEP_SUBMIT = unicodeOr("◇", "o");
var S_BAR_START = unicodeOr("┌", "T");
var S_BAR = unicodeOr("│", "|");
var S_BAR_END = unicodeOr("└", "—");
var S_BAR_START_RIGHT = unicodeOr("┐", "T");
var S_BAR_END_RIGHT = unicodeOr("┘", "—");
var S_RADIO_ACTIVE = unicodeOr("●", ">");
var S_RADIO_INACTIVE = unicodeOr("○", " ");
var S_CHECKBOX_ACTIVE = unicodeOr("◻", "[•]");
var S_CHECKBOX_SELECTED = unicodeOr("◼", "[+]");
var S_CHECKBOX_INACTIVE = unicodeOr("◻", "[ ]");
var S_PASSWORD_MASK = unicodeOr("▪", "•");
var S_BAR_H = unicodeOr("─", "-");
var S_CORNER_TOP_RIGHT = unicodeOr("╮", "+");
var S_CONNECT_LEFT = unicodeOr("├", "+");
var S_CORNER_BOTTOM_RIGHT = unicodeOr("╯", "+");
var S_CORNER_BOTTOM_LEFT = unicodeOr("╰", "+");
var S_CORNER_TOP_LEFT = unicodeOr("╭", "+");
var S_INFO = unicodeOr("●", "•");
var S_SUCCESS = unicodeOr("◆", "*");
var S_WARN = unicodeOr("▲", "!");
var S_ERROR = unicodeOr("■", "x");
var symbol = (o2) => {
  switch (o2) {
    case "initial":
    case "active":
      return styleText2("cyan", S_STEP_ACTIVE);
    case "cancel":
      return styleText2("red", S_STEP_CANCEL);
    case "error":
      return styleText2("yellow", S_STEP_ERROR);
    case "submit":
      return styleText2("green", S_STEP_SUBMIT);
    case "validating":
      return styleText2("dim", S_STEP_ACTIVE);
  }
};
var symbolBar = (o2) => {
  switch (o2) {
    case "initial":
    case "active":
      return styleText2("cyan", S_BAR);
    case "cancel":
      return styleText2("red", S_BAR);
    case "error":
      return styleText2("yellow", S_BAR);
    case "submit":
      return styleText2("green", S_BAR);
  }
};
function formatInstructionFooter(o2, e) {
  const r2 = [`${e ? `${styleText2("cyan", S_BAR)}  ` : ""}${o2.join(" • ")}`];
  return e && r2.push(styleText2("cyan", S_BAR_END)), r2;
}
var I = (l2, e, w, p2, b2, C2 = false) => {
  let r2 = e, O = 0;
  if (C2)
    for (let i = p2 - 1;i >= w; i--) {
      const m2 = l2[i];
      if (m2 && (r2 -= m2.length), O++, r2 <= b2)
        break;
    }
  else
    for (let i = w;i < p2; i++) {
      const m2 = l2[i];
      if (m2 && (r2 -= m2.length), O++, r2 <= b2)
        break;
    }
  return { lineCount: r2, removals: O };
};
var limitOptions = ({
  cursor: l2,
  options: e,
  style: w,
  output: p2 = process.stdout,
  maxItems: b2 = Number.POSITIVE_INFINITY,
  columnPadding: C2 = 0,
  rowPadding: r2 = 4
}) => {
  const i = getColumns(p2) - C2, m2 = getRows(p2), M2 = styleText2("dim", "..."), v = Math.max(m2 - r2, 0), a2 = Math.max(Math.min(b2, v), 5);
  let f2 = 0;
  l2 >= a2 - 3 && (f2 = Math.max(Math.min(l2 - a2 + 3, e.length - a2), 0));
  let d = a2 < e.length && f2 > 0, c2 = a2 < e.length && f2 + a2 < e.length;
  const W = Math.min(f2 + a2, e.length), s = [];
  let g2 = 0;
  d && g2++, c2 && g2++;
  const T3 = f2 + (d ? 1 : 0), y2 = W - (c2 ? 1 : 0);
  for (let t2 = T3;t2 < y2; t2++) {
    const n3 = e[t2], o2 = n3 ? w(n3, t2 === l2) : "", h2 = wrapAnsi(o2, i, {
      hard: true,
      trim: false
    }).split(`
`);
    s.push(h2), g2 += h2.length;
  }
  if (g2 > v) {
    let t2 = 0, n3 = 0, o2 = g2;
    const h2 = l2 - T3;
    let u4 = v;
    const L = () => I(s, o2, 0, h2, u4), E = () => I(s, o2, h2 + 1, s.length, u4, true);
    d ? ({ lineCount: o2, removals: t2 } = L(), o2 > u4 && (c2 || (u4 -= 1), { lineCount: o2, removals: n3 } = E())) : (c2 || (u4 -= 1), { lineCount: o2, removals: n3 } = E(), o2 > u4 && (u4 -= 1, { lineCount: o2, removals: t2 } = L())), t2 > 0 && (d = true, s.splice(0, t2)), n3 > 0 && (c2 = true, s.splice(s.length - n3, n3));
  }
  const x = [];
  d && x.push(M2);
  for (const t2 of s)
    for (const n3 of t2)
      x.push(n3);
  return c2 && x.push(M2), x;
};
function E(t2) {
  return t2.label ?? String(t2.value ?? "");
}
function P2(t2, c2) {
  if (!t2)
    return true;
  const n3 = (c2.label ?? String(c2.value ?? "")).toLowerCase(), i = (c2.hint ?? "").toLowerCase(), r2 = String(c2.value).toLowerCase(), o2 = t2.toLowerCase();
  return n3.includes(o2) || i.includes(o2) || r2.includes(o2);
}
function j(t2, c2) {
  const n3 = [];
  for (const i of c2)
    t2.includes(i.value) && n3.push(i);
  return n3;
}
var autocomplete = (t2) => new T$1({
  options: t2.options,
  initialValue: t2.initialValue ? [t2.initialValue] : undefined,
  initialUserInput: t2.initialUserInput,
  placeholder: t2.placeholder,
  completeOnTab: t2.completeOnTab,
  filter: t2.filter ?? ((n3, i) => P2(n3, i)),
  signal: t2.signal,
  input: t2.input,
  output: t2.output,
  validate: t2.validate,
  render() {
    const n3 = t2.withGuide ?? settings.withGuide, i = n3 ? [`${styleText2("gray", S_BAR)}`, `${symbol(this.state)}  ${t2.message}`] : [`${symbol(this.state)}  ${t2.message}`], r2 = this.userInput, o2 = this.options, m2 = t2.placeholder, p2 = r2 === "" && m2 !== undefined, $ = (l2, s) => {
      const a2 = E(l2), u4 = l2.hint && l2.value === this.focusedValue ? styleText2("dim", ` (${l2.hint})`) : "";
      switch (s) {
        case "active":
          return `${styleText2("green", S_RADIO_ACTIVE)} ${a2}${u4}`;
        case "inactive":
          return `${styleText2("dim", S_RADIO_INACTIVE)} ${styleText2("dim", a2)}`;
        case "disabled":
          return `${styleText2("gray", S_RADIO_INACTIVE)} ${styleText2(["strikethrough", "gray"], a2)}`;
      }
    };
    switch (this.state) {
      case "submit": {
        const l2 = j(this.selectedValues, o2), s = l2.length > 0 ? `  ${styleText2("dim", l2.map(E).join(", "))}` : "", a2 = n3 ? styleText2("gray", S_BAR) : "";
        return `${i.join(`
`)}
${a2}${s}`;
      }
      case "cancel": {
        const l2 = r2 ? `  ${styleText2(["strikethrough", "dim"], r2)}` : "", s = n3 ? styleText2("gray", S_BAR) : "";
        return `${i.join(`
`)}
${s}${l2}`;
      }
      default: {
        const l2 = this.state === "error" ? "yellow" : "cyan", s = n3 ? `${styleText2(l2, S_BAR)}  ` : "", a2 = n3 ? styleText2(l2, S_BAR_END) : "";
        let u4 = "";
        if (this.isNavigating || p2) {
          const d = p2 ? m2 : r2;
          u4 = d !== "" ? ` ${styleText2("dim", d)}` : "";
        } else
          u4 = ` ${this.userInputWithCursor}`;
        const V = this.filteredOptions.length !== o2.length ? styleText2("dim", ` (${this.filteredOptions.length} match${this.filteredOptions.length === 1 ? "" : "es"})`) : "", b2 = this.filteredOptions.length === 0 && r2 ? [`${s}${styleText2("yellow", "No matches found")}`] : [], y2 = this.state === "error" ? [`${s}${styleText2("yellow", this.error)}`] : [];
        n3 && i.push(`${s.trimEnd()}`), i.push(`${s}${styleText2("dim", "Search:")}${u4}${V}`, ...b2, ...y2);
        const S = [
          `${styleText2("dim", "↑/↓")} to select`,
          ...t2.completeOnTab ? [`${styleText2("dim", "Tab:")} complete`] : [],
          `${styleText2("dim", "Enter:")} confirm`,
          `${styleText2("dim", "Type:")} to search`
        ], g2 = [`${s}${S.join(" • ")}`, a2], O = this.filteredOptions.length === 0 ? [] : limitOptions({
          cursor: this.cursor,
          options: this.filteredOptions,
          columnPadding: n3 ? 3 : 0,
          rowPadding: i.length + g2.length,
          style: (d, f2) => $(d, d.disabled ? "disabled" : f2 ? "active" : "inactive"),
          maxItems: t2.maxItems,
          output: t2.output
        });
        return [
          ...i,
          ...O.map((d) => `${s}${d}`),
          ...g2
        ].join(`
`);
      }
    }
  }
}).prompt();
var autocompleteMultiselect = (t2) => {
  const c2 = (i, r2, o2, m2) => {
    const p2 = o2.includes(i.value), $ = i.label ?? String(i.value ?? ""), l2 = i.hint && m2 !== undefined && i.value === m2 ? styleText2("dim", ` (${i.hint})`) : "", s = p2 ? styleText2("green", S_CHECKBOX_SELECTED) : styleText2("dim", S_CHECKBOX_INACTIVE);
    return i.disabled ? `${styleText2("gray", S_CHECKBOX_INACTIVE)} ${styleText2(["strikethrough", "gray"], $)}` : r2 ? `${s} ${$}${l2}` : `${s} ${styleText2("dim", $)}`;
  }, n3 = new T$1({
    options: t2.options,
    multiple: true,
    placeholder: t2.placeholder,
    filter: t2.filter ?? ((i, r2) => P2(i, r2)),
    validate: () => {
      if (t2.required && n3.selectedValues.length === 0)
        return "Please select at least one item";
    },
    initialValue: t2.initialValues,
    signal: t2.signal,
    input: t2.input,
    output: t2.output,
    render() {
      const i = t2.withGuide ?? settings.withGuide, r2 = `${i ? `${styleText2("gray", S_BAR)}
` : ""}${symbol(this.state)}  ${t2.message}
`, o2 = this.userInput, m2 = t2.placeholder, p2 = o2 === "" && m2 !== undefined, $ = this.isNavigating || p2 ? styleText2("dim", p2 ? m2 : o2) : this.userInputWithCursor, l2 = this.options, s = this.filteredOptions.length !== l2.length ? styleText2("dim", ` (${this.filteredOptions.length} match${this.filteredOptions.length === 1 ? "" : "es"})`) : "";
      switch (this.state) {
        case "submit":
          return `${r2}${i ? `${styleText2("gray", S_BAR)}  ` : ""}${styleText2("dim", `${this.selectedValues.length} items selected`)}`;
        case "cancel":
          return `${r2}${i ? `${styleText2("gray", S_BAR)}  ` : ""}${styleText2(["strikethrough", "dim"], o2)}`;
        default: {
          const a2 = this.state === "error" ? "yellow" : "cyan", u4 = i ? `${styleText2(a2, S_BAR)}  ` : "", V = i ? styleText2(a2, S_BAR_END) : "", b2 = [
            `${styleText2("dim", "↑/↓")} to navigate`,
            `${styleText2("dim", this.isNavigating ? "Space/Tab:" : "Tab:")} select`,
            `${styleText2("dim", "Enter:")} confirm`,
            `${styleText2("dim", "Type:")} to search`
          ], y2 = this.filteredOptions.length === 0 && o2 ? [`${u4}${styleText2("yellow", "No matches found")}`] : [], S = this.state === "error" ? [`${u4}${styleText2("yellow", this.error)}`] : [], g2 = [
            ...`${r2}${i ? styleText2(a2, S_BAR) : ""}`.split(`
`),
            `${u4}${styleText2("dim", "Search:")} ${$}${s}`,
            ...y2,
            ...S
          ], O = [`${u4}${b2.join(" • ")}`, V], d = limitOptions({
            cursor: this.cursor,
            options: this.filteredOptions,
            style: (f2, L) => c2(f2, L, this.selectedValues, this.focusedValue),
            maxItems: t2.maxItems,
            output: t2.output,
            rowPadding: g2.length + O.length
          });
          return [
            ...g2,
            ...d.map((f2) => `${u4}${f2}`),
            ...O
          ].join(`
`);
        }
      }
    }
  });
  return n3.prompt();
};
var K = [
  S_CORNER_TOP_LEFT,
  S_CORNER_TOP_RIGHT,
  S_CORNER_BOTTOM_LEFT,
  S_CORNER_BOTTOM_RIGHT
];
var Q = [S_BAR_START, S_BAR_START_RIGHT, S_BAR_END, S_BAR_END_RIGHT];
function A$1(n3, e, t2, o2) {
  let i = t2, f2 = t2;
  return o2 === "center" ? i = Math.floor((e - n3) / 2) : o2 === "right" && (i = e - n3 - t2), f2 = e - i - n3, [i, f2];
}
var U2 = (n3) => n3;
var box = (n3 = "", e = "", t2) => {
  const o2 = t2?.output ?? process.stdout, i = getColumns(o2), R2 = 1 * 2, u4 = t2?.titlePadding ?? 1, h2 = t2?.contentPadding ?? 2, w = t2?.width === undefined || t2.width === "auto" ? 1 : Math.min(1, t2.width), m2 = t2?.withGuide ?? settings.withGuide ? `${styleText2("gray", S_BAR)} ` : "", b2 = t2?.formatBorder ?? U2, a2 = ((t2?.rounded) ? K : Q).map(b2), _2 = b2(S_BAR_H), p2 = b2(S_BAR), x = dist_default2(m2), B = dist_default2(e), y2 = i - x;
  let r2 = Math.floor(i * w) - x;
  if (t2?.width === "auto") {
    const c2 = n3.split(`
`);
    let s = B + u4 * 2;
    for (const G of c2) {
      const P3 = dist_default2(G) + h2 * 2;
      P3 > s && (s = P3);
    }
    const g2 = s + R2;
    g2 < r2 && (r2 = g2);
  }
  r2 % 2 !== 0 && (r2 < y2 ? r2++ : r2--);
  const d = r2 - R2, T3 = d - u4 * 2, S = B > T3 ? `${e.slice(0, T3 - 3)}...` : e, [O, W] = A$1(dist_default2(S), d, u4, t2?.titleAlign), L = wrapAnsi(n3, d - h2 * 2, {
    hard: true,
    trim: false
  });
  o2.write(`${m2}${a2[0]}${_2.repeat(O)}${S}${_2.repeat(W)}${a2[1]}
`);
  const E2 = L.split(`
`);
  for (const c2 of E2) {
    const [s, g2] = A$1(dist_default2(c2), d, h2, t2?.contentAlign);
    o2.write(`${m2}${p2}${" ".repeat(s)}${c2}${" ".repeat(g2)}${p2}
`);
  }
  o2.write(`${m2}${a2[2]}${_2.repeat(d)}${a2[3]}
`);
};
var confirm = (e) => {
  const a2 = e.active ?? "Yes", o2 = e.inactive ?? "No";
  return new r({
    active: a2,
    inactive: o2,
    signal: e.signal,
    input: e.input,
    output: e.output,
    initialValue: e.initialValue ?? true,
    render() {
      const i = e.withGuide ?? settings.withGuide, u4 = `${symbol(this.state)}  `, l2 = i ? `${styleText2("gray", S_BAR)}  ` : "", f2 = wrapTextWithPrefix(e.output, e.message, l2, u4), s = `${i ? `${styleText2("gray", S_BAR)}
` : ""}${f2}
`, c2 = this.value ? a2 : o2;
      switch (this.state) {
        case "submit": {
          const r2 = i ? `${styleText2("gray", S_BAR)}  ` : "";
          return `${s}${r2}${styleText2("dim", c2)}`;
        }
        case "cancel": {
          const r2 = i ? `${styleText2("gray", S_BAR)}  ` : "";
          return `${s}${r2}${styleText2(["strikethrough", "dim"], c2)}${i ? `
${styleText2("gray", S_BAR)}` : ""}`;
        }
        default: {
          const r2 = i ? `${styleText2("cyan", S_BAR)}  ` : "", g2 = i ? styleText2("cyan", S_BAR_END) : "";
          return `${s}${r2}${this.value ? `${styleText2("green", S_RADIO_ACTIVE)} ${a2}` : `${styleText2("dim", S_RADIO_INACTIVE)} ${styleText2("dim", a2)}`}${e.vertical ? i ? `
${styleText2("cyan", S_BAR)}  ` : `
` : ` ${styleText2("dim", "/")} `}${this.value ? `${styleText2("dim", S_RADIO_INACTIVE)} ${styleText2("dim", o2)}` : `${styleText2("green", S_RADIO_ACTIVE)} ${o2}`}
${g2}
`;
        }
      }
    }
  }).prompt();
};
var date = (e) => {
  const r2 = e.validate;
  return new U({
    ...e,
    validate(t2) {
      if (t2 === undefined)
        return e.defaultValue !== undefined ? undefined : r2 ? runValidation(r2, t2) : settings.date.messages.required;
      const o2 = (i) => i.toISOString().slice(0, 10);
      if (e.minDate && o2(t2) < o2(e.minDate))
        return settings.date.messages.afterMin(e.minDate);
      if (e.maxDate && o2(t2) > o2(e.maxDate))
        return settings.date.messages.beforeMax(e.maxDate);
      if (r2)
        return runValidation(r2, t2);
    },
    render() {
      const t2 = (e?.withGuide ?? settings.withGuide) !== false, i = `${`${t2 ? `${styleText2("gray", S_BAR)}
` : ""}${symbol(this.state)}  `}${e.message}
`, l2 = this.state !== "initial" ? this.state : "active", d = b2(this, l2), c2 = this.value instanceof Date ? this.formattedValue : "";
      switch (this.state) {
        case "error": {
          const a2 = this.error ? `  ${styleText2("yellow", this.error)}` : "", s = t2 ? `${styleText2("yellow", S_BAR)}  ` : "", f2 = t2 ? styleText2("yellow", S_BAR_END) : "";
          return `${i.trim()}
${s}${d}
${f2}${a2}
`;
        }
        case "submit": {
          const a2 = c2 ? `  ${styleText2("dim", c2)}` : "", s = t2 ? styleText2("gray", S_BAR) : "";
          return `${i}${s}${a2}`;
        }
        case "cancel": {
          const a2 = c2 ? `  ${styleText2(["strikethrough", "dim"], c2)}` : "", s = t2 ? styleText2("gray", S_BAR) : "";
          return `${i}${s}${a2}${c2.trim() ? `
${s}` : ""}`;
        }
        default: {
          const a2 = t2 ? `${styleText2("cyan", S_BAR)}  ` : "", s = t2 ? styleText2("cyan", S_BAR_END) : "", f2 = t2 ? `${styleText2("cyan", S_BAR)}  ` : "", g2 = this.inlineError ? `
${f2}${styleText2("yellow", this.inlineError)}` : "";
          return `${i}${a2}${d}${g2}
${s}
`;
        }
      }
    }
  }).prompt();
};
function b2(e, r2) {
  const { segmentValues: t2, segmentCursor: o2 } = e;
  if (r2 === "submit" || r2 === "cancel")
    return e.formattedValue;
  const i = styleText2("gray", e.separator);
  return e.segments.map((l2, d) => {
    const c2 = d === o2.segmentIndex && !["submit", "cancel"].includes(r2), a2 = p2[l2.type];
    return x(t2[l2.type], { isActive: c2, label: a2 });
  }).join(i);
}
function x(e, r2) {
  const t2 = !e || e.replace(/_/g, "") === "";
  return r2.isActive ? styleText2("inverse", t2 ? r2.label : e.replace(/_/g, " ")) : t2 ? styleText2("dim", r2.label) : e.replace(/_/g, styleText2("dim", " "));
}
var p2 = {
  year: "yyyy",
  month: "mm",
  day: "dd"
};
var group = async (o2, r2) => {
  const t2 = {}, p3 = Object.keys(o2);
  for (const e of p3) {
    const i = o2[e], n3 = await i({ results: t2 })?.catch((a2) => {
      throw a2;
    });
    if (typeof r2?.onCancel == "function" && isCancel(n3)) {
      t2[e] = "canceled", r2.onCancel({ results: t2 });
      continue;
    }
    t2[e] = n3;
  }
  return t2;
};
var MULTISELECT_INSTRUCTIONS = [
  `${styleText2("dim", "↑/↓")} to navigate`,
  `${styleText2("dim", "Space:")} select`,
  `${styleText2("dim", "Enter:")} confirm`
];
var m2 = (i, u4) => i.split(`
`).map((d) => u4(d)).join(`
`);
var multiselect = (i) => {
  const u4 = (t2, a2) => {
    const r2 = t2.label ?? String(t2.value);
    return a2 === "disabled" ? `${styleText2("gray", S_CHECKBOX_INACTIVE)} ${m2(r2, (o2) => styleText2(["strikethrough", "gray"], o2))}${t2.hint ? ` ${styleText2("dim", `(${t2.hint ?? "disabled"})`)}` : ""}` : a2 === "active" ? `${styleText2("cyan", S_CHECKBOX_ACTIVE)} ${r2}${t2.hint ? ` ${styleText2("dim", `(${t2.hint})`)}` : ""}` : a2 === "selected" ? `${styleText2("green", S_CHECKBOX_SELECTED)} ${m2(r2, (o2) => styleText2("dim", o2))}${t2.hint ? ` ${styleText2("dim", `(${t2.hint})`)}` : ""}` : a2 === "cancelled" ? `${m2(r2, (o2) => styleText2(["strikethrough", "dim"], o2))}` : a2 === "active-selected" ? `${styleText2("green", S_CHECKBOX_SELECTED)} ${r2}${t2.hint ? ` ${styleText2("dim", `(${t2.hint})`)}` : ""}` : a2 === "submitted" ? `${m2(r2, (o2) => styleText2("dim", o2))}` : `${styleText2("dim", S_CHECKBOX_INACTIVE)} ${m2(r2, (o2) => styleText2("dim", o2))}`;
  }, d = i.required ?? true, x2 = i.showInstructions ?? true;
  return new a({
    options: i.options,
    signal: i.signal,
    input: i.input,
    output: i.output,
    initialValues: i.initialValues,
    required: d,
    cursorAt: i.cursorAt,
    validate(t2) {
      if (d && (t2 === undefined || t2.length === 0))
        return `Please select at least one option.
${styleText2("reset", styleText2("dim", `Press ${styleText2(["gray", "bgWhite", "inverse"], " space ")} to select, ${styleText2("gray", styleText2("bgWhite", styleText2("inverse", " enter ")))} to submit`))}`;
    },
    render() {
      const t2 = i.withGuide ?? settings.withGuide, a2 = wrapTextWithPrefix(i.output, i.message, t2 ? `${symbolBar(this.state)}  ` : "", `${symbol(this.state)}  `), r2 = `${t2 ? `${styleText2("gray", S_BAR)}
` : ""}${a2}
`, o2 = this.value ?? [], g2 = (n3, l2) => {
        if (n3.disabled)
          return u4(n3, "disabled");
        const s = o2.includes(n3.value);
        return l2 && s ? u4(n3, "active-selected") : s ? u4(n3, "selected") : u4(n3, l2 ? "active" : "inactive");
      };
      switch (this.state) {
        case "submit": {
          const n3 = this.options.filter(({ value: s }) => o2.includes(s)).map((s) => u4(s, "submitted")).join(styleText2("dim", ", ")) || styleText2("dim", "none"), l2 = wrapTextWithPrefix(i.output, n3, t2 ? `${styleText2("gray", S_BAR)}  ` : "");
          return `${r2}${l2}`;
        }
        case "cancel": {
          const n3 = this.options.filter(({ value: s }) => o2.includes(s)).map((s) => u4(s, "cancelled")).join(styleText2("dim", ", "));
          if (n3.trim() === "")
            return `${r2}${styleText2("gray", S_BAR)}`;
          const l2 = wrapTextWithPrefix(i.output, n3, t2 ? `${styleText2("gray", S_BAR)}  ` : "");
          return `${r2}${l2}${t2 ? `
${styleText2("gray", S_BAR)}` : ""}`;
        }
        case "error": {
          const n3 = t2 ? `${styleText2("yellow", S_BAR)}  ` : "", l2 = this.error.split(`
`).map(($, v) => v === 0 ? `${t2 ? `${styleText2("yellow", S_BAR_END)}  ` : ""}${styleText2("yellow", $)}` : `   ${$}`).join(`
`), s = r2.split(`
`).length, h2 = l2.split(`
`).length + 1;
          return `${r2}${n3}${limitOptions({
            output: i.output,
            options: this.options,
            cursor: this.cursor,
            maxItems: i.maxItems,
            columnPadding: n3.length,
            rowPadding: s + h2,
            style: g2
          }).join(`
${n3}`)}
${l2}
`;
        }
        default: {
          const n3 = t2 ? `${styleText2("cyan", S_BAR)}  ` : "", l2 = r2.split(`
`).length, s = x2 ? formatInstructionFooter(MULTISELECT_INSTRUCTIONS, t2) : t2 ? [styleText2("cyan", S_BAR_END)] : [], h2 = s.join(`
`), $ = s.length + 1;
          return `${r2}${n3}${limitOptions({
            output: i.output,
            options: this.options,
            cursor: this.cursor,
            maxItems: i.maxItems,
            columnPadding: n3.length,
            rowPadding: l2 + $,
            style: g2
          }).join(`
${n3}`)}
${h2}
`;
        }
      }
    }
  }).prompt();
};
var groupMultiselect = (o2) => {
  const { selectableGroups: f2 = true, groupSpacing: x2 = 0 } = o2, d = (n3, l2, p3 = []) => {
    const a2 = n3.label ?? String(n3.value), t2 = typeof n3.group == "string", s = t2 && (p3[p3.indexOf(n3) + 1] ?? { group: true }), u4 = t2 && s && s.group === true;
    let r2 = "", c2 = "";
    t2 && (f2 ? (r2 = u4 ? `${S_BAR_END} ` : `${S_BAR} `, c2 = u4 ? "  " : `${S_BAR} `) : r2 = "  ");
    let i = "";
    if (x2 > 0 && !t2 && (i = `
`.repeat(x2)), l2 === "active")
      return wrapTextWithPrefix(o2.output, `${a2}${n3.hint ? ` ${styleText2("dim", `(${n3.hint})`)}` : ""}`, `${i}${styleText2("dim", r2)} `, `${i}${styleText2("dim", r2)}${styleText2("cyan", S_CHECKBOX_ACTIVE)} `, `${i}${styleText2("dim", c2)} `);
    if (l2 === "group-active")
      return wrapTextWithPrefix(o2.output, a2, `${i}${r2} `, `${i}${r2}${styleText2("cyan", S_CHECKBOX_ACTIVE)} `, `${i}${c2} `, (m3) => styleText2("dim", m3));
    if (l2 === "group-active-selected")
      return wrapTextWithPrefix(o2.output, a2, `${i}${r2} `, `${i}${r2}${styleText2("green", S_CHECKBOX_SELECTED)} `, `${i}${c2} `, (m3) => styleText2("dim", m3));
    if (l2 === "selected") {
      const m3 = t2 || f2 ? styleText2("green", S_CHECKBOX_SELECTED) : "";
      return wrapTextWithPrefix(o2.output, `${a2}${n3.hint ? ` (${n3.hint})` : ""}`, `${i}${styleText2("dim", r2)} `, `${i}${styleText2("dim", r2)}${m3} `, `${i}${styleText2("dim", c2)} `, (I2) => styleText2("dim", I2));
    }
    if (l2 === "cancelled")
      return `${styleText2(["strikethrough", "dim"], a2)}`;
    if (l2 === "active-selected")
      return wrapTextWithPrefix(o2.output, `${a2}${n3.hint ? ` ${styleText2("dim", `(${n3.hint})`)}` : ""}`, `${i}${styleText2("dim", r2)} `, `${i}${styleText2("dim", r2)}${styleText2("green", S_CHECKBOX_SELECTED)} `, `${i}${styleText2("dim", c2)} `);
    if (l2 === "submitted")
      return `${styleText2("dim", a2)}`;
    const h2 = t2 || f2 ? styleText2("dim", S_CHECKBOX_INACTIVE) : "";
    return wrapTextWithPrefix(o2.output, a2, `${i}${styleText2("dim", r2)} `, `${i}${styleText2("dim", r2)}${h2} `, `${i}${styleText2("dim", c2)} `, (m3) => styleText2("dim", m3));
  }, y2 = o2.required ?? true, S = o2.showInstructions ?? true;
  return new u$2({
    options: o2.options,
    signal: o2.signal,
    input: o2.input,
    output: o2.output,
    initialValues: o2.initialValues,
    required: y2,
    cursorAt: o2.cursorAt,
    selectableGroups: f2,
    validate(n3) {
      if (y2 && (n3 === undefined || n3.length === 0))
        return `Please select at least one option.
${styleText2("reset", styleText2("dim", `Press ${styleText2(["gray", "bgWhite", "inverse"], " space ")} to select, ${styleText2("gray", styleText2(["bgWhite", "inverse"], " enter "))} to submit`))}`;
    },
    render() {
      const n3 = o2.withGuide ?? settings.withGuide, l2 = `${n3 ? `${styleText2("gray", S_BAR)}
` : ""}${symbol(this.state)}  ${o2.message}
`, p3 = this.value ?? [], a2 = (t2, s) => {
        const u4 = this.options, r2 = p3.includes(t2.value) || t2.group === true && this.isGroupSelected(`${t2.value}`);
        return !s && typeof t2.group == "string" && this.options[this.cursor]?.value === t2.group ? d(t2, r2 ? "group-active-selected" : "group-active", u4) : s && r2 ? d(t2, "active-selected", u4) : r2 ? d(t2, "selected", u4) : d(t2, s ? "active" : "inactive", u4);
      };
      switch (this.state) {
        case "submit": {
          const t2 = this.options.filter(({ value: u4 }) => p3.includes(u4)).map((u4) => d(u4, "submitted")), s = t2.length === 0 ? "" : `  ${t2.join(styleText2("dim", ", "))}`;
          return `${l2}${n3 ? styleText2("gray", S_BAR) : ""}${s}`;
        }
        case "cancel": {
          const t2 = this.options.filter(({ value: s }) => p3.includes(s)).map((s) => d(s, "cancelled")).join(styleText2("dim", ", "));
          return `${l2}${n3 ? `${styleText2("gray", S_BAR)}  ` : ""}${t2.trim() ? `${t2}${n3 ? `
${styleText2("gray", S_BAR)}` : ""}` : ""}`;
        }
        case "error": {
          const t2 = n3 ? `${styleText2("yellow", S_BAR)}  ` : "", s = this.error.split(`
`).map((i, h2) => h2 === 0 ? `${n3 ? `${styleText2("yellow", S_BAR_END)}  ` : ""}${styleText2("yellow", i)}` : `   ${i}`).join(`
`), u4 = l2.split(`
`).length, r2 = s.split(`
`).length + 1, c2 = limitOptions({
            output: o2.output,
            options: this.options,
            cursor: this.cursor,
            maxItems: o2.maxItems,
            columnPadding: t2.length,
            rowPadding: u4 + r2,
            style: a2
          }).join(`
${t2}`);
          return `${l2}${t2}${c2}
${s}
`;
        }
        default: {
          const t2 = n3 ? `${styleText2("cyan", S_BAR)}  ` : "", s = l2.split(`
`).length, u4 = S ? formatInstructionFooter(MULTISELECT_INSTRUCTIONS, n3) : n3 ? [styleText2("cyan", S_BAR_END)] : [], r2 = u4.join(`
`), c2 = u4.length + 1, i = limitOptions({
            output: o2.output,
            options: this.options,
            cursor: this.cursor,
            maxItems: o2.maxItems,
            columnPadding: t2.length,
            rowPadding: s + c2,
            style: a2
          }).join(`
${t2}`);
          return `${l2}${t2}${i}
${r2}
`;
        }
      }
    }
  }).prompt();
};
var log = {
  message: (s = [], {
    symbol: e = styleText2("gray", S_BAR),
    secondarySymbol: r2 = styleText2("gray", S_BAR),
    output: m3 = process.stdout,
    spacing: l2 = 1,
    withGuide: c2
  } = {}) => {
    const t2 = [], o2 = c2 ?? settings.withGuide, f2 = o2 ? r2 : "", O = o2 ? `${e}  ` : "", u4 = o2 ? `${r2}  ` : "";
    for (let i = 0;i < l2; i++)
      t2.push(f2);
    const g2 = Array.isArray(s) ? s : s.split(`
`);
    if (g2.length > 0) {
      const [i, ...y2] = g2;
      i.length > 0 ? t2.push(`${O}${i}`) : t2.push(o2 ? e : "");
      for (const p3 of y2)
        p3.length > 0 ? t2.push(`${u4}${p3}`) : t2.push(o2 ? r2 : "");
    }
    m3.write(`${t2.join(`
`)}
`);
  },
  info: (s, e) => {
    log.message(s, { ...e, symbol: styleText2("blue", S_INFO) });
  },
  success: (s, e) => {
    log.message(s, { ...e, symbol: styleText2("green", S_SUCCESS) });
  },
  step: (s, e) => {
    log.message(s, { ...e, symbol: styleText2("green", S_STEP_SUBMIT) });
  },
  warn: (s, e) => {
    log.message(s, { ...e, symbol: styleText2("yellow", S_WARN) });
  },
  warning: (s, e) => {
    log.warn(s, e);
  },
  error: (s, e) => {
    log.message(s, { ...e, symbol: styleText2("red", S_ERROR) });
  }
};
var cancel = (o2 = "", t2) => {
  const i = t2?.output ?? process.stdout, e = t2?.withGuide ?? settings.withGuide ? `${styleText2("gray", S_BAR_END)}  ` : "";
  i.write(`${e}${styleText2("red", o2)}

`);
};
var intro = (o2 = "", t2) => {
  const i = t2?.output ?? process.stdout, e = t2?.withGuide ?? settings.withGuide ? `${styleText2("gray", S_BAR_START)}  ` : "";
  i.write(`${e}${o2}
`);
};
var outro = (o2 = "", t2) => {
  const i = t2?.output ?? process.stdout, e = t2?.withGuide ?? settings.withGuide ? `${styleText2("gray", S_BAR)}
${styleText2("gray", S_BAR_END)}  ` : "";
  i.write(`${e}${o2}

`);
};
var multiline = (e) => new h({
  validate: e.validate,
  placeholder: e.placeholder,
  defaultValue: e.defaultValue,
  initialValue: e.initialValue,
  showSubmit: e.showSubmit,
  output: e.output,
  signal: e.signal,
  input: e.input,
  render() {
    const i = e?.withGuide ?? settings.withGuide, o2 = `${`${i ? `${styleText2("gray", S_BAR)}
` : ""}${symbol(this.state)}  `}${e.message}
`, h2 = e.placeholder && e.placeholder.length > 0 ? styleText2("inverse", e.placeholder[0]) + styleText2("dim", e.placeholder.slice(1)) : styleText2(["inverse", "hidden"], "_"), a2 = this.userInput ? this.userInputWithCursor : h2, l2 = this.value ?? "", d = e.showSubmit ? `
  ${styleText2(this.focused === "submit" ? "cyan" : "dim", "[ submit ]")}` : "";
    switch (this.state) {
      case "error": {
        const n3 = `${styleText2("yellow", S_BAR)}  `, r2 = i ? wrapTextWithPrefix(e.output, a2, n3, undefined) : a2, u4 = styleText2("yellow", S_BAR_END);
        return `${o2}${r2}
${u4}  ${styleText2("yellow", this.error)}${d}
`;
      }
      case "submit": {
        const n3 = `${styleText2("gray", S_BAR)}  `, r2 = i ? wrapTextWithPrefix(e.output, l2, n3, undefined, undefined, (u4) => styleText2("dim", u4)) : l2 ? styleText2("dim", l2) : "";
        return `${o2}${r2}`;
      }
      case "cancel": {
        const n3 = `${styleText2("gray", S_BAR)}  `, r2 = i ? wrapTextWithPrefix(e.output, l2, n3, undefined, undefined, (u4) => styleText2(["strikethrough", "dim"], u4)) : l2 ? styleText2(["strikethrough", "dim"], l2) : "";
        return `${o2}${r2}`;
      }
      default: {
        const n3 = i ? `${styleText2("cyan", S_BAR)}  ` : "", r2 = i ? styleText2("cyan", S_BAR_END) : "", u4 = i ? wrapTextWithPrefix(e.output, a2, n3) : a2;
        return `${o2}${u4}
${r2}${d}
`;
      }
    }
  }
}).prompt();
var W$1 = (o2) => o2;
var C2 = (o2, e, s) => {
  const a2 = {
    hard: true,
    trim: false
  }, i = wrapAnsi(o2, e, a2).split(`
`), c2 = i.reduce((n3, t2) => Math.max(dist_default2(t2), n3), 0), u4 = i.map(s).reduce((n3, t2) => Math.max(dist_default2(t2), n3), 0), g2 = e - (u4 - c2);
  return wrapAnsi(o2, g2, a2);
};
var note = (o2 = "", e = "", s) => {
  const a2 = s?.output ?? process$1.stdout, i = s?.withGuide ?? settings.withGuide, c2 = s?.format ?? W$1, g2 = ["", ...C2(o2, getColumns(a2) - 6, c2).split(`
`).map(c2), ""], n3 = dist_default2(e), t2 = Math.max(g2.reduce((m3, F) => {
    const O = dist_default2(F);
    return O > m3 ? O : m3;
  }, 0), n3) + 2, h2 = g2.map((m3) => `${styleText2("gray", S_BAR)}  ${m3}${" ".repeat(t2 - dist_default2(m3))}${styleText2("gray", S_BAR)}`).join(`
`), T3 = i ? `${styleText2("gray", S_BAR)}
` : "", l$1 = i ? S_CONNECT_LEFT : S_CORNER_BOTTOM_LEFT;
  a2.write(`${T3}${styleText2("green", S_STEP_SUBMIT)}  ${styleText2("reset", e)} ${styleText2("gray", S_BAR_H.repeat(Math.max(t2 - n3 - 1, 1)) + S_CORNER_TOP_RIGHT)}
${h2}
${styleText2("gray", l$1 + S_BAR_H.repeat(t2 + 2) + S_CORNER_BOTTOM_RIGHT)}
`);
};
var password = (e) => new u$1({
  validate: e.validate,
  mask: e.mask ?? S_PASSWORD_MASK,
  signal: e.signal,
  input: e.input,
  output: e.output,
  render() {
    const r2 = e.withGuide ?? settings.withGuide, o2 = `${r2 ? `${styleText2("gray", S_BAR)}
` : ""}${symbol(this.state)}  ${e.message}
`, m3 = this.userInputWithCursor, i = this.masked;
    switch (this.state) {
      case "error": {
        const s = r2 ? `${styleText2("yellow", S_BAR)}  ` : "", n3 = r2 ? `${styleText2("yellow", S_BAR_END)}  ` : "", d = i ?? "";
        return e.clearOnError && this.clear(), `${o2.trim()}
${s}${d}
${n3}${styleText2("yellow", this.error)}
`;
      }
      case "submit": {
        const s = r2 ? `${styleText2("gray", S_BAR)}  ` : "", n3 = i ? styleText2("dim", i) : "";
        return `${o2}${s}${n3}`;
      }
      case "cancel": {
        const s = r2 ? `${styleText2("gray", S_BAR)}  ` : "", n3 = i ? styleText2(["strikethrough", "dim"], i) : "";
        return `${o2}${s}${n3}${i && r2 ? `
${styleText2("gray", S_BAR)}` : ""}`;
      }
      default: {
        const s = r2 ? `${styleText2("cyan", S_BAR)}  ` : "", n3 = r2 ? styleText2("cyan", S_BAR_END) : "";
        return `${o2}${s}${m3}
${n3}
`;
      }
    }
  }
}).prompt();
var path = (e) => {
  const a2 = e.validate;
  return autocomplete({
    ...e,
    initialUserInput: e.initialValue ?? e.root ?? process.cwd(),
    maxItems: 5,
    completeOnTab: true,
    validate(t2) {
      if (!Array.isArray(t2)) {
        if (!t2)
          return "Please select a path";
        if (a2)
          return runValidation(a2, t2);
      }
    },
    options() {
      const t2 = this.userInput;
      if (t2 === "")
        return [];
      try {
        let i;
        existsSync(t2) ? lstatSync(t2).isDirectory() && (!e.directory || t2.endsWith("/")) ? i = t2 : i = dirname(t2) : i = dirname(t2);
        const c2 = t2.length > 1 && t2.endsWith("/") ? t2.slice(0, -1) : t2;
        return readdirSync(i).map((r2) => {
          const n3 = join(i, r2), m3 = lstatSync(n3);
          return {
            name: r2,
            path: n3,
            isDirectory: m3.isDirectory()
          };
        }).filter(({ path: r2, isDirectory: n3 }) => r2.startsWith(c2) && (n3 || !e.directory)).map((r2) => ({
          value: r2.path
        }));
      } catch {
        return [];
      }
    }
  });
};
var W = (l2) => styleText2("magenta", l2);
var spinner = ({
  indicator: l2 = "dots",
  onCancel: h2,
  output: n3 = process.stdout,
  cancelMessage: G,
  errorMessage: O,
  frames: E2 = unicode ? ["◒", "◐", "◓", "◑"] : ["•", "o", "O", "0"],
  delay: F = unicode ? 80 : 120,
  signal: m3,
  ...I2
} = {}) => {
  const u4 = isCI();
  let M2, T3, d = false, S = false, s = "", p3, w = performance.now();
  const x2 = getColumns(n3), k = I2?.styleFrame ?? W, g2 = (e) => {
    const r2 = e > 1 ? O ?? settings.messages.error : G ?? settings.messages.cancel;
    S = e === 1, d && (a2(r2, e), S && typeof h2 == "function" && h2());
  }, f2 = () => g2(2), i = () => g2(1), A = () => {
    process.on("uncaughtExceptionMonitor", f2), process.on("unhandledRejection", f2), process.on("SIGINT", i), process.on("SIGTERM", i), process.on("exit", g2), m3 && m3.addEventListener("abort", i);
  }, H = () => {
    process.removeListener("uncaughtExceptionMonitor", f2), process.removeListener("unhandledRejection", f2), process.removeListener("SIGINT", i), process.removeListener("SIGTERM", i), process.removeListener("exit", g2), m3 && m3.removeEventListener("abort", i);
  }, y2 = () => {
    if (p3 === undefined)
      return;
    u4 && n3.write(`
`);
    const r2 = wrapAnsi(p3, x2, {
      hard: true,
      trim: false
    }).split(`
`);
    r2.length > 1 && n3.write(import_sisteransi2.cursor.up(r2.length - 1)), n3.write(import_sisteransi2.cursor.to(0)), n3.write(import_sisteransi2.erase.down());
  }, C3 = (e) => e.replace(/\.+$/, ""), _2 = (e) => {
    const r2 = (performance.now() - e) / 1000, t2 = Math.floor(r2 / 60), o2 = Math.floor(r2 % 60);
    return t2 > 0 ? `[${t2}m ${o2}s]` : `[${o2}s]`;
  }, N = I2.withGuide ?? settings.withGuide, P3 = (e = "") => {
    d = true, M2 = block({ output: n3 }), s = C3(e), w = performance.now(), N && n3.write(`${styleText2("gray", S_BAR)}
`);
    let r2 = 0, t2 = 0;
    A(), T3 = setInterval(() => {
      if (u4 && s === p3)
        return;
      y2(), p3 = s;
      const o2 = k(E2[r2]);
      let v;
      if (u4)
        v = `${o2}  ${s}...`;
      else if (l2 === "timer")
        v = `${o2}  ${s} ${_2(w)}`;
      else {
        const B = ".".repeat(Math.floor(t2)).slice(0, 3);
        v = `${o2}  ${s}${B}`;
      }
      const j2 = wrapAnsi(v, x2, {
        hard: true,
        trim: false
      });
      n3.write(j2), r2 = r2 + 1 < E2.length ? r2 + 1 : 0, t2 = t2 < 4 ? t2 + 0.125 : 0;
    }, F);
  }, a2 = (e = "", r2 = 0, t2 = false) => {
    if (!d)
      return;
    d = false, clearInterval(T3), y2();
    const o2 = r2 === 0 ? styleText2("green", S_STEP_SUBMIT) : r2 === 1 ? styleText2("red", S_STEP_CANCEL) : styleText2("red", S_STEP_ERROR);
    s = e ?? s, t2 || (l2 === "timer" ? n3.write(`${o2}  ${s} ${_2(w)}
`) : n3.write(`${o2}  ${s}
`)), H(), M2();
  };
  return {
    start: P3,
    stop: (e = "") => a2(e, 0),
    message: (e = "") => {
      s = C3(e ?? s);
    },
    cancel: (e = "") => a2(e, 1),
    error: (e = "") => a2(e, 2),
    clear: () => a2("", 0, true),
    get isCancelled() {
      return S;
    }
  };
};
var u4 = {
  light: unicodeOr("─", "-"),
  heavy: unicodeOr("━", "="),
  block: unicodeOr("█", "#")
};
function progress({
  style: o2 = "heavy",
  max: d = 100,
  size: v = 40,
  ...x2
} = {}) {
  const r2 = spinner(x2);
  let a2 = 0, n3 = "";
  const c2 = Math.max(1, d), l2 = Math.max(1, v), S = (t2) => {
    switch (t2) {
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
  }, p3 = (t2, e) => {
    const m3 = Math.floor(a2 / c2 * l2);
    return `${S(t2)(u4[o2].repeat(m3))}${styleText2("dim", u4[o2].repeat(l2 - m3))} ${e}`;
  }, h2 = (t2 = "") => {
    n3 = t2, r2.start(p3("initial", t2));
  }, g2 = (t2 = 1, e) => {
    a2 = Math.min(c2, t2 + a2), r2.message(p3("active", e ?? n3)), n3 = e ?? n3;
  };
  return {
    start: h2,
    stop: r2.stop,
    cancel: r2.cancel,
    error: r2.error,
    clear: r2.clear,
    advance: g2,
    isCancelled: r2.isCancelled,
    message: (t2) => g2(0, t2)
  };
}
var SELECT_INSTRUCTIONS = [
  `${styleText2("dim", "↑/↓")} to navigate`,
  `${styleText2("dim", "Enter:")} confirm`
];
var c2 = (t2, o2) => t2.includes(`
`) ? t2.split(`
`).map((d) => o2(d)).join(`
`) : o2(t2);
var select = (t2) => {
  const o2 = (n3, m3) => {
    if (n3 === undefined)
      return "";
    const s = n3.label ?? String(n3.value);
    switch (m3) {
      case "disabled":
        return `${styleText2("gray", S_RADIO_INACTIVE)} ${c2(s, (i) => styleText2("gray", i))}${n3.hint ? ` ${styleText2("dim", `(${n3.hint ?? "disabled"})`)}` : ""}`;
      case "selected":
        return `${c2(s, (i) => styleText2("dim", i))}`;
      case "active":
        return `${styleText2("green", S_RADIO_ACTIVE)} ${s}${n3.hint ? ` ${styleText2("dim", `(${n3.hint})`)}` : ""}`;
      case "cancelled":
        return `${c2(s, (i) => styleText2(["strikethrough", "dim"], i))}`;
      default:
        return `${styleText2("dim", S_RADIO_INACTIVE)} ${c2(s, (i) => styleText2("dim", i))}`;
    }
  }, d = t2.showInstructions ?? true;
  return new n$1({
    options: t2.options,
    signal: t2.signal,
    input: t2.input,
    output: t2.output,
    initialValue: t2.initialValue,
    render() {
      const n3 = t2.withGuide ?? settings.withGuide, m3 = `${symbol(this.state)}  `, s = `${symbolBar(this.state)}  `, i = wrapTextWithPrefix(t2.output, t2.message, s, m3), u5 = `${n3 ? `${styleText2("gray", S_BAR)}
` : ""}${i}
`;
      switch (this.state) {
        case "submit": {
          const r2 = n3 ? `${styleText2("gray", S_BAR)}  ` : "", a2 = wrapTextWithPrefix(t2.output, o2(this.options[this.cursor], "selected"), r2);
          return `${u5}${a2}`;
        }
        case "cancel": {
          const r2 = n3 ? `${styleText2("gray", S_BAR)}  ` : "", a2 = wrapTextWithPrefix(t2.output, o2(this.options[this.cursor], "cancelled"), r2);
          return `${u5}${a2}${n3 ? `
${styleText2("gray", S_BAR)}` : ""}`;
        }
        default: {
          const r2 = n3 ? `${styleText2("cyan", S_BAR)}  ` : "", a2 = u5.split(`
`).length, p3 = d ? formatInstructionFooter(SELECT_INSTRUCTIONS, n3) : n3 ? [styleText2("cyan", S_BAR_END)] : [], f2 = p3.join(`
`), b3 = p3.length + 1;
          return `${u5}${r2}${limitOptions({
            output: t2.output,
            cursor: this.cursor,
            options: this.options,
            maxItems: t2.maxItems,
            columnPadding: r2.length,
            rowPadding: a2 + b3,
            style: (g2, x2) => o2(g2, g2.disabled ? "disabled" : x2 ? "active" : "inactive")
          }).join(`
${r2}`)}
${f2}
`;
        }
      }
    }
  }).prompt();
};
var selectKey = (t2) => {
  const c3 = (e, a2 = "inactive") => {
    if (e === undefined)
      return "";
    const n3 = e.label ?? String(e.value);
    return a2 === "selected" ? `${styleText2("dim", n3)}` : a2 === "cancelled" ? `${styleText2(["strikethrough", "dim"], n3)}` : a2 === "active" ? `${styleText2(["bgCyan", "gray"], ` ${e.value} `)} ${n3}${e.hint ? ` ${styleText2("dim", `(${e.hint})`)}` : ""}` : `${styleText2(["gray", "bgWhite", "inverse"], ` ${e.value} `)} ${n3}${e.hint ? ` ${styleText2("dim", `(${e.hint})`)}` : ""}`;
  };
  return new u3({
    options: t2.options,
    signal: t2.signal,
    input: t2.input,
    output: t2.output,
    initialValue: t2.initialValue,
    caseSensitive: t2.caseSensitive,
    render() {
      const e = t2.withGuide ?? settings.withGuide, a2 = `${e ? `${styleText2("gray", S_BAR)}
` : ""}${symbol(this.state)}  ${t2.message}
`;
      switch (this.state) {
        case "submit": {
          const n3 = e ? `${styleText2("gray", S_BAR)}  ` : "", r2 = this.options.find((u5) => u5.value === this.value) ?? t2.options[0], l2 = wrapTextWithPrefix(t2.output, c3(r2, "selected"), n3);
          return `${a2}${l2}`;
        }
        case "cancel": {
          const n3 = e ? `${styleText2("gray", S_BAR)}  ` : "", r2 = wrapTextWithPrefix(t2.output, c3(this.options[0], "cancelled"), n3);
          return `${a2}${r2}${e ? `
${styleText2("gray", S_BAR)}` : ""}`;
        }
        default: {
          const n3 = e ? `${styleText2("cyan", S_BAR)}  ` : "", r2 = e ? styleText2("cyan", S_BAR_END) : "", l2 = this.options.map((u5, d) => wrapTextWithPrefix(t2.output, c3(u5, d === this.cursor ? "active" : "inactive"), n3)).join(`
`);
          return `${a2}${l2}
${r2}
`;
        }
      }
    }
  }).prompt();
};
var i = `${styleText2("gray", S_BAR)}  `;
var stream = {
  message: async (e, { symbol: l2 = styleText2("gray", S_BAR) } = {}) => {
    process.stdout.write(`${styleText2("gray", S_BAR)}
${l2}  `);
    let s = 3;
    for await (let r2 of e) {
      r2 = r2.replace(/\n/g, `
${i}`), r2.includes(`
`) && (s = 3 + stripVTControlCharacters(r2.slice(r2.lastIndexOf(`
`))).length);
      const o2 = stripVTControlCharacters(r2).length;
      s + o2 < process.stdout.columns ? (s += o2, process.stdout.write(r2)) : (process.stdout.write(`
${i}${r2.trimStart()}`), s = 3 + stripVTControlCharacters(r2.trimStart()).length);
    }
    process.stdout.write(`
`);
  },
  info: (e) => stream.message(e, { symbol: styleText2("blue", S_INFO) }),
  success: (e) => stream.message(e, { symbol: styleText2("green", S_SUCCESS) }),
  step: (e) => stream.message(e, { symbol: styleText2("green", S_STEP_SUBMIT) }),
  warn: (e) => stream.message(e, { symbol: styleText2("yellow", S_WARN) }),
  warning: (e) => stream.warn(e),
  error: (e) => stream.message(e, { symbol: styleText2("red", S_ERROR) })
};
var tasks = async (o2, e) => {
  for (const t2 of o2) {
    if (t2.enabled === false)
      continue;
    const s = spinner(e);
    s.start(t2.title);
    const n3 = await t2.task(s.message);
    s.stop(n3 || t2.title);
  }
};
var A = (l2) => l2.replace(/\x1b\[(?:\d+;)*\d*[ABCDEFGHfJKSTsu]|\x1b\[(s|u)/g, "");
var taskLog = (l2) => {
  const r2 = l2.output ?? process.stdout, O = getColumns(r2), i2 = styleText2("gray", S_BAR), p3 = l2.spacing ?? 1, k = 3, m3 = l2.retainLog === true, d = !isCI() && isTTY(r2);
  r2.write(`${i2}
`), r2.write(`${styleText2("green", S_STEP_SUBMIT)}  ${l2.title}
`);
  for (let e = 0;e < p3; e++)
    r2.write(`${i2}
`);
  const n3 = [
    {
      value: "",
      full: ""
    }
  ];
  let v = false;
  const f2 = (e) => {
    if (n3.length === 0)
      return;
    let s = 0;
    e && (s += p3 + 2);
    for (const t2 of n3) {
      const { value: o2, result: a2 } = t2;
      let g2 = a2?.message ?? o2;
      if (g2.length === 0)
        continue;
      a2 === undefined && t2.header !== undefined && t2.header !== "" && (g2 += `
${t2.header}`);
      const E2 = g2.split(`
`).reduce((b3, w) => w === "" ? b3 + 1 : b3 + Math.ceil((w.length + k) / O), 0);
      s += E2;
    }
    s > 0 && (s += 1, r2.write(import_sisteransi2.erase.lines(s)));
  }, h2 = (e, s, t2) => {
    const o2 = t2 ? `${e.full}
${e.value}` : e.value;
    e.header !== undefined && e.header !== "" && log.message(e.header.split(`
`).map((a2) => styleText2("bold", a2)), {
      output: r2,
      secondarySymbol: i2,
      symbol: i2,
      spacing: 0
    }), log.message(o2.split(`
`).map((a2) => styleText2("dim", a2)), {
      output: r2,
      secondarySymbol: i2,
      symbol: i2,
      spacing: s ?? p3
    });
  }, T3 = () => {
    for (const e of n3) {
      const { header: s, value: t2, full: o2 } = e;
      (s === undefined || s.length === 0) && t2.length === 0 || h2(e, undefined, m3 === true && o2.length > 0);
    }
  }, L = (e, s, t2) => {
    if (f2(false), (t2?.raw !== true || !v) && e.value !== "" && (e.value += `
`), e.value += A(s), v = t2?.raw === true, l2.limit !== undefined) {
      const o2 = e.value.split(`
`), a2 = o2.length - l2.limit;
      if (a2 > 0) {
        const g2 = o2.splice(0, a2);
        m3 && (e.full += (e.full === "" ? "" : `
`) + g2.join(`
`));
      }
      e.value = o2.join(`
`);
    }
    d && y2();
  }, y2 = () => {
    for (const e of n3)
      e.result ? e.result.status === "error" ? log.error(e.result.message, { output: r2, secondarySymbol: i2, spacing: 0 }) : log.success(e.result.message, { output: r2, secondarySymbol: i2, spacing: 0 }) : e.value !== "" && h2(e, 0);
  }, B = (e, s) => {
    f2(false), e.result = s, d && y2();
  };
  return {
    message(e, s) {
      L(n3[0], e, s);
    },
    group(e) {
      const s = {
        header: e,
        value: "",
        full: ""
      };
      return n3.push(s), {
        message(t2, o2) {
          L(s, t2, o2);
        },
        error(t2) {
          B(s, {
            status: "error",
            message: t2
          });
        },
        success(t2) {
          B(s, {
            status: "success",
            message: t2
          });
        }
      };
    },
    error(e, s) {
      f2(true), log.error(e, { output: r2, secondarySymbol: i2, spacing: 1 }), s?.showLog !== false && T3(), n3.splice(1, n3.length - 1), n3[0].value = "", n3[0].full = "";
    },
    success(e, s) {
      f2(true), log.success(e, { output: r2, secondarySymbol: i2, spacing: 1 }), s?.showLog === true && T3(), n3.splice(1, n3.length - 1), n3[0].value = "", n3[0].full = "";
    }
  };
};
var text = (t2) => new n2({
  validate: t2.validate,
  placeholder: t2.placeholder,
  defaultValue: t2.defaultValue,
  initialValue: t2.initialValue,
  output: t2.output,
  signal: t2.signal,
  input: t2.input,
  render() {
    const r2 = t2?.withGuide ?? settings.withGuide, l2 = `${`${r2 ? `${styleText2("gray", S_BAR)}
` : ""}${symbol(this.state)}  `}${t2.message}
`, d = t2.placeholder && t2.placeholder.length > 0 ? styleText2("inverse", t2.placeholder[0]) + styleText2("dim", t2.placeholder.slice(1)) : styleText2(["inverse", "hidden"], "_"), o2 = this.userInput ? this.userInputWithCursor : d, s = this.value ?? "";
    switch (this.state) {
      case "validating": {
        const n3 = r2 ? `${styleText2("cyan", S_BAR)}  ` : "", i2 = r2 ? styleText2("cyan", S_BAR_END) : "", c3 = styleText2("dim", o2), $ = styleText2("dim", "Validating...");
        return `${l2}${n3}${c3}
${i2}  ${$}
`;
      }
      case "error": {
        const n3 = this.error ? `  ${styleText2("yellow", this.error)}` : "", i2 = r2 ? `${styleText2("yellow", S_BAR)}  ` : "", c3 = r2 ? styleText2("yellow", S_BAR_END) : "";
        return `${l2.trim()}
${i2}${o2}
${c3}${n3}
`;
      }
      case "submit": {
        const n3 = s ? `${r2 ? "  " : ""}${styleText2("dim", s)}` : "", i2 = r2 ? styleText2("gray", S_BAR) : "";
        return `${l2}${i2}${n3}`;
      }
      case "cancel": {
        const n3 = s ? `  ${styleText2(["strikethrough", "dim"], s)}` : "", i2 = r2 ? styleText2("gray", S_BAR) : "";
        return `${l2}${i2}${n3}${s.trim() ? `
${i2}` : ""}`;
      }
      default: {
        const n3 = r2 ? `${styleText2("cyan", S_BAR)}  ` : "", i2 = r2 ? styleText2("cyan", S_BAR_END) : "";
        return `${l2}${n3}${o2}
${i2}
`;
      }
    }
  }
}).prompt();
export { settings, updateSettings, CANCEL_SYMBOL, isCancel, unicode, isCI, isTTY, unicodeOr, S_STEP_ACTIVE, S_STEP_CANCEL, S_STEP_ERROR, S_STEP_SUBMIT, S_BAR_START, S_BAR, S_BAR_END, S_BAR_START_RIGHT, S_BAR_END_RIGHT, S_RADIO_ACTIVE, S_RADIO_INACTIVE, S_CHECKBOX_ACTIVE, S_CHECKBOX_SELECTED, S_CHECKBOX_INACTIVE, S_PASSWORD_MASK, S_BAR_H, S_CORNER_TOP_RIGHT, S_CONNECT_LEFT, S_CORNER_BOTTOM_RIGHT, S_CORNER_BOTTOM_LEFT, S_CORNER_TOP_LEFT, S_INFO, S_SUCCESS, S_WARN, S_ERROR, symbol, symbolBar, formatInstructionFooter, limitOptions, autocomplete, autocompleteMultiselect, box, confirm, date, group, MULTISELECT_INSTRUCTIONS, multiselect, groupMultiselect, log, cancel, intro, outro, multiline, note, password, path, spinner, progress, SELECT_INSTRUCTIONS, select, selectKey, stream, tasks, taskLog, text };
