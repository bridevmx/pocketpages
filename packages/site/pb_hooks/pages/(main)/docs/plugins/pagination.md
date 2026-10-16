# PocketPages Pagination Plugin

Page numbers, links and a `<nav>` for listings that don't fit in one page.

- **The arithmetic**: how many pages, what to skip and take in the database, which items a page shows.
- **Links that keep the rest of the URL**: searches, filters and sorting survive going from one page to the next.
- **A window of page numbers** (`1 … 9 10 11 … 20`) and an accessible `<nav>` you can use as it is or build yourself.

It needs `pocketpages` 0.23 or newer.

## Installation

```bash
npm install pocketpages-plugin-pagination
```

## Setup

```javascript
// +config.js
module.exports = {
  plugins: ['pocketpages-plugin-ejs', 'pocketpages-plugin-pagination'],
}
```

## Usage

Count the items, ask for the page, show it:

```javascript
// pages/blog/+load.js
module.exports = ({ paginate }) => {
  const filter = 'published = true'
  const total = $app.countRecords('posts', $dbx.hashExp({ published: true }))

  const pagination = paginate({ total, perPage: 10 })

  const posts = $app.findRecordsByFilter(
    'posts',
    filter,
    '-created',
    pagination.limit,
    pagination.offset
  )
  return { posts, pagination }
}
```

```html
<!-- pages/blog/index.ejs -->
<%% for (const post of data.posts) { %>
<article>
  <h2><%%= post.get('title') %></h2>
</article>
<%% } %>

<p>
  Posts <%%= data.pagination.from %>–<%%= data.pagination.to %> of <%%=
  data.pagination.total %>
</p>
<%%- data.pagination.nav() %>
```

The page number is the `page` parameter of the query string (`/blog?page=3`). A page number that is missing, or not a positive whole number, is the first page. One that is beyond the last page is shown as the last one, and `pagination.outOfRange` tells you if you would rather answer with a 404:

```javascript
if (pagination.outOfRange) throw new NotFoundError()
```

### What `paginate()` returns

|                               |                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `page`                        | The page being shown (1, 2, 3...)                                                           |
| `totalPages`                  | How many pages there are, 1 at the least                                                    |
| `perPage`, `total`            | Items per page, items in all                                                                |
| `offset`, `limit`             | What to skip and what to take in the database                                               |
| `from`, `to`                  | The numbers of the first and the last item the page shows (`0` and `0` when there are none) |
| `hasPrev`, `hasNext`          | Whether there is a page before and after                                                    |
| `prev`, `next`                | Their numbers, `null` when there are none                                                   |
| `pages`                       | The numbers to link to, with `null` for gaps: `[1, null, 9, 10, 11, null, 20]`              |
| `requestedPage`, `outOfRange` | The page that was asked for, and whether it was beyond the last one                         |
| `url(page)`                   | The URL of a page of this listing                                                           |
| `prevUrl`, `nextUrl`          | The URLs of the previous and the next page, `null` when there are none                      |
| `nav(options?)`               | The links as a `<nav>`, `''` when there is a single page                                    |

### Links

`url(3)` is the address of the page the visitor is on with `page=3`, and everything else in the query string as it was: `/blog?q=hello&tag=news&page=3`. The address is the one the visitor used, so a plugin that rewrites URLs (a language prefix, for instance) does not break the links. The link to the first page leaves `page` out (`/blog`), so a page has a single address.

### The nav

```html
<nav class="pagination" aria-label="Pagination">
  <a class="page" href="/blog?page=1" rel="prev">‹ Previous</a>
  <a class="page" href="/blog">1</a>
  <a class="page current" href="/blog?page=2" aria-current="page">2</a>
  <a class="page" href="/blog?page=3">3</a>
  <span class="gap" aria-hidden="true">…</span>
  <a class="page" href="/blog?page=20">20</a>
  <a class="page" href="/blog?page=3" rel="next">Next ›</a>
</nav>
```

Change the words and the class names:

```javascript
pagination.nav({
  label: 'Páginas',
  prev: 'Anterior',
  next: 'Siguiente',
  classes: {
    nav: 'pager',
    item: 'btn',
    current: 'active',
    disabled: 'off',
    gap: 'dots',
  },
})
```

Or loop over `pages` and write the markup of your CSS framework yourself:

```html
<ul>
  <%% for (const p of pagination.pages) { %> <%% if (p === null) { %>
  <li>…</li>
  <%% } else { %>
  <li class="<%%= p === pagination.page ? 'active' : '' %>">
    <a href="<%%= pagination.url(p) %>"><%%= p %></a>
  </li>
  <%% } %> <%% } %>
</ul>
```

## Options

Everything can be set for the site, and overridden in each call to `paginate()`:

```javascript
module.exports = {
  plugins: [
    'pocketpages-plugin-ejs',
    {
      name: 'pocketpages-plugin-pagination',
      perPage: 20, // items per page
      pageParam: 'page', // the parameter of the query string
      perPageParam: false, // name one ('size') to let visitors choose how many items they get
      maxPerPage: 100, // the most they can ask for
      siblings: 1, // pages shown on each side of the current one
      boundaries: 1, // pages always shown at each end
      omitFirstPage: true, // leave ?page=1 out of the link to the first page
    },
  ],
}
```

`paginate()` also takes `page`, to show a page other than the one in the query string.

## Counting records

PocketBase can count records for you with an expression: `$app.countRecords('posts', $dbx.hashExp({ published: true }))`. Filters written in PocketBase's filter syntax (`created > "2024-01-01" && title ~ "news"`) are for finding records, not for counting them. Use `$dbx.exp()` to count with the SQL equivalent, or load the ids and count them if the listing is small.
