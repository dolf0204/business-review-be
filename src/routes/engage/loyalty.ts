import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { ownedBusiness } from '../../lib/auth/access.js';
import {
  cardFate,
  cardView,
  DEFAULT_RADIUS_METERS,
  distanceMeters,
  isNearEnough,
  isStaffCode,
  MAX_CARD_VALID_DAYS,
  MAX_PROGRAMS_PER_BUSINESS,
  periodsOverlap,
  pickProgram,
  staffCode,
  utcDay,
  windowState,
} from '../../lib/engage/loyalty.js';
import { idParam } from '../../schemas.js';
import { guestOf } from '../public/guests.js';
import { isLive } from '../../lib/business/live.js';

const code = z.string().min(4).max(32);
const date = z.coerce.date().nullable().optional();
const actionParams = z.object({ id: z.uuid(), actionId: z.uuid() });
const CARRY_OVERS = ['RESET', 'TRANSFER'] as const;
const programBody = z.object({
  enabled: z.boolean(),
  goal: z.number().int().min(2).max(50),
  rewardText: z.string().trim().min(1).max(100),
  startsAt: date,
  endsAt: date,
  cardValidDays: z
    .number()
    .int()
    .min(1)
    .max(MAX_CARD_VALID_DAYS)
    .nullable()
    .optional(),
  carryOver: z.enum(CARRY_OVERS).optional(),
});
const endBody = z.object({
  carryOver: z.enum(CARRY_OVERS),
  next: programBody.omit({ startsAt: true }).optional(),
});
type ProgramBody = z.infer<typeof programBody>;
const BLANK_PROGRAM = {
  enabled: false,
  goal: 10,
  rewardText: '',
  startsAt: null,
  endsAt: null,
  cardValidDays: null,
  radiusMeters: DEFAULT_RADIUS_METERS,
  carryOver: 'RESET',
};
// Trying staff codes is the only thing worth guessing here, so it is limited per guest (or per address when not signed in).
const guessLimit = {
  rateLimit: {
    max: 10,
    timeWindow: '10 minutes',
    keyGenerator: (req: FastifyRequest) => req.cookies?.guest ?? req.ip,
  },
};

export async function loyaltyRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { onRequest: [app.authenticate] };
  const today = () => utcDay(new Date());

  // ---- the business owner ----
  const periodsOf = (businessId: string) =>
    prisma.loyaltyProgram.findMany({
      where: { businessId },
      orderBy: { startsAt: { sort: 'asc', nulls: 'first' } },
    });

  /** Why a period cannot be saved (with the HTTP status), or null. `others` are the business's other periods. */
  function refusal(
    business: { lat: number | null; lng: number | null },
    body: ProgramBody,
    others: { startsAt: Date | null; endsAt: Date | null }[],
  ) {
    const { startsAt = null, endsAt = null } = body;
    if (startsAt && endsAt && endsAt <= startsAt)
      return { status: 422, error: 'invalid_period' };
    // The location check needs to know where the business is, which comes from the Google connection.
    if (body.enabled && (business.lat === null || business.lng === null))
      return { status: 422, error: 'google_not_connected' };
    if (others.some((o) => periodsOverlap({ startsAt, endsAt }, o)))
      return { status: 409, error: 'period_overlaps' };
    return null;
  }

  const dataOf = ({
    startsAt = null,
    endsAt = null,
    ...rest
  }: ProgramBody) => ({ ...rest, startsAt, endsAt });

  r.get(
    '/businesses/:id/loyalty',
    { ...auth, schema: { params: idParam } },
    async (req, reply) => {
      const b = await ownedBusiness(req.user.sub, req.params.id);
      if (!b) return reply.code(404).send({ error: 'not_found' });
      const programs = await periodsOf(b.id);
      return {
        program: pickProgram(programs, new Date()) ?? BLANK_PROGRAM,
        programs,
        // The code staff show to guests who cannot share a location, and enter to redeem a reward. It changes every day.
        staffCode: staffCode(b.id, today(), config.JWT_SECRET),
      };
    },
  );

  r.put(
    '/businesses/:id/loyalty',
    { ...auth, schema: { params: idParam, body: programBody } },
    async (req, reply) => {
      const b = await ownedBusiness(req.user.sub, req.params.id);
      if (!b) return reply.code(404).send({ error: 'not_found' });
      const programs = await periodsOf(b.id);
      const target = pickProgram(programs, new Date());
      const refused = refusal(
        b,
        req.body,
        programs.filter((p) => p.id !== target?.id),
      );
      if (refused)
        return reply.code(refused.status).send({ error: refused.error });
      const data = dataOf(req.body);
      return target
        ? prisma.loyaltyProgram.update({ where: { id: target.id }, data })
        : prisma.loyaltyProgram.create({ data: { businessId: b.id, ...data } });
    },
  );

  r.post(
    '/businesses/:id/loyalty/actions',
    { ...auth, schema: { params: idParam, body: programBody } },
    async (req, reply) => {
      const b = await ownedBusiness(req.user.sub, req.params.id);
      if (!b) return reply.code(404).send({ error: 'not_found' });
      const programs = await periodsOf(b.id);
      if (programs.length >= MAX_PROGRAMS_PER_BUSINESS)
        return reply.code(409).send({ error: 'too_many_actions' });
      const refused = refusal(b, req.body, programs);
      if (refused)
        return reply.code(refused.status).send({ error: refused.error });
      return reply
        .code(201)
        .send(
          await prisma.loyaltyProgram.create({
            data: { businessId: b.id, ...dataOf(req.body) },
          }),
        );
    },
  );

  r.put(
    '/businesses/:id/loyalty/actions/:actionId',
    { ...auth, schema: { params: actionParams, body: programBody } },
    async (req, reply) => {
      const b = await ownedBusiness(req.user.sub, req.params.id);
      if (!b) return reply.code(404).send({ error: 'not_found' });
      const programs = await periodsOf(b.id);
      if (!programs.some((p) => p.id === req.params.actionId))
        return reply.code(404).send({ error: 'not_found' });
      const refused = refusal(
        b,
        req.body,
        programs.filter((p) => p.id !== req.params.actionId),
      );
      if (refused)
        return reply.code(refused.status).send({ error: refused.error });
      return prisma.loyaltyProgram.update({
        where: { id: req.params.actionId },
        data: dataOf(req.body),
      });
    },
  );

  r.post(
    '/businesses/:id/loyalty/actions/:actionId/end',
    { ...auth, schema: { params: actionParams, body: endBody } },
    async (req, reply) => {
      const b = await ownedBusiness(req.user.sub, req.params.id);
      if (!b) return reply.code(404).send({ error: 'not_found' });
      const programs = await periodsOf(b.id);
      const running = programs.find((p) => p.id === req.params.actionId);
      if (!running) return reply.code(404).send({ error: 'not_found' });
      const now = new Date();
      if (windowState(running.startsAt, running.endsAt, now) !== 'active')
        return reply.code(409).send({ error: 'action_not_running' });
      const { carryOver, next } = req.body;
      if (!next)
        return {
          ended: await prisma.loyaltyProgram.update({
            where: { id: running.id },
            data: { endsAt: now, carryOver },
          }),
          next: null,
        };
      if (programs.length >= MAX_PROGRAMS_PER_BUSINESS)
        return reply.code(409).send({ error: 'too_many_actions' });
      const refused = refusal(
        b,
        { ...next, startsAt: now },
        programs.filter((p) => p.id !== running.id),
      );
      if (refused)
        return reply.code(refused.status).send({ error: refused.error });
      const [ended, created] = await prisma.$transaction([
        prisma.loyaltyProgram.update({
          where: { id: running.id },
          data: { endsAt: now, carryOver },
        }),
        prisma.loyaltyProgram.create({
          data: { businessId: b.id, ...dataOf({ ...next, startsAt: now }) },
        }),
      ]);
      return reply.code(201).send({ ended, next: created });
    },
  );

  r.delete(
    '/businesses/:id/loyalty/actions/:actionId',
    { ...auth, schema: { params: actionParams } },
    async (req, reply) => {
      const b = await ownedBusiness(req.user.sub, req.params.id);
      if (!b) return reply.code(404).send({ error: 'not_found' });
      const found = await prisma.loyaltyProgram.findFirst({
        where: { id: req.params.actionId, businessId: b.id },
        select: { id: true },
      });
      if (!found) return reply.code(404).send({ error: 'not_found' });
      await prisma.loyaltyProgram.delete({ where: { id: found.id } });
      return reply.code(204).send();
    },
  );

  // ---- the guest ----
  async function context(req: FastifyRequest, businessCode: string) {
    const guest = await guestOf(app, req);
    if (!guest)
      return { ok: false as const, status: 401, error: 'unauthenticated' };
    const business = await prisma.business.findUnique({
      where: { code: businessCode },
      select: {
        id: true,
        publishedAt: true,
        paidUntil: true,
        lat: true,
        lng: true,
        loyaltyPrograms: { where: { enabled: true } },
      },
    });
    if (!business || !isLive(business))
      return { ok: false as const, status: 404, error: 'not_found' };
    const membership = await prisma.membership.findUnique({
      where: {
        guestId_businessId: { guestId: guest.id, businessId: business.id },
      },
      select: { id: true },
    });
    if (!membership)
      return { ok: false as const, status: 403, error: 'not_member' };
    return {
      ok: true as const,
      business,
      membership,
      program: pickProgram(business.loyaltyPrograms, new Date()),
    };
  }

  type Program = NonNullable<
    Awaited<ReturnType<typeof context>> extends infer C
      ? C extends { program: infer P }
        ? P
        : never
      : never
  >;

  const currentCard = (membershipId: string) =>
    prisma.loyaltyCard.findFirst({
      where: { membershipId, redeemedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { punches: true } },
        program: { select: { carryOver: true } },
      },
    });

  type LiveCard = NonNullable<Awaited<ReturnType<typeof liveCard>>>;

  async function liveCard(membershipId: string, program: Program, now: Date) {
    const card = await currentCard(membershipId);
    if (!card) return null;
    const fate = cardFate(card, program.id, card.program);
    if (fate === 'drop') return null;
    const transfer = fate === 'transfer';
    const view = cardView(
      transfer ? { ...card, createdAt: now } : card,
      card._count.punches,
      program,
      now,
    );
    return view.expired ? null : { card, view, transfer };
  }

  async function startCard(membershipId: string, program: Program, now: Date) {
    const created = await prisma.loyaltyCard.create({
      data: {
        membershipId,
        programId: program.id,
        goal: program.goal,
        rewardText: program.rewardText,
      },
    });
    const card = {
      ...created,
      _count: { punches: 0 },
      program: { carryOver: program.carryOver },
    };
    return { card, view: cardView(created, 0, program, now), transfer: false };
  }

  async function settle(
    { card, view, transfer }: LiveCard,
    program: Program,
    now: Date,
  ) {
    const completing = view.complete && card.completedAt === null;
    if (transfer || completing) {
      await prisma.loyaltyCard.update({
        where: { id: card.id },
        data: {
          ...(transfer && { programId: program.id, createdAt: now }),
          ...(completing && {
            goal: view.goal,
            rewardText: view.rewardText,
            completedAt: now,
          }),
        },
      });
    }
    return view.complete;
  }

  async function stateFor(membershipId: string, program: Program) {
    const now = new Date();
    const live = await liveCard(membershipId, program, now);
    const last = await prisma.loyaltyPunch.findFirst({
      where: { membershipId },
      orderBy: { createdAt: 'desc' },
      select: { day: true },
    });
    return {
      program: {
        goal: program.goal,
        rewardText: program.rewardText,
        startsAt: program.startsAt,
        endsAt: program.endsAt,
        cardValidDays: program.cardValidDays,
        window: windowState(program.startsAt, program.endsAt, now),
      },
      card: live && {
        punches: live.card._count.punches,
        goal: live.view.goal,
        rewardText: live.view.rewardText,
        complete: live.view.complete,
        expiresAt: live.view.expiresAt,
      },
      punchedToday: last?.day === today(),
    };
  }

  r.get(
    '/guest/b/:code/loyalty',
    { schema: { params: z.object({ code }) } },
    async (req, reply) => {
      const c = await context(req, req.params.code);
      if (!c.ok) return reply.code(c.status).send({ error: c.error });
      if (!c.program) return { program: null, card: null, punchedToday: false };
      return stateFor(c.membership.id, c.program);
    },
  );

  r.post(
    '/guest/b/:code/loyalty/punch',
    {
      schema: {
        params: z.object({ code }),
        body: z
          .object({
            lat: z.number().min(-90).max(90).optional(),
            lng: z.number().min(-180).max(180).optional(),
            accuracy: z.number().min(0).max(100_000).optional(),
            staffCode: z.string().max(10).optional(),
          })
          .default({}),
      },
      config: guessLimit,
    },
    async (req, reply) => {
      const c = await context(req, req.params.code);
      if (!c.ok) return reply.code(c.status).send({ error: c.error });
      if (!c.program) return reply.code(404).send({ error: 'no_program' });
      const now = new Date();
      if (windowState(c.program.startsAt, c.program.endsAt, now) !== 'active')
        return reply.code(409).send({ error: 'program_not_active' });
      const day = utcDay(now);
      const last = await prisma.loyaltyPunch.findFirst({
        where: { membershipId: c.membership.id },
        orderBy: { createdAt: 'desc' },
        select: { day: true },
      });
      if (last?.day === day)
        return reply.code(409).send({ error: 'already_punched_today' });

      // Proof that the guest is really there: the phone is near the business, or staff gave them today's code.
      const { lat, lng, accuracy } = req.body;
      const havePosition = lat !== undefined && lng !== undefined;
      const meters =
        havePosition && c.business.lat !== null && c.business.lng !== null
          ? distanceMeters(
              { lat, lng },
              { lat: c.business.lat, lng: c.business.lng },
            )
          : null;
      let method: 'LOCATION' | 'STAFF_CODE' | null = null;
      if (
        meters !== null &&
        isNearEnough(meters, c.program.radiusMeters, accuracy)
      )
        method = 'LOCATION';
      else if (
        isStaffCode(req.body.staffCode, c.business.id, day, config.JWT_SECRET)
      )
        method = 'STAFF_CODE';
      if (!method) {
        if (req.body.staffCode)
          return reply.code(403).send({ error: 'wrong_code' });
        return reply
          .code(422)
          .send({ error: havePosition ? 'too_far' : 'location_required' });
      }

      const target =
        (await liveCard(c.membership.id, c.program, now)) ??
        (await startCard(c.membership.id, c.program, now));
      if (await settle(target, c.program, now))
        return reply.code(409).send({ error: 'card_complete' });
      try {
        await prisma.loyaltyPunch.create({
          data: {
            cardId: target.card.id,
            membershipId: c.membership.id,
            day,
            method,
            distanceMeters: meters,
          },
        });
      } catch (err) {
        // Two taps at the same moment: the database lets only one stamp per day through.
        if ((err as { code?: string }).code === 'P2002')
          return reply.code(409).send({ error: 'already_punched_today' });
        throw err;
      }
      if (target.card._count.punches + 1 >= target.view.goal)
        await prisma.loyaltyCard.update({
          where: { id: target.card.id },
          data: {
            completedAt: now,
            goal: target.view.goal,
            rewardText: target.view.rewardText,
          },
        });
      return stateFor(c.membership.id, c.program);
    },
  );

  // Staff redeem a finished card on the guest's phone by entering today's code. The card is then closed and a new one starts at the next stamp.
  r.post(
    '/guest/b/:code/loyalty/redeem',
    {
      schema: {
        params: z.object({ code }),
        body: z.object({ staffCode: z.string().max(10) }),
      },
      config: guessLimit,
    },
    async (req, reply) => {
      const c = await context(req, req.params.code);
      if (!c.ok) return reply.code(c.status).send({ error: c.error });
      if (!c.program) return reply.code(404).send({ error: 'no_program' });
      if (
        !isStaffCode(
          req.body.staffCode,
          c.business.id,
          today(),
          config.JWT_SECRET,
        )
      )
        return reply.code(403).send({ error: 'wrong_code' });
      const now = new Date();
      const live = await liveCard(c.membership.id, c.program, now);
      if (!live?.view.complete)
        return reply.code(409).send({ error: 'nothing_to_redeem' });
      await settle(live, c.program, now);
      await prisma.loyaltyCard.update({
        where: { id: live.card.id },
        data: { redeemedAt: now },
      });
      return stateFor(c.membership.id, c.program);
    },
  );
}
