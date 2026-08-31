"use strict"

const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const { CompactBarPolicy, CalendarEvent } = require("../Model.js")

describe("CompactBarPolicy", () => {
  const start = new Date(2026, 7, 31, 11, 0, 0)
  const event = new CalendarEvent({
    uid: "weekly-review",
    title: "Weekly Review",
    start,
    end: new Date(2026, 7, 31, 12, 0, 0),
    allDay: false,
    meetUrl: "https://meet.google.com/abc-defg-hij"
  })

  function minutesBefore(minutes) {
    return new Date(start.getTime() - minutes * 60 * 1000)
  }

  describe("state()", () => {
    it("maps a timed event to the compact bar urgency bands", () => {
      assert.strictEqual(CompactBarPolicy.state(event, minutesBefore(31)), "scheduled")
      assert.strictEqual(CompactBarPolicy.state(event, minutesBefore(30)), "soon")
      assert.strictEqual(CompactBarPolicy.state(event, minutesBefore(10)), "imminent")
      assert.strictEqual(CompactBarPolicy.state(event, start), "ongoing")
    })

    it("treats missing and all-day events as idle", () => {
      const allDay = new CalendarEvent({
        uid: "holiday",
        title: "Holiday",
        start: new Date(2026, 7, 31, 0, 0, 0),
        end: new Date(2026, 8, 1, 0, 0, 0),
        allDay: true
      })

      assert.strictEqual(CompactBarPolicy.state(null, minutesBefore(31)), "idle")
      assert.strictEqual(CompactBarPolicy.state(allDay, minutesBefore(31)), "idle")
    })

    it("keeps tomorrow's events idle today", () => {
      const tomorrowEvent = new CalendarEvent({
        uid: "tomorrow-sync",
        title: "Tomorrow Sync",
        start: new Date(2026, 8, 1, 0, 10, 0),
        end: new Date(2026, 8, 1, 1, 0, 0),
        allDay: false
      })

      assert.strictEqual(
        CompactBarPolicy.state(tomorrowEvent, new Date(2026, 7, 31, 23, 50, 0)),
        "idle"
      )
    })

    it("keeps a cross-midnight event pink while it is happening", () => {
      const overnightEvent = new CalendarEvent({
        uid: "overnight-maintenance",
        title: "Overnight Maintenance",
        start: new Date(2026, 7, 31, 23, 30, 0),
        end: new Date(2026, 8, 1, 0, 30, 0),
        allDay: false
      })

      assert.strictEqual(
        CompactBarPolicy.state(overnightEvent, new Date(2026, 8, 1, 0, 10, 0)),
        "ongoing"
      )
    })
  })

  describe("color()", () => {
    it("maps the five status states to their approved signal colors", () => {
      assert.deepStrictEqual(
        ["idle", "scheduled", "soon", "imminent", "ongoing"].map(state =>
          CompactBarPolicy.color(state)
        ),
        ["#4ade80", "#60a5fa", "#facc15", "#fb923c", "#fb7185"]
      )
    })
  })

  describe("notificationMilestone()", () => {
    it("selects only the 60-second window after each reminder threshold", () => {
      assert.strictEqual(CompactBarPolicy.notificationMilestone(event, minutesBefore(31)), null)
      assert.strictEqual(CompactBarPolicy.notificationMilestone(event, minutesBefore(30)), 30)
      assert.strictEqual(CompactBarPolicy.notificationMilestone(event, minutesBefore(29.5)), 30)
      assert.strictEqual(CompactBarPolicy.notificationMilestone(event, minutesBefore(28)), null)
      assert.strictEqual(CompactBarPolicy.notificationMilestone(event, minutesBefore(10)), 10)
      assert.strictEqual(CompactBarPolicy.notificationMilestone(event, minutesBefore(9.5)), 10)
      assert.strictEqual(CompactBarPolicy.notificationMilestone(event, minutesBefore(8)), null)
      assert.strictEqual(CompactBarPolicy.notificationMilestone(event, start), null)
    })

    it("never notifies for all-day events", () => {
      const allDay = new CalendarEvent({
        uid: "offsite",
        title: "Offsite",
        start: new Date(2026, 7, 31, 0, 0, 0),
        end: new Date(2026, 8, 1, 0, 0, 0),
        allDay: true
      })

      assert.strictEqual(CompactBarPolicy.notificationMilestone(allDay, minutesBefore(10)), null)
    })
  })

  describe("notification identity and content", () => {
    it("uses the occurrence and milestone to make stable distinct keys", () => {
      assert.strictEqual(
        CompactBarPolicy.notificationKey(event, 30),
        "weekly-review|1788184800000|30"
      )
      assert.strictEqual(
        CompactBarPolicy.notificationKey(event, 10),
        "weekly-review|1788184800000|10"
      )
    })

    it("builds concise notification content", () => {
      assert.deepStrictEqual(
        CompactBarPolicy.notificationPayload(event, 30, minutesBefore(29), false),
        {
          headline: "Weekly Review",
          description: "Starts in 29 minutes · 11:00"
        }
      )
      assert.deepStrictEqual(
        CompactBarPolicy.notificationPayload(event, 10, minutesBefore(9), true),
        {
          headline: "Weekly Review",
          description: "Starts in 9 minutes · 11:00 AM"
        }
      )
    })
  })

  describe("timed event selection", () => {
    it("selects the next timed event instead of an ongoing all-day event", () => {
      const allDay = new CalendarEvent({
        uid: "offsite",
        title: "Offsite",
        start: new Date(2026, 7, 31, 0, 0, 0),
        end: new Date(2026, 8, 1, 0, 0, 0),
        allDay: true
      })

      assert.strictEqual(
        CompactBarPolicy.nextTimedEvent([allDay, event], new Date(2026, 7, 31, 9, 0)),
        event
      )
    })

    it("returns every timed event currently due for a reminder", () => {
      const secondEvent = new CalendarEvent({
        uid: "product-sync",
        title: "Product Sync",
        start: new Date(2026, 7, 31, 11, 20, 0),
        end: new Date(2026, 7, 31, 12, 0, 0),
        allDay: false
      })
      const allDay = new CalendarEvent({
        uid: "holiday",
        title: "Holiday",
        start: new Date(2026, 7, 31, 0, 0, 0),
        end: new Date(2026, 8, 1, 0, 0, 0),
        allDay: true
      })

      assert.deepStrictEqual(
        CompactBarPolicy.notificationCandidates(
          [allDay, secondEvent, event],
          new Date(2026, 7, 31, 10, 50, 0)
        ),
        [
          { event, milestone: 10 },
          { event: secondEvent, milestone: 30 }
        ]
      )
    })

    it("keeps a milestone eligible on the next 30-second tick for retry", () => {
      assert.strictEqual(CompactBarPolicy.notificationMilestone(event, minutesBefore(30)), 30)
      assert.strictEqual(CompactBarPolicy.notificationMilestone(event, minutesBefore(29.5)), 30)
    })
  })
})
