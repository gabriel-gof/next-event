"use strict"

const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const { mkdtempSync, writeFileSync, chmodSync, readFileSync, statSync, rmSync } = require("node:fs")
const { tmpdir } = require("node:os")
const { join } = require("node:path")
const { spawnSync, execFile } = require("node:child_process")
const { promisify } = require("node:util")

const execFileAsync = promisify(execFile)

describe("notify-event", () => {
  it("delivers a milestone once and persists it privately", t => {
    const dir = mkdtempSync(join(tmpdir(), "next-event-notify-"))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const statePath = join(dir, "notifications.json")
    const logPath = join(dir, "notifications.log")
    const fakeNotifier = join(dir, "fake-notifier")
    writeFileSync(fakeNotifier, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$NEXT_EVENT_TEST_LOG"\n')
    chmodSync(fakeNotifier, 0o700)

    const env = {
      ...process.env,
      NEXT_EVENT_NOTIFICATION_STATE: statePath,
      NEXT_EVENT_NOTIFY_BIN: fakeNotifier,
      NEXT_EVENT_TEST_LOG: logPath
    }
    const args = [
      "weekly-review|1788184800000|30",
      "Weekly Review",
      "Starts in 30 minutes · 11:00",
      "https://meet.google.com/abc-defg-hij"
    ]

    const first = spawnSync(join(__dirname, "..", "notify-event"), args, {
      env,
      encoding: "utf8"
    })
    const second = spawnSync(join(__dirname, "..", "notify-event"), args, {
      env,
      encoding: "utf8"
    })

    assert.strictEqual(
      first.status,
      0,
      first.error ? first.error.message : String(first.stderr || "")
    )
    assert.strictEqual(
      second.status,
      0,
      second.error ? second.error.message : String(second.stderr || "")
    )
    assert.strictEqual(readFileSync(logPath, "utf8").trim().split("\n").length, 1)
    assert.strictEqual(statSync(statePath).mode & 0o777, 0o600)
    assert.strictEqual(
      JSON.parse(readFileSync(statePath, "utf8")).delivered["weekly-review|1788184800000|30"] > 0,
      true
    )
  })

  it("serializes simultaneous monitor attempts into one notification", async t => {
    const dir = mkdtempSync(join(tmpdir(), "next-event-notify-race-"))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const statePath = join(dir, "notifications.json")
    const logPath = join(dir, "notifications.log")
    const fakeNotifier = join(dir, "fake-notifier")
    writeFileSync(
      fakeNotifier,
      '#!/bin/sh\nsleep 0.2\nprintf "%s\\n" "$*" >> "$NEXT_EVENT_TEST_LOG"\n'
    )
    chmodSync(fakeNotifier, 0o700)

    const env = {
      ...process.env,
      NEXT_EVENT_NOTIFICATION_STATE: statePath,
      NEXT_EVENT_NOTIFY_BIN: fakeNotifier,
      NEXT_EVENT_TEST_LOG: logPath
    }
    const dispatcher = join(__dirname, "..", "notify-event")
    const args = [
      "weekly-review|1788184800000|10",
      "Weekly Review",
      "Starts in 10 minutes · 11:00",
      "https://meet.google.com/abc-defg-hij"
    ]

    await Promise.all([
      execFileAsync(dispatcher, args, { env }),
      execFileAsync(dispatcher, args, { env })
    ])

    assert.strictEqual(readFileSync(logPath, "utf8").trim().split("\n").length, 1)
  })
})
