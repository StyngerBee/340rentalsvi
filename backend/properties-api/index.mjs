// index.mjs — Properties API with JWT verification inside Lambda (no API GW authorizer required)

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import * as jose from "jose";

// ===== ENV =====
const REGION = process.env.REGION || "us-east-2";
const TABLE = process.env.TABLE || "Properties";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";
const USER_POOL_ID = process.env.USER_POOL_ID || "us-east-2_XvJeUUAyn";         // <-- set in Lambda env
const APP_CLIENT_ID = process.env.APP_CLIENT_ID || "7jt9bgu03in136n5d50l893j6t"; // <-- set in Lambda env

// ===== AWS Clients =====
const ddbClient = new DynamoDBClient({ region: REGION });
const doc = DynamoDBDocumentClient.from(ddbClient);

// ===== JWT Verify (Cognito ID token) =====
const COGNITO_ISS = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;
const JWKS_URL = `${COGNITO_ISS}/.well-known/jwks.json`;
const JWKS = jose.createRemoteJWKSet(new URL(JWKS_URL));

async function verifyIdToken(authorizationHeader) {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    throw new Error("no_bearer");
  }
  const token = authorizationHeader.slice(7);
  const { payload } = await jose.jwtVerify(token, JWKS, {
    issuer: COGNITO_ISS,
    audience: APP_CLIENT_ID, // match 'aud' in the ID token
  });
  return payload; // contains sub, email, "cognito:groups", etc.
}

// ===== Helpers =====
const corsHeaders = () => ({
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
});

const bad = (code, msg) => ({
  statusCode: code,
  headers: corsHeaders(),
  body: JSON.stringify({ error: msg }),
});

const ok = (code, body) => ({
  statusCode: code,
  headers: corsHeaders(),
  body: body ? JSON.stringify(body) : "",
});

function parseJson(body) {
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return null;
  }
}

function pathId(path) {
  const m = path.match(/\/properties\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function userIsOwnerOrEditor(claims) {
  const g = claims?.["cognito:groups"];
  if (Array.isArray(g)) return g.includes("owners") || g.includes("editors");
  if (typeof g === "string") return g.split(",").includes("owners") || g.split(",").includes("editors");
  return false;
}

// ===== Handler =====
export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path = event.requestContext?.http?.path || event.path || "/";
  const authz = event.headers?.authorization || event.headers?.Authorization;

  // CORS preflight
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  try {
    // GET /properties  (public)
    if (method === "GET" && path === "/properties") {
      const res = await doc.send(new ScanCommand({ TableName: TABLE }));
      return ok(200, res.Items ?? []);
    }

    // POST /properties  (owners/editors)
    if (method === "POST" && path === "/properties") {
      const claims = await verifyIdToken(authz).catch(() => null);
      if (!userIsOwnerOrEditor(claims)) return bad(401, "unauthorized");

      const body = parseJson(event.body);
      if (!body) return bad(400, "invalid_json");

      const id = crypto.randomUUID();
      const item = {
        id,
        title: body.title ?? "",
        description: body.description ?? "",
        price: Number(body.price ?? 0),
        bedrooms: Number(body.bedrooms ?? 0),
        bathrooms: Number(body.bathrooms ?? 0),
        available: Boolean(body.available ?? false),
        tags: Array.isArray(body.tags) ? body.tags : [],
        photos: Array.isArray(body.photos) ? body.photos : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await doc.send(new PutCommand({ TableName: TABLE, Item: item }));
      return ok(201, item);
    }

    // PUT /properties/{id}  (owners/editors)
    if (method === "PUT" && path.startsWith("/properties/")) {
      const claims = await verifyIdToken(authz).catch(() => null);
      if (!userIsOwnerOrEditor(claims)) return bad(401, "unauthorized");

      const id = pathId(path);
      if (!id) return bad(400, "missing_id");

      const body = parseJson(event.body);
      if (!body) return bad(400, "invalid_json");

      const safeFields = ["title", "description", "price", "bedrooms", "bathrooms", "available", "tags", "photos"];
      const exprNames = {};
      const exprValues = {};
      const sets = [];

      for (const k of safeFields) {
        if (k in body) {
          exprNames["#" + k] = k;
          exprValues[":" + k] = body[k];
          sets.push(`#${k} = :${k}`);
        }
      }
      exprNames["#updatedAt"] = "updatedAt";
      exprValues[":updatedAt"] = new Date().toISOString();
      sets.push("#updatedAt = :updatedAt");

      if (sets.length === 0) return bad(400, "no_fields");

      await doc.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { id },
          UpdateExpression: "SET " + sets.join(", "),
          ExpressionAttributeNames: exprNames,
          ExpressionAttributeValues: exprValues,
          ReturnValues: "ALL_NEW",
        })
      );

      const updated = await doc.send(new GetCommand({ TableName: TABLE, Key: { id } }));
      return ok(200, updated.Item ?? {});
    }

    // DELETE /properties/{id}  (owners/editors)
    if (method === "DELETE" && path.startsWith("/properties/")) {
      const claims = await verifyIdToken(authz).catch(() => null);
      if (!userIsOwnerOrEditor(claims)) return bad(401, "unauthorized");

      const id = pathId(path);
      if (!id) return bad(400, "missing_id");
      await doc.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
      return ok(204);
    }

    return bad(404, "not_found");
  } catch (err) {
    console.error("ERROR", err);
    return bad(500, "server_error");
  }
};
