import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod/v4";
import type { ReadonlyUint8Array } from "@solana/kit";
import type { V2Snapshot, V2Row } from "../../app/src/chain-v2.js";
import type { RentalLock } from "../../app/src/generated-v2/index.js";
import {
  RENTAL_STATUS_V2,
  formatUsdc,
  rentalStatusLabel,
} from "../../app/src/program-v2.js";
import { AuthService } from "./auth.js";
import {
  hasAnyRole,
  resolveRoles,
  type ChainGateway,
  type Roles,
} from "./chain.js";
import type { AppConfig } from "./config.js";
import {
  ApiError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "./errors.js";
import type { MetadataStore } from "./store.js";

export type AppDependencies = {
  config: AppConfig;
  chain: ChainGateway;
  auth: AuthService;
  store: MetadataStore;
  now?: () => number;
};

const ErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  message: z.string(),
});

const TokenSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int().positive(),
  wallet: z.string(),
  roles: z.object({
    guest: z.boolean(),
    merchant: z.boolean(),
    operator: z.boolean(),
    keeper: z.boolean(),
  }),
});

const WalletSchema = z.string().min(32).max(44);
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/i);

const RentalSchema = z.object({
  address: z.string(),
  passport: z.string(),
  owner: z.string(),
  merchant: z.string(),
  depositAccount: z.string(),
  amountRaw: z.string(),
  amountUsdc: z.string(),
  itemId: z.string(),
  status: z.number().int().min(0).max(5),
  statusLabel: z.string(),
  nonce: z.string(),
  startedAt: z.string(),
  dueAt: z.string(),
  returnedAt: z.string(),
  disputedAt: z.string(),
  resolvedAt: z.string(),
  evidenceDigest: z.string(),
  resolutionDigest: z.string(),
  rulesVersion: z.number().int(),
});

const PassportSchema = z.object({
  address: z.string(),
  owner: z.string(),
  activeLock: z.string(),
  nextNonce: z.string(),
  deposits: z.array(
    z.object({
      address: z.string(),
      mint: z.string(),
      availableRaw: z.string(),
      availableUsdc: z.string(),
      lockedRaw: z.string(),
      lockedUsdc: z.string(),
    }),
  ),
});

const EvidenceSchema = z.object({
  id: z.string(),
  rental: z.string(),
  evidenceDigest: z.string(),
  objectKey: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  uploadedBy: z.string(),
  createdAt: z.string(),
});

const NotificationSchema = z.object({
  id: z.string(),
  wallet: z.string(),
  kind: z.enum(["rental", "dispute", "evidence", "system"]),
  title: z.string(),
  body: z.string(),
  rental: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

const hex = (bytes: ReadonlyUint8Array) =>
  [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");

function toRental(row: V2Row<RentalLock>) {
  const data = row.data;
  return {
    address: row.address,
    passport: data.passport,
    owner: data.owner,
    merchant: data.merchant,
    depositAccount: data.depositAccount,
    amountRaw: data.amount.toString(),
    amountUsdc: formatUsdc(data.amount),
    itemId: data.itemId,
    status: data.status,
    statusLabel: rentalStatusLabel(data.status),
    nonce: data.nonce.toString(),
    startedAt: data.startedAt.toString(),
    dueAt: data.dueAt.toString(),
    returnedAt: data.returnedAt.toString(),
    disputedAt: data.disputedAt.toString(),
    resolvedAt: data.resolvedAt.toString(),
    evidenceDigest: hex(data.evidenceDigest),
    resolutionDigest: hex(data.resolutionDigest),
    rulesVersion: data.rulesVersion,
  };
}

function bearerToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw new UnauthorizedError();
  return token;
}

function walletMerchantAddresses(wallet: string, snapshot: V2Snapshot): Set<string> {
  return new Set(
    snapshot.merchants
      .filter((row) => row.data.authority === wallet)
      .map((row) => row.address),
  );
}

function visibleRentals(
  wallet: string,
  roles: Roles,
  snapshot: V2Snapshot,
) {
  if (roles.operator) return snapshot.rentals;
  const merchantAddresses = walletMerchantAddresses(wallet, snapshot);
  return snapshot.rentals.filter(
    (row) =>
      (roles.guest && row.data.owner === wallet) ||
      (roles.merchant && merchantAddresses.has(row.data.merchant)) ||
      roles.keeper,
  );
}

function visiblePassports(
  wallet: string,
  roles: Roles,
  snapshot: V2Snapshot,
) {
  if (roles.operator) return snapshot.passports;
  if (!roles.guest) return [];
  return snapshot.passports.filter((row) => row.data.owner === wallet);
}

function requireAnyRole(roles: Roles): void {
  if (!hasAnyRole(roles)) {
    throw new ForbiddenError(
      "This wallet has no active participant role on chain.",
    );
  }
}

export async function buildApp(
  dependencies: AppDependencies,
): Promise<FastifyInstance> {
  const { config, chain, auth, store } = dependencies;
  const now = dependencies.now ?? Date.now;
  const app = Fastify({
    logger: config.NODE_ENV !== "test",
    trustProxy: true,
    bodyLimit: 1_048_576,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Shared Deposit API",
        description:
          "Chain-authoritative rental API. Evidence bodies are private; this service stores metadata and digests only.",
        version: "0.1.0",
      },
      servers: [{ url: `http://${config.HOST}:${config.PORT}` }],
      tags: [
        { name: "auth", description: "Wallet authentication and sessions" },
        { name: "chain", description: "Chain-authoritative participant data" },
        { name: "evidence", description: "Private dispute evidence metadata" },
        { name: "notifications", description: "Participant notifications" },
        { name: "system", description: "Service health and contract" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    staticCSP: true,
  });

  const routes = app.withTypeProvider<ZodTypeProvider>();

  const authenticate = async (request: FastifyRequest) => {
    const wallet = await auth.verifyAccessToken(bearerToken(request));
    const snapshot = await chain.load();
    const roles = await resolveRoles(
      wallet,
      snapshot,
      config.KEEPER_ALLOWLIST,
    );
    requireAnyRole(roles);
    return { wallet, snapshot, roles };
  };

  routes.route({
    method: "GET",
    url: "/v1/health",
    schema: {
      tags: ["system"],
      summary: "Liveness and runtime safety policy",
      response: {
        200: z.object({
          status: z.literal("ok"),
          service: z.literal("shared-deposit-api"),
          cluster: z.string(),
          program: z.string(),
          timestamp: z.string(),
          chainSource: z.string().nullable(),
          evidenceStorage: z.literal("metadata-only"),
        }),
      },
    },
    handler: async () => ({
      status: "ok" as const,
      service: "shared-deposit-api" as const,
      cluster: config.SOLANA_CLUSTER,
      program: "BZnWbeR8y5C7WWWLatmmEmcbL2rXqMka5jTV2XsikdCM",
      timestamp: new Date(now()).toISOString(),
      chainSource: chain.lastSource(),
      evidenceStorage: "metadata-only" as const,
    }),
  });

  routes.route({
    method: "POST",
    url: "/v1/auth/challenge",
    schema: {
      tags: ["auth"],
      summary: "Create a one-time Sign-In With Solana challenge",
      body: z.object({ wallet: WalletSchema }),
      response: {
        201: z.object({
          challengeId: z.string(),
          wallet: z.string(),
          message: z.string(),
          nonce: z.string(),
          expiresAt: z.string(),
        }),
        400: ErrorSchema,
        401: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      const challenge = await auth.challenge(request.body.wallet);
      return reply.code(201).send(challenge);
    },
  });

  routes.route({
    method: "POST",
    url: "/v1/auth/verify",
    schema: {
      tags: ["auth"],
      summary: "Verify the wallet signature and issue rotating tokens",
      body: z.object({
        challengeId: z.string().uuid(),
        wallet: WalletSchema,
        signature: z.string().min(64).max(128),
      }),
      response: {
        200: TokenSchema,
        400: ErrorSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
    },
    handler: async (request) => {
      await auth.consumeChallenge(request.body);
      const snapshot = await chain.load();
      const roles = await resolveRoles(
        request.body.wallet,
        snapshot,
        config.KEEPER_ALLOWLIST,
      );
      requireAnyRole(roles);
      const tokens = await auth.issueTokens(request.body.wallet);
      await store.audit({
        actor: request.body.wallet,
        action: "auth.login",
        subject: request.body.wallet,
      });
      return {
        ...tokens,
        tokenType: "Bearer" as const,
        wallet: request.body.wallet,
        roles,
      };
    },
  });

  routes.route({
    method: "POST",
    url: "/v1/auth/refresh",
    schema: {
      tags: ["auth"],
      summary: "Rotate an opaque refresh token",
      body: z.object({ refreshToken: z.string().min(32) }),
      response: {
        200: TokenSchema,
        400: ErrorSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
    },
    handler: async (request) => {
      const tokens = await auth.rotateRefresh(request.body.refreshToken);
      const wallet = await auth.verifyAccessToken(tokens.accessToken);
      const snapshot = await chain.load();
      const roles = await resolveRoles(
        wallet,
        snapshot,
        config.KEEPER_ALLOWLIST,
      );
      requireAnyRole(roles);
      return {
        ...tokens,
        tokenType: "Bearer" as const,
        wallet,
        roles,
      };
    },
  });

  routes.route({
    method: "POST",
    url: "/v1/auth/logout",
    schema: {
      tags: ["auth"],
      summary: "Revoke the refresh-token family",
      body: z.object({ refreshToken: z.string().min(32) }),
      response: {
        204: z.null(),
        400: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      await auth.logout(request.body.refreshToken);
      return reply.code(204).send(null);
    },
  });

  routes.route({
    method: "GET",
    url: "/v1/me",
    schema: {
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      summary: "Return chain-derived roles for the access-token wallet",
      response: {
        200: z.object({
          wallet: z.string(),
          roles: TokenSchema.shape.roles,
          activeRental: z.string().nullable(),
          passport: z.string().nullable(),
          cluster: z.string(),
          chainSlot: z.string(),
        }),
        401: ErrorSchema,
        403: ErrorSchema,
        503: ErrorSchema,
      },
    },
    handler: async (request) => {
      const { wallet, roles, snapshot } = await authenticate(request);
      const passport = snapshot.passports.find(
        (row) => row.data.owner === wallet,
      );
      const rental = snapshot.rentals.find(
        (row) =>
          row.data.status === RENTAL_STATUS_V2.ACTIVE &&
          (row.data.owner === wallet ||
            walletMerchantAddresses(wallet, snapshot).has(row.data.merchant)),
      );
      return {
        wallet,
        roles,
        activeRental: rental?.address ?? null,
        passport: passport?.address ?? null,
        cluster: config.SOLANA_CLUSTER,
        chainSlot: snapshot.slot.toString(),
      };
    },
  });

  routes.route({
    method: "GET",
    url: "/v1/passports",
    schema: {
      tags: ["chain"],
      security: [{ bearerAuth: [] }],
      summary: "List passports visible to the authenticated role",
      response: {
        200: z.object({
          slot: z.string(),
          passports: z.array(PassportSchema),
        }),
        401: ErrorSchema,
        403: ErrorSchema,
        503: ErrorSchema,
      },
    },
    handler: async (request) => {
      const { wallet, roles, snapshot } = await authenticate(request);
      const passports = visiblePassports(wallet, roles, snapshot).map((row) => ({
        address: row.address,
        owner: row.data.owner,
        activeLock: row.data.activeLock,
        nextNonce: row.data.nextNonce.toString(),
        deposits: snapshot.deposits
          .filter((deposit) => deposit.data.passport === row.address)
          .map((deposit) => ({
            address: deposit.address,
            mint: deposit.data.mint,
            availableRaw: deposit.data.available.toString(),
            availableUsdc: formatUsdc(deposit.data.available),
            lockedRaw: deposit.data.locked.toString(),
            lockedUsdc: formatUsdc(deposit.data.locked),
          })),
      }));
      return { slot: snapshot.slot.toString(), passports };
    },
  });

  routes.route({
    method: "GET",
    url: "/v1/rentals",
    schema: {
      tags: ["chain"],
      security: [{ bearerAuth: [] }],
      summary: "List rentals visible to the authenticated role",
      querystring: z.object({
        status: z
          .enum([
            "ACTIVE",
            "RETURNED",
            "DISPUTED",
            "RELEASED_TO_GUEST",
            "PAID_TO_MERCHANT",
            "TIMED_OUT",
          ])
          .optional(),
      }),
      response: {
        200: z.object({
          slot: z.string(),
          blockTime: z.string(),
          rentals: z.array(RentalSchema),
        }),
        401: ErrorSchema,
        403: ErrorSchema,
        503: ErrorSchema,
      },
    },
    handler: async (request) => {
      const { wallet, roles, snapshot } = await authenticate(request);
      let rows = visibleRentals(wallet, roles, snapshot);
      if (request.query.status) {
        const requestedStatus =
          RENTAL_STATUS_V2[
            request.query.status as keyof typeof RENTAL_STATUS_V2
          ];
        rows = rows.filter((row) => row.data.status === requestedStatus);
      }
      return {
        slot: snapshot.slot.toString(),
        blockTime: snapshot.timestamp.toString(),
        rentals: rows.map(toRental),
      };
    },
  });

  routes.route({
    method: "GET",
    url: "/v1/disputes",
    schema: {
      tags: ["chain"],
      security: [{ bearerAuth: [] }],
      summary: "List open disputes visible to the authenticated role",
      response: {
        200: z.object({
          slot: z.string(),
          disputes: z.array(RentalSchema),
        }),
        401: ErrorSchema,
        403: ErrorSchema,
        503: ErrorSchema,
      },
    },
    handler: async (request) => {
      const { wallet, roles, snapshot } = await authenticate(request);
      return {
        slot: snapshot.slot.toString(),
        disputes: visibleRentals(wallet, roles, snapshot)
          .filter((row) => row.data.status === RENTAL_STATUS_V2.DISPUTED)
          .map(toRental),
      };
    },
  });

  routes.route({
    method: "GET",
    url: "/v1/evidence/rentals/:rental",
    schema: {
      tags: ["evidence"],
      security: [{ bearerAuth: [] }],
      summary: "List private evidence metadata for a visible rental",
      params: z.object({ rental: WalletSchema }),
      response: {
        200: z.object({
          rental: z.string(),
          evidence: z.array(EvidenceSchema),
        }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        503: ErrorSchema,
      },
    },
    handler: async (request) => {
      const { wallet, roles, snapshot } = await authenticate(request);
      const rental = visibleRentals(wallet, roles, snapshot).find(
        (row) => row.address === request.params.rental,
      );
      if (!rental) throw new NotFoundError("The rental was not found.");
      return {
        rental: rental.address,
        evidence: await store.evidenceByRental(rental.address),
      };
    },
  });

  routes.route({
    method: "POST",
    url: "/v1/evidence",
    schema: {
      tags: ["evidence"],
      security: [{ bearerAuth: [] }],
      summary:
        "Register metadata after an evidence object is accepted by private storage",
      body: z.object({
        rental: WalletSchema,
        evidenceDigest: DigestSchema,
        objectKey: z
          .string()
          .min(1)
          .max(300)
          .refine(
            (value) => !value.includes("..") && !value.startsWith("/"),
            "Object key must be a private relative path.",
          ),
        contentType: z.enum([
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf",
        ]),
        sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
      }),
      response: {
        201: EvidenceSchema,
        400: ErrorSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        503: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      const { wallet, roles, snapshot } = await authenticate(request);
      const rental = visibleRentals(wallet, roles, snapshot).find(
        (row) => row.address === request.body.rental,
      );
      if (!rental) throw new NotFoundError("The rental was not found.");
      const evidence = await store.addEvidence({
        ...request.body,
        evidenceDigest: request.body.evidenceDigest.toLowerCase(),
        uploadedBy: wallet,
      });
      await store.audit({
        actor: wallet,
        action: "evidence.registered",
        subject: rental.address,
      });
      return reply.code(201).send(evidence);
    },
  });

  routes.route({
    method: "GET",
    url: "/v1/notifications",
    schema: {
      tags: ["notifications"],
      security: [{ bearerAuth: [] }],
      summary: "List notifications for the authenticated wallet",
      response: {
        200: z.object({
          notifications: z.array(NotificationSchema),
        }),
        401: ErrorSchema,
        403: ErrorSchema,
        503: ErrorSchema,
      },
    },
    handler: async (request) => {
      const { wallet } = await authenticate(request);
      return { notifications: await store.notifications(wallet) };
    },
  });

  routes.route({
    method: "POST",
    url: "/v1/notifications/:id/read",
    schema: {
      tags: ["notifications"],
      security: [{ bearerAuth: [] }],
      summary: "Mark a recipient notification as read",
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: NotificationSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        503: ErrorSchema,
      },
    },
    handler: async (request) => {
      const { wallet } = await authenticate(request);
      const record = await store.markNotificationRead(
        wallet,
        request.params.id,
      );
      if (!record) throw new NotFoundError("The notification was not found.");
      return record;
    },
  });

  app.get("/documentation/json", async () => app.swagger());

  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message: "The request does not match the API schema.",
      });
    }
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: error.statusCode >= 500 ? "Service Unavailable" : "Request Error",
        code: error.code,
        message: error.message,
      });
    }
    request.log.error({ err: error }, "Unhandled API error");
    return reply.code(500).send({
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  });

  return app;
}
