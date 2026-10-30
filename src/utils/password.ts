import { randomUUID } from 'node:crypto'
import bcrypt from 'bcrypt'

const SALT_ROUNDS = 12

export const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomUUID(), SALT_ROUNDS)

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash)
}
