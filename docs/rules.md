# Lint rules

The linter runs a set of rules over a note and marks the text each rule flags. Nothing runs until you ask.

## How a rule works

Every rule has:

- an **engine**, which decides how the rule checks text,
- a **scope**, which says what it looks at: a `sentence`, a `paragraph` or the whole `document`,
- a **severity**: `suggestion` for style, `warning` for clearer problems, `error` if you really mean it.

Four engines run locally, instantly and for free: `wordlist`, `regex`, `substitution` and `metric`. Two engines ask a model and cost money: `classifier` (Jev, a cheap yes/no model) and `llm`. They only run when you run the linter, and a setting picks which one handles them.

What gets marked depends on the engine and scope:

- `wordlist`, `regex` and `substitution` rules with sentence scope mark the exact words that matched.
- `metric` rules mark the whole sentence or paragraph they measured.
- Paragraph rules mark the whole paragraph, once.
- Document rules show in the Lint panel only. Their range is the whole note.

The linter never looks inside code blocks, inline code, frontmatter, math, comments, link targets or URLs. Curly and straight apostrophes count as the same character, so `it's` in a rule also matches `it’s` in your note.

Several rules can share a label. The built-in "AI-sounding" check, for example, is five rules with the label `AI-sounding`, and the Lint panel groups them together.

## Editing rules in settings

Settings → Vikalp → Rules lists every rule, grouped by name. A family like **Hedging** is several small rules: a phrase list, a pattern and an AI question. Switch a whole family off with its toggle, or open it to switch single checks on and off.

The pencil opens a rule in a form. **Add rule** starts a new one. Pick a kind:

| In the form | Engine in the file | What it does |
|---|---|---|
| Phrases | `wordlist` | Flags exact words or phrases. Whole words only. |
| Phrases with fixes | `substitution` | Flags a phrase and suggests a plainer one you can apply. |
| Pattern | `regex` | A regular expression, for shapes a phrase list can't catch. |
| Measurement | `metric` | Flags text when a number goes over a limit, like words in a sentence. |
| AI yes/no question | `classifier` | Jev answers a yes/no question about each sentence or paragraph. |
| AI finds quotes | `llm` | The selected model reads the note and quotes what matches your instructions. |

While you edit, the form shows how many marks the rule makes on the open note, and any problems with it. Saving writes the rule's YAML file. An edited built-in rule can be put back with **Reset to built-in**; rules you added can be deleted.

## The rule file

Rules are YAML files in `.obsidian/plugins/vikalp/rules/`, one rule per file. These fields work for every engine:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique name, no spaces. Use `my.` as a prefix for your own rules. |
| `label` | no | Name shown on marks and in the panel. Defaults to the id. |
| `description` | no | One line saying what the rule catches. |
| `scope` | no | `sentence`, `paragraph` or `document`. Defaults to `sentence`. |
| `engine` | yes | `wordlist`, `regex`, `substitution`, `metric`, `classifier` or `llm`. |
| `severity` | no | `suggestion`, `warning` or `error`. Defaults to `warning`. |
| `message` | no | Shown on the mark. `%s` becomes the matched text. |
| `judgment` | no | A yes/no question asked alongside a local engine. See below. |

If a file has a mistake, the Lint panel says what is wrong and which rule it is in, for example `Rule 'my.cold': 'threshold' must be a number between 0 and 1`. Unknown fields are errors too, so a typo like `token:` for `tokens:` does not fail silently.

### wordlist

Flags every listed word or phrase.

```yaml
id: my.corporate
label: Corporate speak
scope: sentence
engine: wordlist
tokens: [synergy, circle back, move the needle, low-hanging fruit]
ignorecase: true
message: "Corporate speak: '%s'"
severity: warning
```

Tokens match whole words only: `use` does not match "user" or "re-use". A space in a token matches any whitespace, including a line break. A hyphen matches a hyphen, a space or nothing, so `game-changer` also catches "game changer" and "gamechanger". Matching ignores case unless you set `ignorecase: false`. Tokens match exact forms, so list `delve`, `delves` and `delving` if you want all three.

### regex

Flags every match of a JavaScript regular expression.

```yaml
id: my.so-openers
label: So-openers
engine: regex
patterns:
  - '^so\b'
message: "Starts with '%s'"
severity: suggestion
```

Write patterns in **single quotes**. In double quotes YAML turns `\b` into a control character and the pattern breaks; the linter tells you if that happens. Patterns ignore case unless `ignorecase: false`, and Unicode classes like `\p{L}` work. In a sentence rule, `^` and `$` mean the start and end of the sentence. In paragraph and document rules they mean the start and end of the paragraph.

### substitution

Flags wordy phrases and offers a plain replacement you can apply.

```yaml
id: my.plain
label: Plain words
engine: substitution
swap:
  in order to: to
  utilize: use
  it should be noted that: ""
message: "Wordy: '%s'."
severity: warning
```

`%s` in the message is the matched text and `%r` the replacement. If the message has no `%r`, "Try 'to'." is added at the end. An empty replacement means "cut it". The replacement keeps a capital letter when the match starts with one. Suggestions only apply to sentence rules, since paragraph and document marks cover more than the phrase.

### metric

Measures each sentence, paragraph or the whole note and flags it when the number is above `max`.

```yaml
id: my.long-sentences
label: Long sentences
scope: sentence
engine: metric
metric: sentence-words
max: 30
minWords: 0
message: "Long sentence (%s)."
severity: suggestion
```

`minWords` skips units with fewer words than that, which keeps ratios from firing on tiny sentences. In a metric message `%s` is what was measured, for example "38 words". Headings are never measured.

| Metric | Scopes | What it measures | `%s` |
|---|---|---|---|
| `sentence-words` | any | Words per sentence (an average for paragraphs and documents) | `38 words` |
| `readability-grade` | any | Automated Readability Index: 4.71 × letters per word + 0.5 × words per sentence − 21.43 | `grade 17` |
| `long-word-ratio` | any | Share of words with three or more syllables (0 to 1) | `45% long words` |
| `adverb-density` | any | Share of words that are "-ly" adverbs (0 to 1). Words like "only", "early", "family" and "friendly" do not count. | the adverbs |
| `em-dash-density` | any | Em dashes (— or --) per 100 words. Units under 100 words count as 100. | `4 em dashes` |
| `paragraph-words` | paragraph, document | Words per paragraph | `240 words` |
| `repeated-word` | any | How often one content word (four or more letters, not a common word like "about") appears within 20 words in a paragraph. Marks the sentence where it goes over. | the word |
| `repeated-opener` | any | How many sentences in a row start with the same word. Headings and list items break a run. | the word |
| `one-sentence-paragraph-run` | paragraph, document | How many one-sentence paragraphs come in a row | `5 in a row` |
| `one-sentence-paragraph-ratio` | document | Share of paragraphs that are one sentence (0 to 1). Needs at least 5 paragraphs. | `70% of paragraphs` |

### classifier

Asks a yes/no question about every unit in scope. The unit is flagged when the model's probability of "yes" is at or above `threshold`.

```yaml
id: my.cold
label: Too cold
scope: paragraph
engine: classifier
question: "Does this paragraph read as emotionally cold or detached?"
threshold: 0.65
```

Phrase the question so "yes" means "flag this". Sentence rules ask once per sentence, paragraph rules once per paragraph, document rules once per note.

### llm

Sends each unit to the selected model with your instructions. The model answers with exact quotes and a short reason.

```yaml
id: my.jargon
label: Jargon
scope: paragraph
engine: llm
prompt: "Quote any phrase a smart reader outside tech would not understand."
```

### Adding a judgment to a local rule

Any local rule can also ask a yes/no question, to catch what its list or number misses:

```yaml
id: my.hedges
label: Hedging
engine: wordlist
tokens: [I think, perhaps]
judgment:
  question: "Does this sentence hedge or soften its claim more than it needs to?"
  threshold: 0.7
  message: "Hedges more than it needs to"
```

The word list runs every time. The question only runs with the judgment rules.

## Built-in rules

The built-ins are written to the rules folder on first run, so you can edit or delete them like your own.

| Label | Rule id | Scope | Engine | Catches |
|---|---|---|---|---|
| Hedging | `hedging` | sentence | wordlist + judgment | "I think", "perhaps", "it seems", "probably" |
| Hedging | `hedging.softeners` | sentence | regex | "kind of", "sort of", "in a way" used as softeners, not as nouns ("this kind of bug" is fine) |
| Hedging | `hedging.weasels` | sentence | wordlist | "studies show", "experts agree", "many people say" |
| Wordy | `wordy` | sentence | substitution | about 150 padded phrases, each with a plain replacement |
| Wordy | `wordy.fillers` | sentence | wordlist | "basically", "really", "very", "at the end of the day" |
| Wordy | `wordy.long-sentence` | sentence | metric | sentences over 35 words |
| Verbose | `verbose` | paragraph | metric + judgment | paragraphs over 250 words, or that say one thing more than once |
| Complicated | `complicated` | sentence | metric | reading grade above 16, for sentences of 12 words or more |
| Complicated | `complicated.long-words` | sentence | metric | more than 40% long words, for sentences of 8 words or more |
| AI-sounding | `ai-sounding.words` | sentence | wordlist | "delve", "tapestry", "pivotal", "testament", "vibrant" |
| AI-sounding | `ai-sounding.phrases` | sentence | wordlist | "it's important to note", "in today's fast-paced world", "a crucial role" |
| AI-sounding | `ai-sounding.patterns` | sentence | regex | "not just X, but Y", "it's not X, it's Y", trailing ", highlighting the…", "serves as a reminder" |
| AI-sounding | `ai-sounding.em-dashes` | paragraph | metric | more than two em dashes per 100 words |
| AI-sounding | `ai-sounding.paragraph` | paragraph | classifier | paragraphs that read like generic chatbot text |
| LinkedIn voice | `linkedin-voice.phrases` | sentence | wordlist | "Here's what I learned", "Let that sink in", "I'm humbled", "Unpopular opinion" |
| LinkedIn voice | `linkedin-voice.closers` | sentence | regex | "Agree?", "Thoughts?", "The result?" as a sentence on their own |
| LinkedIn voice | `linkedin-voice.emoji-bullets` | paragraph | regex | paragraphs and list items that start with an emoji |
| LinkedIn voice | `linkedin-voice.buzzwords` | sentence | wordlist | "synergy", "circle back", "move the needle" |
| LinkedIn voice | `linkedin-voice.one-liners` | paragraph | metric | more than three one-sentence paragraphs in a row |
| LinkedIn voice | `linkedin-voice.short-paragraphs` | document | metric | notes where over 60% of paragraphs are one sentence |
| LinkedIn voice | `linkedin-voice.post` | document | classifier | notes that read like a LinkedIn post |
| Repetition | `repetition.words` | sentence | metric | the same word three times within 20 words |
| Repetition | `repetition.openers` | sentence | metric | three sentences in a row starting with the same word |
| Repetition | `repetition.doubled` | sentence | regex | "the the" (but not "that that" or "had had") |
| Awkward | `awkward` | sentence | classifier | sentences that are hard to follow on a first read |
| Passive voice | `passive` | sentence | regex | passives that name who acted: "was written by", "were made by" |
| Adverbs | `adverbs` | sentence | metric | more than 12% "-ly" adverbs, for sentences of 9 words or more |

The lists aim for few false positives. Some choices that follow from that:

- "just", "may", "could" and "often" are not flagged. They are usually accurate, not hedges. Add "just" to your copy of `wordy.fillers` if you want it.
- Agentless passives like "mistakes were made" are not flagged, because most of them are fine. To flag every passive, remove the `\s+by\b…` part at the end of the `passive` pattern.
- Common words that chatbots overuse but people use too ("crucial", "enhance", "landscape", "key") are not in the AI word list.
- Rule-of-three lists ("the obvious, the easy, and the possible") are left to the `ai-sounding.paragraph` judgment. A pattern cannot tell a good list from a tic.

## Adding your own rule

1. Create a `.yaml` file in `.obsidian/plugins/vikalp/rules/`, or select a phrase and run **Vikalp: New rule from selection** to start from a word list.
2. Give it an `id` starting with `my.` and an `engine`, plus the fields that engine needs.
3. Run the linter. If the file has a mistake, the Lint panel says what to fix.

To change a built-in, edit its file in the same folder. To turn one off, use the enabled-rules setting.

## Sources

- Hedges, weasel words and fillers are modeled on the `hedges`, `weasels` and `fillers` word-list packages by Titus Wormer, used by [retext-intensify](https://github.com/retextjs/retext-intensify), MIT licence. The lists here are cut down and rewritten for precision.
- AI-overused words and phrases come from Wikipedia's [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) page, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The `berenslab/llm-excess-vocab` research list was not used, because its licence was not checked at build time.
- Wordy-to-plain substitutions follow the plain-language lists in write-good, proselint and the US federal Plain Language guidelines.
- The rule shapes (existence, substitution, metric) follow [Vale](https://vale.sh) styles. The readability formula is the Automated Readability Index (Senter and Smith, 1967).
