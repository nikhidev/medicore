import { Router } from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { hashPassword, verifyPassword } from "./db.mjs";

export const fail = (status, message) =>
  Object.assign(new Error(message), { status });
export const hash = (token) => createHash("sha256").update(token).digest("hex");
export const id = () => randomUUID();
export const label = z.string().trim().min(1).max(160);
export const identifier = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/);
export const dateTime = z.iso.datetime({ offset: true });
export const read = async (db, query, params = []) =>
  (await db.query(query, params)).rows;
export const one = async (...args) => (await read(...args))[0];
export const roles = (req, ...allowed) => {
  if (!allowed.includes(req.user.role))
    throw fail(403, "Your role cannot perform this action.");
};
export const audit = (db, req, action, target, outcome = "allowed") =>
  db.query(
    "INSERT INTO audit(actor_id,action,target,outcome,request_id) VALUES ($1,$2,$3,$4,$5)",
    [req.user?.id ?? null, action, target, outcome, req.requestId],
  );

export function authRoutes(db, secure) {
  const router = Router();
  const fallback = hashPassword("invalid");
  const options = { httpOnly: true, sameSite: "strict", secure, path: "/" };
  const credentials = z.object({
    email: z.email().max(160),
    password: z.string().min(1).max(128),
  });
  const session = async (tx, user, previous) => {
    const token = randomBytes(32).toString("hex");
    if (
      previous &&
      !(
        await tx.query(
          "DELETE FROM sessions WHERE token_hash=$1 RETURNING token_hash",
          [previous],
        )
      ).rows.length
    ) {
      throw fail(401, "Session already refreshed or revoked.");
    }
    await tx.query(
      "INSERT INTO sessions VALUES ($1,$2,now()+interval '8 hours')",
      [hash(token), user.id],
    );
    return token;
  };
  router.post("/login", async (req, res) => {
    const { email, password } = credentials.parse(req.body);
    const user = await one(
      db,
      "SELECT id,name,role,email,password FROM users WHERE email=$1",
      [email.toLowerCase()],
    );
    if (!verifyPassword(password, user?.password ?? fallback) || !user)
      throw fail(401, "Invalid email or password.");
    const { password: _, ...profile } = user;
    req.user = profile;
    const token = await db.transaction(async (tx) => {
      if (req.cookies.medicore)
        await tx.query("DELETE FROM sessions WHERE token_hash=$1", [
          hash(req.cookies.medicore),
        ]);
      await audit(tx, req, "session.login", profile.id);
      return session(tx, profile);
    });
    res
      .cookie("medicore", token, { ...options, maxAge: 28800000 })
      .json({ data: profile });
  });
  router.use(async (req, res, next) => {
    const token = req.cookies.medicore;
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      throw fail(401, "Sign in to continue.");
    req.token = hash(token);
    req.user = await one(
      db,
      "SELECT u.id,u.name,u.role,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()",
      [req.token],
    );
    if (!req.user) throw fail(401, "Your session has expired.");
    next();
  });
  router.get("/me", (req, res) => res.json({ data: req.user }));
  router.post("/refresh", async (req, res) => {
    const token = await db.transaction((tx) =>
      session(tx, req.user, req.token),
    );
    res
      .cookie("medicore", token, { ...options, maxAge: 28800000 })
      .json({ data: req.user });
  });
  router.post("/logout", async (req, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [req.token]);
    res.clearCookie("medicore", options).json({ data: true });
  });
  return router;
}
