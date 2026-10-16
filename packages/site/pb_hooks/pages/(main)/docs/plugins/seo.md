# PocketPages SEO Plugin

What search engines and social networks look for, without writing it by hand.

- **The `<head>` of each page**: title, description, canonical address, Open Graph and Twitter cards, `robots`, structured data (JSON-LD) and breadcrumbs.
- **`sitemap.xml`** made from your pages and from the records of your collections, with the `hreflang` alternates of the [i18n plugin](/docs/plugins/i18n).
- **`robots.txt`** with the rules you give it, and a link to the sitemap.
- **RSS feeds** from a collection.

It needs `pocketpages` 0.23 or newer.

## Installation

```bash
npm install pocketpages-plugin-seo
```

## Setup

```javascript
// +config.js
module.exports = {
  plugins: [
    'pocketpages-plugin-ejs',
    {
      name: 'pocketpages-plugin-seo',
      siteName: 'Acme',
      baseUrl: 'https://acme.example.com', // the appURL setting of PocketBase by default
      description: 'Rockets for everyone',
      image: '/img/share.png', // for pages that don't have an image of their own
      twitter: '@acme',
    },
  ],
}
```

`sitemap.xml` and `robots.txt` are served from now on. Put the tags in the layout:

```html
<!-- pages/+layout.ejs -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <%%- seo.head() %>
  </head>
  <body>
    <%%- slot %>
  </body>
</html>
```

Pages say what they are about. The page is rendered before its layout, so anything a page sets is in the head:

```html
<!-- pages/pricing/index.ejs -->
<%% seo.set({ title: 'Pricing', description: 'Plans for teams of every size', })
%>
<h1>Pricing</h1>
```

## The head

`seo.head()` writes the tags. Everything is optional, and anything missing is left out:

```html
<title>Pricing | Acme</title>
<meta name="description" content="Plans for teams of every size" />
<link rel="canonical" href="https://acme.example.com/pricing" />
<meta property="og:site_name" content="Acme" />
<meta property="og:type" content="website" />
<meta property="og:title" content="Pricing | Acme" />
<meta property="og:description" content="Plans for teams of every size" />
<meta property="og:url" content="https://acme.example.com/pricing" />
<meta property="og:image" content="https://acme.example.com/img/share.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="@acme" />
<meta name="twitter:title" content="Pricing | Acme" />
...
```

What `seo.set()` takes (and the config too, for what is the same on every page):

| Field                           | What it is                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `title`                         | The title of the page. `titleTemplate` turns it into `Pricing \| Acme`.                             |
| `siteName`                      | The name of the site                                                                                |
| `description`                   | What the page is about, about 150 characters                                                        |
| `canonical`                     | The address of the page when it is not the one the visitor used. A path or a complete address.      |
| `image`, `imageAlt`             | The picture for when the page is shared. Paths are made complete.                                   |
| `type`                          | `website` (the default) or `article`, `profile`... for Open Graph                                   |
| `noindex`, `nofollow`           | Keep the page out of search results, and the links on it unfollowed                                 |
| `locale`                        | `en_US` for Open Graph. Taken from the language of the visitor when the i18n plugin knows a region. |
| `twitter`, `twitterCreator`     | The handles of the site and of the author                                                           |
| `twitterCard`                   | `summary_large_image` when there is an image and `summary` when there is not, unless you say        |
| `publishedTime`, `modifiedTime` | For articles. ISO dates.                                                                            |
| `author`, `section`, `tags`     | For articles                                                                                        |
| `meta`                          | Any other `<meta name>`: `{ 'theme-color': '#0b5fff' }`                                             |

Config options only: `titleTemplate` (`{title} | {siteName}`), `defaultTitle` (for pages without a title; the site name unless told otherwise) and `baseUrl`.

**The canonical address is the path of the page without the query string**, in the language the visitor used. A listing with `?page=2` or `?sort=name` has the address of the listing, unless you set `canonical`.

Methods of `seo`:

|                           |                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `seo.set(data)`           | What this page says about itself. Returns `seo`, so calls can be chained.               |
| `seo.get()`               | Everything that will be written, config and page together                               |
| `seo.title()`             | The title as it is going to be written                                                  |
| `seo.head()`              | The tags                                                                                |
| `seo.jsonLd(data)`        | Adds structured data to the head: an object, or a list of them                          |
| `seo.breadcrumbs(items)`  | Adds a `BreadcrumbList`: `[{ name: 'Home', url: '/' }, { name: 'Blog', url: '/blog' }]` |
| `seo.excerpt(html, max?)` | The text of some HTML without tags, cut at a word, for a description (160 characters)   |

Values are escaped, `</script>` included in structured data, so what visitors write can safely end up in them.

### Structured data

```html
<%% seo.set({ title: post.title, type: 'article', publishedTime: post.created })
.jsonLd({ '@context': 'https://schema.org', '@type': 'Article', headline:
post.title, datePublished: post.created, author: { '@type': 'Person', name:
'Ana' }, }) .breadcrumbs([{ name: 'Home', url: '/' }, { name: 'Blog', url:
'/blog' }, { name: post.title, url: '/blog/' + post.slug }]) %>
```

### Languages

When the [i18n plugin](/docs/plugins/i18n) is there, `seo.head()` also writes its `hreflang` links (set `hreflang: false` to leave them out), and the sitemap lists every page in every language.

## sitemap.xml

By default it lists the pages of your site that have an address of their own: not those with a `[param]` in their path, not files. Say what else belongs, and what doesn't:

```javascript
{
  name: 'pocketpages-plugin-seo',
  sitemap: {
    exclude: ['/admin/**', '/account/**', '/login'],
    urls: [{ path: '/pricing', changefreq: 'monthly', priority: 0.8 }],
    collections: [
      {
        collection: 'posts',
        filter: 'published = true', // the sitemap is public: leave the drafts out
        path: '/blog/{slug}', // the fields of the record fill in {slug}
        lastmod: 'updated', // the field with the day it last changed, `updated` unless told otherwise
        changefreq: 'weekly',
      },
    ],
    ttl: 3600, // seconds a sitemap is kept before it is made again
  },
}
```

- `pages: false` leaves the pages out, for sites that list everything by hand.
- Sitemaps are kept for an hour (`ttl`) in a cache all of PocketBase's JS runtimes share, and answered with an `ETag`, so crawlers that already have it get a `304`. With `--dev` they are made again for every request.
- A sitemap holds 50,000 addresses at the most.
- A page of your own at `/sitemap.xml` (a `sitemap.xml.ejs`) wins over the one made here. Pages with a `[param]` in their address (a `[slug].ejs` at the root, say) don't: `sitemap.xml`, `robots.txt` and the feeds are served first.
- `sitemap: false` serves none.

## robots.txt

```javascript
{
  name: 'pocketpages-plugin-seo',
  robots: {
    rules: [
      { userAgent: '*', disallow: ['/admin', '/api'] },
      { userAgent: ['GPTBot', 'CCBot'], disallow: ['/'] },
    ],
    sitemap: true, // a Sitemap line (true: the one above), or the addresses of others
  },
}
```

Without rules, everything is allowed. `robots: false` serves none.

`robots.txt` and `noindex` do different things. A page that must stay out of the results needs `seo.set({ noindex: true })` and not to be blocked in `robots.txt`: crawlers that can't open a page never see the `noindex`.

## RSS feeds

```javascript
{
  name: 'pocketpages-plugin-seo',
  feeds: [
    {
      path: '/blog/rss.xml',
      title: 'Acme blog',
      description: 'News from the rocket factory',
      link: '/blog',
      collection: 'posts',
      filter: 'published = true',
      sort: '-created',
      limit: 20,
      item: {
        title: 'title',
        link: '/blog/{slug}',
        description: 'summary',
        content: 'body', // the whole post, in HTML
        date: 'created',
        author: 'authorName',
      },
    },
  ],
}
```

Each key of `item` names a field of the collection. Add `<link rel="alternate" type="application/rss+xml" href="/blog/rss.xml">` to the head for browsers and readers to find the feed.

## Options

```javascript
{
  name: 'pocketpages-plugin-seo',
  baseUrl: 'https://acme.example.com',
  siteName: 'Acme',
  titleTemplate: '{title} | {siteName}',
  defaultTitle: 'Acme - Rockets for everyone',
  hreflang: true,
  robots: {},   // or false
  sitemap: {},  // or false
  feeds: [],
  // ... and the fields of seo.set(), as defaults for every page
}
```

Set `baseUrl`, or the `appURL` setting of PocketBase: addresses in tags and documents must be complete.
