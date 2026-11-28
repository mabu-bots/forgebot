import assert from "node:assert/strict";
import type { ReactionTrigger } from "../src/blueprint.js";
import {
  matchesReactionTrigger,
  reactionCountFor,
  type ReactionMatchInput,
} from "../src/reactionTrigger.js";
import { test } from "node:test";

function trigger(overrides: Partial<ReactionTrigger> = {}): ReactionTrigger {
  return {
    type: "reaction",
    threshold: 5,
    channelId: "c1",
    template: "送信",
    ...overrides,
  };
}

function input(
  overrides: Partial<ReactionMatchInput> = {},
): ReactionMatchInput {
  return {
    emojiCounts: { "⭐": 5, "👍": 2 },
    totalCount: 7,
    alreadyFired: false,
    ...overrides,
  };
}

test("絵文字指定時はその絵文字の数で判定する", () => {
  const star = trigger({ emoji: "⭐" });
  assert.equal(reactionCountFor(star, input()), 5);
  assert.equal(matchesReactionTrigger(star, input()), true);
  assert.equal(
    matchesReactionTrigger(star, input({ emojiCounts: { "⭐": 4 } })),
    false,
  );
});

test("絵文字未指定時は合計で判定する", () => {
  const any = trigger();
  assert.equal(reactionCountFor(any, input()), 7);
  assert.equal(matchesReactionTrigger(any, input()), true);
  assert.equal(matchesReactionTrigger(any, input({ totalCount: 4 })), false);
});

test("指定した絵文字が1件も無ければ 0 件として扱う", () => {
  const heart = trigger({ emoji: "❤️" });
  assert.equal(reactionCountFor(heart, input()), 0);
  assert.equal(matchesReactionTrigger(heart, input()), false);
});

test("発火済みなら閾値に達していても一致しない", () => {
  assert.equal(
    matchesReactionTrigger(
      trigger({ emoji: "⭐" }),
      input({ alreadyFired: true }),
    ),
    false,
  );
  assert.equal(
    matchesReactionTrigger(trigger(), input({ alreadyFired: true })),
    false,
  );
});

test("閾値ちょうどで一致する", () => {
  assert.equal(
    matchesReactionTrigger(trigger({ emoji: "👍", threshold: 2 }), input()),
    true,
  );
});
