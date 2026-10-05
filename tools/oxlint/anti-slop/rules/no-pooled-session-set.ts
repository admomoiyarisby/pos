import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * Session-level SET statements that must never run on a pooled connection.
 *
 * `DATABASE_URL` is Supabase's shared transaction-mode pooler (port 6543). It
 * keeps a backend connection between transactions and does not reset session
 * state on checkout, so a session-level SET survives the client that issued it
 * and is inherited by whoever draws that backend next. Measured pool width for
 * this project was 1, so the blast radius is every write in the app.
 *
 * `SET default_transaction_read_only = on` in particular took the POS down
 * completely: order creation and the verified toggle both failed with SQLSTATE
 * 25006 while reads kept working.
 *
 * Transaction-scoped forms are fine and are not reported: `BEGIN READ ONLY`,
 * `SET TRANSACTION ...`, and `SET LOCAL ...` all end with the transaction.
 */

type StringLiteralLike = ESTree.Literal | ESTree.TemplateLiteral;

/** Statements that set session state on the connection rather than the transaction. */
const BANNED_PREFIXES = [
  "SET default_transaction_read_only",
  "SET SESSION CHARACTERISTICS",
  "SET TRANSACTION READ ONLY",
  "SET SESSION",
];

function isStringLiteralLike(node: ESTree.Node): node is StringLiteralLike {
  return node.type === "Literal" || node.type === "TemplateLiteral";
}

/**
 * The static text of a literal, or null when it is built from an interpolation.
 *
 * A template with a hole in the first line is not reportable: the prefix could
 * come from either side, and guessing would flag `sql`SET ${mode}`` as either a
 * violation or not depending on a runtime value.
 */
function staticTextOf(node: StringLiteralLike): string | null {
  if (node.type === "Literal") {
    return typeof node.value === "string" ? node.value : null;
  }
  if (node.quasis.length === 1 && node.expressions.length === 0) {
    return node.quasis[0].value.cooked ?? null;
  }
  return null;
}

/** The statement a query-ish call is about to run, if it is statically known. */
function statementOf(node: ESTree.Node): string | null {
  if (isStringLiteralLike(node)) return staticTextOf(node);
  if (node.type === "TemplateLiteral") return staticTextOf(node);
  return null;
}

function bannedStatement(text: string | null): string | null {
  if (text === null) return null;
  // Only the leading statement matters: `query` runs one string, and a leading
  // `SET` is the whole hazard. Leading comments are skipped so a documented
  // `-- why this is safe` header does not hide the statement after it.
  const firstStatement = text
    .split("\n")
    .map((line) => line.replace(/^\s*--.*$/, ""))
    .join("\n")
    .trimStart()
    .replace(/;\s*$/, "")
    .trimStart();
  const normalized = firstStatement.replace(/\s+/g, " ").toLowerCase();
  for (const prefix of BANNED_PREFIXES) {
    if (normalized.startsWith(`${prefix.toLowerCase()} `) || normalized === prefix.toLowerCase()) {
      return firstStatement;
    }
  }
  return null;
}

/**
 * Disallow session-level SET statements on pooled connections.
 *
 * Catches `client.query("SET ...")`, `db.execute("SET ...")`, and the tagged
 * `sql` templates drizzle uses, in both single-quoted and backtick forms.
 */
export const noPooledSessionSetRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow session-level SET statements on pooled connections; scope read-only and other settings to the transaction instead.",
    },
    messages: {
      pooledSessionSet:
        "`{{statement}}` sets session state, which transaction-mode pooling does not reset when the connection returns to the pool — it stays on the backend and breaks later writes for every client. Use `BEGIN READ ONLY` / `SET TRANSACTION` / `SET LOCAL`, or connect in session mode (port 5432) for scripts.",
    },
    schema: [],
  },
  createOnce(context) {
    const report = (node: ESTree.Node, statement: string) => {
      context.report({ node, messageId: "pooledSessionSet", data: { statement } });
    };

    return {
      // client.query("...") / db.execute("...") / sql`...`
      CallExpression(node) {
        if (node.arguments.length === 0) return;
        const statement = bannedStatement(statementOf(node.arguments[0]));
        if (statement !== null) report(node, statement);
      },
      // sql`SET ...` — drizzle's tagged template has no call to inspect.
      TaggedTemplateExpression(node) {
        const tag = node.tag;
        if (tag.type !== "Identifier" || tag.name !== "sql") return;
        const statement = bannedStatement(statementOf(node.quasi));
        if (statement !== null) report(node, statement);
      },
    };
  },
});