import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../src/lib/auth/sessionCookie.js';

const db = vi.hoisted(() => ({
  business: { findFirst: vi.fn() },
  loyaltyProgram: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../../src/db.js', () => ({ prisma: db }));

import { buildApp } from '../../../src/app.js';
import { MAX_PROGRAMS_PER_BUSINESS } from '../../../src/lib/engage/loyalty.js';

const B = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const DAY_MS = 86_400_000;
const URL = `/businesses/${B}/loyalty/actions/${A}/end`;
const NEXT = { enabled: true, goal: 6, rewardText: 'Free dessert' };

describe('ending the running action', () => {
  const stored = (over = {}) => ({
    id: A,
    businessId: B,
    enabled: true,
    goal: 5,
    rewardText: 'x',
    startsAt: new Date(Date.now() - 10 * DAY_MS),
    endsAt: new Date(Date.now() + 10 * DAY_MS),
    cardValidDays: null,
    radiusMeters: 150,
    carryOver: 'RESET',
    ...over,
  });

  async function end(payload: object, url = URL) {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
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
    db.loyaltyProgram.findMany.mockResolvedValue([stored()]);
    db.loyaltyProgram.update.mockImplementation(
      async ({ data }: { data: object }) => ({ id: A, ...data }),
    );
    db.loyaltyProgram.create.mockImplementation(
      async ({ data }: { data: object }) => ({ id: 'new', ...data }),
    );
    db.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
  });

  it('ends the action now and saves whether stars move on, without starting another', async () => {
    const before = Date.now();
    const res = await end({ carryOver: 'TRANSFER' });
    expect(res.statusCode).toBe(200);
    expect(res.json().next).toBeNull();
    const data = db.loyaltyProgram.update.mock.calls[0]![0].data;
    expect(data.carryOver).toBe('TRANSFER');
    expect(data.endsAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(db.loyaltyProgram.create).not.toHaveBeenCalled();
  });

  it('ends the action and starts the next one at the same moment, in one step', async () => {
    const res = await end({
      carryOver: 'TRANSFER',
      next: {
        ...NEXT,
        endsAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
        carryOver: 'RESET',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const closed = db.loyaltyProgram.update.mock.calls[0]![0].data;
    const opened = db.loyaltyProgram.create.mock.calls[0]![0].data;
    expect(opened).toMatchObject({
      businessId: B,
      goal: 6,
      rewardText: 'Free dessert',
      carryOver: 'RESET',
    });
    expect(opened.startsAt).toEqual(closed.endsAt);
    expect(res.json().ended.carryOver).toBe('TRANSFER');
  });

  it('ignores a start date sent for the next action', async () => {
    await end({
      carryOver: 'RESET',
      next: { ...NEXT, startsAt: '2030-01-01' },
    });
    expect(
      db.loyaltyProgram.create.mock.calls[0]![0].data.startsAt.getTime(),
    ).toBeLessThanOrEqual(Date.now());
  });

  it('refuses an action that is not running, and an unknown or foreign one', async () => {
    db.loyaltyProgram.findMany.mockResolvedValue([
      stored({ endsAt: new Date(Date.now() - DAY_MS) }),
    ]);
    expect((await end({ carryOver: 'RESET' })).json().error).toBe(
      'action_not_running',
    );
    db.loyaltyProgram.findMany.mockResolvedValue([
      stored({ startsAt: new Date(Date.now() + DAY_MS) }),
    ]);
    expect((await end({ carryOver: 'RESET' })).json().error).toBe(
      'action_not_running',
    );
    expect(
      (
        await end(
          { carryOver: 'RESET' },
          `/businesses/${B}/loyalty/actions/33333333-3333-4333-8333-333333333333/end`,
        )
      ).statusCode,
    ).toBe(404);
    expect(db.loyaltyProgram.update).not.toHaveBeenCalled();
  });

  it('refuses a next action that runs into a later one, and a business with too many', async () => {
    db.loyaltyProgram.findMany.mockResolvedValue([
      stored(),
      stored({
        id: 'later',
        startsAt: new Date(Date.now() + 20 * DAY_MS),
        endsAt: new Date(Date.now() + 40 * DAY_MS),
      }),
    ]);
    const overlap = await end({ carryOver: 'RESET', next: NEXT });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().error).toBe('period_overlaps');
    expect(db.loyaltyProgram.update).not.toHaveBeenCalled();
    db.loyaltyProgram.findMany.mockResolvedValue(
      Array.from({ length: MAX_PROGRAMS_PER_BUSINESS }, (_, i) =>
        stored({
          id: i === 0 ? A : String(i),
          startsAt:
            i === 0 ? new Date(Date.now() - DAY_MS) : new Date(2020, i, 1),
          endsAt: i === 0 ? null : new Date(2020, i, 2),
        }),
      ),
    );
    expect((await end({ carryOver: 'RESET', next: NEXT })).json().error).toBe(
      'too_many_actions',
    );
  });

  it('refuses a next action that is switched on without a location, and another owner', async () => {
    db.business.findFirst.mockResolvedValue({
      id: B,
      ownerId: 'u1',
      lat: null,
      lng: null,
    });
    expect((await end({ carryOver: 'RESET', next: NEXT })).json().error).toBe(
      'google_not_connected',
    );
    db.business.findFirst.mockResolvedValue(null);
    expect((await end({ carryOver: 'RESET' })).statusCode).toBe(404);
  });

  it('needs to be told what happens to the stars', async () => {
    expect((await end({})).statusCode).toBe(400);
    expect((await end({ carryOver: 'KEEP' })).statusCode).toBe(400);
  });
});
