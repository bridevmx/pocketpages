/**
 * Numbers and dates the way each language writes them. The JS runtime of PocketBase has
 * no `Intl`, so the few things that differ are here. They are the common ones; whatever
 * a language needs that is not here can be given in its translation file, under `_format`.
 */

export type NumberFormat = { group: string; decimal: string }

export type DateNames = {
  months: string[]
  monthsShort: string[]
  days: string[]
  daysShort: string[]
  am: string
  pm: string
}

export type DateFormats = {
  short: string
  medium: string
  long: string
  time: string
}

export type LocaleFormat = {
  number?: Partial<NumberFormat>
  names?: Partial<DateNames>
  dates?: Partial<DateFormats>
}

const COMMA_DOT: NumberFormat = { group: ',', decimal: '.' }
const DOT_COMMA: NumberFormat = { group: '.', decimal: ',' }
const SPACE_COMMA: NumberFormat = { group: ' ', decimal: ',' }
const NARROW_SPACE_COMMA: NumberFormat = { group: ' ', decimal: ',' }

const NUMBERS: Record<string, NumberFormat> = {}
const numbers = (languages: string, format: NumberFormat) =>
  languages.split(' ').forEach((l) => (NUMBERS[l] = format))
numbers('en ja zh ko th he hi ar', COMMA_DOT)
numbers('de es it pt nl id tr da el ro hr sl sr bs vi ca eu gl', DOT_COMMA)
numbers('fr', NARROW_SPACE_COMMA)
numbers('ru uk be pl cs sk sv nb nn no fi bg hu lt lv et', SPACE_COMMA)

const EN_NAMES: DateNames = {
  months: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  monthsShort: [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ],
  days: [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ],
  daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  am: 'AM',
  pm: 'PM',
}

const NAMES: Record<string, DateNames> = {
  en: EN_NAMES,
  es: {
    months: [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ],
    monthsShort: [
      'ene',
      'feb',
      'mar',
      'abr',
      'may',
      'jun',
      'jul',
      'ago',
      'sep',
      'oct',
      'nov',
      'dic',
    ],
    days: [
      'domingo',
      'lunes',
      'martes',
      'miércoles',
      'jueves',
      'viernes',
      'sábado',
    ],
    daysShort: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
    am: 'a. m.',
    pm: 'p. m.',
  },
  pt: {
    months: [
      'janeiro',
      'fevereiro',
      'março',
      'abril',
      'maio',
      'junho',
      'julho',
      'agosto',
      'setembro',
      'outubro',
      'novembro',
      'dezembro',
    ],
    monthsShort: [
      'jan',
      'fev',
      'mar',
      'abr',
      'mai',
      'jun',
      'jul',
      'ago',
      'set',
      'out',
      'nov',
      'dez',
    ],
    days: [
      'domingo',
      'segunda-feira',
      'terça-feira',
      'quarta-feira',
      'quinta-feira',
      'sexta-feira',
      'sábado',
    ],
    daysShort: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
    am: 'AM',
    pm: 'PM',
  },
  fr: {
    months: [
      'janvier',
      'février',
      'mars',
      'avril',
      'mai',
      'juin',
      'juillet',
      'août',
      'septembre',
      'octobre',
      'novembre',
      'décembre',
    ],
    monthsShort: [
      'janv.',
      'févr.',
      'mars',
      'avr.',
      'mai',
      'juin',
      'juil.',
      'août',
      'sept.',
      'oct.',
      'nov.',
      'déc.',
    ],
    days: [
      'dimanche',
      'lundi',
      'mardi',
      'mercredi',
      'jeudi',
      'vendredi',
      'samedi',
    ],
    daysShort: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
    am: 'AM',
    pm: 'PM',
  },
  de: {
    months: [
      'Januar',
      'Februar',
      'März',
      'April',
      'Mai',
      'Juni',
      'Juli',
      'August',
      'September',
      'Oktober',
      'November',
      'Dezember',
    ],
    monthsShort: [
      'Jan.',
      'Feb.',
      'März',
      'Apr.',
      'Mai',
      'Juni',
      'Juli',
      'Aug.',
      'Sept.',
      'Okt.',
      'Nov.',
      'Dez.',
    ],
    days: [
      'Sonntag',
      'Montag',
      'Dienstag',
      'Mittwoch',
      'Donnerstag',
      'Freitag',
      'Samstag',
    ],
    daysShort: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
    am: 'AM',
    pm: 'PM',
  },
  it: {
    months: [
      'gennaio',
      'febbraio',
      'marzo',
      'aprile',
      'maggio',
      'giugno',
      'luglio',
      'agosto',
      'settembre',
      'ottobre',
      'novembre',
      'dicembre',
    ],
    monthsShort: [
      'gen',
      'feb',
      'mar',
      'apr',
      'mag',
      'giu',
      'lug',
      'ago',
      'set',
      'ott',
      'nov',
      'dic',
    ],
    days: [
      'domenica',
      'lunedì',
      'martedì',
      'mercoledì',
      'giovedì',
      'venerdì',
      'sabato',
    ],
    daysShort: ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'],
    am: 'AM',
    pm: 'PM',
  },
}

const EN_DATES: DateFormats = {
  short: 'MM/DD/YYYY',
  medium: 'MMM D, YYYY',
  long: 'MMMM D, YYYY',
  time: 'h:mm A',
}
const DMY: DateFormats = {
  short: 'DD/MM/YYYY',
  medium: 'D MMM YYYY',
  long: 'D MMMM YYYY',
  time: 'HH:mm',
}
const DATES: Record<string, DateFormats> = {
  en: EN_DATES,
  es: {
    short: 'D/M/YYYY',
    medium: 'D MMM YYYY',
    long: 'D [de] MMMM [de] YYYY',
    time: 'H:mm',
  },
  pt: {
    short: 'DD/MM/YYYY',
    medium: 'D [de] MMM [de] YYYY',
    long: 'D [de] MMMM [de] YYYY',
    time: 'HH:mm',
  },
  fr: DMY,
  it: {
    short: 'DD/MM/YYYY',
    medium: 'D MMM YYYY',
    long: 'D MMMM YYYY',
    time: 'HH:mm',
  },
  de: {
    short: 'DD.MM.YYYY',
    medium: 'DD.MM.YYYY',
    long: 'D. MMMM YYYY',
    time: 'HH:mm',
  },
  nl: {
    short: 'DD-MM-YYYY',
    medium: 'D MMM YYYY',
    long: 'D MMMM YYYY',
    time: 'HH:mm',
  },
  ru: {
    short: 'DD.MM.YYYY',
    medium: 'D MMM YYYY',
    long: 'D MMMM YYYY',
    time: 'HH:mm',
  },
  pl: {
    short: 'DD.MM.YYYY',
    medium: 'D MMM YYYY',
    long: 'D MMMM YYYY',
    time: 'HH:mm',
  },
  ja: {
    short: 'YYYY/MM/DD',
    medium: 'YYYY/MM/DD',
    long: 'YYYY年M月D日',
    time: 'H:mm',
  },
  zh: {
    short: 'YYYY/M/D',
    medium: 'YYYY年M月D日',
    long: 'YYYY年M月D日',
    time: 'HH:mm',
  },
  ko: {
    short: 'YYYY. M. D.',
    medium: 'YYYY. M. D.',
    long: 'YYYY년 M월 D일',
    time: 'a h:mm',
  },
}

const lang = (locale: string) => locale.split('-')[0]!.toLowerCase()

export const numberFormatOf = (
  locale: string,
  custom?: Partial<NumberFormat>
): NumberFormat => ({
  ...(NUMBERS[lang(locale)] ?? COMMA_DOT),
  ...custom,
})

export const dateNamesOf = (
  locale: string,
  custom?: Partial<DateNames>
): DateNames => ({
  ...(NAMES[lang(locale)] ?? EN_NAMES),
  ...custom,
})

export const dateFormatsOf = (
  locale: string,
  custom?: Partial<DateFormats>
): DateFormats => ({
  ...(DATES[lang(locale)] ?? EN_DATES),
  ...custom,
})

export type FormatNumberOptions = {
  /** Digits after the decimal separator, as many as the number has unless told otherwise */
  decimals?: number
  /** Leave out the separators between thousands */
  grouping?: boolean
}

/**
 * `1234567.891` is `1,234,567.891` in English and `1.234.567,891` in German
 */
export const formatNumber = (
  value: number,
  format: NumberFormat,
  options: FormatNumberOptions = {}
): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value)
  const fixed =
    options.decimals !== undefined
      ? Math.abs(value).toFixed(Math.max(0, Math.min(20, options.decimals)))
      : String(Math.abs(value))
  // Numbers JS writes with an exponent (1e21, 1e-7) are not worth grouping
  if (/e/i.test(fixed)) return String(value)
  const [integer, fraction] = fixed.split('.')
  const grouped =
    options.grouping === false
      ? integer!
      : integer!.replace(/\B(?=(\d{3})+(?!\d))/g, format.group)
  const sign = value < 0 && Number(fixed) !== 0 ? '-' : ''
  return sign + grouped + (fraction ? format.decimal + fraction : '')
}

export type DateInput = Date | string | number

/** What a date is made of in the end: the PocketBase format `2024-05-06 07:08:09.000Z` too */
export const toDate = (value: DateInput): Date | undefined => {
  let date: Date
  if (value instanceof Date) {
    date = value
  } else if (typeof value === 'number') {
    date = new Date(value)
  } else if (typeof value === 'string') {
    // PocketBase writes `2024-05-06 07:08:09.123Z`, JavaScript wants the T
    const s = value.trim()
    date = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(' ', 'T') : s)
  } else {
    return undefined
  }
  return Number.isNaN(date.getTime()) ? undefined : date
}

const pad = (n: number, length = 2) => String(n).padStart(length, '0')

const TOKEN =
  /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/g

/**
 * Writes a date with a pattern. `YYYY` year, `MM` month (`MMM` and `MMMM` its name), `DD`
 * day of the month, `dddd` and `ddd` the weekday, `HH` hours (24) and `hh` (12),
 * `mm` minutes, `ss` seconds, `A` AM or PM. Text in `[brackets]` is left as it is.
 */
export const formatDate = (
  date: Date,
  pattern: string,
  names: DateNames,
  utc = true
): string => {
  const year = utc ? date.getUTCFullYear() : date.getFullYear()
  const month = utc ? date.getUTCMonth() : date.getMonth()
  const day = utc ? date.getUTCDate() : date.getDate()
  const weekday = utc ? date.getUTCDay() : date.getDay()
  const hours = utc ? date.getUTCHours() : date.getHours()
  const minutes = utc ? date.getUTCMinutes() : date.getMinutes()
  const seconds = utc ? date.getUTCSeconds() : date.getSeconds()
  const hours12 = hours % 12 === 0 ? 12 : hours % 12
  return pattern.replace(TOKEN, (token, literal?: string) => {
    if (literal !== undefined) return literal
    switch (token) {
      case 'YYYY':
        return pad(year, 4)
      case 'YY':
        return pad(year % 100)
      case 'MMMM':
        return names.months[month]!
      case 'MMM':
        return names.monthsShort[month]!
      case 'MM':
        return pad(month + 1)
      case 'M':
        return String(month + 1)
      case 'DD':
        return pad(day)
      case 'D':
        return String(day)
      case 'dddd':
        return names.days[weekday]!
      case 'ddd':
        return names.daysShort[weekday]!
      case 'HH':
        return pad(hours)
      case 'H':
        return String(hours)
      case 'hh':
        return pad(hours12)
      case 'h':
        return String(hours12)
      case 'mm':
        return pad(minutes)
      case 'ss':
        return pad(seconds)
      case 'A':
        return hours < 12 ? names.am : names.pm
      case 'a':
        return (hours < 12 ? names.am : names.pm).toLowerCase()
      default:
        return token
    }
  })
}
