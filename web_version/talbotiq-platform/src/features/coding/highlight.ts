/**
 * Syntax highlighting for the code editor, without a dependency.
 *
 * WHY NOT CODEMIRROR, since that is the obvious question and the honest answer
 * matters more than the code below.
 *
 * CodeMirror 6 would do this better. It is eleven direct packages and roughly
 * twenty-five transitive ones, and it resolves cleanly — the reason it is not
 * here is not that it does not work. It is that this repository took a production
 * outage inside the last day from an unpinned transitive dependency swapping under
 * the data layer, and adding twenty-five more of them to the one page a candidate
 * loads under exam pressure is not a call to make unsupervised. If the decision
 * is taken later, this file and its consumer are what gets deleted; nothing above
 * `CodeEditor` knows this exists.
 *
 * WHAT THIS IS. A single-pass scanner driven by a per-language table. It knows
 * comments, strings, numbers and keywords. That is deliberately the whole list,
 * because those four are what make code readable at a glance — comments recede,
 * string boundaries become visible, and control flow separates from names.
 *
 * WHAT IT GETS WRONG, stated because a highlighter that quietly mis-colours is
 * worse than one whose limits are known:
 *
 *   · Nested template literals in JS/TS colour as one string.
 *   · Rust lifetimes (`&'a str`) colour the tick as a char literal opening; the
 *     scanner is given an explicit rule for this because it looked wrong enough
 *     to matter, but a real grammar would do it properly.
 *   · Regex literals are not distinguished from division.
 *   · No semantic knowledge at all: a variable named `class` in a language where
 *     that is not reserved would still colour as a keyword if the language table
 *     lists it.
 *
 * None of those change what the judge does with the program. All of them are
 * visible only as a colour, never as an edit — the scanner never touches the
 * text, it only describes it.
 */

export type TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'plain'

export interface Token {
  kind: TokenKind
  text: string
}

interface Spec {
  /** Everything from this marker to end of line is a comment. */
  lineComments: string[]
  /** Open/close pair, nesting NOT handled (only Rust nests, and rarely). */
  blockComment?: [string, string]
  /** Quote characters that open a string. */
  quotes: string[]
  /** Triple-quoted strings, for Python's docstrings and Go's raw strings. */
  longQuotes?: string[]
  keywords: string[]
  /** Rust writes `&'a str`; without this the lifetime tick opens a char literal
   *  that never closes and the rest of the file colours as one string. */
  tickIsLifetime?: boolean
}

/* Keyword lists are the RESERVED words, not the standard library. `print` and
   `println!` are not keywords and colouring them as such tells the reader
   something false about the language. */
const SPECS: Record<string, Spec> = {
  python: {
    lineComments: ['#'],
    quotes: ['"', "'"],
    longQuotes: ['"""', "'''"],
    keywords: (
      'False None True and as assert async await break class continue def del elif else except ' +
      'finally for from global if import in is lambda nonlocal not or pass raise return try ' +
      'while with yield match case'
    ).split(' '),
  },
  javascript: {
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'", '`'],
    keywords: (
      'async await break case catch class const continue debugger default delete do else export ' +
      'extends false finally for function if import in instanceof let new null of return static ' +
      'super switch this throw true try typeof var void while with yield'
    ).split(' '),
  },
  java: {
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
    keywords: (
      'abstract assert boolean break byte case catch char class const continue default do double ' +
      'else enum extends final finally float for if implements import instanceof int interface ' +
      'long native new null package private protected public return short static strictfp super ' +
      'switch synchronized this throw throws transient true false try void volatile while var'
    ).split(' '),
  },
  cpp: {
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
    keywords: (
      'alignas alignof auto bool break case catch char class const constexpr const_cast continue ' +
      'decltype default delete do double dynamic_cast else enum explicit export extern false ' +
      'float for friend goto if inline int long mutable namespace new noexcept nullptr operator ' +
      'private protected public register reinterpret_cast return short signed sizeof static ' +
      'static_assert static_cast struct switch template this throw true try typedef typeid ' +
      'typename union unsigned using virtual void volatile while'
    ).split(' '),
  },
  csharp: {
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
    keywords: (
      'abstract as base bool break byte case catch char checked class const continue decimal ' +
      'default delegate do double else enum event explicit extern false finally fixed float for ' +
      'foreach goto if implicit in int interface internal is lock long namespace new null object ' +
      'operator out override params private protected public readonly ref return sbyte sealed ' +
      'short sizeof stackalloc static string struct switch this throw true try typeof uint ulong ' +
      'unchecked unsafe ushort using var virtual void volatile while'
    ).split(' '),
  },
  go: {
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'", '`'],
    keywords: (
      'break case chan const continue default defer else fallthrough for func go goto if import ' +
      'interface map package range return select struct switch type var nil true false'
    ).split(' '),
  },
  rust: {
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
    tickIsLifetime: true,
    keywords: (
      'as async await break const continue crate dyn else enum extern false fn for if impl in ' +
      'let loop match mod move mut pub ref return self Self static struct super trait true type ' +
      'unsafe use where while'
    ).split(' '),
  },
}

/* C is C++ minus the C++-only words; TypeScript is JavaScript plus its own. Built
   from the entries above rather than written out, so a keyword added to one does
   not silently miss the other. */
SPECS.c = {
  ...SPECS.cpp,
  keywords: SPECS.cpp.keywords.filter(
    (k) => !k.includes('_cast') && !'class namespace template this throw try new delete public private protected virtual operator nullptr bool constexpr decltype friend explicit export inline mutable noexcept typeid typename using'.split(' ').includes(k),
  ),
}

SPECS.typescript = {
  ...SPECS.javascript,
  keywords: [
    ...SPECS.javascript.keywords,
    ...'abstract any as asserts bigint boolean declare enum implements infer interface is keyof namespace never number object private protected public readonly require satisfies string symbol type undefined unique unknown'.split(' '),
  ],
}

const IDENT_START = /[A-Za-z_$]/
const IDENT_PART = /[A-Za-z0-9_$]/
const DIGIT = /[0-9]/

/** The languages this can highlight. Anything else renders as plain text. */
export const HIGHLIGHTED = Object.keys(SPECS)

export function canHighlight(language: string): boolean {
  return language in SPECS
}

/**
 * Split `source` into tokens. Total and lossless: joining every `text` in order
 * reproduces the input exactly. That property is what makes it safe to render
 * behind a textarea — the two layers cannot drift, because one is the other.
 */
export function tokenize(source: string, language: string): Token[] {
  const spec = SPECS[language]
  if (!spec) return source ? [{ kind: 'plain', text: source }] : []

  const keywords = new Set(spec.keywords)
  const out: Token[] = []
  let plain = ''
  let i = 0

  const flush = () => {
    if (plain) {
      out.push({ kind: 'plain', text: plain })
      plain = ''
    }
  }
  const emit = (kind: TokenKind, text: string) => {
    flush()
    out.push({ kind, text })
    i += text.length
  }

  while (i < source.length) {
    const rest = source.slice(i)

    // Line comment
    const line = spec.lineComments.find((m) => rest.startsWith(m))
    if (line) {
      const end = source.indexOf('\n', i)
      emit('comment', source.slice(i, end === -1 ? source.length : end))
      continue
    }

    // Block comment — unterminated runs to end of file, which is what an editor
    // should show: the text really is all commented out until it is closed.
    if (spec.blockComment && rest.startsWith(spec.blockComment[0])) {
      const [open, close] = spec.blockComment
      const end = source.indexOf(close, i + open.length)
      emit('comment', source.slice(i, end === -1 ? source.length : end + close.length))
      continue
    }

    // Triple-quoted string, before the single-quote check that would eat one quote
    const long = spec.longQuotes?.find((q) => rest.startsWith(q))
    if (long) {
      const end = source.indexOf(long, i + long.length)
      emit('string', source.slice(i, end === -1 ? source.length : end + long.length))
      continue
    }

    // Rust lifetime: a tick followed by an identifier with no closing tick.
    if (spec.tickIsLifetime && rest[0] === "'" && IDENT_START.test(rest[1] ?? '')) {
      let j = 1
      while (j < rest.length && IDENT_PART.test(rest[j])) j += 1
      if (rest[j] !== "'") {
        // A lifetime, not a char literal. Plain text — it names a scope.
        plain += rest.slice(0, j)
        i += j
        continue
      }
    }

    // String, with escapes
    if (spec.quotes.includes(rest[0])) {
      const quote = rest[0]
      // A backtick string in JS/Go spans lines; a plain quote does not, and an
      // unterminated one must stop at the newline or one stray quote colours the
      // rest of the program.
      const spans = quote === '`'
      let j = 1
      while (j < rest.length) {
        if (rest[j] === '\\') {
          j += 2
          continue
        }
        if (rest[j] === quote) {
          j += 1
          break
        }
        if (rest[j] === '\n' && !spans) break
        j += 1
      }
      emit('string', rest.slice(0, j))
      continue
    }

    // Number: leading digit only, so `x2` stays an identifier. Covers 0x, 1e9,
    // 1_000_000 and 3.14 without parsing them properly, which is enough to colour.
    if (DIGIT.test(rest[0])) {
      let j = 0
      while (j < rest.length) {
        // A dot belongs to the number (`3.14`, `1.`) UNLESS it opens a range:
        // `1..n` in Rust and Go must not colour its first dot as a decimal point.
        if (rest[j] === '.' && rest[j + 1] === '.') break
        if (!/[0-9a-fA-FxXoObB._]/.test(rest[j])) break
        j += 1
      }
      emit('number', rest.slice(0, j))
      continue
    }

    // Identifier, which may be a keyword
    if (IDENT_START.test(rest[0])) {
      let j = 0
      while (j < rest.length && IDENT_PART.test(rest[j])) j += 1
      const word = rest.slice(0, j)
      if (keywords.has(word)) emit('keyword', word)
      else {
        plain += word
        i += j
      }
      continue
    }

    plain += rest[0]
    i += 1
  }

  flush()
  return out
}
