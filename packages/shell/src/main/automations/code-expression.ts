/**
 * Sandboxed expression evaluator for the `Code` step (11b.9, OQ-167 → (a)).
 *
 * "No arbitrary code": this is NOT a JavaScript sandbox — there is no
 * `eval`, no `Function`, no host globals, no I/O, no assignment, no
 * statements. It is a tiny pure-expression language (tokenizer → Pratt
 * parser → AST → evaluator) over a fixed scope (the workflow's prior-step
 * outputs + `input`) plus a curated allow-list of pure functions. So the
 * step's audit surface is exactly this grammar — the concern that drove
 * OQ-167's option (b) doesn't apply, because no foreign code ever runs.
 *
 * Covered: literals (number/string/`true`/`false`/`null`), scope variables
 * with dotted/indexed member access (own properties only — `__proto__` /
 * `constructor` / `prototype` are inaccessible), `! -` unary, `* / % + -`,
 * `< <= > >= == != === !==` (all equality is strict), `&& ||` (short-
 * circuit, value-returning), `?:`, and calls to the built-ins below.
 * Deliberately omitted in v1: regex (a ReDoS surface — a follow-on), any
 * user-defined function, any method call on a value.
 *
 * Pure — no DOM, no broker. Unit-tested directly.
 */

/** Read-only variable scope an expression resolves identifiers against. */
export type ExprScope = Readonly<Record<string, unknown>>;

export interface EvaluateOptions {
	/** Clock for `now()` — injected so a workflow run and its tests pin one
	 *  consistent value. Defaults to the wall clock. */
	now?: number;
}

/** Thrown on a parse error or an unsupported / failed evaluation. The
 *  `Code` interpreter turns this into a failed `StepOutcome`. */
export class ExpressionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExpressionError";
	}
}

const MAX_SOURCE_LENGTH = 4000;
const MAX_DEPTH = 64;
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// ─────────────────────────────── tokens ───────────────────────────────

enum TokKind {
	Num = "num",
	Str = "str",
	Ident = "ident",
	Op = "op",
	Punc = "punc",
	Eof = "eof",
}

interface Token {
	kind: TokKind;
	value: string;
	/** Literal value for Num / Str. */
	literal?: number | string;
	pos: number;
}

const OPERATORS = [
	"===",
	"!==",
	"==",
	"!=",
	"<=",
	">=",
	"&&",
	"||",
	"<",
	">",
	"+",
	"-",
	"*",
	"/",
	"%",
	"!",
	"?",
	":",
];
const PUNCT = new Set(["(", ")", "[", "]", ".", ","]);
const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

function tokenize(src: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	const n = src.length;
	while (i < n) {
		const ch = src[i] ?? "";
		if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") {
			const start = i;
			const quote = ch;
			i++;
			let out = "";
			while (i < n && src[i] !== quote) {
				const c = src[i] ?? "";
				if (c === "\\") {
					const next = src[i + 1] ?? "";
					out += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next; // \" \' \\ and any other → literal char
					i += 2;
				} else {
					out += c;
					i++;
				}
			}
			if (i >= n) throw new ExpressionError("unterminated string literal");
			i++; // closing quote
			tokens.push({ kind: TokKind.Str, value: out, literal: out, pos: start });
			continue;
		}
		if (ch >= "0" && ch <= "9") {
			const start = i;
			while (i < n && /[0-9.]/.test(src[i] ?? "")) i++;
			const text = src.slice(start, i);
			const num = Number(text);
			if (!Number.isFinite(num)) throw new ExpressionError(`invalid number "${text}"`);
			tokens.push({ kind: TokKind.Num, value: text, literal: num, pos: start });
			continue;
		}
		if (IDENT_START.test(ch)) {
			const start = i;
			while (i < n && IDENT_PART.test(src[i] ?? "")) i++;
			tokens.push({ kind: TokKind.Ident, value: src.slice(start, i), pos: start });
			continue;
		}
		const three = src.slice(i, i + 3);
		const two = src.slice(i, i + 2);
		const op = OPERATORS.includes(three) ? three : OPERATORS.includes(two) ? two : ch;
		if (OPERATORS.includes(op)) {
			tokens.push({ kind: TokKind.Op, value: op, pos: i });
			i += op.length;
			continue;
		}
		if (PUNCT.has(ch)) {
			tokens.push({ kind: TokKind.Punc, value: ch, pos: i });
			i++;
			continue;
		}
		throw new ExpressionError(`unexpected character "${ch}" at ${i}`);
	}
	tokens.push({ kind: TokKind.Eof, value: "", pos: n });
	return tokens;
}

// ─────────────────────────────── AST ───────────────────────────────

type Node =
	| { t: "lit"; v: unknown }
	| { t: "var"; name: string }
	| { t: "unary"; op: string; x: Node }
	| { t: "bin"; op: string; a: Node; b: Node }
	| { t: "logical"; op: "&&" | "||"; a: Node; b: Node }
	| { t: "ternary"; c: Node; a: Node; b: Node }
	| { t: "member"; obj: Node; prop: string }
	| { t: "index"; obj: Node; idx: Node }
	| { t: "call"; name: string; args: Node[] };

const BINARY_PRECEDENCE: Record<string, number> = {
	"==": 2,
	"!=": 2,
	"===": 2,
	"!==": 2,
	"<": 3,
	"<=": 3,
	">": 3,
	">=": 3,
	"+": 4,
	"-": 4,
	"*": 5,
	"/": 5,
	"%": 5,
};

class Parser {
	private pos = 0;
	private depth = 0;
	constructor(private readonly tokens: Token[]) {}

	parse(): Node {
		const node = this.ternary();
		if (this.peek().kind !== TokKind.Eof) {
			throw new ExpressionError(`unexpected "${this.peek().value}"`);
		}
		return node;
	}

	private peek(): Token {
		return this.tokens[this.pos] as Token;
	}
	private next(): Token {
		return this.tokens[this.pos++] as Token;
	}
	private guard(): void {
		if (++this.depth > MAX_DEPTH) throw new ExpressionError("expression too deeply nested");
	}

	private ternary(): Node {
		const c = this.logical(1);
		if (this.peek().kind === TokKind.Op && this.peek().value === "?") {
			this.guard();
			this.next();
			const a = this.ternary();
			this.expectOp(":");
			const b = this.ternary();
			this.depth--;
			return { t: "ternary", c, a, b };
		}
		return c;
	}

	// Precedence-climbing for `||` (1), `&&` (1.5) and the arithmetic/
	// comparison band (>=2). `||`/`&&` build logical nodes (short-circuit).
	private logical(minPrec: number): Node {
		let left = this.binary(2);
		for (;;) {
			const tok = this.peek();
			if (tok.kind !== TokKind.Op) break;
			if (tok.value === "||" && minPrec <= 1) {
				this.guard();
				this.next();
				const right = this.binaryOrLogical(2, 1.5);
				left = { t: "logical", op: "||", a: left, b: right };
				this.depth--;
			} else if (tok.value === "&&" && minPrec <= 1.5) {
				this.guard();
				this.next();
				const right = this.binary(2);
				left = { t: "logical", op: "&&", a: left, b: right };
				this.depth--;
			} else break;
		}
		return left;
	}

	private binaryOrLogical(binMin: number, logMin: number): Node {
		// right operand of `||`: allow `&&` to bind tighter
		let left = this.binary(binMin);
		while (this.peek().kind === TokKind.Op && this.peek().value === "&&" && logMin <= 1.5) {
			this.guard();
			this.next();
			const right = this.binary(binMin);
			left = { t: "logical", op: "&&", a: left, b: right };
			this.depth--;
		}
		return left;
	}

	private binary(minPrec: number): Node {
		let left = this.unary();
		for (;;) {
			const tok = this.peek();
			const prec = tok.kind === TokKind.Op ? BINARY_PRECEDENCE[tok.value] : undefined;
			if (prec === undefined || prec < minPrec) break;
			this.guard();
			this.next();
			const right = this.binary(prec + 1);
			left = { t: "bin", op: tok.value, a: left, b: right };
			this.depth--;
		}
		return left;
	}

	private unary(): Node {
		const tok = this.peek();
		if (tok.kind === TokKind.Op && (tok.value === "!" || tok.value === "-")) {
			this.guard();
			this.next();
			const x = this.unary();
			this.depth--;
			return { t: "unary", op: tok.value, x };
		}
		return this.postfix();
	}

	private postfix(): Node {
		let node = this.primary();
		for (;;) {
			const tok = this.peek();
			if (tok.kind === TokKind.Punc && tok.value === ".") {
				this.next();
				const name = this.next();
				if (name.kind !== TokKind.Ident) throw new ExpressionError("expected property name");
				node = { t: "member", obj: node, prop: name.value };
			} else if (tok.kind === TokKind.Punc && tok.value === "[") {
				this.guard();
				this.next();
				const idx = this.ternary();
				this.expectPunc("]");
				this.depth--;
				node = { t: "index", obj: node, idx };
			} else break;
		}
		return node;
	}

	private primary(): Node {
		const tok = this.next();
		if (tok.kind === TokKind.Num || tok.kind === TokKind.Str) {
			return { t: "lit", v: tok.literal };
		}
		if (tok.kind === TokKind.Ident) {
			if (tok.value === "true") return { t: "lit", v: true };
			if (tok.value === "false") return { t: "lit", v: false };
			if (tok.value === "null") return { t: "lit", v: null };
			if (this.peek().kind === TokKind.Punc && this.peek().value === "(") {
				return this.call(tok.value);
			}
			return { t: "var", name: tok.value };
		}
		if (tok.kind === TokKind.Punc && tok.value === "(") {
			this.guard();
			const node = this.ternary();
			this.expectPunc(")");
			this.depth--;
			return node;
		}
		throw new ExpressionError(`unexpected "${tok.value || "end of input"}"`);
	}

	private call(name: string): Node {
		this.expectPunc("(");
		const args: Node[] = [];
		if (!(this.peek().kind === TokKind.Punc && this.peek().value === ")")) {
			for (;;) {
				args.push(this.ternary());
				if (this.peek().kind === TokKind.Punc && this.peek().value === ",") {
					this.next();
					continue;
				}
				break;
			}
		}
		this.expectPunc(")");
		return { t: "call", name, args };
	}

	private expectOp(value: string): void {
		const tok = this.next();
		if (tok.kind !== TokKind.Op || tok.value !== value) {
			throw new ExpressionError(`expected "${value}"`);
		}
	}
	private expectPunc(value: string): void {
		const tok = this.next();
		if (tok.kind !== TokKind.Punc || tok.value !== value) {
			throw new ExpressionError(`expected "${value}"`);
		}
	}
}

// ─────────────────────────────── eval ───────────────────────────────

function truthy(v: unknown): boolean {
	return Boolean(v);
}

function safeGet(obj: unknown, key: string | number): unknown {
	if (obj === null || obj === undefined) return undefined;
	const k = String(key);
	if (BLOCKED_KEYS.has(k)) return undefined;
	if (typeof obj === "string") {
		const idx = Number(key);
		return Number.isInteger(idx) ? obj[idx] : undefined;
	}
	if (Array.isArray(obj)) {
		const idx = Number(key);
		return Number.isInteger(idx) ? obj[idx] : undefined;
	}
	if (typeof obj === "object") {
		return Object.prototype.hasOwnProperty.call(obj, k)
			? (obj as Record<string, unknown>)[k]
			: undefined;
	}
	return undefined;
}

function toNumber(v: unknown): number {
	if (typeof v === "number") return v;
	if (typeof v === "string" && v.trim() !== "") {
		const n = Number(v);
		if (Number.isFinite(n)) return n;
	}
	if (typeof v === "boolean") return v ? 1 : 0;
	throw new ExpressionError(`cannot use ${JSON.stringify(v)} as a number`);
}

function strictEqual(a: unknown, b: unknown): boolean {
	return a === b;
}

function evalBinary(op: string, a: unknown, b: unknown): unknown {
	switch (op) {
		case "==":
		case "===":
			return strictEqual(a, b);
		case "!=":
		case "!==":
			return !strictEqual(a, b);
		case "+":
			if (typeof a === "string" || typeof b === "string") return `${stringify(a)}${stringify(b)}`;
			return toNumber(a) + toNumber(b);
		case "-":
			return toNumber(a) - toNumber(b);
		case "*":
			return toNumber(a) * toNumber(b);
		case "/":
			return toNumber(a) / toNumber(b);
		case "%":
			return toNumber(a) % toNumber(b);
		case "<":
			return compare(a, b) < 0;
		case "<=":
			return compare(a, b) <= 0;
		case ">":
			return compare(a, b) > 0;
		case ">=":
			return compare(a, b) >= 0;
		default:
			throw new ExpressionError(`unknown operator "${op}"`);
	}
}

function compare(a: unknown, b: unknown): number {
	if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
	const x = toNumber(a);
	const y = toNumber(b);
	return x - y;
}

function stringify(v: unknown): string {
	if (v === null || v === undefined) return "";
	if (typeof v === "object") return JSON.stringify(v);
	return String(v);
}

function evalNode(node: Node, scope: ExprScope, now: number): unknown {
	switch (node.t) {
		case "lit":
			return node.v;
		case "var":
			return safeGet(scope, node.name);
		case "unary": {
			const x = evalNode(node.x, scope, now);
			return node.op === "!" ? !truthy(x) : -toNumber(x);
		}
		case "bin":
			return evalBinary(node.op, evalNode(node.a, scope, now), evalNode(node.b, scope, now));
		case "logical": {
			const a = evalNode(node.a, scope, now);
			if (node.op === "&&") return truthy(a) ? evalNode(node.b, scope, now) : a;
			return truthy(a) ? a : evalNode(node.b, scope, now);
		}
		case "ternary":
			return truthy(evalNode(node.c, scope, now))
				? evalNode(node.a, scope, now)
				: evalNode(node.b, scope, now);
		case "member":
			return safeGet(evalNode(node.obj, scope, now), node.prop);
		case "index":
			return safeGet(evalNode(node.obj, scope, now), asKey(evalNode(node.idx, scope, now)));
		case "call":
			return callBuiltin(
				node.name,
				node.args.map((a) => evalNode(a, scope, now)),
				now,
			);
	}
}

function asKey(v: unknown): string | number {
	return typeof v === "number" ? v : String(v);
}

// ───────────────────────────── built-ins ─────────────────────────────

function callBuiltin(name: string, args: unknown[], now: number): unknown {
	switch (name) {
		case "len": {
			const v = args[0];
			if (typeof v === "string" || Array.isArray(v)) return v.length;
			return 0;
		}
		case "lower":
			return stringify(args[0]).toLowerCase();
		case "upper":
			return stringify(args[0]).toUpperCase();
		case "trim":
			return stringify(args[0]).trim();
		case "contains": {
			const hay = args[0];
			if (Array.isArray(hay)) return hay.some((x) => strictEqual(x, args[1]));
			return stringify(hay).includes(stringify(args[1]));
		}
		case "startsWith":
			return stringify(args[0]).startsWith(stringify(args[1]));
		case "endsWith":
			return stringify(args[0]).endsWith(stringify(args[1]));
		case "replace":
			return stringify(args[0]).split(stringify(args[1])).join(stringify(args[2]));
		case "split":
			return stringify(args[0]).split(stringify(args[1]));
		case "join":
			return Array.isArray(args[0]) ? args[0].map(stringify).join(stringify(args[1])) : "";
		case "number": {
			try {
				return toNumber(args[0]);
			} catch {
				return null;
			}
		}
		case "string":
			return stringify(args[0]);
		case "bool":
			return truthy(args[0]);
		case "round": {
			const d = args[1] === undefined ? 0 : toNumber(args[1]);
			const f = 10 ** d;
			return Math.round(toNumber(args[0]) * f) / f;
		}
		case "floor":
			return Math.floor(toNumber(args[0]));
		case "ceil":
			return Math.ceil(toNumber(args[0]));
		case "abs":
			return Math.abs(toNumber(args[0]));
		case "min":
			return Math.min(...args.map(toNumber));
		case "max":
			return Math.max(...args.map(toNumber));
		case "concat":
			return args.map(stringify).join("");
		case "coalesce":
			return args.find((a) => a !== null && a !== undefined) ?? null;
		case "now":
			return now;
		default:
			throw new ExpressionError(`unknown function "${name}"`);
	}
}

/**
 * Evaluate `source` against `scope`. Throws {@link ExpressionError} on a
 * parse error, an unknown function, or a type misuse; the caller (the
 * `Code` interpreter) maps that to a failed step.
 */
export function evaluateExpression(
	source: string,
	scope: ExprScope = {},
	options: EvaluateOptions = {},
): unknown {
	if (source.length > MAX_SOURCE_LENGTH) {
		throw new ExpressionError("expression too long");
	}
	const ast = new Parser(tokenize(source)).parse();
	const now = options.now ?? Date.now();
	return evalNode(ast, scope, now);
}
