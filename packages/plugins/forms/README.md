# PocketPages Forms Plugin

Read, convert and check what a form sent. Show what is wrong with it, and what was typed in.

- **Exactly what was sent.** `01234` stays `01234`. (PocketBase's `formData()` turns it into the number `1234`, and `true` into a boolean, which is not what a text field should end up with.)
- **A schema says what you expect**: types, required fields, lengths, ranges, patterns, options, files. Everything else the client sends is dropped, so no one can set a field you did not ask for.
- **Errors by field**, with messages you can change, and the values to put back in the form.
- **File uploads** checked for size and extension.
- **`PUT`, `PATCH` and `DELETE` from plain HTML forms**, with a hidden `_method` field.

It needs `pocketpages` 0.23 or newer.

## Installation

```bash
npm install pocketpages-plugin-forms
```

## Setup

```javascript
// +config.js
module.exports = {
  plugins: ['pocketpages-plugin-ejs', 'pocketpages-plugin-forms'],
}
```

## Usage

Describe the form once, in the loader, and show the result in the page:

```javascript
// pages/contact/+load.js
module.exports = ({ forms, redirect }) => {
  const form = forms.parse({
    name: { required: true, maxLength: 80 },
    email: { type: 'email', required: true },
    message: { required: true, minLength: 10 },
  })

  if (form.ok) {
    $app.save(/* a record made of form.values */)
    return redirect('/contact/thanks')
  }
  return { form }
}
```

```html
<!-- pages/contact/index.ejs -->
<form method="post">
  <label>
    Name
    <input name="name" value="<%= data.form.value('name') %>" />
  </label>
  <% if (data.form.hasError('name')) { %>
  <p class="error"><%= data.form.error('name') %></p>
  <% } %>

  <label>
    Email
    <input name="email" value="<%= data.form.value('email') %>" />
  </label>
  <p class="error"><%= data.form.error('email') %></p>

  <textarea name="message"><%= data.form.value('message') %></textarea>
  <button>Send</button>
</form>
```

One loader (`+load.js`) can serve the page for `GET` and take the form for `POST`: `forms.parse()` tells a form that was not sent yet from one that was. Nothing is checked, and nothing is wrong, until the visitor sends it.

### `forms.parse(schema, options?)`

Returns a `Form`:

|                               |                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `form.ok`                     | It was sent and nothing is wrong with it                                                                   |
| `form.invalid`                | It was sent and something is wrong with it                                                                 |
| `form.submitted`              | It was sent                                                                                                |
| `form.values`                 | The fields of the schema, converted to the types they ask for. **This is what to save.**                   |
| `form.errors`                 | The first thing wrong with each field that has something wrong, `{ email: 'Enter a valid email address' }` |
| `form.raw`                    | What was typed in, as text                                                                                 |
| `form.value(name, fallback?)` | What is in a field, as text, to put in its `value`. `fallback` (`''`) if it is empty.                      |
| `form.error(name)`            | What is wrong with a field, `''` if nothing                                                                |
| `form.hasError(name)`         | Whether something is                                                                                       |
| `form.errorList()`            | All the errors in the order of the schema, `[{ field, message }]`                                          |
| `form.has(name, value?)`      | For checkboxes, radio buttons and options: whether the field holds `value` (or anything, without `value`)  |

Options:

|            |                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`   | `'body'`, `'query'` or `'auto'` (the default): the body for requests that change something, the query string for `GET`. A form of the query string, a search for instance, only counts as sent if one of its fields is in it. |
| `defaults` | What the fields hold before the form is sent. Edit forms start from the record: `{ defaults: record.export() }`.                                                                                                              |
| `messages` | What to say, by rule, for this form                                                                                                                                                                                           |
| `status`   | The status to answer with when the form is invalid (see below)                                                                                                                                                                |

`forms.blank(schema, defaults?)` is a form that was not sent, for pages that show one without a `+load.js` to decide.

### Fields

`type` is one of:

| Type       | Value in `form.values`                                                                                               | Empty field |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ----------- |
| `string`   | Text, trimmed. This is the default type.                                                                             | `''`        |
| `email`    | Text in lower case that looks like an email address                                                                  | `''`        |
| `url`      | An `http:` or `https:` URL                                                                                           | `''`        |
| `int`      | A whole number                                                                                                       | `null`      |
| `number`   | A number                                                                                                             | `null`      |
| `boolean`  | `true` for `on`, `true`, `1`, `yes`; `false` for anything else, a checkbox that was not checked included             | `false`     |
| `date`     | `2024-02-29`, which has to be a day that exists                                                                      | `''`        |
| `datetime` | `2024-02-29 13:30:00`, from the `datetime-local` format too                                                          | `''`        |
| `array`    | An array: a field that was sent several times (`tags` or `tags[]`), checkboxes sharing a name, a `<select multiple>` | `[]`        |
| `file`     | The uploaded file, ready to be set on a record. An array with `multiple: true`.                                      | `null`      |

Rules, all of them optional:

| Rule                            | What it does                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `required`                      | The field cannot be empty. For a `boolean` it has to be checked (accept the terms), for an `array` it needs an item. |
| `default`                       | What an empty field holds. A field with a default cannot be missing.                                                 |
| `label`                         | How the field is called in messages. `first_name` and `firstName` are "First name" without it.                       |
| `minLength`, `maxLength`        | Characters, counted the way people count them (an emoji is one)                                                      |
| `min`, `max`                    | The value of numbers, the first and last day of dates, the number of items of arrays                                 |
| `pattern`, `patternFlags`       | A regular expression, as text: `'^\\d{5}$'`                                                                          |
| `oneOf`                         | The values that are allowed. For an array, each item has to be one of them.                                          |
| `of`                            | The type of the items of an array: `'int'` for a list of ids                                                         |
| `match`                         | The name of another field that has to hold the same: `confirm: { match: 'password' }`                                |
| `trim`, `lowercase`             | `false` to keep spaces around text, or the case of an email                                                          |
| `maxSize`, `accept`, `multiple` | For files: the most bytes, the extensions allowed (`['.png', '.jpg']`), more than one                                |
| `messages`                      | What to say for this field, by rule                                                                                  |
| `validate`                      | Your own check: `(value, values) => 'What is wrong' or nothing`                                                      |

Only the first thing wrong with a field is reported.

### Files

```javascript
module.exports = ({ forms, redirect, auth }) => {
  const form = forms.parse({
    title: { required: true },
    cover: {
      type: 'file',
      maxSize: 2 * 1024 * 1024,
      accept: ['.png', '.jpg', '.webp'],
    },
  })
  if (!form.ok) return { form }

  const record = new Record($app.findCollectionByNameOrId('posts'))
  record.set('title', form.values.title)
  if (form.values.cover) record.set('cover', form.values.cover) // a file from the form
  $app.save(record)
  return redirect('/posts')
}
```

```html
<form method="post" enctype="multipart/form-data">...</form>
```

Extensions are checked by name. PocketBase checks what the file is when you save it, if the field of your collection has MIME types set.

## Methods HTML forms cannot send

A form can only `GET` or `POST`. Add a hidden `_method` field and the request is treated as a `PUT`, `PATCH` or `DELETE`, which are the `+put.js`, `+patch.js` and `+delete.js` loaders next to your page:

```html
<form method="post" action="/posts/42">
  <input type="hidden" name="_method" value="DELETE" />
  <button>Delete</button>
</form>
```

`request.method` is the method the request was turned into, everywhere. Only `POST` forms of pages are looked at, so a stray `_method` in a query string does nothing. If you use the [security plugin](/docs/plugins/security), the CSRF check sees the new method too.

## Invalid forms and status codes

A page that shows a form with errors is answered with `200 OK`, as every page is. Say what status you want:

```javascript
forms.parse(schema, { status: 422 })
```

or for all forms, in the config (`invalidStatus: 422`). Be careful with [htmx](/docs/htmx): it does not swap content into the page for error statuses unless you tell it to (listen to `htmx:beforeSwap` and set `shouldSwap`).

## Messages

```javascript
// +config.js
module.exports = {
  plugins: [
    'pocketpages-plugin-ejs',
    {
      name: 'pocketpages-plugin-forms',
      messages: {
        required: 'Falta {label}',
        email: 'Escribe un correo electrónico válido',
      },
    },
  ],
}
```

The rules are `required`, `email`, `url`, `int`, `number`, `date`, `datetime`, `minLength`, `maxLength`, `min`, `max`, `pattern`, `oneOf`, `match`, `minItems`, `maxItems`, `fileSize`, `fileType` and `custom`. `{label}`, `{min}`, `{max}` and `{accept}` are filled in.

A site in several languages passes the messages for the language of the visitor when it parses: `forms.parse(schema, { messages: { required: t('forms.required') } })`.

## Options

```javascript
{
  name: 'pocketpages-plugin-forms',
  methodOverride: true,   // honor the hidden field described above
  methodField: '_method', // its name
  invalidStatus: 422,     // status of invalid forms, left alone unless set
  messages: {},           // see above
}
```
