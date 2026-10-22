import { selectBeginnerExample } from '../public/data/beginner-examples.js';
export function buildPublicSpeechEntries(catalog) {
  const texts = new Set();
  const add = value => {
    if (typeof value !== 'string') return;
    const text = value.replace(/\s+/g, ' ').trim();
    if (text) texts.add(text);
  };
  for (const word of catalog.words || []) {
    add(word.word);
    for (const example of word.examples || []) {
      add(example.sentence);
      for (const collocation of example.collocations || []) add(collocation.phrase);
    }
    for (const collocation of word.collocations || []) add(collocation.phrase);
  }
  // Append new teaching sentences after the original entries so old tabs keep
  // their exact public speech IDs while the catalog gains simpler examples.
  for (const word of catalog.words || []) {
    try { add(selectBeginnerExample(word)?.sentence); } catch { /* Keep original public entries usable when optional teaching data is incomplete. */ }
  }
  return [...texts];
}

export function splitSpeechText(text) {
  const chunks = [];
  let current = '';
  for (let word of text.split(/\s+/)) {
    if (current && current.length + word.length + 1 > 180) {
      chunks.push(current);
      current = '';
    }
    while (word.length > 180) { chunks.push(word.slice(0, 180)); word = word.slice(180); }
    if (word) current = current ? `${current} ${word}` : word;
  }
  if (current) chunks.push(current);
  return chunks;
}
