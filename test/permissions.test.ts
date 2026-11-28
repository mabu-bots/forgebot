import assert from "node:assert/strict";
import { test } from "node:test";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { hasManageGuild } from "../src/permissions.js";

test("ManageGuild を持つ権限セットは true", () => {
  const permissions = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
  assert.equal(hasManageGuild(permissions), true);
});

test("ManageGuild を持たない権限セットは false", () => {
  const permissions = new PermissionsBitField(PermissionFlagsBits.SendMessages);
  assert.equal(hasManageGuild(permissions), false);
});

test("権限が null / undefined なら false", () => {
  assert.equal(hasManageGuild(null), false);
  assert.equal(hasManageGuild(undefined), false);
});
