import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client.ts";
import { HttpError } from "../lib/http-error.ts";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { message: "Route not found.", code: "NOT_FOUND" } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code } });
    return;
  }

  if (err instanceof z.ZodError) {
    const fields: Record<string, string[]> = {};
    const lines: string[] = [];
    for (const issue of err.issues) {
      const custom = isCustomMessage(issue);
      const text = custom ? issue.message.replace(/\.$/, "") : describeIssue(issue);
      const key = String(issue.path[0] ?? "");
      (fields[key] ??= []).push(capitalise(text) + ".");
      const label = fieldLabel(issue.path);
      lines.push(!label ? `${capitalise(text)}.` : custom ? `${label}: ${text}.` : `${label} ${text}.`);
    }
    const unique = [...new Set(lines)];
    res.status(400).json({
      error: {
        message: unique.length === 1 ? unique[0] : `Some fields need another look: ${unique.join(" ")}`,
        code: "VALIDATION",
        fields,
      },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: { message: "That already exists.", code: "DUPLICATE" } });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: { message: "Not found.", code: "NOT_FOUND" } });
      return;
    }
  }

  // Malformed JSON bodies from express.json()
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: { message: "Invalid JSON body.", code: "BAD_JSON" } });
    return;
  }

  console.error(err);
  res.status(500).json({ error: { message: "Something went wrong on our side.", code: "INTERNAL" } });
}

/* ------------------------------------------------ validation wording */

/** Names people see instead of the API's field keys. */
const LABELS: Record<string, string> = {
  madeToOrderDays: "Made-to-order days",
  compareAt: "Compare-at price",
  sku: "SKU",
  photo: "Photo",
  ngn: "(NGN)",
  usd: "(USD)",
};

/** ["price", "ngn"] → "Price (NGN)"; ["finishes", 0, "label"] → "Finishes 1 label". */
function fieldLabel(path: PropertyKey[]): string {
  const words = path.map((p) => {
    if (typeof p === "number") return String(p + 1);
    const key = String(p);
    return LABELS[key] ?? key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  });
  return capitalise(words.join(" "));
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Messages written in the schemas themselves are already readable; Zod's defaults aren't. */
const isCustomMessage = (issue: z.core.$ZodIssue) => !/^(Invalid|Too (big|small)|Unrecognized)/.test(issue.message);

/** A short predicate, e.g. "must be 365 or less", to follow the field's name. */
function describeIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      if (/received (undefined|null)/.test(issue.message)) return "is required";
      return issue.expected === "number" ? "must be a number" : `must be a ${issue.expected}`;
    case "too_big": {
      const max = Number(issue.maximum);
      if (issue.origin === "string") return `must be ${max} characters or fewer`;
      if (issue.origin === "array") return `can have at most ${max} items`;
      return issue.inclusive === false ? `must be less than ${max}` : `must be ${max} or less`;
    }
    case "too_small": {
      const min = Number(issue.minimum);
      if (issue.origin === "string") return min <= 1 ? "is required" : `must be at least ${min} characters`;
      if (issue.origin === "array") return min <= 1 ? "needs at least one item" : `needs at least ${min} items`;
      return issue.inclusive === false ? `must be more than ${min}` : `must be ${min} or more`;
    }
    case "invalid_value":
      return `must be one of: ${issue.values.map(String).join(", ")}`;
    case "invalid_format":
      if (issue.format === "email") return "must be a valid email address";
      if (issue.format === "url") return "must be a valid link";
      return "isn't in the right format";
    case "unrecognized_keys":
      return `has unexpected fields: ${issue.keys.join(", ")}`;
    default:
      return "isn't valid";
  }
}
