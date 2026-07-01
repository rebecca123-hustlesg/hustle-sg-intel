/**
 * Shared employer-identity validation for keyword-search hiring sources
 * (JobStreet, MyCareersFuture). A job is only attributed to a competitor when
 * the employer named on the source page positively matches the competitor.
 *
 * The token logic below is moved VERBATIM from the JobStreet scraper so matching
 * behaviour is unchanged — it must not be loosened. Fail closed: when the
 * employer is missing or does not match, the job is rejected.
 */

const GENERIC_COMPANY_TOKENS = new Set([
  'pte', 'ltd', 'llp', 'inc', 'limited', 'the', 'and', 'academy', 'institute',
  'training', 'school', 'college', 'singapore', 'sg', 'co', 'company', 'group',
])

export function significantTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !GENERIC_COMPANY_TOKENS.has(t))
}

/** Loose, suffix-insensitive company match (e.g. "Vertical Institute Pte Ltd"). */
export function companyMatches(competitor: string, company: string | null | undefined): boolean {
  if (!company) return false
  const wanted = significantTokens(competitor)
  if (wanted.length === 0) return true // nothing distinctive to match on — keep it
  const have = new Set(significantTokens(company))
  return wanted.some((t) => have.has(t))
}

/**
 * Extract the employer/company name from a stored job's raw_data, per source.
 * Only JobStreet and MyCareersFuture are supported — every other source returns
 * null (career pages are authoritative and validated by construction; Indeed is
 * out of scope).
 */
export function getEmployerName(
  source: string,
  raw: Record<string, unknown> | null | undefined
): string | null {
  if (!raw) return null
  if (source === 'jobstreet') {
    return (raw.companyName as string | null | undefined) ?? null
  }
  if (source === 'mycareersfuture') {
    const posted = (raw.postedCompany as { name?: string } | null | undefined)?.name
    const hiring = (raw.hiringCompany as { name?: string } | null | undefined)?.name
    return posted ?? hiring ?? null
  }
  return null
}
