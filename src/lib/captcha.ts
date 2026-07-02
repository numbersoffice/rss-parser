import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const TTL_MS = 10 * 60 * 1000

// Domain-separate from other PAYLOAD_SECRET uses so a captcha MAC can never
// double as anything else.
const mac = (secret: string, answer: string, exp: number, nonce: string) =>
  createHmac('sha256', `captcha:${secret}`).update(`${answer}|${exp}|${nonce}`).digest('hex')

/**
 * Stateless math captcha: the answer never leaves the server in the clear —
 * only its HMAC travels inside the token, so verification needs no storage.
 * Token layout: `exp.nonce.mac`.
 */
export function generateCaptcha(secret: string): { question: string; token: string } {
  const ops = [
    { sym: '+', fn: (a: number, b: number) => a + b },
    { sym: '−', fn: (a: number, b: number) => a - b },
    { sym: '×', fn: (a: number, b: number) => a * b },
  ]
  const op = ops[Math.floor(Math.random() * ops.length)]
  let a = 2 + Math.floor(Math.random() * 8)
  let b = 2 + Math.floor(Math.random() * 8)
  if (op.sym === '−' && b > a) [a, b] = [b, a]
  const answer = String(op.fn(a, b))
  const exp = Date.now() + TTL_MS
  const nonce = randomBytes(16).toString('hex')
  return {
    question: `${a} ${op.sym} ${b}`,
    token: `${exp}.${nonce}.${mac(secret, answer, exp, nonce)}`,
  }
}

// Replay guard for successfully solved tokens. In-process only: this app runs
// as a single Node process, and a restart merely re-allows unexpired tokens
// once — harmless for a signup captcha.
const usedNonces = new Map<string, number>()

export function verifyCaptcha(secret: string, token: string, answerRaw: string): boolean {
  const [expStr, nonce, givenMac] = token.split('.')
  const exp = Number(expStr)
  if (!exp || !nonce || !givenMac || Date.now() > exp) return false
  if (usedNonces.has(nonce)) return false
  const answer = answerRaw.trim().replace(/\s+/g, '')
  if (!/^-?\d{1,3}$/.test(answer)) return false
  const expected = Buffer.from(mac(secret, answer, exp, nonce), 'hex')
  const given = Buffer.from(givenMac, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false
  usedNonces.set(nonce, exp)
  if (usedNonces.size > 1000) {
    const now = Date.now()
    for (const [n, e] of usedNonces) if (e < now) usedNonces.delete(n)
  }
  return true
}
