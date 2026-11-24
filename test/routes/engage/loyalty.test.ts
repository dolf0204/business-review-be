import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../src/lib/auth/sessionCookie.js';

const db = vi.hoisted(() => ({
  business: { findFirst: vi.fn(), findUnique: vi.fn() },
  guest: { findUnique: vi.fn() },
  membership: { findUnique: vi.fn() },
  loyaltyProgram: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  loyaltyCard: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  loyaltyPunch: { findFirst: vi.fn(), create: vi.fn() },
}));
vi.mock('../../../src/db.js', () => ({ prisma: db }));

import { buildApp } from '../../../src/app.js';
import { config } from '../../../src/config.js';
import {
  cardExpiry,
  cardFate,
  cardView,
  isNearEnough,
  isStaffCode,
  MAX_PROGRAMS_PER_BUSINESS,
  periodsOverlap,
  pickProgram,
  staffCode,
  utcDay,
  windowState,
} from '../../../src/lib/engage/loyalty.js';

const B = '11111111-1111-4111-8111-111111111111';
const TODAY = utcDay(new Date());
const DAY_MS = 86_400_000;

describe('loyalty rules', () => {
  it('makes a six digit code that differs per business and per day, and checks it', () => {
    const code = staffCode(B, '2026-06-01', 'secret-secret-secret-secret-1234');
    expect(code).toMatch(/^\d{6}$/);
    expect(
      staffCode(B, '2026-06-02', 'secret-secret-secret-secret-1234'),
    ).not.toBe(code);
    expect(
      staffCode('other', '2026-06-01', 'secret-secret-secret-secret-1234'),
    ).not.toBe(code);
    expect(
      isStaffCode(code, B, '2026-06-01', 'secret-secret-secret-secret-1234'),
    ).toBe(true);
    expect(
      isStaffCode(code, B, '2026-06-02', 'secret-secret-secret-secret-1234'),
    ).toBe(false);
    expect(
      isStaffCode('12345', B, '2026-06-01', 'secret-secret-secret-secret-1234'),
    ).toBe(false);
    expect(
      isStaffCode(
        undefined,
        B,
        '2026-06-01',
        'secret-secret-secret-secret-1234',
      ),
    ).toBe(false);
  });

  it("allows for the phone's own accuracy, but only up to 100 m", () => {
    expect(isNearEnough(100, 150, undefined)).toBe(true);
    expect(isNearEnough(200, 150, undefined)).toBe(false);
    expect(isNearEnough(200, 150, 60)).toBe(true);
    expect(isNearEnough(400, 150, 5000)).toBe(false);
  });

  it('knows when the program runs', () => {
    const now = new Date('2026-04-02T12:00:00Z');
    expect(
      windowState(
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-04-03T23:59:59Z'),
        now,
      ),
    ).toBe('active');
    expect(windowState(new Date('2026-04-05T00:00:00Z'), null, now)).toBe(
      'upcoming',
    );
    expect(windowState(null, new Date('2026-04-01T00:00:00Z'), now)).toBe(
      'ended',
    );
    expect(windowState(null, null, now)).toBe('active');
  });

  it('gives a card an end only when the program limits how long a card lasts', () => {
    const from = new Date('2026-04-01T10:00:00Z');
    expect(cardExpiry(null, from)).toBeNull();
    expect(cardExpiry(30, from)).toEqual(new Date('2026-05-01T10:00:00Z'));
  });

  it('runs out an unfinished card after the days the period allows, never a finished one', () => {
    const started = new Date('2026-04-01T12:00:00Z');
    const card = {
      goal: 3,
      rewardText: 'Free meal',
      completedAt: null,
      createdAt: started,
    };
    const rules = { goal: 3, rewardText: 'Free meal', cardValidDays: 7 };
    expect(
      cardView(card, 1, rules, new Date('2026-04-05T12:00:00Z')).expired,
    ).toBe(false);
    expect(
      cardView(card, 1, rules, new Date('2026-04-09T12:00:00Z')).expired,
    ).toBe(true);
    expect(
      cardView(
        card,
        1,
        { ...rules, cardValidDays: null },
        new Date('2027-01-01T00:00:00Z'),
      ).expired,
    ).toBe(false);
    expect(
      cardView(card, 3, rules, new Date('2026-04-09T12:00:00Z')),
    ).toMatchObject({ complete: true, expired: false });
    expect(
      cardView(
        { ...card, completedAt: new Date() },
        3,
        rules,
        new Date('2026-04-09T12:00:00Z'),
      ),
    ).toMatchObject({ complete: true, expired: false, expiresAt: null });
  });

  it('makes a card in progress follow the current rules, and keeps a full card as it was earned', () => {
    const now = new Date('2026-04-05T12:00:00Z');
    const open = {
      goal: 10,
      rewardText: 'Old reward',
      completedAt: null,
      createdAt: new Date('2026-04-01T12:00:00Z'),
    };
    const rules = { goal: 4, rewardText: 'New reward', cardValidDays: 30 };
    expect(cardView(open, 2, rules, now)).toMatchObject({
      goal: 4,
      rewardText: 'New reward',
      complete: false,
      expiresAt: new Date('2026-05-01T12:00:00Z'),
    });
    expect(cardView(open, 4, rules, now)).toMatchObject({
      goal: 4,
      rewardText: 'New reward',
      complete: true,
    });
    expect(
      cardView({ ...open, goal: 10, completedAt: new Date() }, 10, rules, now),
    ).toMatchObject({ goal: 10, rewardText: 'Old reward', complete: true });
  });

  it('tells whether two periods share time, treating a missing end as no limit', () => {
    const d = (v: string) => new Date(v);
    expect(
      periodsOverlap(
        { startsAt: d('2026-04-01'), endsAt: d('2026-04-10') },
        { startsAt: d('2026-04-05'), endsAt: d('2026-04-20') },
      ),
    ).toBe(true);
    expect(
      periodsOverlap(
        { startsAt: d('2026-04-01'), endsAt: d('2026-04-10') },
        { startsAt: d('2026-04-10'), endsAt: d('2026-04-20') },
      ),
    ).toBe(false);
    expect(
      periodsOverlap(
        { startsAt: d('2026-04-01'), endsAt: null },
        { startsAt: d('2026-09-01'), endsAt: d('2026-10-01') },
      ),
    ).toBe(true);
    expect(
      periodsOverlap(
        { startsAt: null, endsAt: d('2026-04-01') },
        { startsAt: d('2026-04-02'), endsAt: null },
      ),
    ).toBe(false);
    expect(
      periodsOverlap(
        { startsAt: null, endsAt: null },
        { startsAt: d('2026-04-02'), endsAt: null },
      ),
    ).toBe(true);
  });

  it('picks the running period, else the next one to start, else the one that ended last', () => {
    const now = new Date('2026-04-15T12:00:00Z');
    const ended = {
      id: 'a',
      startsAt: new Date('2026-03-01'),
      endsAt: new Date('2026-04-01'),
    };
    const running = {
      id: 'b',
      startsAt: new Date('2026-04-10'),
      endsAt: new Date('2026-04-20'),
    };
    const later = { id: 'c', startsAt: new Date('2026-05-01'), endsAt: null };
    const muchLater = {
      id: 'd',
      startsAt: new Date('2026-08-01'),
      endsAt: null,
    };
    expect(pickProgram([ended, later, running], now)?.id).toBe('b');
    expect(pickProgram([muchLater, later, ended], now)?.id).toBe('c');
    expect(
      pickProgram(
        [
          ended,
          {
            id: 'e',
            startsAt: new Date('2025-01-01'),
            endsAt: new Date('2025-02-01'),
          },
        ],
        now,
      )?.id,
    ).toBe('a');
    expect(pickProgram([], now)).toBeNull();
  });

  it('keeps a full card and a card of the current period, moves an unfinished one only when stars are transferred, and drops it otherwise', () => {
    const unfinished = { programId: 'old', completedAt: null };
    expect(cardFate(unfinished, 'new', { carryOver: 'TRANSFER' })).toBe(
      'transfer',
    );
    expect(cardFate(unfinished, 'new', { carryOver: 'RESET' })).toBe('drop');
    expect(cardFate(unfinished, 'new', null)).toBe('drop');
    expect(
      cardFate({ programId: 'old', completedAt: new Date() }, 'new', {
        carryOver: 'RESET',
      }),
    ).toBe('keep');
    expect(
      cardFate({ programId: 'new', completedAt: null }, 'new', {
        carryOver: 'RESET',
      }),
    ).toBe('keep');
    expect(cardFate({ programId: null, completedAt: null }, 'new', null)).toBe(
      'keep',
    );
  });
});

describe('setting up the periods', () => {
  const A = '22222222-2222-4222-8222-222222222222';
  const stored = (over = {}) => ({
    id: A,
    businessId: B,
    enabled: true,
    goal: 5,
    rewardText: 'x',
    startsAt: null,
    endsAt: null,
    cardValidDays: null,
    radiusMeters: 150,
    carryOver: 'RESET',
    ...over,
  });
  const RULE = { enabled: true, goal: 5, rewardText: 'x' };

  async function owner(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    payload?: object,
    url = `/businesses/${B}/loyalty`,
  ) {
    const app = await buildApp();
    const res = await app.inject({
      method,
      url,
      payload,
      headers: { cookie: `${SESSION_COOKIE}=${app.jwt.sign({ sub: 'u1' })}` },
    });
    await app.close();
    return res;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    db.business.findFirst.mockResolvedValue({
      id: B,
      ownerId: 'u1',
      lat: 44.1,
      lng: 15.2,
    });
    db.loyaltyProgram.findMany.mockResolvedValue([]);
    db.loyaltyProgram.create.mockImplementation(
      async ({ data }: { data: object }) => ({ id: A, ...data }),
    );
    db.loyaltyProgram.update.mockImplementation(
      async ({ data }: { data: object }) => ({ id: A, ...data }),
    );
  });

  it("shows a blank program and today's staff code", async () => {
    const res = await owner('GET');
    expect(res.json().program).toMatchObject({
      enabled: false,
      goal: 10,
      cardValidDays: null,
      radiusMeters: 150,
      carryOver: 'RESET',
    });
    expect(res.json().programs).toEqual([]);
    expect(res.json().staffCode).toBe(staffCode(B, TODAY, config.JWT_SECRET));
  });

  it('lists every period and shows the one guests see now as the program', async () => {
    const ended = stored({
      id: 'e',
      startsAt: new Date('2020-01-01'),
      endsAt: new Date('2020-02-01'),
    });
    const running = stored({ startsAt: new Date('2020-03-01'), endsAt: null });
    db.loyaltyProgram.findMany.mockResolvedValue([ended, running]);
    const res = await owner('GET');
    expect(res.json().programs).toHaveLength(2);
    expect(res.json().program.id).toBe(A);
    expect(db.loyaltyProgram.findMany.mock.calls[0]![0].where).toEqual({
      businessId: B,
    });
  });

  it('saves the rule, and refuses a period that ends before it starts, a goal outside 2 to 50, and switching on without a location', async () => {
    expect(
      (
        await owner('PUT', {
          ...RULE,
          goal: 10,
          rewardText: 'Free meal',
          startsAt: '2026-04-01',
          endsAt: '2026-04-03',
        })
      ).statusCode,
    ).toBe(200);
    expect(db.loyaltyProgram.create.mock.calls[0]![0].data).toMatchObject({
      businessId: B,
      goal: 10,
      rewardText: 'Free meal',
    });
    expect(
      (
        await owner('PUT', {
          ...RULE,
          startsAt: '2026-04-03',
          endsAt: '2026-04-01',
        })
      ).json().error,
    ).toBe('invalid_period');
    expect((await owner('PUT', { ...RULE, goal: 1 })).statusCode).toBe(400);
    expect((await owner('PUT', { ...RULE, goal: 51 })).statusCode).toBe(400);
    db.business.findFirst.mockResolvedValue({
      id: B,
      ownerId: 'u1',
      lat: null,
      lng: null,
    });
    expect((await owner('PUT', RULE)).json().error).toBe(
      'google_not_connected',
    );
    expect((await owner('PUT', { ...RULE, enabled: false })).statusCode).toBe(
      200,
    );
  });

  it('updates the period guests see now instead of adding a second one', async () => {
    db.loyaltyProgram.findMany.mockResolvedValue([stored()]);
    expect((await owner('PUT', { ...RULE, goal: 8 })).statusCode).toBe(200);
    expect(db.loyaltyProgram.create).not.toHaveBeenCalled();
    expect(db.loyaltyProgram.update.mock.calls[0]![0]).toMatchObject({
      where: { id: A },
      data: { goal: 8 },
    });
  });

  it('saves how many days a card lasts, clears it with null, leaves it alone when missing, and refuses 0 or more than 730', async () => {
    await owner('PUT', { ...RULE, cardValidDays: 90 });
    expect(db.loyaltyProgram.create.mock.calls[0]![0].data).toMatchObject({
      cardValidDays: 90,
    });
    await owner('PUT', { ...RULE, cardValidDays: null });
    expect(db.loyaltyProgram.create.mock.calls[1]![0].data).toMatchObject({
      cardValidDays: null,
    });
    await owner('PUT', RULE);
    expect(db.loyaltyProgram.create.mock.calls[2]![0].data).not.toHaveProperty(
      'cardValidDays',
    );
    expect((await owner('PUT', { ...RULE, cardValidDays: 0 })).statusCode).toBe(
      400,
    );
    expect(
      (await owner('PUT', { ...RULE, cardValidDays: 731 })).statusCode,
    ).toBe(400);
  });

  it('adds the next period after the running one, and saves what happens to stars at its end', async () => {
    db.loyaltyProgram.findMany.mockResolvedValue([
      stored({
        startsAt: new Date('2026-04-01'),
        endsAt: new Date('2026-05-01'),
      }),
    ]);
    const res = await owner(
      'POST',
      {
        ...RULE,
        startsAt: '2026-05-01',
        endsAt: '2026-06-01',
        carryOver: 'TRANSFER',
      },
      `/businesses/${B}/loyalty/actions`,
    );
    expect(res.statusCode).toBe(201);
    expect(db.loyaltyProgram.create.mock.calls[0]![0].data).toMatchObject({
      businessId: B,
      carryOver: 'TRANSFER',
    });
  });

  it('refuses a period that overlaps another, and a business with too many', async () => {
    db.loyaltyProgram.findMany.mockResolvedValue([
      stored({
        startsAt: new Date('2026-04-01'),
        endsAt: new Date('2026-05-01'),
      }),
    ]);
    const overlap = await owner(
      'POST',
      { ...RULE, startsAt: '2026-04-20', endsAt: '2026-06-01' },
      `/businesses/${B}/loyalty/actions`,
    );
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().error).toBe('period_overlaps');
    expect(db.loyaltyProgram.create).not.toHaveBeenCalled();
    db.loyaltyProgram.findMany.mockResolvedValue(
      Array.from({ length: MAX_PROGRAMS_PER_BUSINESS }, (_, i) =>
        stored({
          id: String(i),
          startsAt: new Date(2020, i, 1),
          endsAt: new Date(2020, i, 2),
        }),
      ),
    );
    expect(
      (
        await owner(
          'POST',
          { ...RULE, startsAt: '2030-01-01', endsAt: '2030-02-01' },
          `/businesses/${B}/loyalty/actions`,
        )
      ).json().error,
    ).toBe('too_many_actions');
  });

  it('changes one period without clashing with itself, and refuses an unknown or foreign one', async () => {
    db.loyaltyProgram.findMany.mockResolvedValue([
      stored({
        startsAt: new Date('2026-04-01'),
        endsAt: new Date('2026-05-01'),
      }),
    ]);
    const url = `/businesses/${B}/loyalty/actions/${A}`;
    expect(
      (
        await owner(
          'PUT',
          {
            ...RULE,
            startsAt: '2026-04-01',
            endsAt: '2026-05-15',
            carryOver: 'TRANSFER',
          },
          url,
        )
      ).statusCode,
    ).toBe(200);
    expect(db.loyaltyProgram.update.mock.calls[0]![0]).toMatchObject({
      where: { id: A },
      data: { carryOver: 'TRANSFER' },
    });
    expect(
      (
        await owner(
          'PUT',
          RULE,
          `/businesses/${B}/loyalty/actions/33333333-3333-4333-8333-333333333333`,
        )
      ).statusCode,
    ).toBe(404);
  });

  it('deletes a period of this business only', async () => {
    db.loyaltyProgram.findFirst.mockResolvedValue({ id: A });
    expect(
      (
        await owner(
          'DELETE',
          undefined,
          `/businesses/${B}/loyalty/actions/${A}`,
        )
      ).statusCode,
    ).toBe(204);
    expect(db.loyaltyProgram.findFirst.mock.calls[0]![0].where).toEqual({
      id: A,
      businessId: B,
    });
    expect(db.loyaltyProgram.delete).toHaveBeenCalledWith({ where: { id: A } });
    db.loyaltyProgram.findFirst.mockResolvedValue(null);
    expect(
      (
        await owner(
          'DELETE',
          undefined,
          `/businesses/${B}/loyalty/actions/${A}`,
        )
      ).statusCode,
    ).toBe(404);
  });

  it('keeps other owners out', async () => {
    db.business.findFirst.mockResolvedValue(null);
    expect((await owner('GET')).statusCode).toBe(404);
    expect(
      (await owner('POST', RULE, `/businesses/${B}/loyalty/actions`))
        .statusCode,
    ).toBe(404);
  });
});

describe('stamps', () => {
  const PROGRAM = {
    id: 'p1',
    carryOver: 'RESET',
    enabled: true,
    goal: 3,
    rewardText: 'Free meal',
    startsAt: null,
    endsAt: null,
    cardValidDays: null,
    radiusMeters: 150,
  };
  const BIZ = {
    id: B,
    publishedAt: new Date(),
    paidUntil: new Date(Date.now() + 86_400_000),
    lat: 44.12,
    lng: 15.23,
    loyaltyPrograms: [PROGRAM],
  };
  const card = (punches: number, over = {}) => ({
    id: 'c1',
    membershipId: 'm1',
    programId: 'p1',
    program: { carryOver: 'RESET' },
    goal: 3,
    rewardText: 'Free meal',
    completedAt: null,
    redeemedAt: null,
    createdAt: new Date(),
    _count: { punches },
    ...over,
  });

  async function call(url: string, payload?: object, signedIn = true) {
    const app = await buildApp();
    const headers = signedIn
      ? {
          cookie: `guest=${app.jwt.sign({ sub: 'g1', kind: 'guest' } as never)}`,
        }
      : {};
    const res = await app.inject({
      method: payload === undefined && url.endsWith('loyalty') ? 'GET' : 'POST',
      url,
      payload,
      headers,
    });
    await app.close();
    return res;
  }
  const code = () => staffCode(B, TODAY, config.JWT_SECRET);
  const HERE = { lat: 44.1201, lng: 15.2301 };

  beforeEach(() => {
    vi.clearAllMocks();
    db.guest.findUnique.mockResolvedValue({ id: 'g1' });
    db.business.findUnique.mockResolvedValue(BIZ);
    db.membership.findUnique.mockResolvedValue({ id: 'm1' });
    db.loyaltyPunch.findFirst.mockResolvedValue(null);
    db.loyaltyCard.findFirst.mockResolvedValue(card(0));
    db.loyaltyPunch.create.mockResolvedValue({});
  });

  it("shows the card and whether today's stamp is taken", async () => {
    db.loyaltyCard.findFirst.mockResolvedValue(card(2));
    db.loyaltyPunch.findFirst.mockResolvedValue({ day: TODAY });
    const res = await call('/guest/b/abcd2345/loyalty');
    expect(res.json()).toMatchObject({
      program: { goal: 3, window: 'active' },
      card: { punches: 2, goal: 3, complete: false },
      punchedToday: true,
    });
    db.business.findUnique.mockResolvedValue({ ...BIZ, loyaltyPrograms: [] });
    expect((await call('/guest/b/abcd2345/loyalty')).json().program).toBeNull();
  });

  it('gives a stamp to a guest who is at the business', async () => {
    const res = await call('/guest/b/abcd2345/loyalty/punch', HERE);
    expect(res.statusCode).toBe(200);
    expect(db.loyaltyPunch.create.mock.calls[0]![0].data).toMatchObject({
      cardId: 'c1',
      membershipId: 'm1',
      day: TODAY,
      method: 'LOCATION',
    });
  });

  it("starts a card with the program's goal and reward when there is none", async () => {
    db.loyaltyCard.findFirst.mockResolvedValue(null);
    db.loyaltyCard.create.mockResolvedValue(card(0));
    await call('/guest/b/abcd2345/loyalty/punch', HERE);
    expect(db.loyaltyCard.create.mock.calls[0]![0].data).toMatchObject({
      membershipId: 'm1',
      programId: 'p1',
      goal: 3,
      rewardText: 'Free meal',
    });
  });

  it("starts a card with the program's goal and reward, and no end of its own", async () => {
    db.loyaltyCard.findFirst.mockResolvedValue(null);
    db.loyaltyCard.create.mockResolvedValue(card(0));
    await call('/guest/b/abcd2345/loyalty/punch', HERE);
    expect(db.loyaltyCard.create.mock.calls[0]![0].data).not.toHaveProperty(
      'expiresAt',
    );
  });

  it('starts a new card when the one in progress has run out', async () => {
    db.business.findUnique.mockResolvedValue({
      ...BIZ,
      loyaltyPrograms: [{ ...PROGRAM, cardValidDays: 30 }],
    });
    db.loyaltyCard.findFirst.mockResolvedValue(
      card(2, { createdAt: new Date(Date.now() - 31 * DAY_MS) }),
    );
    db.loyaltyCard.create.mockResolvedValue(card(0, { id: 'c2' }));
    const res = await call('/guest/b/abcd2345/loyalty/punch', HERE);
    expect(res.statusCode).toBe(200);
    expect(db.loyaltyCard.create).toHaveBeenCalledTimes(1);
    expect(db.loyaltyPunch.create.mock.calls[0]![0].data.cardId).toBe('c2');
  });

  it('shows no card when the one in progress has run out', async () => {
    db.business.findUnique.mockResolvedValue({
      ...BIZ,
      loyaltyPrograms: [{ ...PROGRAM, cardValidDays: 30 }],
    });
    db.loyaltyCard.findFirst.mockResolvedValue(
      card(2, { createdAt: new Date(Date.now() - 31 * DAY_MS) }),
    );
    expect((await call('/guest/b/abcd2345/loyalty')).json().card).toBeNull();
  });

  it('tells the guest how long a card lasts and when the current one ends', async () => {
    const createdAt = new Date(Date.now() - 25 * DAY_MS);
    db.business.findUnique.mockResolvedValue({
      ...BIZ,
      loyaltyPrograms: [{ ...PROGRAM, cardValidDays: 30 }],
    });
    db.loyaltyCard.findFirst.mockResolvedValue(card(1, { createdAt }));
    const res = await call('/guest/b/abcd2345/loyalty');
    expect(res.json().program.cardValidDays).toBe(30);
    expect(res.json().card.expiresAt).toBe(
      new Date(createdAt.getTime() + 30 * DAY_MS).toISOString(),
    );
  });

  it('does not run out a full card', async () => {
    db.business.findUnique.mockResolvedValue({
      ...BIZ,
      loyaltyPrograms: [{ ...PROGRAM, cardValidDays: 30 }],
    });
    db.loyaltyCard.findFirst.mockResolvedValue(
      card(3, {
        completedAt: new Date(),
        createdAt: new Date(Date.now() - 90 * DAY_MS),
      }),
    );
    expect(
      (await call('/guest/b/abcd2345/loyalty/punch', HERE)).json().error,
    ).toBe('card_complete');
  });

  describe('when the owner changes the running action', () => {
    const edited = (over: object) =>
      db.business.findUnique.mockResolvedValue({
        ...BIZ,
        loyaltyPrograms: [{ ...PROGRAM, ...over }],
      });

    it('shows the new goal and reward on a card in progress', async () => {
      edited({ goal: 6, rewardText: 'Free dessert' });
      db.loyaltyCard.findFirst.mockResolvedValue(card(2));
      expect(
        (await call('/guest/b/abcd2345/loyalty')).json().card,
      ).toMatchObject({
        punches: 2,
        goal: 6,
        rewardText: 'Free dessert',
        complete: false,
      });
    });

    it('shows a card as full when the goal is lowered to its stars, and writes the reward down on the next stamp', async () => {
      edited({ goal: 2, rewardText: 'Free dessert' });
      db.loyaltyCard.findFirst.mockResolvedValue(card(2));
      expect(
        (await call('/guest/b/abcd2345/loyalty')).json().card,
      ).toMatchObject({ complete: true, goal: 2, rewardText: 'Free dessert' });
      expect(db.loyaltyCard.update).not.toHaveBeenCalled();
      expect(
        (await call('/guest/b/abcd2345/loyalty/punch', HERE)).json().error,
      ).toBe('card_complete');
      expect(db.loyaltyCard.update.mock.calls[0]![0].data).toMatchObject({
        goal: 2,
        rewardText: 'Free dessert',
        completedAt: expect.any(Date),
      });
      expect(db.loyaltyPunch.create).not.toHaveBeenCalled();
    });

    it('lets staff redeem a card that the new goal has filled, with the reward on it', async () => {
      edited({ goal: 2, rewardText: 'Free dessert' });
      db.loyaltyCard.findFirst.mockResolvedValue(card(2));
      expect(
        (await call('/guest/b/abcd2345/loyalty/redeem', { staffCode: code() }))
          .statusCode,
      ).toBe(200);
      expect(db.loyaltyCard.update.mock.calls[0]![0].data).toMatchObject({
        rewardText: 'Free dessert',
        completedAt: expect.any(Date),
      });
      expect(
        db.loyaltyCard.update.mock.calls[1]![0].data.redeemedAt,
      ).toBeInstanceOf(Date);
    });

    it('does not take back a full card when the goal is raised', async () => {
      edited({ goal: 10, rewardText: 'Big prize' });
      db.loyaltyCard.findFirst.mockResolvedValue(
        card(3, { completedAt: new Date() }),
      );
      expect(
        (await call('/guest/b/abcd2345/loyalty')).json().card,
      ).toMatchObject({ complete: true, goal: 3, rewardText: 'Free meal' });
    });

    it('completes the card on the stamp that reaches the new goal', async () => {
      edited({ goal: 4 });
      db.loyaltyCard.findFirst.mockResolvedValue(card(3));
      await call('/guest/b/abcd2345/loyalty/punch', HERE);
      expect(db.loyaltyCard.update.mock.calls[0]![0].data).toMatchObject({
        goal: 4,
        completedAt: expect.any(Date),
      });
    });
  });

  it('refuses a guest who is far away, and one who gave no proof', async () => {
    const far = await call('/guest/b/abcd2345/loyalty/punch', {
      lat: 44.2,
      lng: 15.4,
    });
    expect(far.statusCode).toBe(422);
    expect(far.json().error).toBe('too_far');
    expect(
      (await call('/guest/b/abcd2345/loyalty/punch', {})).json().error,
    ).toBe('location_required');
    expect(db.loyaltyPunch.create).not.toHaveBeenCalled();
  });

  it("accepts today's staff code instead of a location, and refuses a wrong or old one", async () => {
    const ok = await call('/guest/b/abcd2345/loyalty/punch', {
      staffCode: code(),
    });
    expect(ok.statusCode).toBe(200);
    expect(db.loyaltyPunch.create.mock.calls[0]![0].data.method).toBe(
      'STAFF_CODE',
    );
    const wrong = await call('/guest/b/abcd2345/loyalty/punch', {
      staffCode: code() === '000000' ? '111111' : '000000',
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe('wrong_code');
  });

  it('gives one stamp a day, even when two taps arrive together', async () => {
    db.loyaltyPunch.findFirst.mockResolvedValue({ day: TODAY });
    expect(
      (await call('/guest/b/abcd2345/loyalty/punch', HERE)).json().error,
    ).toBe('already_punched_today');
    db.loyaltyPunch.findFirst.mockResolvedValue({ day: '2020-01-01' });
    db.loyaltyPunch.create.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'P2002' }),
    );
    expect(
      (await call('/guest/b/abcd2345/loyalty/punch', HERE)).json().error,
    ).toBe('already_punched_today');
  });

  it('completes the card on the last stamp, and gives no more stamps until it is redeemed', async () => {
    db.loyaltyCard.findFirst.mockResolvedValue(card(2));
    await call('/guest/b/abcd2345/loyalty/punch', HERE);
    expect(
      db.loyaltyCard.update.mock.calls[0]![0].data.completedAt,
    ).toBeInstanceOf(Date);
    db.loyaltyCard.update.mockClear();
    db.loyaltyCard.findFirst.mockResolvedValue(
      card(3, { completedAt: new Date() }),
    );
    expect(
      (await call('/guest/b/abcd2345/loyalty/punch', HERE)).json().error,
    ).toBe('card_complete');
  });

  it('does not stamp before the program starts or after it ends', async () => {
    db.business.findUnique.mockResolvedValue({
      ...BIZ,
      loyaltyPrograms: [{ ...PROGRAM, endsAt: new Date(Date.now() - 1000) }],
    });
    expect(
      (await call('/guest/b/abcd2345/loyalty/punch', HERE)).json().error,
    ).toBe('program_not_active');
    db.business.findUnique.mockResolvedValue({
      ...BIZ,
      loyaltyPrograms: [
        { ...PROGRAM, startsAt: new Date(Date.now() + 86_400_000) },
      ],
    });
    expect(
      (await call('/guest/b/abcd2345/loyalty/punch', HERE)).json().error,
    ).toBe('program_not_active');
  });

  describe('when a period ends and the next one runs', () => {
    const NEXT = {
      ...PROGRAM,
      id: 'p2',
      goal: 4,
      rewardText: 'Free dessert',
      cardValidDays: 30,
    };
    const old = (punches: number, carryOver: 'RESET' | 'TRANSFER', over = {}) =>
      card(punches, { programId: 'p1', program: { carryOver }, ...over });
    beforeEach(() => {
      db.business.findUnique.mockResolvedValue({
        ...BIZ,
        loyaltyPrograms: [NEXT],
      });
    });

    it('shows an unfinished card of the old period with its stars, in the new goal, when stars are transferred', async () => {
      db.loyaltyCard.findFirst.mockResolvedValue(old(2, 'TRANSFER'));
      expect(
        (await call('/guest/b/abcd2345/loyalty')).json().card,
      ).toMatchObject({
        punches: 2,
        goal: 4,
        rewardText: 'Free dessert',
        complete: false,
      });
    });

    it('shows no card when the old period resets', async () => {
      db.loyaltyCard.findFirst.mockResolvedValue(old(2, 'RESET'));
      expect((await call('/guest/b/abcd2345/loyalty')).json().card).toBeNull();
    });

    it('still shows a full card of the old period, with the reward it earned', async () => {
      db.loyaltyCard.findFirst.mockResolvedValue(
        old(3, 'RESET', { completedAt: new Date() }),
      );
      expect(
        (await call('/guest/b/abcd2345/loyalty')).json().card,
      ).toMatchObject({
        punches: 3,
        goal: 3,
        rewardText: 'Free meal',
        complete: true,
      });
    });

    it('moves the card to the new period on the next stamp, and starts a fresh card when the old one resets', async () => {
      db.loyaltyCard.findFirst.mockResolvedValue(old(2, 'TRANSFER'));
      await call('/guest/b/abcd2345/loyalty/punch', HERE);
      expect(db.loyaltyCard.update.mock.calls[0]![0].data).toMatchObject({
        programId: 'p2',
        createdAt: expect.any(Date),
      });
      expect(db.loyaltyCard.update.mock.calls[0]![0].data).not.toHaveProperty(
        'completedAt',
      );
      expect(db.loyaltyPunch.create.mock.calls[0]![0].data.cardId).toBe('c1');
      expect(db.loyaltyCard.create).not.toHaveBeenCalled();

      db.loyaltyCard.findFirst.mockResolvedValue(old(2, 'RESET'));
      db.loyaltyCard.create.mockResolvedValue(
        card(0, { id: 'c2', programId: 'p2' }),
      );
      await call('/guest/b/abcd2345/loyalty/punch', HERE);
      expect(db.loyaltyCard.create.mock.calls[0]![0].data).toMatchObject({
        programId: 'p2',
        goal: 4,
      });
      expect(db.loyaltyPunch.create.mock.calls[1]![0].data.cardId).toBe('c2');
    });

    it('completes a moved card at once when it already has as many stars as the new goal', async () => {
      db.business.findUnique.mockResolvedValue({
        ...BIZ,
        loyaltyPrograms: [{ ...NEXT, goal: 2 }],
      });
      db.loyaltyCard.findFirst.mockResolvedValue(old(2, 'TRANSFER'));
      expect(
        (await call('/guest/b/abcd2345/loyalty/punch', HERE)).json().error,
      ).toBe('card_complete');
      expect(db.loyaltyCard.update.mock.calls[0]![0].data).toMatchObject({
        programId: 'p2',
        goal: 2,
        rewardText: 'Free dessert',
        completedAt: expect.any(Date),
      });
      expect(db.loyaltyPunch.create).not.toHaveBeenCalled();
    });
  });

  it('needs a signed-in member', async () => {
    expect(
      (await call('/guest/b/abcd2345/loyalty/punch', HERE, false)).statusCode,
    ).toBe(401);
    db.membership.findUnique.mockResolvedValue(null);
    expect(
      (await call('/guest/b/abcd2345/loyalty/punch', HERE)).json().error,
    ).toBe('not_member');
  });

  it("redeems a finished card only with today's staff code", async () => {
    db.loyaltyCard.findFirst.mockResolvedValue(
      card(3, { completedAt: new Date() }),
    );
    const wrong = await call('/guest/b/abcd2345/loyalty/redeem', {
      staffCode: '999999' === code() ? '111111' : '999999',
    });
    expect(wrong.statusCode).toBe(403);
    expect(db.loyaltyCard.update).not.toHaveBeenCalled();
    const ok = await call('/guest/b/abcd2345/loyalty/redeem', {
      staffCode: code(),
    });
    expect(ok.statusCode).toBe(200);
    expect(
      db.loyaltyCard.update.mock.calls[0]![0].data.redeemedAt,
    ).toBeInstanceOf(Date);
    db.loyaltyCard.findFirst.mockResolvedValue(card(1));
    expect(
      (
        await call('/guest/b/abcd2345/loyalty/redeem', { staffCode: code() })
      ).json().error,
    ).toBe('nothing_to_redeem');
  });
});
