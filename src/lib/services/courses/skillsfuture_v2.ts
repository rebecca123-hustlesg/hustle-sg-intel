// SkillsFuture scraper v2 — real data only.
// Source: https://www.myskillsfuture.gov.sg/services/tex/individual/course-search
// STRICT DATA RULE: Never return mock/sample data. Return empty array if source unavailable.

const SF_API = 'https://www.myskillsfuture.gov.sg/services/tex/individual/course-search'

export interface SFCourse {
  sfRefNo: string
  title: string
  providerName: string
  category: string
  durationHours: number | null
  fundingStart: string | null
  fundingEnd: string | null
  totalCost: number | null
  popularityScore: number
  respondents: number
  rating: number
  activeRunCount: number
  modeOfTraining: string | null
}

export interface SFScrapeResult {
  courses: SFCourse[]
  sourceUrl: string
  totalFound: number
}

function popScore(respondents: number, rating: number, hasRuns: boolean): number {
  const score = Math.log10(respondents + 1) * 20 + rating * 10 + (hasRuns ? 20 : 0)
  return Math.min(100, Math.round(score * 10) / 10)
}

function parseDoc(doc: Record<string, unknown>): SFCourse | null {
  const sfRefNo = String(doc['Course_Ref_No'] ?? '').trim()
  if (!sfRefNo) return null

  const title = String(doc['Course_Title'] ?? '').trim()
  const providerName = String(doc['TP_ALIAS'] ?? doc['Organisation_Name'] ?? '').trim()
  const categoryArr = doc['Area_of_Training_text'] as string[] | undefined
  const category = categoryArr?.[0] ?? ''
  const respondents = Number(doc['Course_Quality_NumberOfRespondents'] ?? 0)
  const rating = Number(doc['Course_Quality_Stars_Rating'] ?? 0)
  const hasRuns = Boolean(doc['HasCourseRun'])
  const totalCost = doc['Tol_Cost_of_Trn_Per_Trainee'] != null
    ? Number(doc['Tol_Cost_of_Trn_Per_Trainee'])
    : null
  const modeArr = doc['Mode_of_Training_text'] as string[] | undefined
  const modeOfTraining = modeArr?.[0] ?? null

  return {
    sfRefNo, title, providerName, category,
    durationHours: null,
    fundingStart: null,
    fundingEnd: null,
    totalCost,
    popularityScore: popScore(respondents, rating, hasRuns),
    respondents,
    rating,
    activeRunCount: hasRuns ? 1 : 0,
    modeOfTraining,
  }
}

export async function scrapeSkillsFutureV2(searchTerm: string, pageSize = 100): Promise<SFScrapeResult> {
  const params = new URLSearchParams({
    keyword: searchTerm,
    pageIndex: '0',
    pageSize: String(pageSize),
    sortBy: 'relevance',
    filters: JSON.stringify({}),
  })
  const url = `${SF_API}?${params.toString()}`
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; HustleSGIntel/2.0)',
      'Referer': 'https://www.myskillsfuture.gov.sg/',
    },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`SkillsFuture API returned ${res.status}: ${res.statusText}`)

  const json = await res.json() as Record<string, unknown>

  // API returns grouped Solr response: grouped.GroupID.groups[].doclist.docs[0]
  const grouped = (json['grouped'] as Record<string, unknown> | undefined)?.['GroupID'] as Record<string, unknown> | undefined
  const groups = (grouped?.['groups'] as Array<Record<string, unknown>> | undefined) ?? []
  const numFound = Number(grouped?.['ngroups'] ?? groups.length)

  const courses: SFCourse[] = []
  for (const group of groups) {
    const doclist = group['doclist'] as Record<string, unknown> | undefined
    const docs = (doclist?.['docs'] as Array<Record<string, unknown>> | undefined) ?? []
    if (docs.length > 0) {
      const course = parseDoc(docs[0])
      if (course) courses.push(course)
    }
  }

  return { courses, sourceUrl: url, totalFound: numFound }
}
