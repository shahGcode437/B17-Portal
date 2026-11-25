import { describe, expect, it } from "vitest"
import {
  MAX_PHONE_LENGTH,
  PHONE_MESSAGE,
  formatPhone,
  isNormalizedPhone,
  normalizePhone,
  phoneProblem,
  telHref,
  whatsappHref,
} from "@/lib/phone"

/**
 * The browser side of the listing-contact rules (Listing Contact v1). This file is the mirror of
 * `backend/tests/test_phone_unit.py`: the SAME inputs and the SAME canonical results, so a number
 * the form accepts is one the API accepts, and a number the form refuses is one the API would have
 * refused with `422 invalid_phone`.
 */

/** What a person in B-17 might type -> what the API stores. */
const ACCEPTED: [string, string][] = [
  ["03001234567", "+923001234567"],
  ["0300 1234567", "+923001234567"],
  ["0300 123 4567", "+923001234567"],
  ["0300-123-4567", "+923001234567"],
  ["0300.123.4567", "+923001234567"],
  ["(0300) 123 4567", "+923001234567"],
  ["0300/1234567", "+923001234567"],
  ["  03001234567  ", "+923001234567"],
  ["+923001234567", "+923001234567"],
  ["+92 300 1234567", "+923001234567"],
  ["+92-300-1234567", "+923001234567"],
  ["923001234567", "+923001234567"],
  ["92 300 1234567", "+923001234567"],
  ["0092 3001234567", "+923001234567"],
  ["00923001234567", "+923001234567"],
  ["051 1234567", "+92511234567"],
  ["0511234567", "+92511234567"],
  ["+92 51 1234567", "+92511234567"],
  ["021 12345678", "+922112345678"],
  ["0300 1234567", "+923001234567"],
  ["0300–1234567", "+923001234567"],
]

const REFUSED = [
  "",
  "   ",
  "abc",
  "0300123",
  "03001234",
  "030012345678",
  "0300123456789012",
  "12345",
  "0",
  "+",
  "++923001234567",
  "+0300123456",
  "0300 1234 567x",
  "03OO1234567",
  "+92 1",
  "tel:03001234567",
  "0300,1234567",
  "<script>03001234567</script>",
]

describe("normalizePhone", () => {
  it.each(ACCEPTED)("stores %s as %s", (typed, stored) => {
    expect(normalizePhone(typed)).toBe(stored)
  })

  it.each(REFUSED)("refuses %j and never repairs it", (typed) => {
    expect(normalizePhone(typed)).toBeNull()
  })

  it("is idempotent: the stored form normalises to itself", () => {
    for (const [, stored] of ACCEPTED) expect(normalizePhone(stored)).toBe(stored)
  })

  it("refuses a missing value rather than inventing one", () => {
    expect(normalizePhone(undefined)).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })

  it("refuses input longer than the cap the API also applies", () => {
    expect(normalizePhone("+92 300 1234567" + " ".repeat(MAX_PHONE_LENGTH))).toBeNull()
    expect(normalizePhone("+92 (300) 123-4567")).toBe("+923001234567")
  })

  it("accepts a country we state no plan for, on the generic E.164 rule (future international support)", () => {
    expect(normalizePhone("+1 555 0100")).toBe("+15550100")
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958")
  })

  it("rejects a Pakistani number of the wrong length (what the generic rule alone would let through)", () => {
    expect(normalizePhone("0300123")).toBeNull()
    expect(normalizePhone("+92300123")).toBeNull()
  })
})

describe("isNormalizedPhone", () => {
  it("accepts only canonical E.164", () => {
    expect(isNormalizedPhone("+923001234567")).toBe(true)
    for (const value of ["0300 1234567", "03001234567", "923001234567", "+92 300 1234567", "", undefined, null]) {
      expect(isNormalizedPhone(value)).toBe(false)
    }
  })
})

describe("phoneProblem (what the form tells a person before a submit)", () => {
  it("asks for the required contact number when the field is empty", () => {
    expect(phoneProblem("", { required: true })).toBe("Please enter a contact number.")
    expect(phoneProblem("   ", { required: true })).toBe("Please enter a contact number.")
    expect(phoneProblem(undefined, { required: true })).toBe("Please enter a contact number.")
  })

  it("lets an optional field stay empty", () => {
    expect(phoneProblem("", { required: false })).toBeNull()
    expect(phoneProblem(undefined, { required: false })).toBeNull()
  })

  it("explains an unreadable number with an example, required or not", () => {
    expect(phoneProblem("0300123", { required: true })).toBe(PHONE_MESSAGE)
    expect(phoneProblem("0300123", { required: false })).toBe(PHONE_MESSAGE)
    expect(PHONE_MESSAGE).toContain("03001234567")
  })

  it("accepts every form the API accepts", () => {
    for (const [typed] of ACCEPTED) {
      if (!typed.trim()) continue
      expect(phoneProblem(typed, { required: true }), typed).toBeNull()
    }
  })
})

describe("formatPhone (what a reader sees)", () => {
  it("writes a Pakistani mobile the familiar way", () => {
    expect(formatPhone("+923001234567")).toBe("0300 1234567")
    expect(formatPhone("+923217654321")).toBe("0321 7654321")
  })

  it("writes a landline with its area code, not as a mobile", () => {
    expect(formatPhone("+92512345678")).toBe("051 2345678")
    expect(formatPhone("+922112345678")).toBe("021 12345678")
  })

  it("leaves a number of another country as the E.164 it is", () => {
    expect(formatPhone("+15550100")).toBe("+15550100")
    expect(formatPhone("+442079460958")).toBe("+442079460958")
  })

  it("never pretends a non-canonical value is a number", () => {
    expect(formatPhone("0300 1234567")).toBe("0300 1234567")
    expect(formatPhone("")).toBe("")
  })
})

describe("telHref / whatsappHref (links are built from canonical values only)", () => {
  it("builds the two links from a stored number", () => {
    expect(telHref("+923001234567")).toBe("tel:+923001234567")
    expect(whatsappHref("+923001234567")).toBe("https://wa.me/923001234567")
    expect(whatsappHref("+92512345678")).toBe("https://wa.me/92512345678")
  })

  it("returns null for anything that did not pass the parser, so no caller can render a dead link", () => {
    for (const value of ["0300 1234567", "03001234567", "abc", "", undefined, null, "+92 300 1234567"]) {
      expect(telHref(value), String(value)).toBeNull()
      expect(whatsappHref(value), String(value)).toBeNull()
    }
  })

  it("never puts raw user input into a URL", () => {
    const hostile = "+923001234567?text=hi"
    expect(telHref(hostile)).toBeNull()
    expect(whatsappHref(hostile)).toBeNull()
    expect(whatsappHref("+92300123456</script>")).toBeNull()
  })

  it("wa.me takes digits only (no +), which is what it expects", () => {
    expect(whatsappHref("+923001234567")).not.toContain("+")
  })
})
