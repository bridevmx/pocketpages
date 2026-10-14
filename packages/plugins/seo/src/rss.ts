import { cdata, escapeXml, toRfc822 } from './xml'

export type FeedChannel = {
  title: string
  /** The page the feed is about */
  link: string
  description: string
  /** The address of the feed itself */
  self: string
  language?: string
  /** Minutes a reader can keep the feed without asking again */
  ttl?: number
}

export type FeedItem = {
  title: string
  link: string
  description?: string
  /** The whole post, as HTML */
  content?: string
  date?: string
  author?: string
  guid?: string
  categories?: string[]
}

export const buildRss = (channel: FeedChannel, items: FeedItem[]): string => {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '<channel>',
    `<title>${escapeXml(channel.title)}</title>`,
    `<link>${escapeXml(channel.link)}</link>`,
    `<description>${escapeXml(channel.description)}</description>`,
    `<atom:link href="${escapeXml(channel.self)}" rel="self" type="application/rss+xml"/>`,
  ]
  if (channel.language)
    lines.push(`<language>${escapeXml(channel.language)}</language>`)
  if (channel.ttl !== undefined)
    lines.push(`<ttl>${Math.floor(channel.ttl)}</ttl>`)
  const newest = items.map((i) => toRfc822(i.date)).find((d) => d)
  if (newest) lines.push(`<lastBuildDate>${newest}</lastBuildDate>`)

  for (const item of items) {
    lines.push('<item>')
    lines.push(`<title>${escapeXml(item.title)}</title>`)
    lines.push(`<link>${escapeXml(item.link)}</link>`)
    lines.push(
      `<guid isPermaLink="${item.guid ? 'false' : 'true'}">${escapeXml(item.guid ?? item.link)}</guid>`
    )
    const date = toRfc822(item.date)
    if (date) lines.push(`<pubDate>${date}</pubDate>`)
    if (item.author)
      lines.push(`<dc:creator>${escapeXml(item.author)}</dc:creator>`)
    for (const category of item.categories ?? [])
      lines.push(`<category>${escapeXml(category)}</category>`)
    if (item.description)
      lines.push(`<description>${escapeXml(item.description)}</description>`)
    if (item.content)
      lines.push(`<content:encoded>${cdata(item.content)}</content:encoded>`)
    lines.push('</item>')
  }
  lines.push('</channel>', '</rss>')
  return lines.join('\n') + '\n'
}
