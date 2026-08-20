/**
 * The arithmetic every text annotation depends on.
 *
 *   npm run test:offsets
 *
 * If paragraph offsets are wrong, every stored range points at the wrong words
 * — and nothing fails, which is what makes it worth a test. This caught exactly
 * that: an earlier version assumed the blank line between paragraphs was one
 * character, so every paragraph after the first was off by one or more.
 *
 * Run with Node's type stripping, so it imports the real module rather than a
 * copy that could drift from it.
 */
import {
  splitIntoParagraphs,
  contextAround,
  rangeStillMatches,
} from "../src/features/annotations/annotations.text.ts";

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.log(`  FAIL ${label}\n       got ${JSON.stringify(actual)}\n       want ${JSON.stringify(expected)}`); }
  else console.log(`  pass ${label}`);
};

const transcript = "Digital Fortress\n317\n\nFirst paragraph here.\n\n  Second one, indented.\n\nThird.";
const paras = splitIntoParagraphs(transcript);

console.log("paragraph offsets point at the real text:");
for (const p of paras) {
  check(`"${p.text.slice(0, 22)}" at ${p.start}`, transcript.slice(p.start, p.start + p.text.length), p.text);
}

console.log("\nround trip through an offset:");
const target = "Second one";
const at = transcript.indexOf(target);
check("slice matches the quote", transcript.slice(at, at + target.length), target);
check("rangeStillMatches agrees", rangeStillMatches(transcript, at, at + target.length, target), true);
check("a shifted range does not", rangeStillMatches(transcript, at + 1, at + target.length, target), false);

console.log("\ncontext is drawn from around it:");
const ctx = contextAround(transcript, at, at + target.length);
check("context excludes the quote itself", ctx.includes(target), false);
check("context includes what precedes it", ctx.includes("First paragraph"), true);

console.log(`\n${failures === 0 ? "all passed" : failures + " failed"}`);
process.exit(failures ? 1 : 0);
