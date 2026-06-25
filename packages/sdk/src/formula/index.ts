/**
 * Formula engine — a user-defined computed value whose result is an arithmetic
 * expression over an entity's other properties (the Notion/Anytype "Formula"
 * parity feature). Originally the Database app's formula-COLUMN engine (9.12.17);
 * promoted to the SDK so a first-class **formula PROPERTY** can render in any
 * app's grid AND object inspector via the shared property-ui (`FormulaCell`).
 *
 * Pure + framework-free so the grammar is unit-tested without a grid. A consumer
 * compiles an expression once (`compileFormula`) and evaluates it per row /
 * entity against a value resolver. Parse errors surface at compile time; per-row
 * evaluation errors (a non-numeric reference, divide by zero) surface as a typed
 * result the cell renders as an error chip — never a throw.
 *
 * v1 grammar (a deliberate first slice, mirroring rollup-engine-first):
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := factor (('*' | '/') factor)*
 *   factor := NUMBER | REF | '(' expr ')' | '-' factor
 *   REF    := '{' <property key> '}'
 *
 * References are opaque property keys (`{fee} * {quantity}`); the resolver maps
 * a key to the entity's stored value. String functions / conditionals / dates
 * are later slices.
 */

export type FormulaResult =
	| { readonly ok: true; readonly value: number }
	| {
			readonly ok: false;
			readonly error: string;
	  };

/** A property-value resolver for one entity — maps a referenced key to its
 *  stored value (any storage shape; the engine coerces to a number). */
export type FormulaResolver = (key: string) => unknown;

export type CompiledFormula = {
	/** Distinct property keys the expression references (UI / dependency use). */
	readonly refs: readonly string[];
	/** Evaluate against one entity's values. Pure; never throws. */
	evaluate(resolve: FormulaResolver): FormulaResult;
};

export type CompileResult =
	| { readonly ok: true; readonly formula: CompiledFormula }
	| { readonly ok: false; readonly error: string };

// ── Tokenizer ───────────────────────────────────────────────────────────────

enum TokKind {
	Number = "number",
	Ref = "ref",
	Plus = "+",
	Minus = "-",
	Star = "*",
	Slash = "/",
	LParen = "(",
	RParen = ")",
}

type Token =
	| { kind: TokKind.Number; value: number }
	| { kind: TokKind.Ref; key: string }
	| { kind: Exclude<TokKind, TokKind.Number | TokKind.Ref> };

const OPERATOR_TOKENS: Record<string, TokKind> = {
	"+": TokKind.Plus,
	"-": TokKind.Minus,
	"*": TokKind.Star,
	"/": TokKind.Slash,
	"(": TokKind.LParen,
	")": TokKind.RParen,
};

class FormulaSyntaxError extends Error {}

function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < input.length) {
		const ch = input[i] as string;
		if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
			i++;
			continue;
		}
		if (ch === "{") {
			const end = input.indexOf("}", i + 1);
			if (end === -1) throw new FormulaSyntaxError("Unclosed { in reference");
			const key = input.slice(i + 1, end).trim();
			if (key.length === 0) throw new FormulaSyntaxError("Empty {} reference");
			tokens.push({ kind: TokKind.Ref, key });
			i = end + 1;
			continue;
		}
		const op = OPERATOR_TOKENS[ch];
		if (op !== undefined) {
			tokens.push({ kind: op } as Token);
			i++;
			continue;
		}
		if ((ch >= "0" && ch <= "9") || ch === ".") {
			let j = i + 1;
			while (j < input.length) {
				const c = input[j] as string;
				if ((c >= "0" && c <= "9") || c === ".") j++;
				else break;
			}
			const slice = input.slice(i, j);
			const value = Number(slice);
			if (!Number.isFinite(value)) throw new FormulaSyntaxError(`Invalid number "${slice}"`);
			tokens.push({ kind: TokKind.Number, value });
			i = j;
			continue;
		}
		throw new FormulaSyntaxError(`Unexpected character "${ch}"`);
	}
	return tokens;
}

// ── Parser (recursive descent → AST of evaluator thunks) ──────────────────────

type EvalNode = (resolve: FormulaResolver) => number;

/** Sentinel thrown during evaluation; caught + turned into a typed result. */
class FormulaEvalError extends Error {}

/** Coerce a resolved property value to a finite number, or throw eval error. */
function toNumber(key: string, raw: unknown): number {
	if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	if (typeof raw === "string" && raw.trim() !== "") {
		const n = Number(raw);
		if (Number.isFinite(n)) return n;
	}
	throw new FormulaEvalError(`{${key}} is not a number`);
}

class Parser {
	private pos = 0;
	private readonly refs = new Set<string>();
	constructor(private readonly tokens: Token[]) {}

	parse(): { node: EvalNode; refs: string[] } {
		const node = this.expr();
		if (this.pos !== this.tokens.length) throw new FormulaSyntaxError("Unexpected trailing input");
		return { node, refs: [...this.refs] };
	}

	private peek(): Token | undefined {
		return this.tokens[this.pos];
	}

	private expr(): EvalNode {
		let left = this.term();
		for (;;) {
			const t = this.peek();
			if (t?.kind === TokKind.Plus || t?.kind === TokKind.Minus) {
				this.pos++;
				const right = this.term();
				const l = left;
				left = t.kind === TokKind.Plus ? (r) => l(r) + right(r) : (r) => l(r) - right(r);
			} else break;
		}
		return left;
	}

	private term(): EvalNode {
		let left = this.factor();
		for (;;) {
			const t = this.peek();
			if (t?.kind === TokKind.Star || t?.kind === TokKind.Slash) {
				this.pos++;
				const right = this.factor();
				const l = left;
				if (t.kind === TokKind.Star) {
					left = (r) => l(r) * right(r);
				} else {
					left = (r) => {
						const d = right(r);
						if (d === 0) throw new FormulaEvalError("Division by zero");
						return l(r) / d;
					};
				}
			} else break;
		}
		return left;
	}

	private factor(): EvalNode {
		const t = this.peek();
		if (t === undefined) throw new FormulaSyntaxError("Unexpected end of expression");
		if (t.kind === TokKind.Minus) {
			this.pos++;
			const operand = this.factor();
			return (r) => -operand(r);
		}
		if (t.kind === TokKind.Number) {
			this.pos++;
			const v = t.value;
			return () => v;
		}
		if (t.kind === TokKind.Ref) {
			this.pos++;
			const key = t.key;
			this.refs.add(key);
			return (r) => toNumber(key, r(key));
		}
		if (t.kind === TokKind.LParen) {
			this.pos++;
			const inner = this.expr();
			const close = this.peek();
			if (close?.kind !== TokKind.RParen) throw new FormulaSyntaxError("Missing )");
			this.pos++;
			return inner;
		}
		throw new FormulaSyntaxError(`Unexpected "${t.kind}"`);
	}
}

/** Distinct property keys referenced by an expression (without compiling for
 *  evaluation) — tolerant: a malformed expression yields no refs. */
export function formulaReferences(expression: string): string[] {
	try {
		return new Parser(tokenize(expression)).parse().refs;
	} catch {
		return [];
	}
}

/** Hard cap on a formula's source length. The recursive-descent parser recurses
 *  on nesting depth, so a pathological `(((…)))` / `----…` input could blow the
 *  stack; a few KB is far beyond any real formula and makes the bound INTENTIONAL
 *  rather than relying on the broad catch below. Rejected up front, fail-closed. */
export const MAX_FORMULA_LENGTH = 2048;

/**
 * Compile an expression once. Returns the parse error (empty expression, bad
 * syntax) up front; the returned `evaluate` runs per row and reports evaluation
 * errors (non-numeric ref, divide by zero) as a typed result.
 */
export function compileFormula(expression: string): CompileResult {
	if (expression.trim() === "") return { ok: false, error: "Empty formula" };
	if (expression.length > MAX_FORMULA_LENGTH) {
		return { ok: false, error: `Formula is too long (max ${MAX_FORMULA_LENGTH} characters)` };
	}
	let parsed: { node: EvalNode; refs: string[] };
	try {
		parsed = new Parser(tokenize(expression)).parse();
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : "Invalid formula" };
	}
	const { node, refs } = parsed;
	return {
		ok: true,
		formula: {
			refs,
			evaluate(resolve) {
				try {
					const value = node(resolve);
					if (!Number.isFinite(value)) return { ok: false, error: "Result is not finite" };
					return { ok: true, value };
				} catch (e) {
					if (e instanceof FormulaEvalError) return { ok: false, error: e.message };
					return { ok: false, error: "Evaluation failed" };
				}
			},
		},
	};
}

/** One-shot convenience: compile + evaluate. A compile error becomes an
 *  evaluation result so callers handle a single `FormulaResult`. */
export function evaluateFormula(expression: string, resolve: FormulaResolver): FormulaResult {
	const compiled = compileFormula(expression);
	if (!compiled.ok) return { ok: false, error: compiled.error };
	return compiled.formula.evaluate(resolve);
}
