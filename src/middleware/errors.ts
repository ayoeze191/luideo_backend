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
    res.status(400).json({
      error: {
        message: "Some fields need another look.",
        code: "VALIDATION",
        fields: z.flattenError(err).fieldErrors,
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
