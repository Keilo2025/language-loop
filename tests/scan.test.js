import test from 'node:test';
import assert from 'node:assert/strict';
import { scanRepo, isCopy, isJsxTextCandidate, isJsxTagClose, functionDepth, findPlaceholders } from '../dist/core/scan.js';
import { defaultConfig } from '../dist/core/config.js';
import { detect } from '../dist/core/detect.js';

const config = defaultConfig(detect('tests/fixture'));

test('finds the copy in the fixture and nothing else', () => {
  const result = scanRepo('tests/fixture', config);
  const texts = result.strings.map((s) => s.text);

  assert.ok(texts.includes('Get started free'));
  assert.ok(texts.includes('Find out your deploy broke in 4 minutes'));
  assert.ok(texts.includes('A dashboard showing four failing deploys'));
  assert.ok(texts.includes('Your work email address'));

  // Things that look like strings but are not copy.
  assert.ok(!texts.includes('lg'));
  assert.ok(!texts.includes('email'));
  assert.ok(!texts.includes('submit'));
  assert.ok(!texts.some((t) => t.includes('mx-auto')));
  assert.ok(!texts.some((t) => t.includes('=>')));
});

test('classifies buttons as cta and h-tags as heading', () => {
  const result = scanRepo('tests/fixture', config);
  const cta = result.strings.find((s) => s.text === 'Get started free');
  const heading = result.strings.find((s) => s.text === 'Everything in one place');
  assert.equal(cta.kind, 'cta');
  assert.equal(heading.kind, 'heading');
});

test('keeps interpolated sentences whole', () => {
  const result = scanRepo('tests/fixture', config);
  const interpolated = result.strings.find((s) => s.text.startsWith('You have'));
  assert.ok(interpolated, 'a sentence with {count} in it should still be found');
  assert.deepEqual(interpolated.placeholders, ['{count}']);
});

test('a description in a feature list is copy; a css class is not', () => {
  assert.equal(isCopy('For one engineer watching one pipeline.', 'literal', config), true);
  assert.equal(isCopy('flex items-center gap-2', 'jsx-attr', config), false);
  assert.equal(isCopy('primary', 'jsx-attr', config), false);
  assert.equal(isCopy('#0f172a', 'jsx-attr', config), false);
  assert.equal(isCopy('https://example.com/pricing', 'jsx-text', config), false);
  assert.equal(isCopy('MAX_RETRIES', 'literal', config), false);
  assert.equal(isCopy('onSubmitHandler', 'literal', config), false);
});

test('jsx text candidates admit values but refuse code', () => {
  assert.equal(isJsxTextCandidate('You have {count} builds waiting.'), true);
  assert.equal(isJsxTextCandidate('Signed in as {user.name}'), true);
  assert.equal(isJsxTextCandidate('{plan.title}'), false, 'no words of its own');
  assert.equal(isJsxTextCandidate('{items.map((i) => i.id)}'), false);
  assert.equal(isJsxTextCandidate('{count > 3 ? "many" : "few"}'), false);
  assert.equal(isJsxTextCandidate('(null);\n  const heroRef = useRef'), false);
  assert.equal(isJsxTextCandidate(', error);\n      toast.dismiss();\n      toast.error(t('), false);
});

test('only a real JSX tag close counts as a text-node boundary', () => {
  const jsx = 'return (\n  <h1>Ship it</h1>\n);';
  assert.equal(isJsxTagClose(jsx, jsx.indexOf('>Ship') ), true);

  const generic = 'const [v, setV] = useState<boolean | null>(null);\n  const ref = useRef<HTMLDivElement>(null);';
  assert.equal(isJsxTagClose(generic, generic.indexOf('>(null)')), false);
  assert.equal(isJsxTagClose(generic, generic.indexOf('>(null);')), false);

  const comparison = 'if (count > 0) {\n  return <p>Ready</p>;\n}';
  assert.equal(isJsxTagClose(comparison, comparison.indexOf('> 0')), false);
  assert.equal(isJsxTagClose(comparison, comparison.indexOf('>Ready') ), true);
});

test('module scope is not the same as brace depth', () => {
  const source = `const plans = [{ title: 'Solo' }];\nfunction App() {\n  const items = { title: 'Team' };\n}`;
  assert.equal(functionDepth(source, source.indexOf("'Solo'")), 0);
  assert.equal(functionDepth(source, source.indexOf("'Team'")), 1);
});

test('placeholders of every common shape are found', () => {
  assert.deepEqual(findPlaceholders('Hi {name}'), ['{name}']);
  assert.deepEqual(findPlaceholders('Hi {{name}}').includes('{{name}}'), true);
  assert.deepEqual(findPlaceholders('%s failed'), ['%s']);
  assert.ok(findPlaceholders('Read the <b>docs</b>').includes('<b>'));
});
