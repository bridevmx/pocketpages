import { absoluteUrl } from './xml'

export type RobotsRule = {
  /** The crawlers the rule is for, `*` (all of them) unless told otherwise */
  userAgent?: string | string[]
  allow?: string[]
  disallow?: string[]
  /** Seconds between requests, for the crawlers that honor it */
  crawlDelay?: number
}

const line = (name: string, value: string) => {
  if (/[\r\n]/.test(value))
    throw new Error(`Invalid robots.txt value: ${JSON.stringify(value)}`)
  return `${name}: ${value}`
}

export const buildRobots = (
  rules: RobotsRule[],
  sitemaps: string[],
  baseUrl: string
): string => {
  const groups: string[] = []
  const list = rules.length > 0 ? rules : [{ allow: ['/'] }]
  for (const rule of list) {
    const lines: string[] = []
    const agents =
      rule.userAgent === undefined ? ['*'] : [rule.userAgent].flat()
    for (const agent of agents) lines.push(line('User-agent', agent))
    for (const path of rule.allow ?? []) lines.push(line('Allow', path))
    for (const path of rule.disallow ?? []) lines.push(line('Disallow', path))
    if (rule.crawlDelay !== undefined)
      lines.push(line('Crawl-delay', String(rule.crawlDelay)))
    // A group that says nothing blocks nothing
    if (lines.length === agents.length) lines.push('Disallow:')
    groups.push(lines.join('\n'))
  }
  const out = groups.join('\n\n')
  const maps = sitemaps.map((s) => line('Sitemap', absoluteUrl(baseUrl, s)))
  return maps.length > 0 ? `${out}\n\n${maps.join('\n')}\n` : `${out}\n`
}
