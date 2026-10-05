import type { UserLoginEvent } from '@netlify/functions'
import { getDb } from '../../server/db/client.ts'
import { auditLog, users } from '../../server/db/schema.ts'
import { eq } from 'drizzle-orm'

/**
 * Zdarzenia Identity → audit log (M19: logowania).
 * Uwaga: Identity nie emituje zdarzeń dla nieudanych logowań — te widoczne są w audit logu Identity (plan Pro+).
 */
export default {
  async userLogin(event: UserLoginEvent) {
    const db = getDb()
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.identitySub, event.user.id))
    await db.insert(auditLog).values({
      userId: user?.id ?? null,
      action: 'auth.identity_login',
      entity: 'users',
      entityId: user?.id ?? null,
      changes: user ? null : { identitySub: event.user.id, email: event.user.email ?? null, registered: false },
    })
  },
}
