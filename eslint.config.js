import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Math functions that are implementation-approximated and may differ across engines. */
const BANNED_MATH = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
                     'pow', 'hypot', 'log', 'exp', 'cbrt', 'random'];

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // `.claude/**` is locally installed tooling, not project source — vendoring the
    // impeccable design skill put ~2300 lint errors of somebody else's Node scripts into
    // every run, which makes "read the whole lint output" useless and would hide a real
    // error in the noise.
    ignores: ['dist/**', 'node_modules/**', 'docs/**', '.claude/**'],
  },
  {
    // The determinism contract. See docs/superpowers/specs — section 6.1.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...BANNED_MATH.map((name) => ({
          object: 'Math',
          property: name,
          message:
            `Math.${name} is implementation-approximated and may differ between ` +
            `JavaScript engines, which would break deterministic replay. ` +
            `Only +, -, *, / and Math.sqrt are permitted in src/sim/.`,
        })),
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'src/sim/ must never read wall-clock time.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='performance']",
          message: 'src/sim/ must never read wall-clock time.',
        },
        {
          selector: "MemberExpression[object.name='document']",
          message: 'src/sim/ must never touch the DOM.',
        },
        {
          selector: "ImportDeclaration[source.value=/^\\.\\.\\/(render|shell)/]",
          message: 'src/sim/ must not import from the render or shell layers.',
        },
        {
          selector: 'BinaryExpression[operator="**"]',
          message: 'The ** operator is Math.pow by another name. Use repeated multiplication in src/sim/.',
        },
      ],
    },
  },
  {
    // Tests and headless tools live outside the determinism contract. They are
    // allowed to time things, use Math.random to pick seeds, and reach anywhere.
    files: ['**/*.test.ts', 'tools/**/*.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-globals': 'off',
    },
  },
);
