/**
 * The tokenizer behind the editor's highlighting.
 *
 * THE PROPERTY THAT MATTERS MOST is losslessness: joining every token's text in
 * order must reproduce the input byte for byte. The highlighted layer is rendered
 * behind a transparent textarea and the two must line up to the pixel, so a
 * scanner that dropped or duplicated a single character would show as text
 * sliding out from under the caret. Every case here asserts it, and there is a
 * property-style pass over a corpus at the end.
 *
 * The second is that an UNTERMINATED construct must not colour the rest of the
 * program. One stray quote turning a whole file into a string is the classic
 * hand-rolled-highlighter failure, and it is worse than no highlighting.
 */
import { strict as assert } from 'node:assert'

import { canHighlight, HIGHLIGHTED, tokenize, type Token, type TokenKind } from './highlight'

const join = (tokens: Token[]) => tokens.map((t) => t.text).join('')
const kindsOf = (tokens: Token[], kind: TokenKind) =>
  tokens.filter((t) => t.kind === kind).map((t) => t.text)

function lossless(source: string, language: string) {
  const tokens = tokenize(source, language)
  assert.equal(join(tokens), source, `tokenizing ${language} changed the text`)
  return tokens
}

/* ── Python ─────────────────────────────────────────────────────────────── */

{
  const src = 'import sys\n\ndef solve(n):  # the answer\n    return n * 2\n'
  const tokens = lossless(src, 'python')
  assert.deepEqual(kindsOf(tokens, 'comment'), ['# the answer'])
  assert.deepEqual(kindsOf(tokens, 'keyword'), ['import', 'def', 'return'])
  assert.deepEqual(kindsOf(tokens, 'number'), ['2'])
  // `solve` and `sys` are names, not keywords, and `n` is not a number.
  assert.ok(!kindsOf(tokens, 'keyword').includes('solve'))
}

{
  // A docstring is one string, and the quotes inside it do not open another.
  const src = 'def f():\n    """Say "hello".\n\n    Over lines.\n    """\n    pass\n'
  const tokens = lossless(src, 'python')
  const strings = kindsOf(tokens, 'string')
  assert.equal(strings.length, 1)
  assert.ok(strings[0].startsWith('"""'))
  assert.ok(strings[0].endsWith('"""'))
  assert.ok(strings[0].includes('Over lines.'))
}

{
  // An unterminated single-quoted string stops at the newline.
  const src = "x = 'oops\ny = 1\n"
  const tokens = lossless(src, 'python')
  assert.deepEqual(kindsOf(tokens, 'string'), ["'oops"])
  assert.deepEqual(kindsOf(tokens, 'number'), ['1'])
}

/* ── JavaScript and TypeScript ──────────────────────────────────────────── */

{
  const src = 'const s = "a\\"b";\n/* block\n   comment */\nlet n = 0x1f;\n'
  const tokens = lossless(src, 'javascript')
  // The escaped quote does not end the string.
  assert.deepEqual(kindsOf(tokens, 'string'), ['"a\\"b"'])
  assert.equal(kindsOf(tokens, 'comment').length, 1)
  assert.ok(kindsOf(tokens, 'comment')[0].includes('block'))
  assert.deepEqual(kindsOf(tokens, 'number'), ['0x1f'])
  assert.deepEqual(kindsOf(tokens, 'keyword'), ['const', 'let'])
}

{
  // A template literal spans lines where a plain quote does not.
  const src = 'const t = `line one\nline two`;\n'
  const tokens = lossless(src, 'javascript')
  assert.deepEqual(kindsOf(tokens, 'string'), ['`line one\nline two`'])
}

{
  // TypeScript's own words are keywords; JavaScript's are still there.
  const ts = tokenize('interface X { readonly a: number }', 'typescript')
  assert.ok(kindsOf(ts, 'keyword').includes('interface'))
  assert.ok(kindsOf(ts, 'keyword').includes('readonly'))
  const js = tokenize('interface X {}', 'javascript')
  assert.ok(!kindsOf(js, 'keyword').includes('interface'))
}

/* ── C, C++ and the difference between them ─────────────────────────────── */

{
  const src = '#include <stdio.h>\nint main(){ long long a; scanf("%lld", &a); return 0; }\n'
  const tokens = lossless(src, 'c')
  assert.deepEqual(kindsOf(tokens, 'string'), ['"%lld"'])
  assert.ok(kindsOf(tokens, 'keyword').includes('int'))
  assert.ok(kindsOf(tokens, 'keyword').includes('return'))
  // C has no `class`; C++ does. The lists are derived from one another, so this
  // is the test that the derivation actually removed something.
  assert.ok(!kindsOf(tokenize('class A {};', 'c'), 'keyword').includes('class'))
  assert.ok(kindsOf(tokenize('class A {};', 'cpp'), 'keyword').includes('class'))
}

/* ── Rust lifetimes, the case that looked worst ─────────────────────────── */

{
  // Without the lifetime rule the tick opens a char literal that never closes and
  // the whole remainder of the file colours as a string.
  const src = "fn longest<'a>(x: &'a str) -> &'a str { x }\nlet c = 'z';\n"
  const tokens = lossless(src, 'rust')
  assert.deepEqual(kindsOf(tokens, 'string'), ["'z'"], 'lifetimes must not read as strings')
  assert.ok(kindsOf(tokens, 'keyword').includes('fn'))
  assert.ok(kindsOf(tokens, 'keyword').includes('let'))
}

/* ── Go raw strings ─────────────────────────────────────────────────────── */

{
  const src = 'package main\n\nvar s = `raw\nstring`\n'
  const tokens = lossless(src, 'go')
  assert.deepEqual(kindsOf(tokens, 'string'), ['`raw\nstring`'])
  assert.ok(kindsOf(tokens, 'keyword').includes('package'))
}

/* ── Numbers that are not numbers ───────────────────────────────────────── */

{
  // An identifier containing digits is not a number.
  const tokens = lossless('let x2 = 3; let a1b = 4;', 'javascript')
  assert.deepEqual(kindsOf(tokens, 'number'), ['3', '4'])
}

{
  // `1..n` is a range, not the number "1.".
  const tokens = lossless('for i in 1..n {}', 'rust')
  assert.deepEqual(kindsOf(tokens, 'number'), ['1'])
}

/* ── Unknown languages, and the empty case ──────────────────────────────── */

{
  assert.deepEqual(tokenize('anything at all', 'brainfuck'), [
    { kind: 'plain', text: 'anything at all' },
  ])
  assert.deepEqual(tokenize('', 'python'), [])
  assert.equal(canHighlight('python'), true)
  assert.equal(canHighlight('brainfuck'), false)
}

/* ── Every offered language, and losslessness over a nasty corpus ────────
   The corpus is deliberately full of half-open constructs, because that is what
   a candidate's buffer looks like WHILE THEY TYPE — and the editor highlights on
   every keystroke, not only on valid programs. */

{
  const CORPUS = [
    '',
    '\n',
    '   \n\t\n',
    'x',
    '"',
    "'",
    '`',
    '/*',
    '//',
    '#',
    '"unterminated',
    '/* unterminated',
    "'a",
    '0x',
    '1.',
    '1..',
    '\\',
    '"\\',
    'a"b\'c`d',
    '"""',
    '"""abc',
    'const x = "a"; // c\n/* b */ let y = `t${1}`;\n',
    'def f():\n\t"""d"""\n\treturn 0\n',
    'é 中文 🎯 mixed unicode',
  ]

  for (const language of HIGHLIGHTED) {
    for (const source of CORPUS) {
      const tokens = tokenize(source, language)
      assert.equal(
        join(tokens),
        source,
        `${language} altered ${JSON.stringify(source)}`,
      )
      // No empty tokens: they would each cost a DOM node for nothing.
      assert.ok(
        tokens.every((t) => t.text.length > 0),
        `${language} emitted an empty token for ${JSON.stringify(source)}`,
      )
    }
  }
}

{
  // Every language the dropdown offers can be highlighted. A language in the
  // picker whose code renders flat looks broken rather than unsupported.
  const OFFERED = ['python', 'javascript', 'typescript', 'java', 'cpp', 'c', 'csharp', 'go', 'rust']
  for (const key of OFFERED) {
    assert.ok(canHighlight(key), `${key} is offered but cannot be highlighted`)
  }
}

console.log('highlight.test.ts: all assertions passed')
