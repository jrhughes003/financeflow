import { CASES } from './cases.mjs';
const groups = {};
CASES.forEach(c => { const g = c.tags[0]; (groups[g] = groups[g] || []).push(c); });
for (const [g, list] of Object.entries(groups)) {
  console.log(`\n## ${g}`);
  list.forEach(c => {
    const exp = c.expectZero ? 'expect: zero / none'
      : c.noFigure ? 'expect: no figure — must acknowledge the limit'
      : (c.figures || []).map(alt => alt.map(f => `${f.label}=${f.value}`).join(' OR ')).join(' + ') || '';
    const extra = [c.mustMentionAny && `must mention one of: ${c.mustMentionAny.join('/')}`,
      c.mustNotMention && `must NOT blame: ${c.mustNotMention.join('/')}`].filter(Boolean).join('; ');
    console.log(`${c.seed ? '★' : ' '} ${c.id.padEnd(20)} "${c.question}"`);
    if (exp) console.log(`  ${' '.repeat(20)} ${exp}`);
    if (extra) console.log(`  ${' '.repeat(20)} ${extra}`);
  });
}
console.log(`\ntotal cases: ${CASES.length} (★ = your own wording)`);
