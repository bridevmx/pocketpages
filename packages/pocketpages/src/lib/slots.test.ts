import { expect, test } from 'bun:test'
import { parseSlots } from './slots'

/** parseSlots() before it learned to skip content without slots */
const reference = (input: string) => {
  const regex = /<!--\s*slot:(\w+)\s*-->([\s\S]*?)(?=<!--\s*slot:\w+\s*-->|$)/g
  const slots: Record<string, string> = {}
  let lastIndex = 0
  let cleanedContent = ''
  let match: RegExpExecArray | null
  while ((match = regex.exec(input)) !== null) {
    const name = match[1]
    const content = match[2]?.trim()
    if (name && content) {
      slots[name] = content
      cleanedContent += input.slice(lastIndex, match.index)
      lastIndex = match.index + match[0].length
    }
  }
  cleanedContent += input.slice(lastIndex)
  return { slots, content: cleanedContent.trim() }
}

const samples = [
  '',
  '   ',
  '<h1>No slots</h1>\n',
  '  <p>padded</p>  ',
  '<!-- slot:head --><meta name="a">\n<!-- slot:default -->\n<h1>Body</h1>',
  '<h1>Before</h1><!-- slot:head -->\n  <title>x</title>\n<!--slot:foot-->footer',
  '<!-- slot:empty --><!-- slot:next -->content',
  '<!-- a normal comment --><p>slot: is just text here</p>',
  'slot: <!-- slot -->',
  '<!-- slot:a -->one<!-- slot:a -->two',
]

test('parseSlots keeps its behaviour', () => {
  for (const sample of samples) {
    expect(parseSlots(sample)).toEqual(reference(sample))
  }
})

test('parseSlots extracts named slots and leaves the rest as content', () => {
  const result = parseSlots(
    'intro<!-- slot:head --><title>T</title><!-- slot:default --><main>M</main>'
  )
  expect(result.slots).toEqual({
    head: '<title>T</title>',
    default: '<main>M</main>',
  })
  expect(result.content).toBe('intro')
})
