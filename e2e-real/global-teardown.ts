import { cleanup } from './helpers/stack'

/** Removes ONLY the P12I-tagged records this run created and reports before / after counts. */
export default async function globalTeardown() {
  if (process.env.P12I_KEEP === '1') return
  const { before, after } = cleanup()
  console.log('[real-stack] cleanup before:', JSON.stringify(before))
  console.log('[real-stack] cleanup after :', JSON.stringify(after))
  if (Object.values(after).some((n) => n !== 0)) throw new Error('P12I records remain after cleanup')
}
