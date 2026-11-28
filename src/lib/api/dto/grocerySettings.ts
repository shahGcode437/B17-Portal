/**
 * The Grocery operating settings, Super Admin only, exactly as the backend serves them
 * (`docs/backend/API_CONTRACT.md` §18.6; `backend/app/schemas/grocery.py`).
 */

import type { GroceryPaymentMethodDto } from "@/lib/api/dto/grocery"

export interface GrocerySettingsDto {
  /** The version number. A change must send the version it was made from. */
  revision: number
  enabled: boolean
  serviceableBlocks: string[]
  /** ISO weekdays, 1 = Monday. */
  operatingDays: number[]
  /** `HH:MM`. Orders are accepted from `opensAt` (included) until `closesAt` (excluded). */
  opensAt: string
  closesAt: string
  timezone: string
  /** Orders accepted per Pakistan calendar day. */
  dailyCapacity: number
  /** The largest agreed total, fees included, in paisa. */
  maxOrderValuePaisa: number
  maxActiveOrdersPerCustomer: number
  maxItemsPerOrder: number
  /** What customers are offered and staff can record. Cash on delivery is always in it. */
  paymentMethods: GroceryPaymentMethodDto[]
  /** A Super Admin's statement that the listed blocks cover all of B-17. */
  coversAllB17: boolean
  updatedAt: string
  /** Absent when no person is recorded for this version. */
  updatedBy?: { userId: string; displayName?: string }
}

/** The fields a change may carry. `timezone` is accepted by the API but has one allowed value. */
export type GrocerySettingsField =
  | "enabled"
  | "serviceableBlocks"
  | "operatingDays"
  | "opensAt"
  | "closesAt"
  | "dailyCapacity"
  | "maxOrderValuePaisa"
  | "maxActiveOrdersPerCustomer"
  | "maxItemsPerOrder"
  | "paymentMethods"
  | "coversAllB17"

/** The body of `PATCH`: strict. An omitted field is unchanged; `null` is refused; lists replace whole. */
export type GrocerySettingsPatchDto = { revision: number } & Partial<Pick<GrocerySettingsDto, GrocerySettingsField>>
